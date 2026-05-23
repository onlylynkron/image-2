import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };
  const apiPort = env.PORT || "8787";

  return {
    plugins: [react()],
    root: ".",
    server: {
      port: 5173,
      proxy: {
        "/api": `http://localhost:${apiPort}`,
        "/assets": `http://localhost:${apiPort}`
      }
    },
    build: {
      outDir: "dist/client",
      emptyOutDir: true,
      assetsDir: "app-assets",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "index.html")
        }
      }
    }
  };
});
