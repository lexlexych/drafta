import { NextResponse } from "next/server";
import { start } from "workflow/api";

import { pushDigestWorkflow } from "@/lib/workflows/push/digest.workflow";
import { isAuthorizedCronRequest } from "@/lib/workflows/cron-auth";

/**
 * `GET /api/cron/push-digest` — тик сводки уведомлений каждые пять минут
 * (расписание в `vercel.json`, поведение — `lib/workflows/push/digest.workflow.ts`).
 *
 * Роут только запускает прогон и сразу отвечает: сама рассылка идёт durable, с
 * ретраями по шагам. Перекрытие тиков гасит лиза `cron:push-digest` внутри
 * прогона, поэтому здесь ничего проверять не нужно.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const run = await start(pushDigestWorkflow, [], { region: "fra1" });

  return NextResponse.json({ runId: run.runId });
}
