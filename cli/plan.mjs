// plan: the one file both sides edit. A person or an agent reads the draft,
// changes the ticks and the words, and submits it once. Parsing lives here so
// the rules about what a line means are in one place instead of in the command.
//
// The file is inside .deed/, so the workspace snapshot never counts it as work:
// editing the plan is not a change to the workspace, it is a change to say what
// the work was.

export const HEAD = "# 这一期要做成什么";

export const FORMAT = [
  HEAD,
  "一句话说清这一期要做成什么。",
  "",
  "## 段 S01.1",
  "- [x] T1 已经交付的条目",
  "  标准：做完的标准",
  "  交付：跑了什么，结果几比几",
  "- [ ] T2 还没做的条目",
  "  标准：做完的标准",
  "- ? 还没有编号的条目",
  "  标准：做完的标准",
  "~~ T3 不做了的条目",
  "  理由：为什么不做了",
  "",
  "四件事：勾上 = 交付（必须写 交付：），取消勾选 = 撤回（必须写 理由：），",
  "? = 新条目（submit 时领号），~~ = 放弃（必须写 理由：）；",
  "延后写一行 延后：为什么。路径与 sha256 不用写，submit 自己算。",
].join("\n");

const FIELD = /^\s*(标准|交付|理由|延后)\s*[：:]\s*(.*)$/u;
const CHECK = /^\s*-\s*\[([ xX])\]\s+(?:(T\d+)\s+)?(.*)$/u;
const FRESH = /^\s*-\s*\?\s+(.*)$/u;
const DROPPED = /^\s*~~\s*(T\d+)\s*(.*)$/u;
const HEADING = /^(#{1,6})\s*(.*)$/u;

const fieldOf = (word) => ({ 标准: "criteria", 交付: "claim", 理由: "why", 延后: "later" })[word];

// What the file says, in the order it says it. Nothing here decides whether the
// batch is allowed; that is the command's business, and fold has the last word.
export function parse(text) {
  const items = [];
  const problems = [];
  const goal = [];
  let where = null;
  let item = null;
  // 条目一出现，前面的散文就不再是「这一期要做成什么」了：那是写错位置的句子。
  let started = false;
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  for (const [index, raw] of lines.entries()) {
    const at = index + 1;
    const line = raw.replace(/\s+$/u, "");
    if (line.trim() === "") continue;
    // 注释行是给人看的：它不是这一期要做成什么的一部分。
    if (line.trim().startsWith("<!--")) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      where = heading[1].length === 1 ? "goal" : "segment";
      item = null;
      if (where === "segment") started = true;
      continue;
    }
    const check = CHECK.exec(line);
    if (check) {
      item = { id: check[2] ?? null, title: check[3].trim(), box: check[1].toLowerCase() === "x" ? "x" : " ", at };
      items.push(item);
      started = true;
      continue;
    }
    const fresh = FRESH.exec(line);
    if (fresh) {
      item = { id: null, title: fresh[1].trim(), box: "?", at };
      items.push(item);
      started = true;
      continue;
    }
    const dropped = DROPPED.exec(line);
    if (dropped) {
      item = { id: dropped[1], title: dropped[2].trim(), box: "~", at };
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
  return { goal: goal.join(" ").trim(), items, problems };
}

const bullet = (task) => {
  if (task.status === "dropped") return "~~ " + task.id + " " + task.title;
  const box = task.status === "done" ? "[x]" : "[ ]";
  return "- " + box + " " + task.id + " " + task.title;
};

// The draft the ledger can account for: every task it already knows, under the
// segment it sits in, with the words it was given. Nothing is invented here.
export function draft(session) {
  const out = [HEAD, session.goal?.text ?? "（还没写：一句话说清这一期要做成什么）", ""];
  for (const segment of session.segments) {
    const tasks = session.tasks.filter((one) => one.segment === segment.id);
    if (tasks.length === 0) continue;
    out.push("## 段 " + segment.id);
    for (const task of tasks) {
      out.push(bullet(task));
      out.push("  标准：" + task.criteria);
      const last = task.evidence[task.evidence.length - 1];
      if (last) out.push("  交付：" + last.claim);
      if (task.status === "deferred") out.push("  延后：" + (task.deferredWhy ?? ""));
      if (task.status === "dropped") out.push("  理由：" + (task.dropWhy ?? task.deferredWhy ?? ""));
    }
    out.push("");
  }
  out.push("<!-- 勾上 = 交付（写 交付：一行）；取消勾选 = 撤回（写 理由：）；? = 新条目；~~ = 放弃（写 理由：）。改完 deed submit -->");
  return out.join("\n");
}
