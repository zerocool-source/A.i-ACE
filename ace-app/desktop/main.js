// ACE desktop (Electron) — a native window wrapping the ACE experience.
// Loads a small landing that links the rigged 3D head and the app UI (both are
// self-contained HTML copied in by scripts/prep.mjs).

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#000000",
    title: "ACE",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.loadFile(path.join(__dirname, "renderer", view()));

  // Optional headless capture: ACE_SHOT=<png> renders then writes a screenshot
  // and quits. Used to preview the app window in CI / containers.
  if (process.env.ACE_SHOT) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          require("fs").writeFileSync(process.env.ACE_SHOT, img.toPNG());
        } catch (e) {
          console.error(e);
        }
        app.quit();
      }, 4500);
    });
  }

  // open any external links in the system browser, not a new app window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
}

// Which renderer page to open (ACE_VIEW=3d|app, default = landing).
function view() {
  if (process.env.ACE_VIEW === "3d") return "3d.html";
  if (process.env.ACE_VIEW === "app") return "app.html";
  return "index.html";
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
