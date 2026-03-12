import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { DEFAULT_CLIENT_PORT, DEFAULT_SERVER_PORT } from "./src/shared/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: DEFAULT_CLIENT_PORT,
    proxy: {
      "/api/auth": `http://localhost:${DEFAULT_SERVER_PORT}`,
      "/trpc": `http://localhost:${DEFAULT_SERVER_PORT}`,
      "/health": `http://localhost:${DEFAULT_SERVER_PORT}`
    }
  },
  build: {
    outDir: "dist/client"
  }
});
