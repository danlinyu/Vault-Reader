const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vaultReaderNative", {
  openFolder: () => ipcRenderer.invoke("vault:open-folder"),
  openFiles: () => ipcRenderer.invoke("vault:open-files"),
  openVaultPath: (rootPath) => ipcRenderer.invoke("vault:open-vault-path", rootPath),
  readFile: (absolutePath) => ipcRenderer.invoke("vault:read-file", absolutePath),
  writeFile: (absolutePath, text) => ipcRenderer.invoke("vault:write-file", absolutePath, text),
  createNote: (options) => ipcRenderer.invoke("vault:create-note", options),
  openExternal: (url) => ipcRenderer.invoke("vault:open-external", url),
  onOpenedFiles: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on("vault:opened-files", listener);
    return () => ipcRenderer.removeListener("vault:opened-files", listener);
  },
});
