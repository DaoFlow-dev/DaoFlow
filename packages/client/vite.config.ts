import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DEFAULT_CLIENT_PORT = 5173;
const DEFAULT_SERVER_PORT = 3000;

function splitClientChunks(id: string) {
  const normalizedId = id.replace(/\\/g, "/");

  if (!normalizedId.includes("/node_modules/")) {
    return undefined;
  }

  if (
    normalizedId.includes("/node_modules/react/") ||
    normalizedId.includes("/node_modules/react-dom/") ||
    normalizedId.includes("/node_modules/scheduler/")
  ) {
    return "framework";
  }

  if (
    normalizedId.includes("/node_modules/react-router-dom/") ||
    normalizedId.includes("/node_modules/react-router/")
  ) {
    return "router";
  }

  if (
    normalizedId.includes("/node_modules/@tanstack/react-query/") ||
    normalizedId.includes("/node_modules/@trpc/client/") ||
    normalizedId.includes("/node_modules/@trpc/react-query/") ||
    normalizedId.includes("/node_modules/better-auth/")
  ) {
    return "data-auth";
  }

  if (
    normalizedId.includes("/node_modules/@radix-ui/") ||
    normalizedId.includes("/node_modules/@base-ui/") ||
    normalizedId.includes("/node_modules/sonner/") ||
    normalizedId.includes("/node_modules/class-variance-authority/") ||
    normalizedId.includes("/node_modules/clsx/") ||
    normalizedId.includes("/node_modules/tailwind-merge/")
  ) {
    return "ui-shell";
  }

  return undefined;
}

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
    outDir: "dist",
    rolldownOptions: {
      output: {
        manualChunks: splitClientChunks
      }
    }
  }
});
