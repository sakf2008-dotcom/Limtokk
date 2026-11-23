import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// The sandbox ships a pre-installed Chromium; use it when present so no browser download is needed.
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";
const executablePath = existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined;

const PORT = Number(process.env.E2E_PORT ?? 3100);

function withoutBrowserChoice(descriptor: (typeof devices)[string]): Record<string, unknown> {
  const { defaultBrowserType: _ignored, ...rest } = descriptor as Record<string, unknown>;
  void _ignored;
  return rest;
}

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    // localhost (not 127.0.0.1) so that Secure cookies are accepted, as on the real HTTPS site.
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "iphone",
      use: {
        // The iPhone descriptor asks for WebKit; only Chromium is installed here, so we keep its
        // viewport, touch and user-agent emulation and drop the browser choice.
        ...withoutBrowserChoice(devices["iPhone 14"]),
        // Playwright already applies the real device scale factor for emulated devices.
        // --no-sandbox is required when the sandbox runs as root (this container). It is test-only.
        launchOptions: { args: ["--no-sandbox"], ...(executablePath ? { executablePath } : {}) },
      },
    },
  ],
  webServer: {
    // E2E runs against the production build, in in-memory demo mode, with test secrets.
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ILMTOK_DB_MODE: "memory",
      ILMTOK_SECRET: "e2e-secret-value-for-local-testing-only-0123",
      ADMIN_SESSION_SECRET: "e2e-admin-session-secret-value-0123456789",
      ADMIN_PASSWORD: "e2e-admin-password-long-enough",
    },
  },
});
