import { build, Platform } from "electron-builder";
import { mkdir, writeFile, rm } from "node:fs/promises";

const url = process.env.ESTOQUE_URL ? new URL(process.env.ESTOQUE_URL) : null;
if (
  url &&
  (url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash)
)
  throw new Error("ESTOQUE_URL deve ser a URL HTTPS da operação.");
await mkdir(".data", { recursive: true });
const config = ".data/desktop.json";
await writeFile(config, JSON.stringify({ url: url?.href ?? null }));
try {
  await build({
    targets: Platform.WINDOWS.createTarget(["nsis"]),
    config: "electron-builder.yml",
  });
} finally {
  await rm(config, { force: true });
}
