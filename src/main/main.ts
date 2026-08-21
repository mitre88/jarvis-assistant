import { app, BrowserWindow, Tray } from "electron";
import * as path from "node:path";
import { AgentHost } from "./ipc";
import { PrefsStore } from "./prefs";
import { SecretStore } from "./secrets";
import { createTray } from "./tray";

// dist/src/main → project root (dev) or app root (packaged)
const ROOT = path.join(__dirname, "..", "..", "..");
const ASSETS = path.join(ROOT, "assets");

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: "#0a0f16",
    autoHideMenuBar: true,
    icon: path.join(ROOT, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(path.join(ROOT, "dist", "renderer", "index.html"));

  // Closing hides to tray; quitting happens via the tray menu or Cmd+Q.
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });

  app.whenReady().then(() => {
    window = createWindow();
    tray = createTray(window, ASSETS);
    void tray;

    const userData = app.getPath("userData");
    const host = new AgentHost(window, new PrefsStore(userData), new SecretStore(userData), userData);
    host.register();
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("activate", () => {
    window?.show();
  });

  // Tray app: stay alive with the window hidden, on every platform.
  app.on("window-all-closed", () => {
    if (quitting) app.quit();
  });
}
