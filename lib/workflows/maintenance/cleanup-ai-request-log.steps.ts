import "server-only";

import {
  AI_REQUEST_LOG_RETENTION_DAYS,
  deleteAiRequestLogsBefore,
} from "@/lib/db/ai-request-log";

const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionCutoff(now: Date): string {
  return new Date(
    now.getTime() - AI_REQUEST_LOG_RETENTION_DAYS * DAY_MS,
  ).toISOString();
}

export async function deleteExpiredAiRequestLogs(
  nowIso: string,
): Promise<number> {
  "use step";

  return deleteAiRequestLogsBefore(retentionCutoff(new Date(nowIso)));
}
