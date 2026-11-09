import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/playground",
  base: "./",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/playground/index.html"),
        overlay: resolve(__dirname, "src/playground/overlay.html"),
        about: resolve(__dirname, "src/playground/about.html"),
        characters: resolve(__dirname, "src/playground/characters.html"),
      },
    },
  },
  server: { port: 5173 },
  test: undefined,
});
