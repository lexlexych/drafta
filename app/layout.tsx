import type { Metadata, Viewport } from "next";
import { appDescription, appName } from "@/lib/app-metadata";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
