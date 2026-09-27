import type { MetadataRoute } from "next";
import { cssToken } from "@/lib/theme/cssTokens";
import { PRODUCT_NAME, PRODUCT_SHORT_NAME } from "@/lib/product";

// What "Add to Home Screen" on an iPhone installs. The org screens are
// forced dark, so the installed app's chrome is dark too.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCT_NAME,
    short_name: PRODUCT_SHORT_NAME,
    description: "Rosters, recruiting targets, fit scoring and document intake for a sports organization.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: cssToken("bg", "dark"),
    theme_color: cssToken("bg", "dark"),
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
