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
