const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { newerVersion } = require("./update.cjs");
const releasesUrl = "https://github.com/MrLonely0-0/Controle-de-Compras-e-estoque/releases/latest";
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
function guard(win, allowed, allowProfile = false) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only the exact, trusted footer link may open in the system browser.
    if (allowProfile && url === "https://github.com/MrLonely0-0")
      void shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
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
async function checkDesktopUpdate(win, url) {
  try {
    const response = await fetch(new URL("/api/desktop-version", url), {
      redirect: "error",
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) return;
    const { version } = await response.json();
    if (typeof version !== "string" || !newerVersion(version, app.getVersion()) || win.isDestroyed()) return;
    const result = await dialog.showMessageBox(win, {
      type: "info",
      title: "Atualização disponível",
      message: `Uma nova versão do aplicativo Windows (${version}) está disponível.`,
      detail: "Abra a página de downloads e instale a nova versão. Enquanto o repositório for privado, será necessário entrar no GitHub com acesso autorizado.",
      buttons: ["Abrir downloads", "Depois"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) await shell.openExternal(releasesUrl);
  } catch (error) {
    // Offline or an older server: do not interrupt use of the app.
    console.warn("Não foi possível verificar atualização do aplicativo.", error.message);
  }
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
  guard(win, (target) => new URL(target).origin === url.origin, true);
  win.webContents.setUserAgent(
    `${win.webContents.getUserAgent()} EstoqueDesktop`,
  );
  win.webContents.once("did-finish-load", () => void checkDesktopUpdate(win, url));
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
