import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Drill",
  description: "Chat interface for the HolmesGPT AI-SRE agent",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "dark h-full antialiased font-sans",
        inter.variable,
        geistMono.variable,
      )}
    >
      {/*
        The column + overflow-hidden is the app frame: the impersonation banner
        (rendered by the (app) shell) is a flex-shrink-0 band and every page
        below it claims the rest with `min-h-0 flex-1` — never `h-dvh`, which
        would push content past the viewport by the banner's height.
      */}
      <body className="h-full flex flex-col overflow-hidden">{children}</body>
    </html>
  );
}
