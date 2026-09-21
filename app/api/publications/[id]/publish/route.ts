import {check,failure,json,memberContext,PublicationError,readJson,sameOrigin} from "@/lib/publications/server";
import {validId} from "@/lib/publications/types";
import {deliveryStatus} from "@/lib/publications/publishing";
import {publicationSendRequested} from "@/lib/publications/events";
import { dispatchWorkflow } from "@/lib/workflows/start";
import { reconcileSubject } from "@/lib/workflows/recovery";
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,{params}:Context){
  try {
    const {workspace,db}=await memberContext();const {id}=await params;
    if(!validId(id))throw new PublicationError(400,"Некорректный черновик.");
    const [deliveries,channels]=await Promise.all([deliveryStatus(workspace.id,id),db.from("channel_connections").select("id,name,platform").eq("workspace_id",workspace.id).eq("status","active").in("platform",["instagram","linkedin"])]);check(channels.error);
    return json({deliveries,channels:channels.data ?? []});
  }catch(error){return failure(error);}
}
export async function POST(request:Request,{params}:Context){
  try{
    sameOrigin(request);const {workspace,user,db}=await memberContext();const {id}=await params;const p=await readJson(request);
    if(!validId(id)||!Array.isArray(p.channelIds)||p.channelIds.length<1||p.channelIds.length>2||!p.channelIds.every(validId)||typeof p.version!=="string")throw new PublicationError(400,"Выберите каналы публикации.");
    const previous=await db.from('publication_deliveries').select('id').eq('workspace_id',workspace.id).eq('draft_id',id).in('channel_id',p.channelIds);
    check(previous.error);
    for(const delivery of previous.data??[])await reconcileSubject(workspace.id,'publication-send',delivery.id);
    const {data,error}=await db.rpc("queue_publication",{w:workspace.id,d:id,u:user.id,channels:p.channelIds,version:p.version});
    if(error){
      const messages:Record<string,string>={revision_conflict:"Черновик изменился. Сохраните и проверьте актуальную версию.",instagram_requires_image:"Instagram требует изображение. Добавьте картинку или выберите LinkedIn.",invalid_body:"Проверьте текст: Instagram — до 2200 знаков, LinkedIn — до 3000.",channel_unavailable:"Подключите Instagram или LinkedIn в настройках каналов.",not_publishable:"Сначала сохраните готовый черновик. Сценарий видео не публикуется.",generation_in_progress:"Дождитесь завершения генерации.",invalid_assets:"Проверьте изображения: одно для поста, от 2 до 10 для карусели."};
      for(const [key,message] of Object.entries(messages))if(error.message.includes(key))throw new PublicationError(409,message);
      check(error);
    }
    for(const job of data ?? [])if(["pending","sending"].includes(job.status)){
      const mode=await db.from('publication_deliveries').update({check_only:p.checkOnly===true})
        .eq('workspace_id',workspace.id).eq('id',job.id);check(mode.error);
      try{await dispatchWorkflow(publicationSendRequested.create({workspaceId:workspace.id,deliveryId:job.id}));}
      catch {
        // Keep the state and transport IDs: an acknowledgement may be lost
        // after acceptance. A manual retry must reconcile the same delivery.
        const {error:dispatchError}=await db.from("publication_deliveries")
          .update({error:"Не удалось подтвердить запуск отправки. Нажмите «Повторить»."})
          .eq("workspace_id",workspace.id).eq("id",job.id).in("status",["pending","sending"]);
        check(dispatchError);
      }
    }
    return json({deliveries:await deliveryStatus(workspace.id,id)},202);
  }catch(error){return failure(error);}
}
