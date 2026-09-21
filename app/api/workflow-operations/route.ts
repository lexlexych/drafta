import {memberContext,sameOrigin,json,readJson,PublicationError,failure} from '@/lib/publications/server';
import {validId} from '@/lib/publications/types';
import {assertDb} from '@/lib/workflows/store';
import {reconcileOperation} from '@/lib/workflows/recovery';
import {retryOperation} from '@/lib/workflows/retry';
import type {Operation} from '@/lib/workflows/types';

export async function GET(request:Request) {
  try {
    const {workspace,db}=await memberContext();
    const resource=new URL(request.url).searchParams.get('resource');
    if(!resource||!validId(resource))throw new PublicationError(400,'Некорректный объект.');
    let result=await db.from('workflow_operations').select('*').eq('workspace_id',workspace.id).eq('resource_id',resource).order('updated_at',{ascending:false}).limit(30);assertDb(result.error);
    for(const row of (result.data??[]) as Operation[]) {
      try {await reconcileOperation(row);} catch { /* Keep the current state when status service is unavailable. */ }
    }
    result=await db.from('workflow_operations').select('*').eq('workspace_id',workspace.id).eq('resource_id',resource).order('updated_at',{ascending:false}).limit(30);assertDb(result.error);
    return json({operations:(result.data??[]).filter(r=>['failed','uncertain'].includes(r.status)).map(r=>({id:r.id,kind:r.kind,status:r.status,subjectId:r.subject_id}))});
  } catch(error) {return failure(error);}
}
export async function POST(request:Request) {
  try {
    sameOrigin(request);const {workspace,db}=await memberContext();const body=await readJson(request);
    if(!validId(body.operationId))throw new PublicationError(400,'Некорректная операция.');
    const {data,error}=await db.from('workflow_operations').select('*').eq('workspace_id',workspace.id).eq('id',body.operationId).maybeSingle();assertDb(error);
    if(!data)throw new PublicationError(404,'Операция не найдена.');
    try {await retryOperation(data as Operation,body.checked===true);} catch {throw new PublicationError(409,'Не удалось повторить. Проверьте результат в канале и обновите страницу.');}
    return json({accepted:true},202);
  } catch(error) {return failure(error);}
}
