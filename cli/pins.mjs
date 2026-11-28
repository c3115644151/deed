// 一条交付记下的两样东西：它碰过哪些路径、每份那一刻是多少字节。
// 一条交付与一批交付（submit 一次记好几条）问的是同一组问题，
// 所以只写一处：分成两份实现，两边就会各自长出一条规则，日后只改一边。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

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

// 内容指纹：字节数一样、内容换过的那一份，只有它能认出来。取 sha256 前 16 位——
// 它不作门，只用来在当场核对与「交付记录过期」里比一比。
export function prints(root, changed) {
  const out = {};
  for (const one of changed) {
    try {
      const buf = fs.readFileSync(path.join(root, one));
      out[one] = createHash("sha256").update(buf).digest("hex").slice(0, 16);
    } catch {
      continue;
    }
  }
  return out;
}

// 这一批碰过的文件里，现在是普通文件的那些：交付记录与审查设置都只看路径。
export function pathsOf(root, changed) {
  const out = [];
  for (const one of changed) {
    const full = path.join(root, one);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    out.push({ path: one });
  }
  return out;
}
