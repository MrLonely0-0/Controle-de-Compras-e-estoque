import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  use: {
    baseURL: "http://localhost:3101",
    launchOptions: process.env.CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
      : {},
  },
  webServer: {
    command: "node server/app.mjs",
    env: {
      PORT: "3101",
      DATABASE_URL: "",
      NODE_ENV: "test",
      SERVE_DIST: "1",
      DEMO_DB: "memory://",
    },
    url: "http://localhost:3101/api/environment",
  },
});
