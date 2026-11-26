import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answers, buildNow, clearPanel, readPanel, recordPanel } from "../lib/panel.mjs";

// 面板跟着命令走，不跟着开机走：这条系统不是开机就要用的，但你要用它的那一下
// 页面应该在。所以每条命令先问一句"那一条页面是谁"，不在就把它拉起来。
//
// 一个工作区只有一个面板，一个面板只占一格端口。这条规矩以前不成立：号被占着就
// 挨着往后试（+1、+2…），于是同一份账本同时开着两条页面，你看的是哪一条全靠记忆——
// 屏幕上写着旧渲染，命令算的却是新的。现在只剩一条路：号被占着就问清是谁，
// 是自己（旧代码/旧进程）就把它换掉，是别人就明说，绝不另开第二条。
const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "deed.mjs");

export const panelOff = () => process.env.DEED_NO_PANEL === "1";

const portOf = (root) => {
  try {
    const one = JSON.parse(fs.readFileSync(path.join(root, ".deed", "config.json"), "utf8"));
    const port = one?.board?.port;
    return Number.isInteger(port) && port > 0 ? port : 7317;
  } catch {
    return 7317;
  }
};

// 问那一条页面：它是谁、手里是哪一版代码。问不到就是没人应答（不是"有面板"）。
export async function askPanel(port, timeout = 600) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/__deed", { signal: controller.signal });
    if (res.ok) {
      const one = await res.json();
      return one && one.deed === true ? one : null;
    }
    // 更早一版的面板没有 /__deed 这个路口，只有一句固定的 404。这句话本身就是它的记号：
    // 认出它是自己的旧面板，才谈得上"把它换掉"，而不是含糊地报一句"端口占用中"。
    const why = await res.text();
    if (/只收 \/gate|只有 \/ 、\/state、\/events/u.test(why))
      return { deed: true, legacy: true, root: null, pid: null, port, build: null };
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 请那一格让位：面板自己收摊，端口随即空出来。这不是 kill——谁也不该去杀别人的进程，
// 一个工作区里该发生的是"新的请旧的退场"，而不是"我把它按死"。
const LEGACY_WHY = (port) =>
  "端口 " + port + " 上还坐着更早一版的面板（它没有 /__deed/retire 这个路口）：" +
  "它自己静下来 30 分钟后会退场，那时下一条命令就会把它换成新的；要现在就看，重启一次应用";

export async function retirePanel(port, timeout = 800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/__deed/retire", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
    });
    if (!res.ok) return false;
    const one = await res.json();
    return one?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function panelNow(root) {
  const asked = portOf(root);
  // 上一次已经认出那一格是更早一版：不再发 HTTP（每发一次就等于替它续一次命），
  // 只探一下它还在不在。它自己的空闲计时会把它收走，收走之后这里就空出来了。
  const seen = readPanel(root);
  if (seen?.legacy === true && seen.port === asked) {
    if (!(await answers(asked))) {
      clearPanel(root, seen.pid ?? null);
      return { running: false, port: asked };
    }
    return { running: false, port: asked, blocked: { port: asked, legacy: true, quiet: seen.legacyAnnounced === true, why: LEGACY_WHY(asked) } };
  }
  const who = await askPanel(asked);
  if (!who) return { running: false, port: asked };
  if (who.legacy === true) {
    const seen = readPanel(root);
    recordPanel(root, { pid: who.pid ?? null, port: asked, legacy: true, legacyAnnounced: seen?.legacyAnnounced === true, build: null });
    return { running: false, port: asked, blocked: { port: asked, legacy: true, quiet: seen?.legacyAnnounced === true, why: LEGACY_WHY(asked) } };
  }
  if (path.resolve(who.root) !== path.resolve(root))
    return { running: false, port: asked, blocked: { port: asked, why: "端口上坐着另一个工作区的面板（" + who.root + "）" } };
  if (who.build !== buildNow())
    return { running: false, port: asked, stale: { pid: who.pid, port: asked }, outdated: true };
  recordPanel(root, { pid: who.pid, port: asked, build: who.build });
  return { running: true, port: asked, pid: who.pid };
}

const waitFor = async (root, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const now = await panelNow(root);
    if (now.running) return now;
    await new Promise((step) => setTimeout(step, 80));
  }
  return null;
};

// 「这个号现在能不能占」跟「这个号上有没有人应答」不是一回事：刚停掉的进程会把号
// 留在 TIME_WAIT 里，connect 不上去，listen 还是 EADDRINUSE。判的是能不能占。
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const canBind = (port) =>
  new Promise((ok) => {
    const probe = net.createServer(() => {});
    probe.once("error", () => ok(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => ok(true)));
  });

const holdFor = async (port, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await canBind(port)) return true;
    await new Promise((step) => setTimeout(step, 60));
  }
  return false;
};

