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
