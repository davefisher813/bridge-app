import type { Metadata } from "next";
import localFont from "next/font/local";
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
