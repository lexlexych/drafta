import { NextResponse } from "next/server";
import { start } from "workflow/api";

import { cleanupAiRequestLogWorkflow } from "@/lib/workflows/maintenance/cleanup-ai-request-log.workflow";
import { isAuthorizedCronRequest } from "@/lib/workflows/cron-auth";

/**
 * `GET /api/cron/cleanup-ai-request-log` — ночная чистка `public.ai_request_log`
 * (расписание в `vercel.json`, поведение —
 * `lib/workflows/maintenance/cleanup-ai-request-log.workflow.ts`).
 *
 * Роут только запускает прогон и сразу отвечает: удаление идёт durable. Ретенция
 * — обязательство §15, поэтому прогон живёт отдельно от роута и переживает его
 * таймаут.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const run = await start(cleanupAiRequestLogWorkflow, [], { region: "fra1" });

  return NextResponse.json({ runId: run.runId });
}
