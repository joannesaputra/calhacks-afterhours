import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // "@/" is the web app's own import alias (apps/web/tsconfig.json); tests that render its components need it too.
  resolve: { alias: [{ find: /^@\//, replacement: `${path.resolve(import.meta.dirname, "apps/web")}/` }] },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
  },
});
