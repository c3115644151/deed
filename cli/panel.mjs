import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answers, clearPanel, readPanel } from "../lib/panel.mjs";

// 面板跟着命令走，不跟着开机走：这条系统不是开机就要用的，但你要用它的那一下
// 页面应该在。所以每条命令先问一句"还活着吗"，不在就把它拉起来——后台起、
// 不接管道、不占终端，命令该多快还是多快。
const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "deed.mjs");

export const panelOff = () => process.env.DEED_NO_PANEL === "1";

export async function panelNow(root) {
  const one = readPanel(root);
  if (!one) return { running: false };
  if (!(await answers(one.port))) return { running: false, stale: one };
  return { running: true, port: one.port, pid: one.pid };
}

const waitFor = async (root, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const one = readPanel(root);
    if (one && (await answers(one.port))) return one;
    await new Promise((step) => setTimeout(step, 60));
  }
  return null;
};

export async function startPanel(root) {
  const child = spawn(process.execPath, [entry, "serve", "--port", "0"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  const one = await waitFor(root, 3000);
  return one ? { running: true, port: one.port, pid: one.pid, started: true } : { running: false };
}

// 每条命令都过的这一句：在就不动（一次 socket 探测），不在就起，起不来就算了。
export async function ensurePanel(root) {
  if (panelOff()) return null;
  if (!fs.existsSync(path.join(root, ".deed", "config.json"))) return null;
  const now = await panelNow(root);
  if (now.running) return { ...now, started: false };
  return startPanel(root);
}

export function stopPanel(root) {
  const one = readPanel(root);
  if (!one) return { stopped: false };
  try {
    process.kill(one.pid);
  } catch {
    // 已经退了：清掉记号就算停住。
  }
  clearPanel(root, one.pid);
  return { stopped: true, pid: one.pid, port: one.port };
}
