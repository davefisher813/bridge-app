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
  title: "BFFSA",
  description: "Rosters, recruiting targets, fit scoring and document intake.",
  manifest: "/manifest.webmanifest",
  // Installed from Safari's share sheet, the app runs without browser
  // chrome and with a status bar that sits over the dark org screens.
  appleWebApp: { capable: true, statusBarStyle: "default", title: "BFFSA" },
};

// The colour behind the status bar and the browser's own chrome. Sign-in
// is light, the org screens are forced dark; the one theme colour is the
// dark page, which is where a signed-in person spends their time.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: cssToken("bg", "light") },
    { media: "(prefers-color-scheme: dark)", color: cssToken("bg", "dark") },
  ],
};

// Stamps data-theme from the phone's setting before anything paints, and
// keeps it in step if the setting changes while the app is open. The
// stylesheet's dark block is keyed on that attribute, which is also what
// the styling laws read, so the CSS did not have to move.
const THEME_SCRIPT = `(function(){try{var m=window.matchMedia("(prefers-color-scheme: dark)");function a(){document.documentElement.setAttribute("data-theme",m.matches?"dark":"light")}a();m.addEventListener("change",a)}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
