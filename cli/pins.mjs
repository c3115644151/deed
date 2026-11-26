// 一条交付记下的两样东西：它碰过哪些路径、每份那一刻是多少字节。
// 一条交付与一批交付（submit 一次记好几条）问的是同一组问题，
// 所以只写一处：分成两份实现，两边就会各自长出一条规则，日后只改一边。
import fs from "node:fs";
import path from "node:path";

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
