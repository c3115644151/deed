// plan: the one file both sides edit. A person or an agent reads the draft,
// changes the ticks and the words, and submits it once. Parsing lives here so
// the rules about what a line means are in one place instead of in the command.
//
// The file is inside .deed/, so the workspace snapshot never counts it as work:
// editing the plan is not a change to the workspace, it is a change to say what
// the work was.

import { awaitingJudgement, awaitingVerdict } from "../core/fold.mjs";
import { groupsOf } from "../core/rules.mjs";

export const HEAD = "# 这一期要做成什么";


// 条目只有一种形状：一个方框 + 可选号 + 标题。四种状态都在方框里说，
// 不再有 "~~" 这种挂在行首的记号——那是第二套语法。
//   - [?] 标题       新条目（submit 领号）
//   - [ ] T1 标题    还没做
//   - [x] T1 标题    已交付（必须写 交付：）
//   - [~] T1 标题    不做了（必须写 理由：）
// 注记只有一种开头：两个空格一个箭头，后面跟一个词——延后 或 下一段。
const FIELD = /^\s*(?:→\s*)?(标准|问题|依据|前提|交付|理由|延后|下一段|改到下一段)\s*[：:]\s*(.*)$/u;
const CHECK = /^\s*-\s*\[([ xX~?])\]\s+(?:(T\d+)\s+)?(.*)$/u;
const LEGACY_FRESH = /^\s*-\s*\?\s+(.*)$/u;
const LEGACY_DROPPED = /^\s*~~\s*(T\d+)\s*(.*)$/u;
const HEADING = /^(#{1,6})\s*(.*)$/u;

const fieldOf = (word) => ({
  标准: "criteria",
  问题: "problem",
  依据: "source",
  前提: "premise",
  交付: "claim",
  理由: "why",
  延后: "later",
  下一段: "carry",
  改到下一段: "carry",
})[word];

// What the file says, in the order it says it. Nothing here decides whether the
// batch is allowed; that is the command's business, and fold has the last word.
export function parse(text) {
  const items = [];
  const sections = [];
  const problems = [];
  const goal = [];
  let where = null;
  // 节是条目排在哪里的依据：同一段里的先后按文件里的先后算，不按条目编号算。
  // 条目一旦离开它那一节，位置就变了——这是这份文件唯一说「顺序」的地方。
  let section = 0;
  let item = null;
  // 条目一出现，前面的散文就不再是「这一期要做成什么」了：那是写错位置的句子。
  let started = false;
  let inComment = false;
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  for (const [index, raw] of lines.entries()) {
    const at = index + 1;
    const line = raw.replace(/\s+$/u, "");
    if (line.trim() === "") continue;
    // 注释是给人看的（写法和现在的形状都印在那里）：它不是这一期要做成什么的一部分。
    // 从 <!-- 到 --> 之间整段跳过，所以注释可以写好几行。
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.trim().startsWith("<!--")) {
      inComment = !line.includes("-->");
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      where = heading[1].length === 1 ? "goal" : "segment";
      item = null;
      if (where === "segment") {
        section += 1;
        // 节头写的是哪一段：写了 S02.21 就落那一段；空着的节 submit 领一个新号。
        sections.push({ index: section, title: heading[2].replace(/^段\s*/u, "").trim() });
        started = true;
      }
      continue;
    }
    const check = CHECK.exec(line);
    if (check) {
      const mark = check[1].toLowerCase();
      const box = mark === "x" ? "x" : mark === "~" ? "~" : mark === "?" ? "?" : " ";
      // 「?」那条没有号：新条目在 submit 那一刻才领。
      item = { id: box === "?" ? null : (check[2] ?? null), title: check[3].trim(), box, at, section };
      items.push(item);
      started = true;
      continue;
    }
    // 旧写法照读：以前新条目写 "- ? 标题"、放弃写 "~~ T1 标题"。
    const fresh = LEGACY_FRESH.exec(line);
    if (fresh) {
      item = { id: null, title: fresh[1].trim(), box: "?", at, section };
      items.push(item);
      started = true;
      continue;
    }
    const dropped = LEGACY_DROPPED.exec(line);
    if (dropped) {
      item = { id: dropped[1], title: dropped[2].trim(), box: "~", at, section };
      items.push(item);
      started = true;
      continue;
    }
    const field = FIELD.exec(line);
    if (field) {
      if (!item) {
        problems.push("第 " + at + " 行的「" + field[1] + "：」不属于任何条目");
        continue;
      }
      const key = fieldOf(field[1]);
      if (item[key] !== undefined) {
        problems.push("第 " + at + " 行：条目 " + (item.id ?? item.title) + " 的「" + field[1] + "：」写了不止一遍");
        continue;
      }
      item[key] = field[2].trim();
      continue;
    }
    if (where === "goal" && !started) {
      // 目的是一句话，写在所有条目之前。第二句多半是想写条目却忘了缩进或忘了
      // - [ ]——说出来，别把它悄悄拼进那一句话里。
      if (goal.length > 0) {
        problems.push("第 " + at + " 行读不懂：这一期要做成什么只写一句话（多出来的这句要么是条目，要么是写错了）");
        continue;
      }
      goal.push(line.trim());
      continue;
    }
    problems.push("第 " + at + " 行看不懂：" + line.trim());
  }
  const ids = items.filter((one) => one.id).map((one) => one.id);
  const twice = ids.filter((id, at) => ids.indexOf(id) !== at);
  if (twice.length > 0) problems.push("同一个条目标了两次：" + [...new Set(twice)].join("、"));
  // 条目只知道自己属于第几节；节头把"第几节"翻成"哪一段"。
  for (const item of items) {
    const sec = sections.find((one) => one.index === item.section) ?? null;
    item.sectionTitle = sec ? sec.title : "";
  }
  return { goal: goal.join(" ").trim(), items, sections, problems };
}

