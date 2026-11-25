const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const setupPath = join(__dirname, "setup.html");
const userConfig = () => join(app.getPath("userData"), "desktop.json");
function serverUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Informe o endereço HTTPS raiz do servidor da operação.");
  return url;
}
function config() {
  if (process.env.ESTOQUE_URL) return process.env.ESTOQUE_URL;
  for (const path of [
    userConfig(),
    join(process.resourcesPath, "desktop.json"),
  ]) {
    try {
      const value = JSON.parse(readFileSync(path, "utf8")).url;
      if (value) return value;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return null;
}
const prefs = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
};
function guard(win, allowed) {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (const event of ["will-navigate", "will-redirect"])
    win.webContents.on(event, (e, target) => {
      if (!allowed(target)) e.preventDefault();
    });
  win.webContents.session.setPermissionRequestHandler((_w, _p, respond) =>
    respond(false),
  );
}
function openSetup() {
  const win = new BrowserWindow({
    width: 530,
    height: 370,
    autoHideMenuBar: true,
    webPreferences: { ...prefs, preload: join(__dirname, "preload.cjs") },
  });
  const setupUrl = pathToFileURL(setupPath).href;
  guard(win, (target) => target === setupUrl);
  ipcMain.handle("setup:save", async (e, value) => {
    if (e.sender !== win.webContents || e.senderFrame?.url !== setupUrl)
      throw new Error("Configuração não autorizada.");
    const url = serverUrl(String(value).trim());
    const check = await fetch(new URL("/api/environment", url), {
      redirect: "error",
      // Render Free may take a minute to wake after inactivity.
      signal: AbortSignal.timeout(90000),
    }).catch(() => null);
    if (!check?.ok || (await check.json().catch(() => null))?.demo !== false)
      throw new Error(
        "O endereço não respondeu como um servidor de produção. Confira a URL e a conexão.",
      );
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(userConfig(), JSON.stringify({ url: url.href }), {
      mode: 0o600,
    });
    setImmediate(() => {
      openServer(url);
      win.close();
    });
    return true;
  });
  win.on("closed", () => ipcMain.removeHandler("setup:save"));
  void win.loadFile(setupPath);
}
function openServer(url) {
  const win = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 360,
    minHeight: 570,
    backgroundColor: "#171d2d",
    autoHideMenuBar: true,
    webPreferences: prefs,
  });
  guard(win, (target) => new URL(target).origin === url.origin);
  win.webContents.setUserAgent(
    `${win.webContents.getUserAgent()} EstoqueDesktop`,
  );
  void win.loadURL(url.href).catch((e) => {
    if (win.isDestroyed()) return;
    const selection = dialog.showMessageBoxSync(win, {
      type: "error",
      title: "Estoque & Compras",
      message: "Não foi possível abrir o servidor da operação.",
      detail: e.message,
      buttons: ["Configurar servidor", "Fechar"],
      cancelId: 1,
    });
    if (selection === 0) openSetup();
    win.close();
  });
}
app.whenReady().then(() => {
  try {
    const value = config();
    if (value) openServer(serverUrl(value));
    else openSetup();
  } catch (e) {
    dialog.showErrorBox("Estoque & Compras", e.message);
    openSetup();
  }
});
app.on("window-all-closed", () => app.quit());
