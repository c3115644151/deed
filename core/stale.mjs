// stale: 机械判一条任务的标准是不是已经过期。
//
// 任务的标准写的是"当时怎么做"：deed say --topic I1、deed ask answer…。做法一改，
// 标准就成了悬空的句子——陌生 agent 照着敲，只会得到一个"不认这个开关"，还不知道
// 该怀疑标准本身。这里把"悬空"变成能列出来的事实：只比对能复核的东西——命令名与开关名，
// 取自命令面自己（SPEC），不靠我记性。
//
// core 不认识 cli/spec.mjs（层依赖：core 不依赖 cli）。所以命令面由调用方传进来：
// surface = { say: ["from","session"], submit: ["run","session"], ... }（开关名不带 --）。
// 传 null 就不做这条检查——没有命令面可比对时，"过期"无从谈起，不说，不猜。

const DEED = /\bdeed\s+([a-z][a-z-]*)/gu;
const FLAG = /--([a-z][a-z-]*)/gu;

// 一条标准里引用了哪些命令与开关。按出现的先后列，去重。
export function references(text) {
  const out = [];
  const seen = new Set();
  if (typeof text !== "string" || text === "") return out;
  for (const hit of text.matchAll(DEED)) add(hit[1], "命令", seen, out);
  // 开关跟着它前面最近的那个命令走；找不到命令的开关也算一条（它就悬在那）。
  let verb = null;
  const tokens = text.match(/\bdeed\s+[a-z][a-z-]*|--[a-z][a-z-]*/gu) ?? [];
  for (const token of tokens) {
    if (token.startsWith("deed ")) {
      verb = token.trim().split(/\s+/u)[1] ?? null;
      continue;
    }
    const flag = token.slice(2);
    const key = (verb ?? "?") + " --" + flag;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ verb, flag, ref: (verb ?? "?") + " --" + flag, kind: "开关" });
  }
  return out;
}

const add = (name, kind, seen, out) => {
  const key = kind + ":" + name;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ verb: name, flag: null, ref: "deed " + name, kind });
};

// 只查还没关口的段里的任务：已关闭段是历史，它的标准当时成立过。
export function findStaleTasks(tasks, segments, surface) {
  if (!surface || typeof surface !== "object") return [];
  const open = new Set((segments ?? []).filter((one) => one.closedAt == null).map((one) => one.id));
  const out = [];
  for (const task of tasks ?? []) {
    // 只有"还没做完、且段还开着"的任务才需要被陌生 agent 读懂。
    // 已交付/已放弃的任务，标准写的是当时的做法，当时成立过——那不是过期，是历史。
    if (task.status !== "todo") continue;
    if (!open.has(task.segment)) continue;
    // 问题与依据是稳定的，不做比对；只有标准里写的做法才算引用。
    const text = task.criteria ?? "";
    for (const ref of references(text)) {
      if (ref.kind === "命令") {
        if (!(ref.verb in surface))
          out.push({ id: task.id, ref: ref.ref, why: "命令面里没有这个命令：" + ref.verb });
        continue;
      }
      if (ref.verb !== null && ref.verb !== "?") {
        const flags = surface[ref.verb];
        if (flags === undefined) continue; // 命令本身就报过了，不重复报它的开关
        if (!flags.includes(ref.flag))
          out.push({ id: task.id, ref: ref.ref, why: "命令 " + ref.verb + " 没有开关 " + ref.flag });
      }
    }
  }
  return out;
}
