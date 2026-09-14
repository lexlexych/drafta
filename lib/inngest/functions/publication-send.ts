import { inngest } from "../client";
import { publicationSendRequested } from "@/lib/publications/events";
import { runPublicationDelivery } from "@/lib/publications/publishing";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { check } from "@/lib/publications/server";
export const publicationSend = inngest.createFunction({
  id:"publication-send",triggers:[publicationSendRequested],retries:3,
  concurrency:{limit:1,key:"event.data.deliveryId"},
  onFailure:async({event})=>{
    const {workspaceId,deliveryId}=event.data.event.data;
    const db=createAdminSupabaseClient();
    const row=await db.from("publication_deliveries").select("first_sent_at").eq("workspace_id",workspaceId).eq("id",deliveryId).maybeSingle();check(row.error);
    const {error}=await db.from("publication_deliveries").update({status:row.data?.first_sent_at?"uncertain":"failed",error:"Не удалось завершить отправку. Проверьте статус публикации и подключение канала.",updated_at:new Date().toISOString()}).eq("workspace_id",workspaceId).eq("id",deliveryId).in("status",["pending","sending"]);check(error);
  },
},async({event,step})=>{
  await step.run("publish",async()=>{await runPublicationDelivery(event.data.workspaceId,event.data.deliveryId);});
  return {deliveryId:event.data.deliveryId};
});
export const recoverPublicationDeliveries=inngest.createFunction({id:"recover-publication-deliveries",triggers:[{cron:"* * * * *"}],retries:1},async({step})=>{
  const ids=await step.run("pending-ids",async()=>{
    const {data,error}=await createAdminSupabaseClient().from("publication_deliveries").select("id,workspace_id").in("status",["pending","sending"]).lt("updated_at",new Date(Date.now()-60000).toISOString()).limit(100);check(error);return data ?? [];
  });
  if(ids.length)await step.sendEvent("recover",ids.map(j=>publicationSendRequested.create({workspaceId:j.workspace_id,deliveryId:j.id})));
});
