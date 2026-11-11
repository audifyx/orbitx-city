import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function cityApi(): Plugin {
  const attach = (server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      const url = String(req.url || "");
      if (!url.startsWith("/api/city")) {
        next();
        return;
      }
      const chunks: Uint8Array[] = [];
      req.on("data", (chunk: Uint8Array) => chunks.push(chunk));
      req.on("end", () => {
        void (async () => {
          // @ts-expect-error city API is plain JS outside this project.
          const api = (await import("../api/city.js")) as {
            GET: () => Promise<Response>;
            POST: (request: Request) => Promise<Response>;
          };
          const body = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
          let offset = 0;
          for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.length;
          }
          const request = new Request(`http://127.0.0.1${url}`, {
            method: String(req.method || "GET"),
            headers: {
              authorization: String(req.headers?.authorization || ""),
              "content-type": "application/json",
            },
            body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
          });
          const response = req.method === "GET" ? await api.GET() : await api.POST(request);
          res.statusCode = response.status;
          res.setHeader("content-type", "application/json");
          res.end(new Uint8Array(await response.arrayBuffer()));
        })().catch((err: unknown) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : "API error" }));
        });
      });
    });
  };
  return {
    name: "city-api",
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}

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
  plugins: [react(), classicScript, cityApi()],
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
