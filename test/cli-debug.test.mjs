import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { workspace } from "../support/lib.mjs";
import { readEvents } from "../lib/store.mjs";
import { changedPaths } from "../lib/store.mjs";
import { deed } from "./support/cli.mjs";
import { readTraces, byVerb } from "../cli/trace.mjs";

const rows = (cwd) =>
  fs
    .readdirSync(path.join(cwd, ".deed", "debug"))
    .filter((one) => one.endsWith(".jsonl"))
    .flatMap((one) => fs.readFileSync(path.join(cwd, ".deed", "debug", one), "utf8").trim().split("\n").filter(Boolean))
    .map((one) => JSON.parse(one));

// 一次调用一行：成没成、花了多久、用过哪些开关（只记名字，不记值）、被拒时的那一句。
test("every call leaves one line, and a refusal leaves the reason on it", () => {
  const cwd = workspace("debug-trace");
  deed(cwd, "init", "--said", "开始");
  const ok = deed(cwd, "say", "一句话");
  assert.equal(ok.status, 0);
  const refused = deed(cwd, "submit", "--run", "echo secret-value");
  assert.equal(refused.status, 1);

  const lines = rows(cwd);
  const said = lines.find((one) => one.verb === "say");
  assert.equal(said.ok, true);
  assert.equal(typeof said.ms, "number");
  const failed = lines.find((one) => one.verb === "submit");
  assert.equal(failed.ok, false);
  assert.match(failed.why, /还没有清单/u, "被拒的那一句跟着这一行走");
  assert.deepEqual(said.switches, [], "没有开关就空着");
  assert.ok(failed.switches.includes("--run"), "开关只记名字");
  const text = fs.readFileSync(path.join(cwd, ".deed", "debug", lines[0].at.slice(0, 7) + ".jsonl"), "utf8");
  assert.doesNotMatch(text, /secret-value/u, "开关的值不落盘：它可能是命令、是路径、是秘密");
});

// 账本只记发生过的事：统计是另一处，一条都不进账本，也不进方案快照。
test("the trace is not the ledger, and not part of the workspace", () => {
  const cwd = workspace("debug-separate");
  deed(cwd, "init", "--said", "开始");
  const before = readEvents(cwd).length;
  deed(cwd, "say", "一句话");
  deed(cwd, "bogus");
  assert.equal(readEvents(cwd).length, before + 1, "只有 say 进账本；被拒的 bogus 一个字不进");
  assert.ok(rows(cwd).length >= 3, "被拒的调用在统计里");
  assert.equal(changedPaths(cwd).changed.includes(".deed/debug"), false, "统计不脏工作区");
});

// 报告回答三个问题：从没敲过的、敲了就失败的、没人用过的开关。
test("the report names what was never used, what keeps failing, and what switches nobody touches", () => {
  const cwd = workspace("debug-report");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "say", "一句话");
  deed(cwd, "submit"); // 拒一次
  const out = deed(cwd, "debug", "--days", "7");
  assert.equal(out.status, 0);
  assert.match(out.stdout, /调试 · 最近 7 天/u);
  assert.match(out.stdout, /从没敲过/u);
  assert.match(out.stdout, /reply/u, "没敲过的动词被点出来");
  assert.match(out.stdout, /敲了就失败最多的/u);
  assert.match(out.stdout, /submit\s+\d+ 次 · 失败/u);
  assert.match(out.stdout, /一次都没用过的开关/u);

  const machine = JSON.parse(deed(cwd, "debug", "--json").stdout);
  assert.equal(machine.window.days, 30);
  assert.ok(Array.isArray(machine.verbs));
  assert.ok(machine.verbs.some((one) => one.verb === "say" && one.ok === 1));
  assert.ok(machine.never.includes("reply"));
  assert.ok(machine.deadSwitches.some((one) => one.flag === "--run"));
  assert.equal(machine.enough, false, "样本少的时候自己说出来");
});

// 统计只认窗口：窗口外的调用不算进去，也不让一个过时的数字冒充现在。
test("only the window counts", () => {
  const cwd = workspace("debug-window");
  deed(cwd, "init", "--said", "开始");
  const file = path.join(cwd, ".deed", "debug", "2020-01.jsonl");
  fs.writeFileSync(
    file,
    JSON.stringify({ at: "2020-01-01T00:00:00.000Z", verb: "old", ok: true, ms: 1, switches: [] }) + "\n",
    "utf8",
  );
  const one = readTraces(cwd, 30);
  assert.equal(one.some((row) => row.verb === "old"), false, "五年前的调用不在三十天窗口里");
  assert.equal(byVerb(readTraces(cwd, 4000)).some((row) => row.verb === "old"), true, "窗口放宽就看得见");
});
