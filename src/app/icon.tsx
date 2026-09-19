import { ImageResponse } from "next/og";
import { cssToken } from "@/lib/theme/cssTokens";

// The app icon, generated at build from the same tokens the screens use.
// A mark rather than a letter, because the product's name is not yet
// confirmed (CLAUDE.md) and an icon with the wrong initial on it would
// outlive the decision. The mark is the committed-stage check.

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export function AppMark({ px }: { px: number }) {
  return (
    <div
      style={{
        width: px,
        height: px,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: cssToken("solid-accent"),
        borderRadius: Math.round(px * 0.22),
      }}
    >
      <svg width={px * 0.58} height={px * 0.58} viewBox="0 0 24 24" fill="none" stroke={cssToken("solid-accent-on")} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12.5l2.6 2.6L16.5 9" />
      </svg>
    </div>
  );
}

export default function Icon() {
  return new ImageResponse(<AppMark px={size.width} />, size);
}
