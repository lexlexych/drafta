import {start} from 'workflow/api';
import {authorizedCron} from '@/lib/workflows/cron';
import {cleanupAiRequestLogWorkflow} from '@/lib/workflows/cleanup-ai-request-log';
export async function GET(request:Request) {
  if(!authorizedCron(request))return new Response(null,{status:401});
  await start(cleanupAiRequestLogWorkflow,[],{region:'fra1',experimental_retention:0});
  return Response.json({accepted:true},{status:202});
}
