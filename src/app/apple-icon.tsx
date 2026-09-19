import { ImageResponse } from "next/og";
import { AppMark } from "./icon";

// iOS home-screen icon. Apple applies its own corner mask, so this one is
// drawn square-cornered rather than double-rounded.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: size.width, height: size.height, display: "flex", borderRadius: 0, overflow: "hidden" }}>
      <AppMark px={size.width} />
    </div>,
    size
  );
}
