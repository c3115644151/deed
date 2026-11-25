// 一条交付记下的两样东西：它碰过哪些路径、每份内容那一刻是多少字节、什么 sha256。
// 单条交付（deed task done）与整批交付（deed submit）问的是同一组问题，
// 所以只写一处：分成两份实现，两边就会各自长出一条规则，日后只改一边。
import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/digest.mjs";
import { rel } from "../lib/store.mjs";

// 规模是规则看得见的一半：碰了几个文件数得出来，几个字节得在交付那一刻称。
// 已经不在的路径不进来：它原来多大没人称得出，而把"说不清多大"记成零字节，
// 等于让删掉三十 KB 也按小改动免审。留空，规则那边按要审算。
export function weigh(root, changed) {
  const sizes = {};
  for (const one of changed) {
    try {
      sizes[one] = fs.statSync(path.join(root, one)).size;
    } catch {
      continue;
    }
  }
  return sizes;
}

// 工作区快照里那一批新内容各是什么：整批交付共用这一份差，所以指的都是同一组。
export function pinSet(root, changed, now) {
  const pins = [];
  for (const one of changed) {
    const full = path.join(root, one);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    pins.push({ path: one, digest: now.get(one) });
  }
  return pins;
}

// 手工点名的那几份（--digest 可写多遍）：只认工作区里的普通文件，指到外面或指到
// 目录都当场拒绝——一条交付指着工作区外的东西，事后没有人能替它核。
export function namedPins(root, given = []) {
  return given.map((one) => {
    const file = path.resolve(root, String(one));
    const inside = path.relative(root, file);
    if (inside.startsWith("..") || path.isAbsolute(inside))
      throw new Error("--digest 只认工作区里的文件：" + one + " 在外面（工作区是 " + root + "）");
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      throw new Error("--digest 指的文件不在：" + one);
    }
    if (!stat.isFile()) throw new Error("--digest 要指一个文件，不是目录：" + one + "（例如 docs/a.md）");
    return { path: rel(root, file), digest: digest(fs.readFileSync(file)), size: stat.size };
  });
}

// 量差与记账之间还剩一条缝：外部有东西正好在这几毫秒里写了那条路径。记完账立刻
// 重算一遍，变了就说出来——这时那条交付已经在账本里，只能撤回，不能当没发生。
export function movedSince(root, files = []) {
  const moved = [];
  for (const one of files) {
    const full = path.join(root, one.path);
    let now = null;
    try {
      now = digest(fs.readFileSync(full));
    } catch {
      moved.push({ path: one.path, digest: one.digest, now: null });
      continue;
    }
    if (now !== one.digest) moved.push({ path: one.path, digest: one.digest, now });
  }
  return moved;
}

// 量差之后、记账之前再核一次：变了就不记账（这一处能真拒——抛在 build 里，一条都不落）。
export function requireUnchanged(root, files = []) {
  const moved = movedSince(root, files);
  if (moved.length === 0) {
    // 收据由做这件事的函数自己印：核过却没人说，接线掉了也看不出来。
    if (files.length > 0) console.log("记账之前再核一遍 · " + files.length + " 条没有变");
    return;
  }
  throw new Error(
    "记账之前这些路径变了：" +
      moved
        .map((one) => one.path + "（记下 " + one.digest.slice(0, 12) + "，现在是 " + (one.now === null ? "文件不在" : one.now.slice(0, 12)) + "）")
        .join("、") +
      "；重跑一遍再交",
  );
}

// 记账那一刻的核对：刚落进账本的这些交付，现在还指得到那份内容吗？
// 两件事在这一刻看得见：路径在写入之后又变了（外部进程正好撞上），或者这条交付
// 谁也没指着（既没量到改动、也没点名文件）——都是"账已经记了、却核不了"的样子。
// 它们不能当没发生：已经写进账本的那条只能撤回，所以这里只负责说出来。
export function auditDelivered(root, events = []) {
  const bad = [];
  for (const ev of events) {
    if (ev.k !== "task.done") continue;
    const files = ev.files ?? (ev.digest && ev.digestPath ? [{ path: ev.digestPath, digest: ev.digest }] : []);
    // 只删不改也记不到字节，但它确实动过那条路径：空交付说的是「谁也没指着」，不是「没有内容可指」。
    const removed = Array.isArray(ev.changed) && ev.changed.length > 0;
    if (files.length === 0 && !removed) bad.push({ id: ev.id, path: null, digest: null, now: null, empty: true });
    for (const one of movedSince(root, files)) bad.push({ id: ev.id, ...one, empty: false });
  }
  return bad;
}
