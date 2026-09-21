export type OperationInput = { workspaceId: string; operationId: string; attemptId: string };
export type JobInput = { workspaceId: string; [key: string]: string };
export type JobKind = 'generate-draft' | 'auto-reply' | 'send-message' | 'send-comment' |
  'send-comment-private-reply' | 'send-push' | 'contact-avatar' | 'post-thumbnail' |
  'publication-generation' | 'publication-import' | 'publication-send';
export type Operation = {
  id: string; workspace_id: string; attempt_id: string; run_id: string | null;
  kind: JobKind; subject_id: string; resource_id: string; input: JobInput;
  status: 'queued'|'running'|'succeeded'|'failed'|'uncertain'|'cancelled';
  effect_started: boolean; checkpoints: Record<string, unknown>; updated_at: string; created_at: string;
};
