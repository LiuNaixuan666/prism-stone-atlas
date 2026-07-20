import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito" });

export const metadata: Metadata = {
  title: "棱石图鉴 · Prism Stone Collection",
  description: "手机优先的美妙旋律棱石收藏图鉴：查编号、勾选拥有、追踪缺少并备份收藏。",
  applicationName: "棱石图鉴",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/prism-icon.png", apple: "/prism-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8f4ff",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={nunito.variable}>{children}</body>
    </html>
  );
}
