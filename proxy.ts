import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/db/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Служебные роуты Workflows (`.well-known/workflow/`) обязаны проходить
    // мимо прокси: перехват POST /.well-known/workflow/v1/flow ломает
    // возобновление прогонов (docs/architecture/18-workflows.md).
    // PWA-ресурсы (manifest, сервис-воркер) должны отдаваться публично, без
    // редиректа на /login: манифест браузер запрашивает анонимно, а перехват
    // sw.js ломает регистрацию воркера (docs/architecture/11-realtime-pwa.md).
    "/((?!api|_next/static|_next/image|\\.well-known/workflow/|favicon.ico|manifest\\.webmanifest|sw\\.js|swe-worker-.*\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
