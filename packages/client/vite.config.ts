import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DEFAULT_CLIENT_PORT = 5173;
const DEFAULT_SERVER_PORT = 4000;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    port: DEFAULT_CLIENT_PORT,
    proxy: {
      "/api/auth": `http://localhost:${DEFAULT_SERVER_PORT}`,
      "/trpc": `http://localhost:${DEFAULT_SERVER_PORT}`,
      "/health": `http://localhost:${DEFAULT_SERVER_PORT}`
    }
  },
  build: {
    outDir: "dist"
  }
});
