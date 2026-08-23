import { app, BrowserWindow, globalShortcut, session, Tray } from "electron";
import * as path from "node:path";
import { AgentHost } from "./ipc";
import { PrefsStore } from "./prefs";
import { SecretStore } from "./secrets";
import { createTray } from "./tray";
import { VoiceHost } from "./voice/host";

// dist/src/main → project root (dev) or app root (packaged)
const ROOT = path.join(__dirname, "..", "..", "..");
const ASSETS = path.join(ROOT, "assets");

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#0a0f16",
    autoHideMenuBar: true,
    icon: path.join(ROOT, "build", "icon.png"),
    ...(process.platform === "linux"
      ? {}
      : {
          titleBarStyle: "hidden" as const,
          ...(process.platform === "darwin"
            ? { trafficLightPosition: { x: 14, y: 13 } }
            : {
                titleBarOverlay: {
                  color: "#0a0f16",
                  symbolColor: "#cfe3ec",
                  height: 40,
                },
              }),
        }),
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
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === "media");
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return permission === "media";
    });

    window = createWindow();
    tray = createTray(window, ASSETS);
    void tray;

    const userData = app.getPath("userData");
    const prefs = new PrefsStore(userData);
    const secrets = new SecretStore(userData);
    const host = new AgentHost(window, prefs, secrets, userData);
    host.register();

    const voice = new VoiceHost(window, prefs, userData);
    voice.register();

    const voiceAccel = "CommandOrControl+Shift+Space";
    if (
      !globalShortcut.register(voiceAccel, () => {
        window?.show();
        window?.focus();
        voice.emit({ type: "voice-toggle-hotkey" });
      })
    ) {
      console.warn(`Jarvis: could not register voice shortcut ${voiceAccel}`);
    }

    const summonAccel = process.platform === "darwin" ? "Command+Shift+J" : "Control+Shift+J";
    if (
      !globalShortcut.register(summonAccel, () => {
        if (!window) return;
        if (window.isVisible() && window.isFocused()) {
          window.hide();
        } else {
          window.show();
          window.focus();
        }
      })
    ) {
      console.warn(`Jarvis: could not register global shortcut ${summonAccel}`);
    }
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  app.on("activate", () => {
    window?.show();
  });

  // Tray app: stay alive with the window hidden, on every platform.
  app.on("window-all-closed", () => {
    if (quitting) app.quit();
  });
}
