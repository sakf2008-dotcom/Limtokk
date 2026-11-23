import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Integration tests share one in-memory database per worker; run files serially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      ILMTOK_DB_MODE: "memory",
      ILMTOK_SECRET: "test-secret-for-vitest-only-0123456789abcdef",
      ADMIN_SESSION_SECRET: "test-admin-session-secret-0123456789abcdef",
      ADMIN_PASSWORD: "test-admin-password-long-enough",
    },
  },
});
