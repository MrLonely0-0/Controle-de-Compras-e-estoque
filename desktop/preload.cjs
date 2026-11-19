const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("estoqueSetup", {
  save: (url) => ipcRenderer.invoke("setup:save", url),
});