// 一组一行注释：markdown 里看不见它，纯文本里也只占一行——但读的人知道哪几条是做过的。
const GROUP_NOTE = {
  doing: "：只做这一条，做完立刻勾上，再动下一条",
  waiting: "：上面那条做完再动",
  settled: "：交过的，往下沉",
  closed: "：不做了的，沉到最后",
};

const bullet = (task) => {
  if (task.status === "dropped") return "- [~] " + task.id + " " + task.title;
  // 判过的条目也算交过了：草稿把它们画成未勾选，下一次 submit 就会当成
  // 「还没做」，或者让已经判过的一段重新被勾一遍。
  const box = task.status === "done" || task.status === "accepted" ? "[x]" : "[ ]";
  return "- " + box + " " + task.id + " " + task.title;
};

// 草稿只画要过目的东西：目的、现在收活的段、排着的下一段、还没做完的条目。
// 已关闭的段不再常驻——它们的事实全在账本里，草稿上只留一行数。
// 说明印成注释：解析器整段跳过它。这里不写任何像真条目的字样（不出现号、不以方框开头），
// 免得按行改文件的脚本把说明本身当成一条任务改了。
const LEGEND = [
  "<!-- 这份文件就是这一期的清单：改它，然后 deed submit 一次记账。",
  "     每条任务一行，开头是一个方框：方框里 ? = 新条目、空着 = 还没做、x = 已交付、~ = 不做了。",
  "     方框后面跟着号和标题；改的时候只动方框与下面那几行，别改号和标题。",
  "     一条任务可带三行上下文：问题：要消掉的现象（不随实现变）；依据：能点回哪一轮/哪条要点的锚点；",
  "     前提：这条标准依赖的概念、命令、版本——概念一变，读的人据此知道要重新理解。",
  "     勾上就得写一行「交付：」——跑了什么、结果几比几；不做了就得写一行「理由：」。",
  "     注记两行：箭头加「延后：」这一次不做；箭头加「下一段：」送去下一段接着做，不是放弃。",
  "     先后就是你排的行序：上下挪一下再 submit；一次只交一条。 -->",
].join("\n");

export function draft(session) {
  const out = [HEAD, session.goal?.text ?? "（还没写：一句话说清这一期要做成什么）", "", LEGEND, ""];
  // 关闭与否只有一种写法：closedAt 有值就是关了（null 与 undefined 都是没关）。
  const open = session.segments.filter((one) => one.closedAt == null);
  const closed = session.segments.filter((one) => one.closedAt != null);
  if (closed.length > 0) {
    // 一行说清沉下去的：几条、哪几段。要看细节去 deed state 或账本，不在这份文件里。
    const counts = closed.map((one) => one.id + " " + session.tasks.filter((task) => task.segment === one.id).length);
    out.push("<!-- 已关闭 " + closed.length + " 段（不再过目）：" + counts.join(" · ") + " -->", "");
  }
  for (const segment of open) {
    const tasks = session.tasks.filter((one) => one.segment === segment.id);
    if (tasks.length === 0) continue;
    out.push("## 段 " + segment.id);
    // 只有"排好的下一段"才印这句：它前面还有一段没收活。这是 takingSegment 的那一条。
    const taking = session.segments.find((one) => one.closedAt == null && one.plannedAt == null) ?? null;
    if (taking && taking.id !== segment.id) out.push("<!-- 还没轮到：现在收活的是 " + taking.id + "，轮到了这一段才收交付 -->");
    for (const group of groupsOf(tasks)) {
      out.push("<!-- " + group.label + "（" + group.tasks.length + " 条）" + GROUP_NOTE[group.key] + " -->");
      for (const task of group.tasks) {
        out.push(bullet(task));
        if (task.problem) out.push("  问题：" + task.problem);
        if (task.source) out.push("  依据：" + task.source);
        if (task.premise && task.premise.length > 0) out.push("  前提：" + task.premise.join("、"));
        out.push("  标准：" + task.criteria);
        const last = task.evidence[task.evidence.length - 1];
        if (last) out.push("  交付：" + last.claim);
        if (task.status === "deferred") out.push("  → 延后：" + (task.deferredWhy ?? ""));
        if (task.status === "dropped") out.push("  理由：" + (task.dropWhy ?? task.deferredWhy ?? ""));
      }
    }
    out.push("");
  }
  // 新条目落在哪一段：正在等结论/等判决的段不再收新东西，那时 ? 落到下一段。
  const last = open.at(-1) ?? null;
  if (!last) out.push("## 下一段（这一段的活都结束了：写在这里的 ? 会开下一段）", "");
  else if (awaitingVerdict(session, last))
    out.push("## 下一段（" + last.id + " 在等结论，它不再收新条目：写在这里的 ? 落到下一段，submit 时才领号）", "");
  else if (awaitingJudgement(session, last))
    out.push("## 下一段（" + last.id + " 审查通过了、等你判决，它不再收新条目：写在这里的 ? 落到下一段，submit 时才领号）", "");
  return out.join("\n");
}
