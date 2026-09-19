import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cssToken } from "@/lib/theme/cssTokens";
import "./globals.css";

// Dave's call on the ChatGPT redesign conflict: Inter, heavy weight, for
// headlines (font-extrabold/font-black in Tailwind). Self-hosted (the
// variable-weight woff2 from @fontsource-variable/inter, vendored into
// this repo) rather than next/font/google: no external CDN fetch at
// build time or runtime, and the variable font covers 100-900 in one
// file so the heavy headline weights actually render. See docs/DECISIONS.md.
const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Recruiting Platform",
  description: "Recruiting and roster management platform (placeholder name).",
  manifest: "/manifest.webmanifest",
  // Installed from Safari's share sheet, the app runs without browser
  // chrome and with a status bar that sits over the dark org screens.
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Recruiting" },
};

// The colour behind the status bar and the browser's own chrome. Sign-in
// is light, the org screens are forced dark; the one theme colour is the
// dark page, which is where a signed-in person spends their time.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: cssToken("bg", "dark"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
