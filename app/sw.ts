import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Границы офлайна (docs/architecture/11-realtime-pwa.md#границы-офлайна):
 * кэшируется **только оболочка приложения** — сборочные ассеты и иконки. Любой
 * запрос с данными (страницы `(app)/*`, `/api/*`, Supabase, вебхуки) идёт
 * `NetworkOnly` — данные всегда из сети (минимизация данных, §15). Быстрая
 * навигация между разделами достигается прекэшем статики + `<Link prefetch>`
 * Next.js, а не кэшем ответов с данными.
 */
const runtimeCaching: RuntimeCaching[] = [
  {
    // Immutable build output (`/_next/static/**`) — безопасно и полезно кэшировать.
    matcher: ({ url, sameOrigin }) =>
      sameOrigin && url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({
      cacheName: "next-static-assets",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 128,
          maxAgeSeconds: 30 * 24 * 60 * 60,
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
  {
    // App-shell визуал: иконки/манифест/статичные картинки — не персональные данные.
    matcher: ({ request, url, sameOrigin }) =>
      sameOrigin &&
      (request.destination === "image" || request.destination === "font") &&
      !url.pathname.startsWith("/api/"),
    handler: new CacheFirst({
      cacheName: "static-shell-media",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 64,
          maxAgeSeconds: 30 * 24 * 60 * 60,
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
  {
    // Всё остальное — включая навигацию на страницы с данными и /api — только из сети.
    matcher: () => true,
    handler: new NetworkOnly(),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
});

serwist.addEventListeners();

type PushPayload = {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
};

function parsePushPayload(event: PushEvent): PushPayload {
  const fallback: PushPayload = { title: "drafta" };
  const raw = event.data?.text();
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PushPayload>;
    if (typeof parsed.title !== "string" || parsed.title.length === 0) {
      return fallback;
    }
    return {
      title: parsed.title,
      body: typeof parsed.body === "string" ? parsed.body : undefined,
      url: typeof parsed.url === "string" ? parsed.url : undefined,
      tag: typeof parsed.tag === "string" ? parsed.tag : undefined,
    };
  } catch {
    return fallback;
  }
}

/**
 * Web Push (docs/architecture/11-realtime-pwa.md#web-push). Payload несёт
 * заголовок, короткий текст, deep-link и тег — **без текста переписки** (его
 * формирует `send-push` из имён и названий каналов, §11). Клик открывает нужный
 * раздел инбокса.
 */
self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  const targetUrl = data?.url ?? "/";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        await client.focus();
        if ("navigate" in client) {
          try {
            await client.navigate(targetUrl);
          } catch {
            // Cross-origin or detached client — fall back to opening a window.
          }
        }
        return;
      }

      await self.clients.openWindow(targetUrl);
    })(),
  );
});
