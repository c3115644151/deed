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

// 一次调用一行：退出码、花了多久、用过哪些开关（只记名字，不记值）、程序打出的那一句话。
test("every call leaves one line, and a refusal leaves the reason on it", () => {
  const cwd = workspace("debug-trace");
  deed(cwd, "init", "--said", "开始");
  const ok = deed(cwd, "say", "一句话");
  assert.equal(ok.status, 0);
  const refused = deed(cwd, "submit", "--run", "echo secret-value");
  assert.equal(refused.status, 1);

  const lines = rows(cwd);
  const said = lines.find((one) => one.verb === "say");
  assert.equal(said.code, 0, "退出码 0：客观量，不带我的解释");
  assert.equal(typeof said.ms, "number");
  const failed = lines.find((one) => one.verb === "submit");
  assert.equal(failed.code, 1, "非零退出码：客观量");
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
test("the report prints the measured quantities without interpreting them", () => {
  const cwd = workspace("debug-report");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "say", "一句话");
  deed(cwd, "submit"); // 拒一次
  const out = deed(cwd, "debug", "--days", "7");
  assert.equal(out.status, 0);
  assert.match(out.stdout, /观察 · 最近 7 天/u);
  assert.match(out.stdout, /窗口内一次都没出现过的动词/u);
  assert.match(out.stdout, /reply/u, "窗口里没出现的动词被列出");
  assert.match(out.stdout, /退出码/u);
  assert.match(out.stdout, /submit\s+\d+\s+1×1/u);
  assert.match(out.stdout, /窗口内一次都没出现过的开关/u);
  assert.doesNotMatch(out.stdout, /伪需求|缺陷|值得|提示设计|只当提示|别当结论/u, "报告不解释、不劝告、不下结论");

  const machine = JSON.parse(deed(cwd, "debug", "--json").stdout);
  assert.equal(machine.window.days, 30);
  assert.ok(Array.isArray(machine.verbs));
  assert.ok(machine.verbs.some((one) => one.verb === "say" && one.codes.some((c) => c.code === 0 && c.n === 1)));
  assert.ok(machine.absentVerbs.includes("reply"));
  assert.ok(machine.absentSwitches.some((one) => one.flag === "--run"));
  assert.equal(machine.window.calls, 4, "窗口里精确报出四次调用，不替人判断够不够");
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
