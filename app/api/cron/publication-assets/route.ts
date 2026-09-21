import {start} from 'workflow/api';
import {authorizedCron} from '@/lib/workflows/cron';
import {cleanupPublicationAssetsWorkflow} from '@/lib/workflows/cleanup-publication-assets';
export async function GET(request:Request) {
  if(!authorizedCron(request))return new Response(null,{status:401});
  await start(cleanupPublicationAssetsWorkflow,[],{region:'fra1',experimental_retention:0});
  return Response.json({accepted:true},{status:202});
}
