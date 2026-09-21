import {cleanPublicationAssets} from './cleanup-steps';
export async function cleanupPublicationAssetsWorkflow():Promise<void> {
  'use workflow';
  await cleanPublicationAssets();
}
