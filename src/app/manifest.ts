import type { MetadataRoute } from "next";
import { cssToken } from "@/lib/theme/cssTokens";

// What "Add to Home Screen" on an iPhone installs. The org screens are
// forced dark, so the installed app's chrome is dark too.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BFFSA",
    short_name: "BFFSA",
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
