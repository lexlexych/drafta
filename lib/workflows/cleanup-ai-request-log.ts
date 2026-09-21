import {cleanAiLogs} from './cleanup-steps';
export async function cleanupAiRequestLogWorkflow():Promise<void> {
  'use workflow';
  await cleanAiLogs();
}
