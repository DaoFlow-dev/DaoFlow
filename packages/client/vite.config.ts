import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DEFAULT_CLIENT_PORT = 5173;
const DEFAULT_SERVER_PORT = 3000;

function splitClientChunks(id: string) {
  const normalizedId = id.replace(/\\/g, "/");

  if (!normalizedId.includes("node_modules")) {
    return undefined;
  }

  if (
    normalizedId.includes("/react/") ||
    normalizedId.includes("/react-dom/") ||
    normalizedId.includes("/scheduler/")
  ) {
    return "framework";
  }

  if (normalizedId.includes("/react-router-dom/") || normalizedId.includes("/react-router/")) {
    return "router";
  }

  if (
    normalizedId.includes("/@tanstack/react-query/") ||
    normalizedId.includes("/@trpc/client/") ||
    normalizedId.includes("/@trpc/react-query/") ||
    normalizedId.includes("/better-auth/")
  ) {
    return "data-auth";
  }

  if (
    normalizedId.includes("/@radix-ui/") ||
    normalizedId.includes("/@base-ui/") ||
    normalizedId.includes("/sonner/") ||
    normalizedId.includes("/class-variance-authority/") ||
    normalizedId.includes("/clsx/") ||
    normalizedId.includes("/tailwind-merge/")
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
