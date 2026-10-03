import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // Stays `node` so the pure-logic suite keeps running without a DOM. The
    // component tests opt into jsdom per file with a `@vitest-environment`
    // docblock, which keeps the heavier environment off the fast suite.
    environment: "node",
    include: [
      "tests/unit/**/*.test.js",
      "tests/integration/**/*.test.js",
      "tests/component/**/*.test.jsx",
    ],
    exclude: ["tests/e2e/**", "node_modules/**"],
    reporters: ["default"],
  },
});