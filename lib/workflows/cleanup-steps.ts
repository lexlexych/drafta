import {RetryableError} from 'workflow';
export async function cleanAiLogs():Promise<void> {
  'use step';
  try {
    const {deleteAiRequestLogsBefore,AI_REQUEST_LOG_RETENTION_DAYS}=await import('@/lib/db/ai-request-log');
    await deleteAiRequestLogsBefore(new Date(Date.now()-AI_REQUEST_LOG_RETENTION_DAYS*86400000).toISOString());
  } catch {throw new RetryableError('cleanup_ai_log_failed',{retryAfter:'1m'});}
}
cleanAiLogs.maxRetries=2;
export async function cleanPublicationAssets():Promise<void> {
  'use step';
  try {
    const {cleanupPublicationAssets}=await import('@/lib/jobs/cleanup-publication-assets');
    await cleanupPublicationAssets();
    const {reconcileBackgroundOperations}=await import('./recovery');
    await reconcileBackgroundOperations();
  } catch {throw new RetryableError('cleanup_assets_failed',{retryAfter:'1m'});}
}
cleanPublicationAssets.maxRetries=2;
