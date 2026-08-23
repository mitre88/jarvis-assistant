import { contextBridge, ipcRenderer } from "electron";
import type { AgentEvent, JarvisApi, ModelProgress, VoiceEvent } from "../shared/types";

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

  startVoice: (mode) => ipcRenderer.send("voice:start", mode),
  stopVoice: () => ipcRenderer.send("voice:stop"),
  commitVoice: () => ipcRenderer.send("voice:commit"),
  cancelVoice: () => ipcRenderer.send("voice:cancel"),
  // Transfer the underlying buffer; the worklet hands us throwaway chunks.
  sendPcm: (chunk) => ipcRenderer.send("voice:pcm", chunk.buffer),
  onVoiceEvent: (cb) => {
    ipcRenderer.on("voice-event", (_e, event: VoiceEvent) => cb(event));
  },

  listWhisperModels: () => ipcRenderer.invoke("voice:models:list"),
  downloadWhisperModel: (id) => ipcRenderer.invoke("voice:models:download", id),
  deleteWhisperModel: (id) => ipcRenderer.invoke("voice:models:delete", id),
  browseWhisperModel: () => ipcRenderer.invoke("voice:models:browse"),
  onModelProgress: (cb) => {
    ipcRenderer.on("voice-model-progress", (_e, progress: ModelProgress) => cb(progress));
  },

  createRealtimeSession: () => ipcRenderer.invoke("realtime:session"),
  executeTool: (name, argsJson) => ipcRenderer.invoke("tools:execute", name, argsJson),
};

contextBridge.exposeInMainWorld("jarvis", api);
