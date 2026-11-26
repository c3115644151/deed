import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { workspace } from "../support/lib.mjs";
import { readEvents } from "../lib/store.mjs";
import { fold } from "../core/fold.mjs";
import { CLI, OFF, deed, addTask, deliverTask, setGoal, proof, briefs } from "./support/cli.mjs";


const due = (cwd, ...args) => {
  const run = spawnSync(process.execPath, [CLI, "review", "--due", ...args], { cwd, encoding: "utf8", env: OFF });
  const line = String(run.stdout ?? "").trim().split("\n").pop();
  assert.equal(run.status, 0, "问一句该不该审不该拒：" + run.stderr);
  return JSON.parse(line);
};


// 原文可以由宿主交来：话仍是人说的，通道写着它怎么到的；同一个消息号只记一次。
test("a host can hand the raw turn in, and the same message is recorded once", () => {
  const cwd = workspace("say-from");
  deed(cwd, "init", "--said", "开始");
  const first = deed(cwd, "say", "--from", "dsh:session-abc:m-1", "这一轮原话");
  assert.equal(first.status, 0, first.stderr);
  const row = readEvents(cwd).filter((one) => one.k === "turn").at(-1);
  assert.deepEqual([row.who, row.via, row.origin, row.mid], ["user", "hook", "dsh", "m-1"], "话是人说的，通道是钩子交来的");
  const again = deed(cwd, "say", "--from", "dsh:session-abc:m-1", "这一轮原话");
  assert.equal(again.status, 0);
  assert.match(again.stdout, /已经记过/, "同一个消息号不再记第二遍");
  assert.equal(readEvents(cwd).filter((one) => one.mid === "m-1").length, 1, "这个消息号只落了一条");
});


// 没有位置参数时读 stdin：引号、换行走 argv 会被拆坏。
test("a piped turn keeps its own quotes and line breaks", () => {
  const cwd = workspace("say-stdin");
  deed(cwd, "init", "--said", "开始");
  const run = spawnSync(process.execPath, [CLI, "say"], {
    cwd, encoding: "utf8", env: OFF, input: '第一行 "引号"\n第二行\n',
  });
  assert.equal(run.status, 0, run.stderr);
  const row = readEvents(cwd).filter((one) => one.k === "turn").at(-1);
  assert.equal(row.said, '第一行 "引号"\n第二行', "引号与换行一个字没少");
  assert.equal(row.mid, undefined, "没有 --from 就不是钩子交来的");
  assert.match(deed(cwd, "state").stdout, /2 轮/, "这一轮记进了会话");
});


// 「现在该谁审」：只读，回答清单在哪、交给哪个名字。
test("the due query says what needs a reviewer, and never asks the person", () => {
  const cwd = workspace("review-due");
  deed(cwd, "init", "--said", "开始", "--review", "core/**");
  fs.mkdirSync(path.join(cwd, "core"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "core", "a.mjs"), "x\n");
  setGoal(cwd, "把这一件事做成");
  assert.deepEqual(due(cwd), { kind: null }, "还没有交付：没有该审的东西");

  addTask(cwd, "写一处实现", "文件在");
  deliverTask(cwd, "T1", "写了 core/a.mjs", { file: "core/a.mjs" });
  const want = due(cwd);
  assert.equal(want.kind, "segment");
  assert.equal(want.segment, "S01.1");
  assert.equal(want.needs, "brief", "条目都交付了：要的是一份清单");
  assert.equal(want.hand, "r-s01-1", "这一段交给同一个名字");

  const wrote = deed(cwd, "review", "--segment", "S01.1", "--auto");
  assert.equal(wrote.status, 0, wrote.stderr);
  const handed = readEvents(cwd).filter((one) => one.k === "review.brief").at(-1);
  assert.equal(handed.via, "auto", "记账的是钩子那一侧");
  const then = due(cwd);
  assert.equal(then.needs, "verdict", "清单已经交出去：这一步是落结论");
  assert.equal(then.hand, "r-s01-1", "复用的是同一个名字");
  assert.ok(fs.existsSync(path.join(cwd, then.brief)), "due 报的清单路径真的在盘上");
  assert.ok(fs.existsSync(path.join(cwd, then.guide)), "角色包也在盘上");

  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met").status, 0);
  assert.deepEqual(due(cwd), { kind: null }, "审查通过之后在等人判：那不是审查者的活");
});


