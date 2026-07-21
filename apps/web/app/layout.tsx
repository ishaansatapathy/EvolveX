import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { caveat } from "~/lib/fonts";
import { evolvexTypewriter } from "~/lib/evolvex-fonts";
import { GlobalProviders } from "~/providers/global";

import type { ReactNode } from "react";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});
const evolvexHero = localFont({
  src: "./fonts/EvolvexHero.ttf",
  variable: "--font-evolvex-hero",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Evolvex — Every Incident Leaves Evidence",
  description:
    "AI-native observability investigation layer. Collect, connect, and reconstruct the full story behind incidents.",
  icons: {
    icon: [{ url: "/icon.png", type: "image/png" }],
    shortcut: "/icon.png",
    apple: "/apple-icon.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/icon.png" type="image/png" />
        <meta
          name="google-site-verification"
          content="0-M21tVL5Opq0r0Ibk-8iE3aISFbUUgT3npGo7Lcu9A"
        />
      </head>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable} ${evolvexHero.variable} ${evolvexTypewriter.variable} antialiased`}
      >
        <GlobalProviders>{children}</GlobalProviders>
      </body>
    </html>
  );
}
