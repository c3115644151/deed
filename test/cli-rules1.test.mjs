import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { workspace } from "../support/lib.mjs";
import { readEvents } from "../lib/store.mjs";
import { fold } from "../core/fold.mjs";
import { EVENT_VERSION, validateEvent } from "../core/events.mjs";
import { panelRecord, buildNow, watchedFiles } from "../lib/panel.mjs";
import { applyGate, gatesOf } from "../board/gates.mjs";
import {
  CLI, OFF, deed, later, gate, judgeAll, judgeHere, signHere, judged, kinds, briefs, proof,
  writeLines, planFile, writePlan, readPlan,
  addTask, deliverTask, undoDelivery, dropTask,
} from "./support/cli.mjs";


test("init binds the workspace and records the first turn", () => {
  const cwd = workspace("init");
  const first = deed(cwd, "init", "--said", "开始");
  assert.equal(first.status, 0);
  const config = JSON.parse(fs.readFileSync(path.join(cwd, ".deed", "config.json"), "utf8"));
  // 审查设置不替工作区猜目录：空着的意思就是"任何改动都要审"，要免审由工作区自己声明。
  assert.deepEqual(config.review, { required: [], exempt: [] });
  assert.match(first.stdout, /审查设置是空的：任何改动都要审/);
  assert.deepEqual(kinds(cwd), ["config.change", "config.change", "config.change", "turn"], "审查设置的基线也落在账本里");
});


test("init says what else can be done, so one round can finish it", () => {
  const cwd = workspace("init-optional");
  const out = deed(cwd, "init", "--said", "开始", "--port", "7420");
  assert.equal(out.status, 0);
  for (const one of ["deed init --print-agents", "deed serve", "deed check --ledger", "deed check --gates", "deed init --force"])
    assert.ok(out.stdout.includes(one), one + " 应该出现在 init 的反馈里");
  assert.match(out.stdout, /127\.0\.0\.1:7420/, "面板地址用这个工作区的端口");
  assert.match(out.stdout, /都可选/, "说清楚不做也不会坏");
});


test("a turn must say what was said", () => {
  const cwd = workspace("say");
  deed(cwd, "init", "--said", "开始");
  assert.equal(deed(cwd, "say").status, 1);
});


// 一段的一期不审两遍：段放行就是这一期的结局，下一步直接是签收。
test("a period with one segment still owes the period judgement, and that judgement is not a second pass over the items", () => {
  const cwd = workspace("single-whole");
  deed(cwd, "init", "--said", "开始");
  fs.mkdirSync(path.join(cwd, "core"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "core", "a.mjs"), "a\n");
  addTask(cwd, "甲", "能跑", "--files", "core/a.mjs");
  deliverTask(cwd, "T1", "node --test");
  const alone = judged(cwd, "review", "--all");
  assert.equal(alone.status, 1, "整期上没有审查这件事");
  assert.match(alone.stderr, /--all/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "review.brief").length, 0, "被拒的一个字都不写");
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met").status, 0);
  const state = deed(cwd, "state");
  assert.equal(state.status, 0);
  assert.match(state.stdout, /下一步 · user · 判决/, "审查通过之后轮到你判这一段");
  assert.equal(judgeHere(cwd, "S01.1").status, 0);
  assert.match(deed(cwd, "state").stdout, /下一步 · reviewer · 期审/, "判过之后轮到这一期做成的样子");
  assert.match(deed(cwd, "state").stdout, /deed review --all/u, "期审有它自己的命令");
  assert.equal(judged(cwd, "review", "--all").status, 0);
  const sheet = briefs(cwd)
    .filter((one) => one.startsWith("S01-period-") && !one.endsWith("-reviewer.md"))
    .map((one) => fs.readFileSync(path.join(cwd, ".deed", "review", one), "utf8")).at(-1);
  assert.match(sheet, /各段的结局/u, "期审清单列的是各段结局");
  assert.doesNotMatch(sheet, /## 要审的任务/u, "期审不重判段里的条目");
  assert.equal(judged(cwd, "review", "--all", "--verdict", "pass").status, 0);
  assert.match(deed(cwd, "state").stdout, /下一步 · user · 签收/, "期审过了才剩一句话");
  assert.equal(signHere(cwd, "可以").status, 0);
});


// PowerShell 5.1 会把 --did "" 变成裸开关，账本落 did: true，读起来像"这轮做过事"。
test("a turn cannot record a did it never wrote", () => {
  assert.throws(() => validateEvent({ k: "turn", who: "user", said: "开始", did: 5 }), /did/);
  assert.ok(validateEvent({ k: "turn", who: "user", said: "开始", did: true }));
  assert.ok(validateEvent({ k: "turn", who: "user", said: "开始", did: "跑了一遍测试" }));
});


