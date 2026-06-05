import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  title: "Session Viewer",
  description: "Browse AI coding agent sessions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b border-neutral-800 px-6 py-3 flex items-center gap-4">
          <Link href="/" className="font-semibold text-lg hover:text-blue-400 transition-colors">
            Session Viewer
          </Link>
          <span className="text-xs text-neutral-500">AI coding sessions browser</span>
          <Link href="/registry" className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors ml-auto">
            Registry
          </Link>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </body>
    </html>
  );
}
