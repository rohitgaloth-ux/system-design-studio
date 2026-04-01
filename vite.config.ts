import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  /* GitHub project Pages: set VITE_BASE=/repo-name/ in CI (see .github/workflows). */
  base: process.env.VITE_BASE || "/",
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:4173",
    },
  },
  build: {
    outDir: "dist",
  },
});
