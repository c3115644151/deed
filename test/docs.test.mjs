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

const ROOT = path.join(import.meta.dirname, "..");

test("the README carries exactly the block init --print-agents prints", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.ok(readme.includes("\`\`\`md\n" + BLOCK + "\n\`\`\`"), "README 里那段要和命令输出逐字相同（改了命令就重跑一次，把这段换掉）");
});

test("the block names the commands an agent needs, and no verb it does not have", () => {
  for (const verb of ["deed state", "deed tick", "deed plan", "deed submit", "deed review", "deed judge", "deed sign", "deed verify", "deed doctor"])
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
const RETIRED = ["承诺", "判据", "折叠", "任务书", "白纸", "物料", "三态", "读数", "钉住", "证据", "事实账本", "出纸"];
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

// HANDOFF keeps the comparison table on purpose: it lists the words that were
// replaced, so the words appear there. The markers make that region the only
// place a retired word is allowed to stand.
const dropTable = (text) => text.replace(/<!-- 用词对照表[\s\S]*?<!-- \/用词对照表 -->/g, "");

// 「材料」是一句日常话（过程材料），也是一个被换掉的绰号。数它出现几次靠人眼，
// 而写数的人自己就是被数的对象——改一次文档就把数目改一次。这条守卫代替计数：
// 只有写成「过程材料」才算日常话，其余一律算绰号。
test("「材料」只许写成「过程材料」", () => {
  const left = [];
  for (const file of prose(ROOT)) {
    if (path.resolve(file) === path.resolve(import.meta.filename)) continue;
    const text = dropTable(fs.readFileSync(file, "utf8"));
    for (const hit of text.matchAll(/材料/gu)) {
      if (text.slice(Math.max(0, hit.index - 2), hit.index) === "过程") continue;
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