// 免审的段没有审查者：它的结局是 agent 封存。
test("a segment the review setting lets through is never handed to a reviewer", () => {
  const cwd = workspace("review-due-exempt");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**");
  setGoal(cwd, "把文档写完");
  addTask(cwd, "写文档", "读完能上手");
  deliverTask(cwd, "T1", "写完了", { file: "docs/a.md" });
  assert.deepEqual(due(cwd), { kind: null }, "免审段不该出一份没人答的卷子");
});


// 期审：各段都有结局之后才谈，且每次一个新名字。
test("the period asks for a fresh reviewer, and only after every segment has an ending", () => {
  const cwd = workspace("review-due-period");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**");
  setGoal(cwd, "把文档写完");
  addTask(cwd, "写文档", "读完能上手");
  deliverTask(cwd, "T1", "写完了", { file: "docs/a.md" });
  assert.equal(deed(cwd, "review", "--skip", "--why", "只改了文档").status, 0);
  const want = due(cwd);
  assert.equal(want.kind, "period", "段都关了：轮到这一期的样子");
  assert.equal(want.needs, "brief");
  assert.equal(want.hand, "r-period-s01");
  assert.equal(deed(cwd, "review", "--all", "--auto").status, 0);
  assert.equal(due(cwd).needs, "verdict");
  assert.equal(deed(cwd, "review", "--all", "--verdict", "pass").status, 0);
  assert.deepEqual(due(cwd), { kind: null }, "期审过了：下一步是签收，不是再审");
});


// 原文的另一半：我说的话也进账本。它不数轮次、不开会话，同一个消息号只记一次。
test("my own side of the conversation is raw text too, and it never counts as a round", () => {
  const cwd = workspace("reply-from");
  deed(cwd, "init", "--said", "开始");
  const run = spawnSync(process.execPath, [CLI, "reply", "--from", "dsh:session-abc:a-1"], {
    cwd, encoding: "utf8", env: OFF, input: '我这边的一句话，带 "引号"\n与换行\n',
  });
  assert.equal(run.status, 0, run.stderr);
  const row = readEvents(cwd).filter((one) => one.k === "reply").at(-1);
  assert.deepEqual([row.via, row.origin, row.mid], ["hook", "dsh", "a-1"], "通道写着它怎么到的");
  assert.equal(row.text, '我这边的一句话，带 "引号"\n与换行', "一个字节没少");
  assert.equal(readEvents(cwd).filter((one) => one.k === "turn").length, 1, "回复不记成轮次");
  const again = spawnSync(process.execPath, [CLI, "reply", "--from", "dsh:session-abc:a-1"], {
    cwd, encoding: "utf8", env: OFF, input: "同一句",
  });
  assert.match(again.stdout, /已经记过/, "同一个消息号不再记第二遍");
  assert.match(deed(cwd, "state").stdout, /1 轮/, "状态里的轮次只有人开口那一轮");
});


// 一句空的回复不是话：不许落成一条什么都没有的行。
test("an empty reply is refused instead of becoming a blank fact", () => {
  const cwd = workspace("reply-empty");
  deed(cwd, "init", "--said", "开始");
  const run = spawnSync(process.execPath, [CLI, "reply", "--from", "dsh:s:m"], { cwd, encoding: "utf8", env: OFF, input: "   \n" });
  assert.equal(run.status, 1, "空的那一句要被拒");
  assert.match(run.stdout + run.stderr, /说了什么要写下来/, "拒绝的话要说清怎么写");
  assert.equal(readEvents(cwd).filter((one) => one.k === "reply").length, 0, "账本上没有一条空话");
});
