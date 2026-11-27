// trace: how the command surface actually gets used.
//
// 它不是账本。账本记的是工作区发生过的事实，一个被拒的动作在那里是零字节；
// 而"这个面好不好用"只有数能回答：哪些动词从没被敲过（伪需求的候选）、
// 哪些敲了就失败（提示或设计有缺陷）、哪些开关一次都没出现过（死开关）。
//
// 所以这里记的是**程序自己**的事，落在 .deed/debug/，按月分文件、只追加、
// 不进版本库、不进方案快照。它没有任何一条会改变账本，也不会因为读不动账本而停摆。

import fs from "node:fs";
import path from "node:path";

const DEED = ".deed";
const DIR = "debug";

const fileOf = (root, at) => path.join(root, DEED, DIR, at.slice(0, 7) + ".jsonl");

// 一次调用一行。写不进去就算了，: 观察用的东西不该挡住一条正常命令。
export const trace = (root, entry) => {
  try {
    // 还没有 .deed 的地方（空目录、别人的仓库、只问一句 --print-agents）：
    // 拒绝就是拒绝，不留任何记号——观察层不许替谁建出一本账。
    if (!fs.existsSync(path.join(root, DEED))) return;
    const dir = path.join(root, DEED, DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(fileOf(root, entry.at), JSON.stringify(entry) + "\n", "utf8");
  } catch {
    /* 没有 .deed 的地方（空目录、别人的仓库）：不留记号。 */
  }
};

// 被拒的那一句由 fail() 放到这里，dispatcher 走完再取走：一次调用只写一行。
let lastRefusal = null;
export const refused = (why) => {
  lastRefusal = String(why).split("\n")[0].slice(0, 240);
};
export const takeRefusal = () => {
  const one = lastRefusal;
  lastRefusal = null;
  return one;
};

const monthOf = (at) => at.slice(0, 7);

// 窗口内的调用，按时间排。读不动的文件跳过：一行坏账不该让统计整页空着。
export function readTraces(root, days = 30) {
  const dir = path.join(root, DEED, DIR);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((one) => one.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const out = [];
  for (const one of files) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(dir, one), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let row = null;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (!row || typeof row.at !== "string" || row.at < from) continue;
      out.push(row);
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

const pick = (list, p) => {
  if (list.length === 0) return null;
  const at = Math.min(list.length - 1, Math.max(0, Math.round((list.length - 1) * p)));
  return list[at];
};

// 一个动词在窗口里的样子。switches 记的是**用过的开关名**，不是值。
export function byVerb(rows) {
  const seen = new Map();
  for (const row of rows) {
    const key = row.verb ?? "";
    if (!seen.has(key))
      seen.set(key, { verb: key, calls: 0, ok: 0, fail: 0, ms: [], whys: new Map(), switches: new Map(), last: null });
    const one = seen.get(key);
    one.calls += 1;
    if (row.ok) one.ok += 1;
    else one.fail += 1;
    if (typeof row.ms === "number") one.ms.push(row.ms);
    if (row.why) one.whys.set(row.why, (one.whys.get(row.why) ?? 0) + 1);
    for (const sw of row.switches ?? []) one.switches.set(sw, (one.switches.get(sw) ?? 0) + 1);
    one.last = row.at;
  }
  const out = [];
  for (const one of seen.values()) {
    const ms = [...one.ms].sort((a, b) => a - b);
    out.push({
      verb: one.verb,
      calls: one.calls,
      ok: one.ok,
      fail: one.fail,
      rate: one.calls === 0 ? 0 : one.fail / one.calls,
      p50: pick(ms, 0.5),
      p95: pick(ms, 0.95),
      last: one.last,
      whys: [...one.whys.entries()].sort((a, b) => b[1] - a[1]).map(([why, n]) => ({ why, n })),
      switches: [...one.switches.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })),
    });
  }
  return out.sort((a, b) => b.calls - a.calls || a.verb.localeCompare(b.verb));
}
