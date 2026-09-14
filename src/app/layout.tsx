import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
