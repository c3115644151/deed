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
  const asked = portOf(root);
  // 声明的号被别的程序长期占着时，退到哪一格要算是出来的，不是抽出来的：
  // 挨着的下一个空号（声明号 + 1、+2…）。地址才收藏得住，也不需要在磁盘上记一行。
  // 声明号空出来之后，ensurePanel 会把面板搬回去。
  // 刚停掉旧进程的那一下，号还在 TIME_WAIT 里没让干净：先等它一小会儿，
  // 别把"正在退"当成"被别人占着"，否则换进程就等于给自己换一条地址。
  const clears = async (port, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (!(await answers(port))) return true;
      await new Promise((step) => setTimeout(step, 60));
    }
    return false;
  };
  let want = asked;
  if (!(await clears(asked, 900))) {
    want = 0;
    for (let step = 1; step <= 9; step += 1) {
      if (!(await answers(asked + step))) { want = asked + step; break; }
    }
  }
  const child = spawn(process.execPath, [entry, "serve", "--port", String(want)], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  const one = await waitFor(root, 3000);
  if (!one) return { running: false };
  // 面板是在一个不接管道的子进程里起的，它自己那句"端口被占着"只会掉进虚空：
  // 端口退到哪儿这件事必须由拉它起来的这一头说，否则用户只看到一条无声换掉的地址。
  return { running: true, port: one.port, pid: one.pid, started: true, asked, fellBack: one.port !== asked };
}

// 每条命令都过的这一句：在就不动（一次 socket 探测），不在就起，起不来就算了。
export async function ensurePanel(root) {
  if (panelOff()) return null;
  if (!fs.existsSync(path.join(root, ".deed", "config.json"))) return null;
  const now = await panelNow(root);
  if (now.running) {
    // 门槛里写的那个号空出来了，而活着的这一个还停在当初退回的号上：换回去。
    // 地址是用来收藏的，"退回的号"只是一次意外的落点，不该变成新的地址。
    const asked = portOf(root);
    if (now.port === asked || (await answers(asked))) return { ...now, started: false };
    stopPanel(root);
    return startPanel(root);
  }
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
