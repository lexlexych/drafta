"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated media stays behind the workspace proxy. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/db/browser";
import { DEFAULT_CONTEXT, MAX_UPLOAD_BYTES, type PublicationContext, type PublicationDraft } from "@/lib/publications/types";
import styles from "./publication-panel.module.css";
import ui from "../../_components/ui.module.css";

type PanelData = { drafts: PublicationDraft[]; selectedDraft?: PublicationDraft | null; categories: { id: string; name: string }[]; connected: boolean; authorizedKbIds: string[]; gptUrl: string | null };
const button = `${ui.button} ${ui.buttonSmall}`;
const primary = `${button} ${ui.buttonPrimary}`;
const statusLabel = { waiting: "Ожидаем публикацию из ChatGPT", importing: "Загружаем изображения…", ready: "Черновик готов", error: "Не удалось загрузить изображения. Попросите ChatGPT отправить их повторно." };
async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось выполнить действие.");
  return data;
}
function patch(id: string, data: unknown) { return api(`/api/publications/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); }

export function PublicationDraftLinks({ selectedId }: { selectedId?: string | null }) {
  const [drafts, setDrafts] = useState<PublicationDraft[]>([]);
  useEffect(() => {
    let active = true;
    const refresh = () => { void api("/api/publications").then(data => { if (active) setDrafts(data.drafts); }).catch(() => {}); };
    refresh(); const timer = setInterval(refresh, 15000);
    window.addEventListener("publication-changed", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("publication-changed", refresh); };
  }, []);
  if (!drafts.length) return null;
  return <details className={styles.drafts} open><summary>Черновики · {drafts.length}</summary>
    {drafts.map(d => <Link key={d.id} href={`/comments?draft=${d.id}`} aria-current={selectedId === d.id ? "page" : undefined}>{d.title}</Link>)}
  </details>;
}

export function PublicationPanel({ draftId, workspaceId }: { draftId: string; workspaceId: string }) {
  const router = useRouter();
  const [data, setData] = useState<PanelData | null>(null);
  const [draft, setDraft] = useState<PublicationDraft | null>(null);
  const [context, setContext] = useState<PublicationContext>(DEFAULT_CONTEXT);
  const [title, setTitle] = useState("Новая публикация");
  const [kind, setKind] = useState<"image" | "carousel">("image");
  const [body, setBody] = useState("");
  const [assets, setAssets] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const sync = useCallback((item: PublicationDraft) => {
    setDraft(item); setContext(item.context); setTitle(item.title); setKind(item.kind);
    setBody(item.body); setAssets(item.asset_ids); setEditing(!!item.edited_at);
  }, []);
  const refresh = useCallback(async () => {
    const next: PanelData = await api(draftId === "new" ? "/api/publications" : `/api/publications?draft_id=${encodeURIComponent(draftId)}`); setData(next);
    if (draftId !== "new" && !dirtyRef.current) {
      const item = next.selectedDraft ?? next.drafts.find(d => d.id === draftId);
      if (item) sync(item); else setError("Черновик не найден в текущем рабочем пространстве.");
    }
  }, [draftId, sync]);
  useEffect(() => {
    let active = true;
    const run = () => { if (active) void refresh().catch(e => { if (active) setError(e.message); }); };
    run(); const timer = setInterval(run, 5000);
    const db = createBrowserSupabaseClient();
    const channel = db.channel(`publication-panel:${workspaceId}:${draftId}`).on("postgres_changes", {
      event: "*", schema: "public", table: "publication_drafts", filter: `workspace_id=eq.${workspaceId}`,
    }, run).subscribe();
    window.addEventListener("focus", run);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", run); void db.removeChannel(channel); };
  }, [refresh, workspaceId, draftId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    const guard = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (dirtyRef.current && link && link.target !== "_blank" && !window.confirm("Есть несохранённые изменения. Уйти без сохранения?")) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", guard, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", guard, true); };
  }, []);
  function change() { dirtyRef.current = true; setDirty(true); setMessage(""); }
  async function perform(work: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await work(); window.dispatchEvent(new Event("publication-changed")); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось выполнить действие."); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!draft) return;
    await patch(draft.id, editing ? { action: "save", context, title, body, kind, asset_ids: assets } : { action: "context", context, title, kind });
    dirtyRef.current = false; setDirty(false); await refresh(); setMessage("Сохранено");
  }
  async function upload(file: File, purpose: "logo" | "image", replaceIndex?: number) {
    if (!draft) return;
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Для ручной загрузки выберите изображение до 4 МБ.");
    if (purpose === "image" && replaceIndex === undefined && assets.length >= 10) throw new Error("Можно добавить до 10 изображений.");
    const result = await api(`/api/publications/${draft.id}/assets?purpose=${purpose}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
    if (purpose === "logo") setContext(c => ({ ...c, brand: { ...c.brand, logoAssetId: result.id } }));
    else { setEditing(true); setAssets(a => replaceIndex === undefined ? [...a, result.id] : a.map((id, i) => i === replaceIndex ? result.id : id)); }
    change();
  }
  const frozen = busy || draft?.status === "importing";
  return <div className={styles.panel}>
    <div className={styles.header}><h2>{draft ? "Черновик публикации" : "Создание публикации"}</h2>
      <button className={button} disabled={busy} onClick={() => void perform(async () => { if (dirty) await save(); router.push("/comments"); })}>Закрыть</button>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status">{message}</p>}
    {!draft && draftId === "new" && <><p>Создайте текст и изображения с помощью ChatGPT, затем отредактируйте результат здесь.</p>
      <button className={primary} disabled={busy} onClick={() => void perform(async () => {
        const created = await api("/api/publications", { method: "POST" });
        router.replace(`/comments?draft=${created.id}`);
      })}>Создать через ChatGPT</button></>}
    {draft && <div className={styles.form}>
      <p className={styles.notice} role="status">{statusLabel[draft.status]}{draft.edited_at && " · Ручное редактирование: ChatGPT больше не может перезаписать этот черновик."}</p>
      <fieldset disabled={frozen}>
        <legend>Настройки для ChatGPT</legend>
        <label>Название черновика<input value={title} maxLength={200} onChange={e => { setTitle(e.target.value); change(); }} /></label>
        <div className={styles.row}>
          <label>Тип публикации<select value={kind} onChange={e => { setKind(e.target.value as "image" | "carousel"); change(); }}><option value="image">Пост с картинкой</option><option value="carousel">Карусель</option></select></label>
          <label>Язык<select value={context.language} onChange={e => { setContext(c => ({ ...c, language: e.target.value })); change(); }}>{["Уточнить в ChatGPT","Русский","Deutsch","English","Українська"].map(v => <option key={v}>{v}</option>)}</select></label>
          <label>Формат изображения<select value={context.aspectRatio} onChange={e => { setContext(c => ({ ...c, aspectRatio: e.target.value })); change(); }}>{["1:1","4:5","9:16"].map(v => <option key={v}>{v}</option>)}</select></label>
          {kind === "carousel" && <label>Количество слайдов<select value={context.slideCount} onChange={e => { setContext(c => ({ ...c, slideCount: Number(e.target.value) })); change(); }}>{Array.from({ length: 9 }, (_, i) => <option key={i} value={i + 2}>{i + 2}</option>)}</select></label>}
        </div>
        <label className={styles.check}><input type="checkbox" checked={context.textOnImages} onChange={e => { setContext(c => ({ ...c, textOnImages: e.target.checked })); change(); }} />Текст на изображениях</label>
      </fieldset>
      <fieldset disabled={frozen}><legend>База знаний</legend><p className={styles.muted}>Выберите категории для этой публикации. При подключении ChatGPT разрешите доступ к этим же категориям.</p>
        {!data?.categories.length && <p>Добавьте факты о бизнесе в настройках базы знаний.</p>}
        {data?.categories.map(c => <label className={styles.check} key={c.id}><input type="checkbox" checked={context.kbIds.includes(c.id)} onChange={e => { setContext(old => ({ ...old, kbIds: e.target.checked ? [...old.kbIds, c.id] : old.kbIds.filter(id => id !== c.id) })); change(); }} />{c.name}</label>)}
        {data?.connected && context.kbIds.some(id => !data.authorizedKbIds.includes(id)) && <p className={styles.muted}>Для некоторых выбранных категорий нет разрешения OAuth. Переподключите Drafta в ChatGPT и отметьте их.</p>}
      </fieldset>
      <fieldset disabled={frozen}><legend>Сведения о бренде</legend><p className={styles.muted}>Передадим только отмеченные сведения. Регион и конкурентов ChatGPT возьмёт из базы знаний или уточнит у вас.</p>
        {([['audience','Аудитория'],['tone','Тон'],['colors','Цвета']] as const).map(([key,label]) => <div key={key}>
          <label className={styles.check}><input type="checkbox" checked={context.brand[key] !== undefined} onChange={e => { setContext(c => { const brand = { ...c.brand }; if (e.target.checked) brand[key] = ""; else delete brand[key]; return { ...c, brand }; }); change(); }} />{label}</label>
          {context.brand[key] !== undefined && <label><span className={styles.muted}>{label}: пожелания или «уточнить в ChatGPT»</span><input value={context.brand[key]} maxLength={2000} onChange={e => { setContext(c => ({ ...c, brand: { ...c.brand, [key]: e.target.value } })); change(); }} /></label>}
        </div>)}
        <label>Логотип (необязательно)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file) void perform(() => upload(file, "logo")); e.target.value = ""; }} /></label>
        {context.brand.logoAssetId && <div>{ }<img className={styles.logo} src={`/api/publications/assets/${context.brand.logoAssetId}`} alt="Выбранный логотип" /><button className={button} onClick={() => { setContext(c => { const brand = { ...c.brand }; delete brand.logoAssetId; return { ...c, brand }; }); change(); }}>Не передавать логотип</button></div>}
      </fieldset>
      <div className={styles.actions}>
        <button className={primary} disabled={frozen} onClick={() => void perform(save)}>Сохранить{dirty ? " изменения" : " настройки"}</button>
        {data?.gptUrl ? <a className={button} href={data.gptUrl} target="_blank" rel="noopener noreferrer" aria-disabled={dirty} onClick={e => { if (dirty) { e.preventDefault(); setError("Сначала сохраните настройки."); } }}>Открыть ChatGPT ↗</a> : <span className={styles.muted}>Ссылка на Custom GPT ещё не настроена.</span>}
        {data?.connected && <button className={button} disabled={busy} onClick={() => void perform(async () => { await api("/api/publications", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "disconnect" }) }); await refresh(); setMessage("Доступ ChatGPT отозван. Для подключения удалите прежнее соединение в ChatGPT и войдите снова."); })}>Отключить ChatGPT</button>}
      </div>
      <p className={styles.muted}>{data?.connected ? "ChatGPT подключён." : "В ChatGPT выберите «Войти в Drafta» и разрешите доступ к нужным категориям."} Начните с «Создать карусель» или «Создать пост с картинкой», опишите тему и выберите этот черновик по названию.</p>
      <fieldset disabled={frozen}><legend>Текст и изображения</legend>
        {!editing && <button className={button} onClick={() => void perform(async () => { await save(); await patch(draft.id, { action: "lock" }); await refresh(); })}>Начать ручное редактирование</button>}
        <label>Текст публикации<textarea rows={9} readOnly={!editing} value={body} maxLength={20000} onChange={e => { setBody(e.target.value); change(); }} /></label>
        <div className={styles.images}>{assets.map((id,index) => <div key={id} className={styles.image}>
          { }<img src={`/api/publications/assets/${id}`} alt={`Слайд ${index + 1}`} />
          <span className={styles.muted}>Слайд {index + 1}</span>
          {editing && <><div className={styles.actions}>
            <button aria-label={`Слайд ${index + 1} влево`} disabled={index === 0} onClick={() => { setAssets(a => { const next = [...a]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; }); change(); }}>←</button>
            <button aria-label={`Слайд ${index + 1} вправо`} disabled={index === assets.length - 1} onClick={() => { setAssets(a => { const next = [...a]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; }); change(); }}>→</button>
            <button onClick={() => { setAssets(a => a.filter(v => v !== id)); change(); }}>Удалить</button>
          </div><label>Заменить<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file) void perform(() => upload(file, "image", index)); e.target.value = ""; }} /></label></>}
        </div>)}</div>
        {editing && <label>Добавить изображение<input type="file" accept="image/png,image/jpeg,image/webp" disabled={assets.length >= 10} onChange={e => { const file = e.target.files?.[0]; if (file) void perform(() => upload(file, "image")); e.target.value = ""; }} /></label>}
      </fieldset>
      {editing && <button className={primary} disabled={frozen} onClick={() => void perform(save)}>Сохранить черновик</button>}
    </div>}
  </div>;
}
