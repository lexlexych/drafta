import "server-only";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { randomUUID } from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { resolveChannelAdapter } from "@/lib/channels/registry";
import { PublicationTransportError, type PublishPostResult } from "@/lib/channels/types";
import "@/lib/channels/zernio";
import { check, PublicationError } from "./server";

type Media = {type: "image" | "document"; url: string; path: string};
type Snapshot = {title: string; body: string; kind: string; assetIds: string[]};
export async function deliveryStatus(workspaceId: string, draftId: string) {
  const {data,error} = await createAdminSupabaseClient().from("publication_deliveries").select("id,channel_id,status,published_url,error,updated_at").eq("workspace_id",workspaceId).eq("draft_id",draftId).order("created_at");
  check(error); return data ?? [];
}
export async function preparePublicationMedia(workspaceId: string, draftId: string, snapshot: Snapshot, platform: string): Promise<Media[]> {
  const db = createAdminSupabaseClient();
  const pdf = snapshot.kind === "carousel" && platform === "linkedin" ? await PDFDocument.create() : null;
  const media: Media[] = [];
  async function store(bytes: Uint8Array, type: "image" | "document") {
    if(bytes.length>10485760)throw new PublicationError(422,"Подготовленный файл больше 10 МБ. Уменьшите число или размер слайдов.");
    const id = randomUUID(); const path = `${workspaceId}/${draftId}/${id}.${type === "image" ? "jpg" : "pdf"}`;
    const mime = type === "image" ? "image/jpeg" : "application/pdf";
    const uploaded = await db.storage.from("publication-assets").upload(path,bytes,{contentType:mime}); check(uploaded.error);
    const saved = await db.from("publication_assets").insert({id,workspace_id:workspaceId,draft_id:draftId,storage_path:path,mime_type:mime}); check(saved.error);
    const signed = await db.storage.from("publication-assets").createSignedUrl(path,7*86400); check(signed.error);
    media.push({type,url:signed.data!.signedUrl,path});
  }
  let dimensions: {width:number;height:number}|undefined;
  for (const assetId of snapshot.assetIds) {
    const asset = await db.from("publication_assets").select("storage_path").eq("workspace_id",workspaceId).eq("draft_id",draftId).eq("id",assetId).single(); check(asset.error);
    const file = await db.storage.from("publication-assets").download(asset.data!.storage_path); check(file.error);
    const source = Buffer.from(await file.data!.arrayBuffer());
    const metadata = await sharp(source,{limitInputPixels:40000000}).rotate().metadata();
    if (!dimensions) {
      const rotated = [5,6,7,8].includes(metadata.orientation ?? 1);
      const width = (rotated ? metadata.height : metadata.width) ?? 1080;
      const height = (rotated ? metadata.width : metadata.height) ?? 1350;
      const ratio = Math.min(1.91, Math.max(0.8,width/height));
      dimensions = {width:1080,height:Math.round(1080/ratio)};
    }
    // Contain instead of cropping: labels/products at the edges must remain visible.
    const bytes = await sharp(source,{limitInputPixels:40000000}).rotate().resize({...dimensions,fit:"contain",background:"#ffffff"}).flatten({background:"#ffffff"}).jpeg({quality:92}).toBuffer();
    if (pdf) {
      const image = await pdf.embedJpg(bytes); const page = pdf.addPage([image.width,image.height]); page.drawImage(image,{x:0,y:0,width:image.width,height:image.height});
    } else await store(bytes,"image");
  }
  if (pdf) await store(await pdf.save(),"document");
  return media;
}
export async function runPublicationDelivery(workspaceId: string, deliveryId: string, beforeSend:()=>Promise<void> = async()=>{}) {
  const db = createAdminSupabaseClient();
  const row = await db.from("publication_deliveries").select("*").eq("workspace_id",workspaceId).eq("id",deliveryId).maybeSingle(); check(row.error);
  const job = row.data;
  if (!job || !["pending","sending","uncertain","failed"].includes(job.status)) return;
  async function update(patch: Record<string,unknown>) {
    const {error} = await db.from("publication_deliveries").update({...patch,updated_at:new Date().toISOString()}).eq("workspace_id",workspaceId).eq("id",deliveryId);check(error);
  }
  const member = await db.from("workspace_members").select("user_id").eq("workspace_id",workspaceId).eq("user_id",job.created_by).maybeSingle();check(member.error);
  const channel = await db.from("channel_connections").select("provider,external_id,platform,status").eq("workspace_id",workspaceId).eq("id",job.channel_id).maybeSingle();check(channel.error);
  if (!member.data || !channel.data || channel.data.status!=="active" || !["instagram","linkedin"].includes(channel.data.platform)) {
    await update({status: job.first_sent_at ? "uncertain" : "failed",error:"Доступ автора или подключение канала недоступно. Проверьте настройки."});return;
  }
  const c=channel.data; const adapter=resolveChannelAdapter(c.provider);
  if (!adapter.publishPost || !adapter.getPublishedPost || !adapter.retryPublishPost) throw new PublicationError(400,"Публикация в этот канал недоступна.");
  const snapshot=job.snapshot as Snapshot;
  let outcome: PublishPostResult;
  try {
    if (job.remote_id) {
      outcome=await adapter.getPublishedPost({remoteId:job.remote_id,externalAccountId:c.external_id});
      if(outcome.status==="failed" && job.status==="pending" && !job.check_only) {
        await update({status:"sending"});
        await beforeSend();
        outcome=await adapter.retryPublishPost({remoteId:job.remote_id,externalAccountId:c.external_id});
      }
    } else {
      // Provider idempotency lasts five minutes. Never blindly create another public post after that window.
      if(job.first_sent_at || job.check_only) {
        const found=await adapter.findPublishedPost?.({requestId:job.id,externalAccountId:c.external_id,since:job.created_at});
        if(found){await update({remote_id:found.remoteId,status:found.status==="pending"?"sending":found.status,published_url:found.url??null,error:null});return;}
        await update({status:"uncertain",error:"Не удалось подтвердить результат отправки. Проверьте профиль в соцсети; повторная отправка остановлена, чтобы избежать дубля."});return;
      }
      let media=job.media as Media[]|null;
      if(!media) { media=await preparePublicationMedia(workspaceId,job.draft_id,snapshot,c.platform);await update({media}); }
      // Recheck access after potentially slow media processing, immediately before the external send.
      const access=await db.from("workspace_members").select("user_id").eq("workspace_id",workspaceId).eq("user_id",job.created_by).maybeSingle();check(access.error);
      const connection=await db.from("channel_connections").select("status").eq("workspace_id",workspaceId).eq("id",job.channel_id).maybeSingle();check(connection.error);
      if(!access.data||connection.data?.status!=="active"){await update({status:"failed",error:"Подключение или доступ автора изменились. Проверьте настройки."});return;}
      await update({status:"sending",first_sent_at:job.first_sent_at ?? new Date().toISOString()});
      await beforeSend();
      outcome=await adapter.publishPost({requestId:job.id,externalAccountId:c.external_id,platform:c.platform as "instagram"|"linkedin",title:snapshot.title,body:snapshot.body,media:media.map(({type,url})=>({type,url}))});
    }
  } catch(error) {
    if(error instanceof PublicationTransportError && !error.retryable) { await update({status:error.uncertain?"uncertain":"failed",error:error.message,...(!error.uncertain&&!job.remote_id?{first_sent_at:null,media:null}:{})});return; }
    throw error;
  }
  // Persist the remote ID first, before other DB work: subsequent attempts only read/retry this same post.
  await update({remote_id:outcome.remoteId,status:outcome.status==="pending"?"sending":outcome.status,published_url:outcome.url ?? null,error:outcome.status==="failed"?"Соцсеть отклонила публикацию. Проверьте подключение и повторите отправку.":null});
  if(outcome.status==="pending" && Date.now()-Date.parse(job.created_at)>86400000) await update({status:"uncertain",error:"Публикация ещё не подтверждена. Обновите статус позже."});
}
