import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const server = `localhost:${process.env.MAPMAKER_PORT ?? 4747}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": { target: `ws://${server}`, ws: true },
      "/api": `http://${server}`,
      "/mcp": `http://${server}`,
    },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
