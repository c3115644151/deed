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
} from "./support/cli.mjs";


test("a line this deed cannot read, written by the same version, is told apart by what it means", () => {
  // 真事：加了 task.undo 但没升版本号，正在跑的老进程（同一个 0.2.0）把它读成坏账，
  // 还建议整行挪去 rejected——照做就是丢掉一条真交付。行自己的含义版本能分清。
  const cwd = workspace("meaning-version");
  deed(cwd, "init", "--said", "开始");
  const shipped = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")).version;
  const at = new Date().toISOString();
  writeLines(cwd, [
    { v: 1, at, k: "turn", s: "S01", who: "user", said: "开始" },
    { v: EVENT_VERSION + 1, at, k: "task.block", s: "S01", id: "T1", why: "新版本才有的事件", w: shipped },
  ]);
  const doctor = deed(cwd, "doctor");
  assert.equal(doctor.status, 1, "读不动还是读不动：不猜语义");
  assert.match(doctor.stdout, /账本比 deed 新/);
  assert.match(doctor.stdout, new RegExp(`事件含义第 ${EVENT_VERSION + 1} 版`));
  assert.doesNotMatch(doctor.stdout, /rejected/, "同一个版本号的旧程序不该叫人删新行");
  const state = deed(cwd, "state");
  assert.equal(state.status, 1);
  assert.match(state.stderr, /账本比 deed 新/);
});

test("an unknown verb is refused in one line, not a stack trace", () => {
  const cwd = workspace("unknown-verb");
  const run = deed(cwd, "watch");
  assert.equal(run.status, 1);
  assert.equal(run.stderr.trim(), "deed: 没有这个动作：watch（deed help 看全部）");
  assert.equal(/at ModuleJob|Refused/.test(run.stdout + run.stderr), false, "拒绝不该带调用栈");
});


test("a directory with no ledger cannot be written into, or read as if it were fine", () => {
  const cwd = workspace("unbound");
  const tick = deed(cwd, "tick", "--who", "user", "--said", "我先说一句");
  assert.equal(tick.status, 1);
  assert.equal(tick.stderr.trim(), "deed: 这个目录还没接 deed：先 deed init（没有审查设置的账本，读不出状态，也判不了任何一段）");
  assert.deepEqual(kinds(cwd), [], "被拒的那一轮一个字也不该落盘");
  // 被拒是"什么都没发生"：拿锁时顺手建出来的东西也得擦干净，否则明天有人
  // 看见 .deed/ 会以为这个目录接过了。
  assert.equal(fs.existsSync(path.join(cwd, ".deed")), false, "被拒的写操作不该在目录里留下 .deed/");

  const state = deed(cwd, "state");
  assert.equal(state.status, 0);
  assert.equal(state.stdout.includes("这个目录还没接 deed · 先 deed init"), true);
  assert.equal(/下一步/.test(state.stdout), false, "没有审查设置时不该给下一步");

  const verify = deed(cwd, "verify");
  assert.equal(verify.status, 1);
  assert.equal(verify.stdout.trim(), "这个目录还没接 deed：deed init 之后才有账本和交付记录可查");
  assert.equal(fs.existsSync(path.join(cwd, ".deed")), false, "读也不行：看别人的目录不该建出 .deed/");
});


test("a take-back's shape is checked where it is written", () => {
  const base = { k: "task.undo", id: "T1", why: "说错了话", by: "agent" };
  assert.ok(validateEvent({ ...base, undoes: [] }), "什么也没记下的交付，撤回时是空数组");
  assert.ok(validateEvent({ ...base, undoes: [{ path: "a.txt", digest: "a".repeat(64) }] }));
  assert.throws(() => validateEvent({ ...base, undoes: "a.txt" }), /undoes 要是数组/);
  assert.throws(() => validateEvent({ ...base, undoes: [{ path: "a.txt" }] }), /path 与 digest/);
});


test("a pin in a closed segment stops blocking, but it still gets reported", () => {
  const cwd = workspace("shut-pins");
  fs.writeFileSync(path.join(cwd, "thing.txt"), "v1");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "记下内容", "--criteria", "文件在", "--files", "thing.txt");
  deed(cwd, "task", "done", "T1", "--evidence", "第一版");
  deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  const passed = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass", "--result-all", "met");
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(judgeHere(cwd, "S01.1").status, 0, "判过这一段才是真的关了");
  fs.writeFileSync(path.join(cwd, "thing.txt"), "v2");
  const after = deed(cwd, "verify");
  assert.equal(after.status, 0, after.stdout + after.stderr);
  assert.doesNotMatch(after.stdout, /交付记录过期 · T1/, "已关闭的段里没人能再交付，追旧记录只会留一笔结不掉的未结项");
  assert.match(after.stdout, /已关闭的段里有 1 条记下的字节已经变了/, "跳过整条会让「字节变了」变成没人看的一格");
});


test("a flag given twice is refused instead of quietly keeping the last one", () => {
  const cwd = workspace("repeat-flag");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  const twice = deed(cwd, "task", "done", "T1", "--evidence", "第一条", "--evidence", "第二条");
  assert.equal(twice.status, 1, "同一个参数写两遍要问清楚，不能只留最后一条");
  assert.match(twice.stderr, /--evidence 只收一个值/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "task.done").length, 0, "被拒的命令一条都不写");
});


