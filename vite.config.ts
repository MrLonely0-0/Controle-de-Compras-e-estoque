import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export default defineConfig({
  plugins: [
    react(),
    tailwind(),
    {
      name: "version-offline-shell",
      apply: "build",
      async closeBundle() {
        const [html, sw] = await Promise.all([
          readFile("dist/index.html"),
          readFile("public/sw.js", "utf8"),
        ]);
        const revision = createHash("sha256")
          .update(html)
          .digest("hex")
          .slice(0, 12);
        await writeFile(
          "dist/sw.js",
          sw.replace("estoque-shell-v1", `estoque-shell-${revision}`),
        );
      },
    },
  ],
  server: {
    allowedHosts: [".e2b.app"],
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
});