export async function startPanel(root) {
  const asked = portOf(root);
  // 只等这一格：等的是 TIME_WAIT，不是"换一格"。等不住就交给 serve 说清楚谁占着。
  await holdFor(asked, 800);
  const child = spawn(process.execPath, [entry, "serve", "--port", String(asked)], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  const one = await waitFor(root, 3000);
  if (one) return { ...one, started: true };
  // 起不来只有两种：号被别人占着，或者进程自己没站稳。两种都不许另开一条。
  const who = await askPanel(asked);
  const why = who?.legacy
    ? "端口 " + asked + " 上是更早一版的面板（没有 /__deed），关不掉它"
    : who
      ? "端口上已经有面板（pid " + (who.pid ?? "?") + "），它不是这一份代码或不属于这个工作区，而且没能换掉"
      : "端口 " + asked + " 占用中，拉不起新的面板";
  return { running: false, port: asked, blocked: { port: asked, why } };
}

// 每条命令都过的这一句：在就不动，不在就起，起不来就一句话说清谁占着。
export async function ensurePanel(root) {
  if (panelOff()) return null;
  if (!fs.existsSync(path.join(root, ".deed", "config.json"))) return null;
  const now = await panelNow(root);
  if (now.running) return { ...now, started: false };
  if (now.blocked) {
    if (now.blocked.legacy && now.blocked.quiet !== true) {
      recordPanel(root, { ...(readPanel(root) ?? {}), legacy: true, port: now.blocked.port, legacyAnnounced: true });
    }
    return now;
  }
  // 自己那一格上坐着旧代码：先让位，再在原格上起来。让不开就不另开。
  if (now.stale) {
    // 先请它自己退场（新一版都听得懂这句话）；听不懂的那一版，就等它自己收摊：
    // 面板在没人请求 30 分钟后会自己退，不需要任何人去替它按死。
    await retirePanel(now.port);
    await holdFor(now.port, 1200);
    const after = await panelNow(root);
    if (after.running) return { ...after, started: false };
    if (after.blocked) return after;
    if (after.stale) {
      const seen = readPanel(root);
      recordPanel(root, { pid: seen?.pid ?? null, port: now.port, legacy: true, legacyAnnounced: true, build: null });
      return { running: false, port: now.port, blocked: { port: now.port, legacy: true, quiet: true, why: LEGACY_WHY(now.port) } };
    }
  }
  // 号上没人应答，但记号里还写着一个活着的 pid：那是这个工作区更早一版的面板
  // （它没有 /__deed，问不出自己是谁）。先让它让位；让不动就说清楚是哪一个。
  const old = readPanel(root);
  if (old?.pid && alive(old.pid) && !(await canBind(now.port))) {
    stopPanel(root);
    await holdFor(now.port, 800);
    if (!(await canBind(now.port)))
      return {
        running: false,
        port: now.port,
        blocked: {
          port: now.port,
          why: "端口上是旧面板（pid " + old.pid + "），它属于别的进程树，关不掉",
        },
      };
  }
  return startPanel(root);
}

// 在原格上换个新的：先请旧的退场（它自己收摊），端口空了再起。不是"杀掉再启动"，
// 中间那一步是旧的把号让出来——TCP 一格只能有一个听众，这件事绕不过去。
export async function restartPanel(root) {
  const asked = portOf(root);
  const who = await askPanel(asked);
  if (who?.legacy === true)
    return { running: false, port: asked, blocked: { port: asked, legacy: true, why: LEGACY_WHY(asked) } };
  if (who && path.resolve(who.root) !== path.resolve(root))
    return {
      running: false,
      port: asked,
      blocked: { port: asked, why: "端口上坐着另一个工作区的面板（" + who.root + "）" },
    };
  if (who) await retirePanel(asked);
  await holdFor(asked, 1500);
  if (!(await canBind(asked)))
    return { running: false, port: asked, blocked: { port: asked, why: "让位之后那一格还没空出来" } };
  const one = await startPanel(root);
  return one.running ? { ...one, restarted: true } : one;
}

export function stopPanel(root) {
  const one = readPanel(root);
  const port = one?.port ?? portOf(root);
  if (!one) {
    clearPanel(root, null);
    return { stopped: false, port };
  }
  // 先请它自己退；它不听（更早一版、或已经僵住）才由这里收尾。收尾也不该是日常动作：
  // 正常路径是那句 POST /__deed/retire。
  const retire = retirePanel(one.port);
  retire.catch(() => false);
  try {
    if (Number.isInteger(one.pid)) process.kill(one.pid);
  } catch {
    // 已经退了：清掉记号就算停住。
  }
  clearPanel(root, one.pid);
  return { stopped: true, pid: one.pid, port };
}
