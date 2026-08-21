import { contextBridge, ipcRenderer } from "electron";
import type { AgentEvent, JarvisApi } from "../shared/types";

const api: JarvisApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (update) => ipcRenderer.invoke("settings:save", update),
  testConnection: (update) => ipcRenderer.invoke("settings:test", update),
  send: (text) => ipcRenderer.send("chat:send", text),
  cancel: () => ipcRenderer.send("chat:cancel"),
  resetChat: () => ipcRenderer.send("chat:reset"),
  respondConfirm: (id, approved) => ipcRenderer.send("confirm:response", id, approved),
  hideWindow: () => ipcRenderer.send("window:hide"),
  onAgentEvent: (cb) => {
    ipcRenderer.on("agent-event", (_e, event: AgentEvent) => cb(event));
  },
};

contextBridge.exposeInMainWorld("jarvis", api);
