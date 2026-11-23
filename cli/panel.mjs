import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answers, buildNow, clearPanel, readPanel } from "../lib/panel.mjs";

// 面板跟着命令走，不跟着开机走：这条系统不是开机就要用的，但你要用它的那一下
// 页面应该在。所以每条命令先问一句"还活着吗"，不在就把它拉起来——后台起、
// 不接管道、不占终端，命令该多快还是多快。
const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "deed.mjs");

export const panelOff = () => process.env.DEED_NO_PANEL === "1";

// 端口固定：给人一个能收藏的地址。工作区各自的门槛里写着它（config.board.port，
// 默认 7317）；被别的程序占了，serve 会退回系统给的号并在输出里说清。
const portOf = (root) => {
  try {
    const one = JSON.parse(fs.readFileSync(path.join(root, ".deed", "config.json"), "utf8"));
    const port = one?.board?.port;
    return Number.isInteger(port) && port > 0 ? port : 7317;
  } catch {
    return 7317;
  }
};

export async function panelNow(root) {
  const one = readPanel(root);
  if (!one) return { running: false };
  if (!(await answers(one.port))) return { running: false, stale: one };
  // 代码换过之后，还活着的那个卖的还是旧渲染：报成"不在"，让上层的 ensure 换掉它。
  if (one.build !== buildNow()) return { running: false, stale: one, outdated: true };
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
  const child = spawn(process.execPath, [entry, "serve", "--port", String(portOf(root))], {
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
  // 旧的那个还占着端口：先让它把号让出来，否则新进程只能退到别的号去。
  if (now.stale) stopPanel(root);
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
