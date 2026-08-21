import { app, BrowserWindow, Menu, nativeImage, Tray } from "electron";
import * as path from "node:path";

export function createTray(window: BrowserWindow, assetsDir: string): Tray {
  const iconFile =
    process.platform === "darwin" ? "trayTemplate.png" : "tray.png";
  const icon = nativeImage.createFromPath(path.join(assetsDir, iconFile));
  const tray = new Tray(icon);
  tray.setToolTip("Jarvis");

  const toggle = () => {
    if (window.isVisible() && window.isFocused()) {
      window.hide();
    } else {
      window.show();
      window.focus();
    }
  };

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show / Hide", click: toggle },
      { type: "separator" },
      { label: "Quit Jarvis", click: () => app.quit() },
    ])
  );
  tray.on("click", toggle);
  return tray;
}
