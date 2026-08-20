const path = require('node:path');
const { BrowserWindow, screen } = require('electron');

class AutomationGuard {
  constructor() {
    this.windows = [];
    this.takeover = null;
  }

  start({ message, watermarkEnabled, holdSeconds, onTakeover }) {
    this.stop();
    this.takeover = onTakeover;
    for (const display of screen.getAllDisplays()) {
      const win = new BrowserWindow({
        ...display.bounds,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        focusable: true,
        skipTaskbar: true,
        alwaysOnTop: true,
        fullscreenable: false,
        webPreferences: {
          preload: path.join(__dirname, 'guard-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      const query = new URLSearchParams({
        message: watermarkEnabled ? message : '',
        seconds: String(holdSeconds)
      });
      win.loadFile(path.join(__dirname, 'renderer', 'guard.html'), { search: query.toString() });
      win.on('closed', () => {
        this.windows = this.windows.filter((item) => item !== win);
      });
      this.windows.push(win);
    }
  }

  owns(webContents) {
    return this.windows.some((win) => !win.isDestroyed() && win.webContents === webContents);
  }

  requestTakeover() {
    if (!this.takeover) return;
    const callback = this.takeover;
    this.takeover = null;
    callback();
    this.stop();
  }

  setMousePassthrough(enabled) {
    for (const win of this.windows) {
      if (!win.isDestroyed()) win.setIgnoreMouseEvents(Boolean(enabled));
    }
  }

  stop() {
    this.takeover = null;
    const windows = this.windows.splice(0);
    for (const win of windows) {
      if (!win.isDestroyed()) win.destroy();
    }
  }
}

module.exports = { AutomationGuard };
