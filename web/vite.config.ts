import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const classicScript: Plugin = {
  name: "classic-script",
  apply: "build",
  transformIndexHtml(html) {
    return html
      .replace(/<script type="module" crossorigin/g, "<script defer")
      .replace(/<script type="module"/g, "<script defer");
  },
};

// One self-contained game.js plus style.css so the built folder can be opened
// from a zip (index.html at the root) or uploaded as a static site.
export default defineConfig({
  base: "./",
  plugins: [react(), classicScript],
  build: {
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "game.js",
        name: "OrbitxCity",
        assetFileNames(asset) {
          const name = asset.names?.[0] ?? asset.name ?? "";
          if (name.endsWith(".css")) return "style.css";
          return "assets/[name][extname]";
        },
      },
    },
  },
});
