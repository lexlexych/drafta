import { PublicationTransportError, type PublishPostInput, type PublishPostResult } from "../types";
import type { ZernioApiConfig } from "./api";

type Post = { _id?: string; metadata?: {draftaDeliveryId?: string}; platforms?: { accountId?: string | {_id: string}; status?: string; platformPostId?: string; platformPostUrl?: string }[] };
export function normalizePublishedPost(post: Post | undefined, externalAccountId: string): PublishPostResult {
  if (!post?._id) throw new PublicationTransportError("Сервис публикации вернул неполный ответ. Проверяем статус.", true, true);
  const target = post.platforms?.find(p => (typeof p.accountId === "string" ? p.accountId : p.accountId?._id) === externalAccountId);
  return { remoteId: post._id, status: target?.status === "published" ? "published" : target?.status === "failed" ? "failed" : "pending",
    externalId: target?.platformPostId, url: target?.platformPostUrl?.startsWith("https://") ? target.platformPostUrl : undefined };
}
async function request(config: ZernioApiConfig, path: string, externalAccountId: string, body?: unknown, requestId?: string): Promise<PublishPostResult> {
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}/${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", ...(requestId ? {"x-request-id": requestId} : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000), cache: "no-store",
    });
  } catch { throw new PublicationTransportError("Ответ сети задерживается. Проверяем, опубликован ли пост.", true, true); }
  const data = await response.json().catch(() => null);
  if (response.status === 409 && typeof data?.existingPostId === "string") return request(config, `posts/${encodeURIComponent(data.existingPostId)}`, externalAccountId);
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new PublicationTransportError(response.status === 401 || response.status === 403 ? "Проверьте подключение и разрешение на публикацию в настройках каналов." : "Не удалось опубликовать. Проверьте текст, изображения и подключение канала.", retryable, response.status >= 500);
  }
  return normalizePublishedPost(data?.post ?? data?.existingPost, externalAccountId);
}
export function publishZernioPost(config: ZernioApiConfig, input: PublishPostInput) {
  return request(config, "posts", input.externalAccountId, { title: input.title, content: input.body, mediaItems: input.media,
    platforms: [{platform: input.platform, accountId: input.externalAccountId, ...(input.media.some(m => m.type === "document") ? {platformSpecificData: {documentTitle: input.title}} : {})}], publishNow: true, metadata: {draftaDeliveryId: input.requestId},
  }, input.requestId);
}
export function getZernioPublishedPost(config: ZernioApiConfig, input: {remoteId: string; externalAccountId: string}) {
  return request(config, `posts/${encodeURIComponent(input.remoteId)}`, input.externalAccountId);
}
export function retryZernioPost(config: ZernioApiConfig, input: {remoteId: string; externalAccountId: string}) {
  return request(config, `posts/${encodeURIComponent(input.remoteId)}/retry`, input.externalAccountId, {});
}

export async function findZernioPublishedPost(config: ZernioApiConfig, input: {requestId: string; externalAccountId: string; since: string}): Promise<PublishPostResult|null> {
  for(let page=1;page<=2;page++) {
    const query=new URLSearchParams({accountId:input.externalAccountId,dateFrom:input.since,sortBy:"created-desc",limit:"500",page:String(page)});
    const response=await fetch(`${config.apiBaseUrl.replace(/\/$/,"")}/posts?${query}`,{headers:{Authorization:`Bearer ${config.apiKey}`},signal:AbortSignal.timeout(30000),cache:"no-store"});
    if(!response.ok)throw new PublicationTransportError("Не удалось проверить статус публикации.",true,true);
    const data=await response.json() as {posts?:Post[]};
    if(!Array.isArray(data.posts))throw new PublicationTransportError("Неполный ответ при проверке публикации.",true,true);
    const match=data.posts.find(p=>p.metadata?.draftaDeliveryId===input.requestId);
    if(match)return normalizePublishedPost(match,input.externalAccountId);
    if(data.posts.length<500)return null;
  }
  return null;
}
