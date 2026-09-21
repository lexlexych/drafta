import { randomUUID } from 'node:crypto';
import { createAdminSupabaseClient } from '@/lib/db/admin';
import { downloadImage, storeImage } from '@/lib/publications/assets';
import { check } from '@/lib/publications/server';
import type { ImportPayload } from '@/lib/publications/import';
import type { LocalSteps } from './steps';

export async function runPublicationImport(input:{workspaceId:string;importId:string},step:LocalSteps) {
  const {workspaceId,importId}=input;
  const ids=await step.run('prepare-asset-ids',()=>Array.from({length:10},()=>randomUUID()));
  const db=createAdminSupabaseClient();
  const {data:job,error}=await db.from('publication_imports').select('draft_id,payload,status,created_at')
    .eq('workspace_id',workspaceId).eq('id',importId).maybeSingle();check(error);
  if(!job || job.status!=='pending')return;
  if(Date.now()-Date.parse(job.created_at)>270_000)throw new Error('import_links_expired');
  const payload=job.payload as ImportPayload;
  const assets:string[]=[];
  for(let index=0;index<payload.file_order.length;index++) {
    assets.push(await step.run(`import-file-${index}`,async()=>{
      const file=payload.openaiFileIdRefs.find(f=>f.id===payload.file_order[index]);
      if(!file)throw new Error('import_file_missing');
      return storeImage(workspaceId,job.draft_id,ids[index],await downloadImage(file.download_link));
    }));
  }
  await step.run('finish',async()=>{
    const {error}=await db.rpc('finish_publication_import',{w:workspaceId,i:importId,a:assets,failed:false});check(error);
  });
}
