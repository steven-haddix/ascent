import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/** PDF.js fetches these runtime assets by their original filenames. Emitting
 * them through Vite keeps CMaps, standard fonts, and image codecs offline while
 * preserving the directory URL contract expected by pdf.js. */
function pdfJsAssets(): Plugin {
  const root = resolve("node_modules/pdfjs-dist");
  const folders = ["cmaps", "standard_fonts", "wasm"];
  const assets = new Map<string, string>();
  for (const folder of folders) {
    for (const name of readdirSync(resolve(root, folder))) {
      assets.set(`/pdfjs-assets/${folder}/${name}`, resolve(root, folder, name));
    }
  }
  return {
    name: "ascent-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?", 1)[0];
        const file = path ? assets.get(path) : undefined;
        if (!file) return next();
        res.statusCode = 200;
        res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
        res.end(readFileSync(file));
      });
    },
    buildStart() {
      for (const [url, file] of assets) {
        this.emitFile({ type: "asset", fileName: url.slice(1), source: readFileSync(file) });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), pdfJsAssets()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
