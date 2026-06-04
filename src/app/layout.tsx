import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@fontsource/syne/800.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "multidownloader — 全网视频图片下载",
  description: "支持抖音、小红书、快手、X (Twitter)、YouTube 链接解析与一键下载",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body className="min-h-dvh flex flex-col bg-slate-950 text-zinc-100 selection:bg-violet-500/30">
        {/* subtle grain overlay */}
        <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJmIj48ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iLjc0IiBudW1PY3RhdmVzPSIzIiAvPjwvZmlsdGVyPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbHRlcj0idXJsKCNmKSIgb3BhY2l0eT0iMCIgLz48L3N2Zz4=')]" />
        <nav className="relative z-10 flex items-center justify-between px-4 sm:px-6 h-14 border-b border-slate-800/60">
          <a href="/" className="font-display font-extrabold text-sm tracking-wide text-zinc-300 hover:text-white transition-colors">
            <span className="text-gradient">M</span><span className="text-zinc-400">ultidownloader</span>
          </a>
        </nav>
        {children}
      </body>
    </html>
  );
}