test("a closed period cannot be written into, and no verb invents a new one", () => {
  const cwd = workspace("closed");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**");
  addTask(cwd, "写文档", "读完能上手");
  // 交付落在免审路径上，这一段才封得掉（审查设置只 exempt docs/**）。
  assert.equal(deliverTask(cwd, "T1", "写完了", { file: "docs/a.md" }).status, 0);
  assert.equal(deed(cwd, "review", "--skip", "--why", "只改了文档").status, 0);
  judged(cwd, "review", "--all");
  assert.equal(judged(cwd, "review", "--all", "--verdict", "pass").status, 0);
  signHere(cwd, "可以");
  const after = readEvents(cwd).length;
  const stray = addTask(cwd, "又一件", "x");
  assert.equal(stray.status, 1, "签收之后不能靠清单开新期");
  assert.match(stray.stderr, /没有在推进的会话|已经签收/u, "签收之后清单开不出新一期：得先有一轮");
  assert.equal(readEvents(cwd).length, after);
  assert.equal(deed(cwd, "say", "新的一轮").status, 0, "只有一轮对话能开新期");
  assert.equal(addTask(cwd, "又一件", "x").status, 0);
  // The turn that opens a period carries no pointer: it is the birth itself.
  const events = readEvents(cwd);
  const signAt = events.map((one) => one.k).lastIndexOf("sign");
  const afterSign = events.slice(signAt + 1);
  assert.deepEqual(afterSign.map((one) => one.k), ["turn", "segment.plan", "task.add"], "签收之后只多一轮与它开出的新条目（条目自己开一段）");
  assert.equal(afterSign[0].s ?? "-", "-", "开新期的那一轮没有指向前一期");
  assert.equal(afterSign.at(-1).s, "S02", "新活落在新一期");
});


// The threshold is a ledger fact. Editing the file used to be enough to loosen
// it without a trace; now the file is a mirror and the difference is reported.
test("the file on disk is a mirror: judgments read the threshold out of the ledger", () => {
  const cwd = workspace("config-drift");
  assert.equal(deed(cwd, "init", "--said", "开始").status, 0);
  const configFile = path.join(cwd, ".deed", "config.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  config.review.required = [];
  config.review.exempt = ["**"];
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  addTask(cwd, "改重放", "同账本同文档", "--files", "core/fold.mjs");
  deliverTask(cwd, "T1", "node --test");
  const blocked = deed(cwd, "review", "--skip", "--why", "全部免审");
  assert.equal(blocked.status, 1, "改文件不改变规则");
  assert.match(blocked.stderr, /要审|审查/);
  assert.match(deed(cwd, "state").stdout, /审查设置 文件与账本不一致/, "文件与账本不一致由 state 说出来");
  assert.equal(deed(cwd, "init", "--force", "--why", "全部免审，只留文档").status, 0);
  assert.doesNotMatch(deed(cwd, "state").stdout, /审查设置 文件与账本不一致/, "收进账本之后文件与账本一致");
  const last = readEvents(cwd).filter((one) => one.k === "config.change").at(-1);
  assert.equal(last.key, "review");
  assert.equal(last.why, "全部免审，只留文档");
  assert.deepEqual(last.to.required, [], "账本记的是改成什么样");
  assert.deepEqual(last.to.exempt, ["**"]);
  assert.equal(deed(cwd, "review", "--skip", "--why", "全部免审").status, 0, "账本放开了才算放开");
});


test("a workspace that never had a session says that, not that the last one closed", () => {
  const cwd = workspace("virgin");
  assert.equal(deed(cwd, "init").status, 0, "接过 deed、但还一轮都没记");
  const run = deed(cwd, "state");
  assert.equal(run.status, 0);
  assert.match(run.stdout, /还没有会话/);
  assert.doesNotMatch(run.stdout, /上一期已结束/);
});


test("a lock left by a dead process is taken at once, not after ten seconds", () => {
  const cwd = workspace("lock-dead");
  deed(cwd, "init", "--said", "开始");
  fs.writeFileSync(path.join(cwd, ".deed", "log", "lock"), JSON.stringify({ pid: 999999, start: Date.now() }));
  const began = Date.now();
  const added = addTask(cwd, "写服务", "能推事件", "--files", "core/serve.mjs");
  assert.equal(added.status, 0, "持有者不在了，锁就是一个残留文件");
  assert.ok(Date.now() - began < 3000, "不该为一把死锁等满等待预算");
  assert.deepEqual(
    kinds(cwd).filter((one) => one !== "config.change" && one !== "segment.plan"),
    ["turn", "task.add"],
    "锁被接手之后落下的还是那两条（条目自己开出来的那段先不算）",
  );
});






// 账本可能比程序新：这一行是别人写下的真事，只是这本程序读不懂。
// 两种情形的话术和动作相反（升级 vs 挪走），所以不能共用一套。

test("a ledger written by a newer deed says so instead of calling itself broken", () => {
  const cwd = workspace("newer-ledger");
  deed(cwd, "init", "--said", "开始");
  writeLines(cwd, [{ v: 1, at: new Date().toISOString(), k: "task.block", s: "S01", id: "T1", why: "0.9 才有的事件", w: "9.9.9" }]);
  const doctor = deed(cwd, "check", "--ledger");
  assert.equal(doctor.status, 1, "读不动就是读不动：不猜语义");
  assert.match(doctor.stdout, /账本比 deed 新/);
  assert.match(doctor.stdout, /升级 deed/);
  assert.doesNotMatch(doctor.stdout, /移到 \.deed\/log\/rejected/, "账本新的时候指去挪走，等于让人删真事");
  const state = deed(cwd, "state");
  assert.equal(state.status, 1);
  assert.match(state.stderr, /账本比 deed 新/);
});