// 轮次是你和用户之间的一轮对话：我自己做了什么不进轮次——那不是讨论，是交付。

test("a round belongs to the user, and an agent cannot open one", () => {
  const cwd = workspace("round-user-only");
  deed(cwd, "init", "--said", "开始");
  const mine = deed(cwd, "tick", "--who", "agent", "--said", "我改了三处");
  assert.equal(mine.status, 1);
  assert.match(mine.stderr, /轮次只记你和用户之间的一轮/);
  assert.equal(kinds(cwd).filter((one) => one === "turn").length, 1, "被拒的那轮不记账");
  assert.equal(deed(cwd, "tick", "--said", "再改一处").status, 0, "不写 --who 就是替用户记");
  assert.match(deed(cwd, "state").stdout, /· 2 轮 ·/);
});

// 审查设置的一半是规模，而手工 --digest 常常指一份这次没动、但这条任务得担着的文件：
// 它不在工作区差里，不称就一直「称不出」，审查设置只好按要审算。

test("pinning a file that did not move this time still weighs it", () => {
  const cwd = workspace("weigh-pin");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "T1", "--criteria", "做完的标准");
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "第一次").status, 0);
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "重新记同一份").status, 0);
  const last = readEvents(cwd).filter((one) => one.k === "task.done").at(-1);
  assert.deepEqual(last.changed, [], "这一次什么都没动");
  assert.equal(last.bytes["proof.txt"], fs.statSync(path.join(cwd, "proof.txt")).size);
});


// 开关写错一个字：要认出来、说出写错的是哪个、猜最近的那个；一路静默吞掉是最坏的一种。
test("a flag one letter off is refused, and the nearest name is guessed", () => {
  const cwd = workspace("spec-guess");
  deed(cwd, "init", "--said", "起点");
  deed(cwd, "task", "add", "一件事", "--criteria", "做完");
  const behind = deed(cwd, "task", "done", "T1", "--evidence", "跑了", "--digset", "proof.txt");
  assert.equal(behind.status, 1, behind.stdout);
  assert.match(behind.stderr, /不认 --digset/);
  assert.match(behind.stderr, /--digest/);
  // 开关写在子命令的位置上：先说开关错在哪，不拿"子命令不存在"糊过去。
  const upfront = deed(cwd, "task", "--digset", "proof.txt");
  assert.equal(upfront.status, 1, upfront.stdout);
  assert.match(upfront.stderr, /--digest/);
});


// 老账本里可能有一条封存没写理由（早先的 CLI 不校验）：理由为空时只印那半句，
// 不能补一对空括号出来——那会让人以为是排版坏了，而不是"当时没写"。
test("a sealed segment with no reason written says what it is, without empty brackets", () => {
  const cwd = workspace("seal-why-blank");
  deed(cwd, "init", "--said", "把文档写完", "--exempt", "docs/**");
  deed(cwd, "goal", "把文档写完", "--by", "user");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  deed(cwd, "task", "done", "T1", "--evidence", "写完了");
  assert.equal(deed(cwd, "seal", "--why", "只改了文档", "--by", "agent").status, 0);
  const logDir = path.join(cwd, ".deed", "log");
  const name = fs.readdirSync(logDir).find((one) => one.endsWith(".jsonl"));
  const file = path.join(logDir, name);
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const at = lines.findIndex((one) => JSON.parse(one).k === "segment.seal");
  assert.notEqual(at, -1, "先得有一条封存可改");
  const ev = JSON.parse(lines[at]);
  delete ev.why;
  lines[at] = JSON.stringify(ev);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  assert.equal(judged(cwd, "review", "--all", "--by", "period-1").status, 0, "期审清单出得来");
  assert.equal(judged(cwd, "review", "--all", "--by", "period-1", "--verdict", "pass").status, 0);
  const signed = signHere(cwd, "可以");
  assert.equal(signed.status, 0, signed.stderr);
  assert.match(signed.stdout, /没经过审查 · S01\.1/, "这一行照旧要露面");
  // 理由缺的是 undefined 而不是空串：两种形状都不许露出来，否则守卫被删掉也没人知道
  assert.doesNotMatch(signed.stdout, /（）|undefined/u, "没有理由就不该有括号，也不该露出 undefined");
});


test("a path that moved between the scan and the ledger write is caught, and a gone one says gone", () => {
  // 量差到记账之间工作区可能被别的东西写过：那条判断要能分开"变了"与"不在了"，
  // 因为两者都算变了，但说出来的话不一样。
  const cwd = workspace("moved");
  fs.writeFileSync(path.join(cwd, "a.md"), "one");
  const pin = { path: "a.md", digest: createHash("sha256").update("one").digest("hex") };
  assert.deepEqual(movedSince(cwd, [pin]), []);
  fs.writeFileSync(path.join(cwd, "a.md"), "two");
  const moved = movedSince(cwd, [pin]);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].path, "a.md");
  assert.equal(moved[0].now, createHash("sha256").update("two").digest("hex"));
  fs.rmSync(path.join(cwd, "a.md"));
  assert.equal(movedSince(cwd, [pin])[0].now, null, "文件不在了要说成不在了，不是没说变");
});
