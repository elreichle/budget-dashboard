import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Every project runs far from UTC so a day or month sliced from an ISO timestamp fails a test
// (see server/clock.ts). Set before workers start so they inherit it.
process.env.TZ = "Pacific/Auckland";

// Three projects: server and scripts tests run in node, web tests run in jsdom.
// Filter with `npx vitest run --project server` / `--project web` or a path.
export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "server", environment: "node", include: ["server/**/*.test.ts"] },
      },
      {
        test: { name: "scripts", environment: "node", include: ["scripts/**/*.test.{ts,js,mjs}"] },
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          environment: "jsdom",
          include: ["web/src/**/*.test.{ts,tsx}"],
          setupFiles: ["web/src/setupTests.ts"],
        },
      },
    ],
  },
});
