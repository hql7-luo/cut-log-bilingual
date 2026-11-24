import type { Metadata, Viewport } from "next";
import { ServiceWorker } from "../components/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cut Log · 减脂日志",
  description: "Track meals, workouts, and weight in English or Chinese.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "减脂日志" },
};

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#15171b" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
    <body>{children}<ServiceWorker/></body>
  </html>;
}
