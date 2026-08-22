import { contextBridge, ipcRenderer } from "electron";
import type { AgentEvent, JarvisApi } from "../shared/types";

const api: JarvisApi = {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (update) => ipcRenderer.invoke("settings:save", update),
  testConnection: (update) => ipcRenderer.invoke("settings:test", update),
  send: (text) => ipcRenderer.send("chat:send", text),
  retry: () => ipcRenderer.send("chat:retry"),
  cancel: () => ipcRenderer.send("chat:cancel"),
  resetChat: () => ipcRenderer.send("chat:reset"),
  respondConfirm: (id, approved) => ipcRenderer.send("confirm:response", id, approved),
  hideWindow: () => ipcRenderer.send("window:hide"),
  listSessions: () => ipcRenderer.invoke("sessions:list"),
  getCurrentSession: () => ipcRenderer.invoke("sessions:current"),
  loadSession: (id) => ipcRenderer.invoke("sessions:load", id),
  deleteSession: (id) => ipcRenderer.invoke("sessions:delete", id),
  newSession: () => ipcRenderer.invoke("sessions:new"),
  onAgentEvent: (cb) => {
    ipcRenderer.on("agent-event", (_e, event: AgentEvent) => cb(event));
  },
};

contextBridge.exposeInMainWorld("jarvis", api);
