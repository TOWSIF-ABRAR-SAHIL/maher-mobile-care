"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// The renderer gets a tiny explicit bridge. No filesystem, no child process,
// no arbitrary IPC channel names, and no access to Node internals.
contextBridge.exposeInMainWorld("maherDesktop", {
  isElectron: true,
  setWindowTitle: (shopName) => ipcRenderer.invoke("window:set-title", shopName),
  printReceipt: (options) => ipcRenderer.invoke("print:receipt", options),
  getPrinters: () => ipcRenderer.invoke("printing:list"),
  // Returns { canceled, path } from a native Windows folder dialog. No raw
  // filesystem access is exposed — only the single folder the user picked.
  selectDirectory: () => ipcRenderer.invoke("dialog:select-directory"),
});
