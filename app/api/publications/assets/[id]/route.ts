import { check, failure, memberContext, PublicationError } from "@/lib/publications/server";
import { validId } from "@/lib/publications/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, workspace } = await memberContext(); const { id } = await params;
    if (!validId(id)) throw new PublicationError(404, "Изображение не найдено.");
    const { data: asset, error } = await db.from("publication_assets").select("storage_path,mime_type")
      .eq("workspace_id", workspace.id).eq("id", id).maybeSingle();
    check(error); if (!asset) throw new PublicationError(404, "Изображение не найдено.");
    const { data, error: downloadError } = await db.storage.from("publication-assets").download(asset.storage_path);
    check(downloadError);
    return new Response(data, { headers: { "Content-Type": asset.mime_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return failure(error); }
}
