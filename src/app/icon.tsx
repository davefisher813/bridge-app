import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { cssToken } from "@/lib/theme/cssTokens";

// The app icon: Bridge's mark, white on black, generated at build from
// the same PNG the screens draw (public/logos/bridge-mark.png). The app
// calls itself BFFSA today, so its icon is Bridge's; when the platform
// has a name of its own this is where its mark goes.

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

const MARK = `data:image/png;base64,${readFileSync(join(process.cwd(), "public/logos/bridge-mark.png")).toString("base64")}`;

export function AppMark({ px, rounded }: { px: number; rounded: boolean }) {
  return (
    <div
      style={{
        width: px,
        height: px,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: cssToken("bg", "dark"),
        borderRadius: rounded ? Math.round(px * 0.22) : 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={MARK} alt="" width={Math.round(px * 0.78)} style={{ width: Math.round(px * 0.78) }} />
    </div>
  );
}

export default function Icon() {
  return new ImageResponse(<AppMark px={size.width} rounded />, size);
}
