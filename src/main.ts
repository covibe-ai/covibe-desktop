import { BrowserWindow } from "electrobun/bun";

const win = new BrowserWindow({
  title: "Covibe Desktop",
  url: "https://covibe.com",
  width: 1200,
  height: 800,
});

process.on("SIGTERM", () => {
  win.close();
  process.exit(0);
});
