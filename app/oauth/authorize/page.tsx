import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace, listUserWorkspaces } from "@/lib/db/workspace";
import { check, validateAuthorization } from "@/lib/publications/server";
import { hash, secret } from "@/lib/publications/security";
import styles from "./authorize.module.css";

function Brand() {
  return <div className={styles.brand}>
    <Image src="/icon-192.png" alt="" width={28} height={28} />
    <span>drafta</span>
  </div>;
}

export const dynamic = "force-dynamic";
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string,string | string[] | undefined>> }) {
  const input = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (typeof value === "string") params.set(key, value);
  try { validateAuthorization(params); }
  catch {
    return <main className={styles.page} lang="ru">
      <div className={styles.container}>
        <Brand />
        <section className={styles.card} aria-labelledby="authorization-title">
          <span className={styles.badge}>Подключение ChatGPT</span>
          <h1 id="authorization-title" className={styles.title}>Не удалось подключить ChatGPT</h1>
          <p className={styles.description}>Проверьте настройки OAuth и начните подключение заново из ChatGPT.</p>
          <Link href="/comments?draft=new" className={styles.primaryButton}>Вернуться в Drafta</Link>
        </section>
      </div>
    </main>;
  }
  const user = await getAuthenticatedUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${params}`)}`);
  const workspaces = await listUserWorkspaces(user.id);
  const current = await getCurrentWorkspace(user.id);
  const db = await createServerSupabaseClient();
  const { data: categories, error } = await db.from("kb_files").select("id,workspace_id,name")
    .in("workspace_id", workspaces.map(w => w.id)).eq("is_enabled", true).order("sort_order");
  check(error);
  const requestQuery = params.toString();
  async function consent(form: FormData) {
    "use server";
    const auth = validateAuthorization(new URLSearchParams(requestQuery));
    const signedIn = await getAuthenticatedUser();
    if (!signedIn || signedIn.id !== user!.id) throw new Error("Сессия изменилась. Начните подключение заново.");
    const destination = new URL(auth.redirectUri);
    destination.searchParams.set("state", auth.state);
    if (form.get("decision") !== "allow") { destination.searchParams.set("error", "access_denied"); redirect(destination.toString()); }
    const workspaceId = String(form.get("workspace_id"));
    const available = await listUserWorkspaces(signedIn.id);
    if (!available.some(w => w.id === workspaceId)) throw new Error("Рабочее пространство недоступно.");
    const admin = createAdminSupabaseClient();
    const { data: enabled, error: kbError } = await admin.from("kb_files").select("id").eq("workspace_id", workspaceId).eq("is_enabled", true);
    check(kbError);
    const chosen = new Set(form.getAll("kb_ids").map(String));
    const kbIds = (enabled ?? []).map(c => c.id).filter(id => chosen.has(id));
    const code = secret();
    const { error: insertError } = await admin.from("gpt_oauth_grants").insert({
      workspace_id: workspaceId, user_id: signedIn.id, kb_ids: kbIds, code_hash: hash(code),
      code_expires_at: new Date(Date.now() + 300_000).toISOString(), redirect_uri: auth.redirectUri,
      code_challenge: auth.challenge,
    });
    check(insertError);
    destination.searchParams.set("code", code);
    redirect(destination.toString());
  }
  return <main className={styles.page} lang="ru">
    <div className={styles.container}>
      <Brand />
      <section className={styles.card} aria-labelledby="authorization-title">
        <header className={styles.header}>
          <span className={styles.badge}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m10 13 4-4m-7 6-1 1a4.2 4.2 0 0 1-6-6l4-4a4.2 4.2 0 0 1 6 0m4 3 1-1a4.2 4.2 0 0 1 6 6l-4 4a4.2 4.2 0 0 1-6 0" transform="translate(1 1)" /></svg>
            Подключение приложения
          </span>
          <h1 id="authorization-title" className={styles.title}>Подключить ChatGPT <span>к Drafta</span></h1>
          <p className={styles.description}>ChatGPT сможет читать выбранные знания и отправлять текст и изображения в ваши черновики. Публиковать в соцсети он не сможет.</p>
        </header>
        <form action={consent} className={styles.form}>
          <label className={styles.field}>
            <span>Рабочее пространство</span>
            <span className={styles.selectWrapper}>
              <select className={styles.select} name="workspace_id" defaultValue={current?.id} required>
                {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <svg className={styles.chevron} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </span>
          </label>
          <fieldset className={styles.knowledge} aria-describedby="knowledge-hint">
            <legend>Какие знания передать ChatGPT</legend>
            <p id="knowledge-hint" className={styles.hint}>Отметьте категории, к которым разрешаете доступ. ChatGPT получит только те из них, которые вы также выберете для конкретного черновика в этом рабочем пространстве.</p>
            <div className={styles.groups}>
              {workspaces.map(w => <div key={w.id} className={styles.group}>
                <h2 className={styles.groupTitle}>{w.name}</h2>
                <div className={styles.categoryList}>
                  {(categories ?? []).filter(c => c.workspace_id === w.id).map(c => <label key={c.id} className={styles.category}>
                    <input type="checkbox" name="kb_ids" value={c.id} />
                    <span>{c.name}</span>
                  </label>)}
                  {!(categories ?? []).some(c => c.workspace_id === w.id) && <p className={styles.empty}>Активных категорий пока нет. Их можно добавить в базе знаний Drafta.</p>}
                </div>
              </div>)}
            </div>
          </fieldset>
          <aside className={styles.notice}>
            <svg className={styles.noticeIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><path d="m8 12 3 3 5-6" /></svg>
            <div>
              <p className={styles.noticeTitle}>Доступ можно отключить в любой момент</p>
              <p>Выбранные знания и сведения о бренде будут доступны в вашем разговоре с ChatGPT. Разрешение действует до 30 дней; отозвать его можно в панели создания публикаций.</p>
            </div>
          </aside>
          <div className={styles.actions}>
            <button className={styles.primaryButton} type="submit" name="decision" value="allow">
              Разрешить подключение
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
            </button>
            <button className={styles.secondaryButton} type="submit" name="decision" value="deny">Отмена</button>
          </div>
        </form>
      </section>
      <footer className={styles.footer}><Link href="/privacy" target="_blank" rel="noopener noreferrer">Политика конфиденциальности</Link></footer>
    </div>
  </main>;
}
