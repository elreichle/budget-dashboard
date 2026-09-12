import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dashboard lives in web/ and builds into dist/web, which the server serves as static files.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  // Keep the browser's Host (no changeOrigin): the API refuses a state change whose Origin is not its Host.
  server: { proxy: { "/api": "http://localhost:8420" } },
});
