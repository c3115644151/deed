import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 面板是这台机器上的一个进程，不是账本里的一件事：它开过、关过，都不该写进账本。
// 所以它的记号放在系统临时目录，按工作区分开——换个工作区就是另一个面板。

const stampOf = (root) => crypto.createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 12);

// 面板进程开机时把模块装进内存：改过任何一份它加载过的代码，旧进程手里的还是旧判断。
// 所以指纹要盖住它加载的全部——板面（board/），它读账本与算规则用的 core/，还有 lib/。
// 早先只盖 board/render.mjs、board/serve.mjs、lib/panel.mjs 三份，于是改 core/fold.mjs
// 之后页面上还印着已经不存在的那一段（S02.20），命令算出来的却是十九段。
// 走一遍目录而不是列名单：以后新加的模块不用记得回来补。
const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TREES = ["board", "core", "lib"];
const modules = (dir) =>
  fs.readdirSync(path.join(PACKAGE, dir), { withFileTypes: true }).flatMap((one) => {
    const rel = dir + "/" + one.name;
    return one.isDirectory() ? modules(rel) : one.name.endsWith(".mjs") ? [rel] : [];
  });
export const watchedFiles = () => TREES.flatMap(modules).sort();

export function buildNow() {
  const hash = crypto.createHash("sha256");
  for (const one of watchedFiles()) {
    try {
      hash.update(one + "\n");
      hash.update(fs.readFileSync(path.join(PACKAGE, one)));
    } catch {
      hash.update("missing");
    }
  }
  return hash.digest("hex").slice(0, 16);
}

export const panelRecord = (root) => path.join(os.tmpdir(), "deed-panel-" + stampOf(root) + ".json");

export function readPanel(root) {
  try {
    const one = JSON.parse(fs.readFileSync(panelRecord(root), "utf8"));
    // 端口是必须的；pid 可以没有——更早一版的面板问不出自己是谁，那条记号里只有端口。
    return Number.isInteger(one.port) ? one : null;
  } catch {
    return null;
  }
}

export function recordPanel(root, one) {
  fs.writeFileSync(panelRecord(root), JSON.stringify({ ...one, at: new Date().toISOString() }, null, 1));
}

// 只有写着自己 pid 的那一个才清：面板重启时旧的退出不该把新的记号抹掉。
export function clearPanel(root, pid) {
  const one = readPanel(root);
  if (one && one.pid !== pid) return;
  try {
    fs.unlinkSync(panelRecord(root));
  } catch {
    // 已经不在：没有要清的。
  }
}

// 端口上有人应答才算面板在：pid 可能是别的进程复用了同一个号。
export function answers(port, timeout = 400) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
    setTimeout(() => done(false), timeout);
  });
}
