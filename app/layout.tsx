import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { appDescription, appName } from "@/lib/app-metadata";
import "./globals.css";

/**
 * Ранний захват `beforeinstallprompt` (docs/architecture/11-realtime-pwa.md).
 * Chromium эмитит это событие ещё до гидратации React, поэтому ловим его
 * inline-скриптом (`beforeInteractive`) в `window.__draftaInstall` — иначе
 * одноразовое событие теряется и предложение установки не появляется.
 * Доступ к нему — через `lib/pwa/install-store.ts`.
 */
const INSTALL_CAPTURE_SCRIPT = `(() => {
  window.__draftaInstall = window.__draftaInstall || { event: null };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__draftaInstall.event = e;
    window.dispatchEvent(new Event('drafta:installavailable'));
  });
  window.addEventListener('appinstalled', () => {
    window.__draftaInstall.event = null;
    window.dispatchEvent(new Event('drafta:installed'));
  });
})();`;

export const metadata: Metadata = {
  title: appName,
  description: appDescription,
  applicationName: appName,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: appName,
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0e7a6b" },
    { media: "(prefers-color-scheme: dark)", color: "#0e7a6b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>
        <Script id="pwa-install-capture" strategy="beforeInteractive">
          {INSTALL_CAPTURE_SCRIPT}
        </Script>
        {children}
      </body>
    </html>
  );
}
