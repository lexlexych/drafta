import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace, listUserWorkspaces } from "@/lib/db/workspace";
import { check, validateAuthorization } from "@/lib/publications/server";
import { hash, secret } from "@/lib/publications/security";

export const dynamic = "force-dynamic";
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string,string | string[] | undefined>> }) {
  const input = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (typeof value === "string") params.set(key, value);
  try { validateAuthorization(params); }
  catch { return <main style={{ padding: 32 }}><h1>Не удалось подключить ChatGPT</h1><p>Проверьте настройки OAuth и начните подключение заново из ChatGPT.</p></main>; }
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
  return <main style={{ maxWidth: 640, margin: "40px auto", padding: 24 }}>
    <h1>Подключить ChatGPT к Drafta</h1>
    <p>Разрешите общему GPT Drafta читать выбранные категории и отправлять текст и изображения в ваши черновики. Публиковать в соцсети он не сможет.</p>
    <form action={consent}>
      <label>Рабочее пространство <select name="workspace_id" defaultValue={current?.id} required>
        {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select></label>
      <fieldset style={{ margin: "24px 0" }}><legend>Категории, доступные ChatGPT</legend>
        <p>Отметьте разрешённые категории. Будут переданы только категории выбранного выше workspace, также выбранные в настройках конкретного черновика.</p>
        {workspaces.map(w => <div key={w.id}><strong>{w.name}</strong>
          {(categories ?? []).filter(c => c.workspace_id === w.id).map(c => <label key={c.id} style={{ display: "block", margin: "8px 0" }}>
            <input type="checkbox" name="kb_ids" value={c.id} /> {c.name}
          </label>)}
        </div>)}
      </fieldset>
      <p>Выбранные знания и сведения о бренде из черновика будут доступны в вашем разговоре с ChatGPT. Доступ действует до 30 дней; отключить его можно в панели создания публикаций.</p>
      <button type="submit" name="decision" value="allow">Разрешить подключение</button>{" "}
      <button type="submit" name="decision" value="deny">Отмена</button>
    </form>
  </main>;
}
