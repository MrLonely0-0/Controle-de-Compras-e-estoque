const { app, BrowserWindow, dialog } = require("electron");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
function config() {
  if (process.env.ESTOQUE_URL) return process.env.ESTOQUE_URL;
  for (const path of [
    join(app.getPath("userData"), "desktop.json"),
    join(process.resourcesPath, "desktop.json"),
  ]) {
    try {
      return JSON.parse(readFileSync(path, "utf8")).url;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  throw new Error(
    `Defina ESTOQUE_URL ou configure ${join(app.getPath("userData"), "desktop.json")}.`,
  );
}
async function open() {
  try {
    const url = new URL(config());
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Informe a URL HTTPS do servidor da operação.");
    const win = new BrowserWindow({
      width: 1360,
      height: 920,
      minWidth: 360,
      minHeight: 570,
      backgroundColor: "#171d2d",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e, target) => {
      if (new URL(target).origin !== url.origin) e.preventDefault();
    });
    win.webContents.on("will-redirect", (e, target) => {
      if (new URL(target).origin !== url.origin) e.preventDefault();
    });
    win.webContents.session.setPermissionRequestHandler((_w, _p, respond) =>
      respond(false),
    );
    await win.loadURL(url.href);
  } catch (e) {
    dialog.showErrorBox("Estoque & Compras", e.message);
    app.quit();
  }
}
app.whenReady().then(open);
app.on("window-all-closed", () => app.quit());
