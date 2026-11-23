import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 面板是这台机器上的一个进程，不是账本里的一件事：它开过、关过，都不该写进账本。
// 所以它的记号放在系统临时目录，按工作区分开——换个工作区就是另一个面板。

const stampOf = (root) => crypto.createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 12);

// 面板自己那几份代码的指纹：改过它们，旧进程手里的还是旧渲染。
// 记进记号里，下一条命令一比就知道该不该换一个。
// 指纹取自 deed 自己这份代码（面板跑的是它，不是工作区里的文件），所以工作区换了、
// 账本换了，指纹都不动；只有人改了面板的代码，它才动。
const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WATCHED = ["board/render.mjs", "board/serve.mjs", "lib/panel.mjs"];
export function buildNow() {
  const hash = crypto.createHash("sha256");
  for (const one of WATCHED) {
    try {
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
    return Number.isInteger(one.port) && Number.isInteger(one.pid) ? one : null;
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
