import localFont from "next/font/local";

/** Handwritten annotations for callouts */
export const caveat = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/caveat/files/caveat-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/caveat/files/caveat-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/caveat/files/caveat-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-annotate",
  display: "swap",
});
