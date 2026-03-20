import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DEFAULT_CLIENT_PORT = 5173;
const DEFAULT_SERVER_PORT = 3000;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom"
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    port: DEFAULT_CLIENT_PORT,
    proxy: {
      "/api/auth": `http://localhost:${DEFAULT_SERVER_PORT}`,
      "/api/v1": `http://localhost:${DEFAULT_SERVER_PORT}`,
      "/trpc": `http://localhost:${DEFAULT_SERVER_PORT}`,
      "/health": `http://localhost:${DEFAULT_SERVER_PORT}`,
      "/ws/container-logs": {
        target: `ws://localhost:${DEFAULT_SERVER_PORT}`,
        ws: true
      },
      "/ws/docker-terminal": {
        target: `ws://localhost:${DEFAULT_SERVER_PORT}`,
        ws: true
      }
    }
  },
  build: {
    outDir: "dist"
  }
});
