import { BrowserWindow, Tray, Menu, app, dialog, nativeImage, Notification } from "electrobun/bun";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { platform } from "os";
import { loadConfig, saveConfig, getMachineId, getConfigDir } from "./config";
import { hasKey, decryptPrivateKey, generateAndStoreKey } from "./auth/key-store";

// ── Single instance ──
const LOCK_FILE = join(getConfigDir(), "instance.lock");
let lockFd: number | null = null;

function acquireLock(): boolean {
  try {
    const fs = require("fs");
    if (existsSync(LOCK_FILE)) {
      const oldPid = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
      try {
        process.kill(oldPid, 0);
        return false; // Another instance is running
      } catch {
        // Stale lock file, remove it
      }
    }
    const pid = process.pid;
    // Use a Python/C helper or simple file for cross-platform lock
    // On a real OS, use flock/fcntl. Here we use PID file with staleness check.
    lockFd = fs.openSync(LOCK_FILE, "w");
    fs.writeFileSync(LOCK_FILE, String(pid));
    process.on("exit", () => {
      try { fs.unlinkSync(LOCK_FILE); } catch {}
      if (lockFd !== null) fs.closeSync(lockFd);
    });
    return true;
  } catch {
    console.error("Failed to acquire lock");
    return true; // Allow run even if lock fails
  }
}

// ── IPC Handlers for Renderer ──
// Electrobun's BrowserWindow has ipc property for main<->renderer communication

// ── Main ──
async function main() {
  if (!acquireLock()) {
    // Another instance is running, focus it
    // On real impl, send IPC to existing window
    dialog.showMessageBox({
      type: "info",
      title: "Covibe Desktop",
      message: "Covibe 已在运行中",
    });
    process.exit(0);
  }

  const config = loadConfig();
  const machineId = getMachineId();

  const win = new BrowserWindow({
    title: "Covibe Desktop",
    url: process.env.NODE_ENV === "development"
      ? "http://localhost:5173"
      : "file://" + resolve(__dirname, "../dist/renderer/index.html"),
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: join(__dirname, "../assets/icon.png"),
  });

  // ── Tray ──
  let tray: Tray | null = null;
  try {
    tray = new Tray(nativeImage.createFromPath(join(__dirname, "../assets/icon-tray.png")));
    const contextMenu = Menu.buildFromTemplate([
      { label: "打开 Covibe", click: () => win.show() },
      { label: "显示状态", click: () => win.show() },
      { type: "separator" },
      { label: "退出", click: () => {
        win.close();
        process.exit(0);
      }},
    ]);
    tray.setToolTip("Covibe Desktop");
    tray.setContextMenu(contextMenu);
    tray.on("click", () => win.show());
  } catch (e) {
    console.log("Tray not available on this platform");
  }

  // ── Window Events ──
  win.on("close", (event) => {
    if (config.minimizedToTray && tray) {
      event.preventDefault();
      win.hide();
      new Notification({ title: "Covibe", body: "Covibe 已最小化到系统托盘" }).show();
    }
  });

  // ── Auth Check ──
  // IPC channel: renderer sends actions, main process responds
  // The renderer will handle login UI, this process handles crypto/key ops

  process.on("SIGTERM", () => {
    win.close();
    process.exit(0);
  });

  console.log(`Covibe Desktop started (machineId: ${machineId})`);
}

main().catch(console.error);
