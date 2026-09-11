import { check, failure, json, memberContext, PublicationError, readJson, sameOrigin } from "@/lib/publications/server";
import { DEFAULT_CONTEXT, validId } from "@/lib/publications/types";

export async function GET(request: Request) {
  try {
    const { db, user, workspace } = await memberContext();
    const selectedId = new URL(request.url).searchParams.get("draft_id");
    if (selectedId && !validId(selectedId)) throw new PublicationError(400, "Некорректный черновик.");
    const [drafts, categories, grants, selected] = await Promise.all([
      db.from("publication_drafts").select("id,title,body,kind,status,context,asset_ids,edited_at,updated_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(100),
      db.from("kb_files").select("id,name").eq("workspace_id", workspace.id).eq("is_enabled", true).order("sort_order"),
      db.from("gpt_oauth_grants").select("id,kb_ids").eq("workspace_id", workspace.id).eq("user_id", user.id).is("revoked_at", null).not("access_hash", "is", null).gt("expires_at", new Date().toISOString()),
      selectedId ? db.from("publication_drafts").select("id,title,body,kind,status,context,asset_ids,edited_at,updated_at")
        .eq("workspace_id", workspace.id).eq("id", selectedId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    check(drafts.error); check(categories.error); check(grants.error); check(selected.error);
    return json({ drafts: drafts.data, selectedDraft: selected.data, categories: categories.data, connected: !!grants.data?.length,
      authorizedKbIds: [...new Set(grants.data?.flatMap(g => g.kb_ids) ?? [])], gptUrl: process.env.GPT_PUBLIC_URL || null });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { db, user, workspace } = await memberContext();
    const { data, error } = await db.from("publication_drafts").insert({ workspace_id: workspace.id, created_by: user.id, context: DEFAULT_CONTEXT })
      .select("id,title,body,kind,status,context,asset_ids,edited_at,updated_at").single();
    check(error); return json(data, 201);
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const { db, user, workspace } = await memberContext();
    const body = await readJson(request);
    if (body.action !== "disconnect") throw new PublicationError(400, "Некорректное действие.");
    const { error } = await db.from("gpt_oauth_grants").update({ revoked_at: new Date().toISOString(), access_hash: null, refresh_hash: null, code_hash: null })
      .eq("workspace_id", workspace.id).eq("user_id", user.id).is("revoked_at", null);
    check(error); return json({ ok: true });
  } catch (error) { return failure(error); }
}
