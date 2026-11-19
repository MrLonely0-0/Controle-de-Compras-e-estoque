import { build, Platform } from "electron-builder";
import { mkdir, writeFile, rm } from "node:fs/promises";

const url = new URL(process.env.ESTOQUE_URL || "");
if (url.protocol !== "https:" || url.username || url.password)
  throw new Error("ESTOQUE_URL deve ser a URL HTTPS da operação.");
await mkdir(".data", { recursive: true });
const config = ".data/desktop.json";
await writeFile(config, JSON.stringify({ url: url.href }));
try {
  await build({
    targets: Platform.WINDOWS.createTarget(["nsis"]),
    config: "electron-builder.yml",
  });
} finally {
  await rm(config, { force: true });
}
