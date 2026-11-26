// docs: the paste block in the README is the one the command prints.
//
// Two copies of the same prose drift the moment someone edits one of them, and
// the copy an agent pastes is the one that silently loses. The README quotes
// the printed text; this test is what keeps "quotes" true.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BLOCK } from "../lib/words.mjs";
import { SPEC } from "../cli/spec.mjs";
import { WHO } from "../core/events.mjs";

const ROOT = path.join(import.meta.dirname, "..");

test("the README carries exactly the block init --print-agents prints", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.ok(readme.includes("\`\`\`md\n" + BLOCK + "\n\`\`\`"), "README 里那段要和命令输出逐字相同（改了命令就重跑一次，把这段换掉）");
});

test("the block names the commands an agent needs, and no verb it does not have", () => {
  // verify 动词已经删了：账本不再对字节，规则里不许再提它。
  for (const verb of ["deed say", "deed state", "deed plan", "deed submit", "deed review", "deed sign", "deed check --ledger"])
    assert.ok(BLOCK.includes(verb), "那段里少了 " + verb);
  assert.doesNotMatch(BLOCK, /deed (start|close|switch)\b/u, "没有的动作不要写进规则里");
});
test("AGENTS.md carries the same block, so the paste does not drift on one side", () => {
  const agents = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(agents.trimEnd().endsWith(BLOCK.trimEnd()), "AGENTS.md 结尾那段要和 init --print-agents 逐字相同（重跑命令，把尾段整个换掉）");
});

// The lexicon is one table in DESIGN 1.1. A word that stops being used there but
// stays in prose teaches the next reader two vocabularies; this test is what
// keeps "we renamed it" true after the grep that found it is forgotten.
// 往里加一个词要同时做两件事：把它在仓里的每一处换成正式说法，并在这里的
// 「用词对照表」保留区写一行「旧词 → 换成什么」。只做前一件，下一个人只学到一个新词。
const RETIRED = ["承诺", "判据", "折叠", "任务书", "白纸", "物料", "三态", "读数", "钉住", "证据", "事实账本", "出纸", "门槛", "收口", "欠账", "落账", "钉子", "封段", "搬"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".deed", ".deed-test", ".tmp", ".shots", ".archify", ".idea", ".vscode", "examples"]);

function prose(root, found = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) prose(full, found);
    else if (/\.(md|mjs)$/.test(entry.name)) found.push(full);
  }
  return found;
}

// 用词对照表故意保留被换掉的词，所以那里是 retired 词唯一允许出现的地方。
// 标记圈出那一段，别处出现就是两份词表并存。
const dropTable = (text) => text.replace(/<!-- 用词对照表[\s\S]*?<!-- \/用词对照表 -->/g, "");

// 「材料」是一句日常话（过程材料），也是一个被换掉的绰号。数它出现几次靠人眼，
// 而写数的人自己就是被数的对象——改一次文档就把数目改一次。这条守卫代替计数：
// 只有写成「过程材料」才算日常话，其余一律算绰号。
test("「材料」只许写成「过程材料」", () => {
  const left = [];
  for (const file of prose(ROOT)) {
    if (path.resolve(file) === path.resolve(import.meta.filename)) continue;
    // 先把「过程材料」整句抹掉，再看还剩几处：豁免写在替换里，不写在正则里——
    // 正则一改，靠偏移判豁免的写法就会从「抓绰号」变成「抓所有过程材料」。
    const text = dropTable(fs.readFileSync(file, "utf8")).replaceAll("过程材料", "");
    for (const hit of text.matchAll(/材料/gu)) {
      const line = text.slice(0, hit.index).split("\n").length;
      left.push(path.relative(ROOT, file) + " 第 " + line + " 行");
    }
  }
  assert.deepEqual(left, [], "「材料」在这里是绰号：写成「过程材料」，或者换一句说清它是什么");
});

test("no retired word is left in the prose or the code", () => {
  const left = [];
  for (const file of prose(ROOT)) {
    // 这份测试自己写着那张禁词表：它列出要禁的词，不该被自己判违规。
    if (path.resolve(file) === path.resolve(import.meta.filename)) continue;
    const text = dropTable(fs.readFileSync(file, "utf8"));
    for (const word of RETIRED) if (text.includes(word)) left.push(path.relative(ROOT, file) + " · " + word);
  }
  assert.deepEqual(left, [], "这些词已经不在名词表里了：「" + RETIRED.join("」「") + "」。改回通行词，别让两份词表并存");
});
// 同一个动作，帮助、文档、代码三处各说一句，读的人就会照着最松的那一句做事。
// 轮次这件事现在是"只有一个说法"：say 不收 --who，代码只认用户那一轮，文档也这么写。
test("the round is a user's round in the help, the docs and the code alike", () => {
  const usage = SPEC.say.usage.join("\n");
  assert.doesNotMatch(usage, /--who/u, "say 不收 --who：轮次只有人开口的那一轮");
  assert.doesNotMatch(usage, /--said/u, "said 是位置参数：再给一个 --said 就有两个说法");
  assert.deepEqual(WHO, ["user"], "代码里只认用户那一轮");
  for (const name of ["README.md", "AGENTS.md"]) {
    const text = fs.readFileSync(path.join(ROOT, name), "utf8");
    assert.match(text, /deed say "…"/u, name + " 里要写清轮次怎么记");
    assert.doesNotMatch(text, /deed tick/u, name + " 里不能再留旧动词");
  }
});
