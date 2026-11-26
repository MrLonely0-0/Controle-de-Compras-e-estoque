const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("estoqueDesktop", {
  version: () => ipcRenderer.invoke("desktop:version"),
});
