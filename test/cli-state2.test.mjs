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
  freshPlan,

  addTask, deliverTask, undoDelivery, dropTask,startReview, startPeriodReview} from "./support/cli.mjs";


test("naming a segment the ledger does not have lists the ones it does", () => {
  const cwd = workspace("segment-typo");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "甲", "c");
  const run = startReview(cwd, "S01.7");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /里没有段 S01\.7/);
  assert.match(run.stderr, /里没有段 S01\.7/);
});


test("a lock that names no usable holder still gets its grace, not an instant steal", () => {
  for (const body of [{ start: Date.now() }, { pid: 0, start: Date.now() }]) {
    const cwd = workspace("lock-blank-" + (body.pid ?? "none"));
    deed(cwd, "init", "--said", "开始");
    const lockPath = path.join(cwd, ".deed", "log", "lock");
    fs.writeFileSync(lockPath, JSON.stringify(body));
    const born = fs.statSync(lockPath).mtimeMs;
    const added = addTask(cwd, "写服务", "能推事件", "--files", "core/serve.mjs");
    assert.equal(added.status, 0, "锁里没有可用的持有者，宽限期过后就该接手");
    // 宽限期从锁落地那刻算，所以能算数的只有"写入发生在 250ms 之后"：
    // 进程耗时不能拿来相减——启动本身就要一百多毫秒，会被算进宽限期里。
    const at = Date.parse(readEvents(cwd).at(-1).at);
    assert.ok(at - born >= 200, "刚写下的锁要先等宽限期，不能一进来就夺：" + Math.round(at - born) + "ms");
  }
});


test("--session that names no period is refused by every verb that takes one", () => {
  const cwd = workspace("session-matrix");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "写文档", "读完能上手", "--files", "docs/a.md");
  for (const args of [
    ["submit", "--session", "S99"],
    ["review", "--segment", "S01.1", "--session", "S99"],
    ["review", "--skip", "--why", "免审", "--session", "S99"],
  ]) {
    const refused = deed(cwd, ...args);
    assert.equal(refused.status, 1, args.join(" ") + " 要点名真存在的会话");
    assert.match(refused.stderr, /没有这个会话|S99/);
  }
  // 签收在面板上按，它也只认账本里真有的会话。
  const nameless = signHere(cwd, "可以", { session: "S99" });
  assert.equal(nameless.status, 1);
  assert.match(nameless.stderr, /S99/);
});


test("an invented kind with no writer version is still a broken line", () => {
  const cwd = workspace("hand-written-kind");
  deed(cwd, "init", "--said", "开始");
  writeLines(cwd, [{ v: 1, at: new Date().toISOString(), k: "task.block", s: "S01", id: "T1", why: "手写的" }]);
  const doctor = deed(cwd, "check", "--ledger");
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /账本坏了/);
  assert.match(doctor.stdout, /没有写者版本/);
  assert.match(doctor.stdout, /rejected/);
});


test("every line records the deed that wrote it", () => {
  const cwd = workspace("writer-version");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "改重放", "总账能重放");
  const written = readEvents(cwd).map((one) => one.w);
  assert.ok(written.length >= 5);
  assert.ok(written.every((one) => /^\d+\.\d+\.\d+$/.test(one)), "没有写者版本的账本，以后说不清是账本新还是这一行坏了");
});


test("--version answers with the version this program ships as", () => {
  const cwd = workspace("version");
  const shipped = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")).version;
  const run = deed(cwd, "--version");
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), shipped);
});


// 2) --help for a verb with no arguments
test("asking a verb that takes no arguments answers with its line, not the whole page", () => {
  const cwd = workspace("usage-noargs");
  const run = deed(cwd, "state", "--help");
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), "deed state", "state --help 只该打这一行");
  assert.match(deed(cwd, "check", "--help").stdout, /deed check --ledger/u, "check 收开关：它的帮助是那几行");
  const plan = deed(cwd, "plan", "--help");
  assert.match(plan.stdout, /deed plan/);
  assert.doesNotMatch(plan.stdout, /deed judge --pass/, "问 plan 的用法不该回 judge 的行");
});


test("asking what a verb takes does not run it", () => {
  const cwd = workspace("verb-help");
  deed(cwd, "init", "--said", "开始");
  const before = briefs(cwd).length;
  const asked = deed(cwd, "review", "--help");
  assert.equal(asked.status, 0);
  assert.match(asked.stdout, /deed review --segment S01\.1/);
  assert.equal(briefs(cwd).length, before, "问一句用法不该发一份清单");
  assert.equal(kinds(cwd).includes("review.brief"), false);

  const plan = deed(cwd, "plan", "--help");
  assert.equal(plan.status, 0);
  assert.match(plan.stdout, /deed plan/);
});


test("the word --help inside evidence is evidence", () => {
  const cwd = workspace("help-in-words");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "写文档", "读完能上手", "--files", "docs/a.md");
  const done = deliverTask(cwd, "T1", "跑过 review --help 与 task --help，都只打用法");
  assert.equal(done.status, 0, "交付记录里出现 --help 不该被当成在问用法");
  assert.match(done.stdout, /交付 · T1/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "task.done").length, 1);
});


// 旧账本里同批的那些行照读：批号是当时写下的事实，撤回不改变它原本几条。
test("a batch written into an old ledger still reads, and taking one back does not shrink it", () => {
  const cwd = workspace("plan-batchundo");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "say", "一次交两条");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a", "utf8");
  fs.writeFileSync(path.join(cwd, "docs", "b.md"), "b", "utf8");
  writePlan(
    cwd,
    ["# 这一期要做成什么", "把两份说明写完。", "", "- ? 写 a", "  标准：docs/a.md 有一句话", "", "- ? 写 b", "  标准：docs/b.md 有一句话"].join("\n"),
  );
  assert.equal(deed(cwd, "submit").status, 0);
  // 手写两条同一批的交付：那一版的账本允许，这一版不再产生，但读得出来。
  const at = new Date().toISOString();
  const batch = { at, size: 2 };
  const digests = ["docs/a.md", "docs/b.md"].map((one) => ({
    path: one,
    digest: createHash("sha256").update(fs.readFileSync(path.join(cwd, one))).digest("hex"),
  }));
  const logDir = path.join(cwd, ".deed", "log");
  const name = fs.readdirSync(logDir).find((one) => one.endsWith(".jsonl"));
  const file = path.join(logDir, name);
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  for (const [index, id] of ["T1", "T2"].entries()) {
    lines.push(
      JSON.stringify({
        v: 19, w: "0.20.0", at, k: "task.done", s: "S01", id,
        evidence: "写下 " + digests[index].path, by: "agent",
        files: [digests[index]], changed: [digests[index].path], bytes: { [digests[index].path]: 1 },
        batch,
      }),
    );
  }
  fs.writeFileSync(file, lines.join("\n") + "\n");
});


// 草稿把判过的条目也画成勾上：否则下一次 submit 会当成还没做。

test("the draft keeps judged entries ticked", () => {
  const cwd = workspace("plan-draft-accepted");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "say", "写一条");
  writePlan(cwd, ["# 这一期要做成什么", "写一句话。", "", "- ? 写一句话", "  标准：docs/a.md 有一句话"].join("\n"));
  assert.equal(deed(cwd, "submit").status, 0);
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a", "utf8");
  writePlan(cwd, readPlan(cwd).replace("- [ ] T1 写一句话", "- [x] T1 写一句话").replace("  标准：docs/a.md 有一句话", "  标准：docs/a.md 有一句话\n  交付：写下 docs/a.md"));
  assert.equal(deed(cwd, "submit").status, 0);
  assert.equal(startReview(cwd, "S01.1").status, 0);
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met").status, 0);
  const draft = freshPlan(cwd);
  assert.equal(draft.status, 0, draft.stderr);
  assert.match(readPlan(cwd), /- \[x\] T1 写一句话/, "判过的条目在草稿里还是勾上的");
  const again = deed(cwd, "submit");
  assert.equal(again.status, 1, "判过的条目不会再交一次");
  assert.match(again.stderr, /没有要落的改动/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "task.done").length, 1);
});


test("removing a file nobody can weigh is not a small change", () => {
  const cwd = workspace("delete-is-not-small");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**,*.md");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  // 一万五千字节落在免审路径上，够小，够免审。
  fs.writeFileSync(path.join(cwd, "docs", "big.md"), "x".repeat(15000));
  addTask(cwd, "写一份一万五的文档", "它在");
  assert.equal(deliverTask(cwd, "T1", "写了 docs/big.md", { file: "docs/big.md" }).status, 0);
  assert.match(deed(cwd, "state").stdout, /免审（全部落在 exempt）/u, "一万五千字节落在免审路径上，本来不用审");

  addTask(cwd, "再把它删掉", "它不在了");
  fs.rmSync(path.join(cwd, "docs", "big.md"));
  const run = deliverTask(cwd, "T2", "docs/big.md 已删", { keep: true });
  assert.equal(run.status, 0, run.stderr);
  // 删掉的路径没有重量：按 0 字节算就等于说"删掉一万五不算大"，那是放行一条隧道。
  const events = readEvents(cwd).filter((one) => one.k === "task.done" && one.id === "T2");
  assert.deepEqual(events.at(-1).bytes, {}, "删掉的路径不记 0，记空");
  const state = deed(cwd, "state").stdout;
  assert.doesNotMatch(state, /免审（全部落在 exempt）/u, "删掉一万五千字节，不再算小改动");
  assert.match(state, /开始审查/u, "下一步是发清单（面板上按），不是封存");
});


test("a verb that takes no flags still says so instead of ignoring them", () => {
  // 只读动词以前不过开关表：拼错的开关被当成没写，命令照常 exit 0。
  const cwd = workspace("readonly-flags");
  deed(cwd, "init", "--said", "起点");
  const one = deed(cwd, "state", "--digset", "a.md");
  assert.equal(one.status, 1, "state 带了不认的开关却说没事：" + one.stdout);
  assert.match(one.stderr, /不认 --digset/);
  assert.match(one.stderr, /不收开关/, "state 一个开关都不收，别去猜最接近的名字");
  const lost = deed(cwd, "check", "--digset", "a.md");
  assert.equal(lost.status, 1);
  assert.match(lost.stderr, /它认的是 --ledger、--gates/, "check 有开关，拒绝要把它认的列出来");
});


test("a red run cannot be handed in, and the refusal says what failed", () => {
  const cwd = workspace("run-red");
  deed(cwd, "init", "--said", "开始");
  fs.writeFileSync(
    path.join(cwd, "x.test.mjs"),
    'import test from "node:test";\ntest("one", () => { throw new Error("boom"); });\n',
  );
  addTask(cwd, "写一条测试", "跑得绿");
  deed(cwd, "plan");
  const file = path.join(cwd, ".deed", "plan.md");
  fs.writeFileSync(
    file,
    fs.readFileSync(file, "utf8").replace(/- \[ \] T1 (.*)\n/, "- [x] T1 $1\n  交付：写了一条同名测试\n"),
    "utf8",
  );
  const bad = deed(cwd, "submit", "--run", "node --test x.test.mjs");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--run 的命令没有跑通（退出 1）/);
});

// 体检层是只读的：它回答"这个工作区还是不是一个项目、差哪几条"，不产生行动。
// 声明进账本，状态是算出来的，所以它可以退回去。
test("a workspace is not a project until it says so, and the standing is computed", () => {
  const cwd = workspace("standing");
  deed(cwd, "init", "--said", "开始");
  const plain = deed(cwd, "check");
  assert.equal(plain.status, 0, "体检不因为没有项目而失败");
  assert.match(plain.stdout, /没有声明（工作区模式/u);
  assert.match(plain.stdout, /— 项目背景已写 · 没有声明成项目/u, "不适用要写成不适用，不能算通过");
  assert.match(deed(cwd, "state").stdout, /项目 · 没有声明/u, "state 顶上那行说清现在是哪种模式");

  fs.mkdirSync(path.join(cwd, "core"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "app"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "core", "a.mjs"), "export const a = 1;\n");
  fs.writeFileSync(path.join(cwd, "app", "x.mjs"), "export const x = 1;\n");
  fs.mkdirSync(path.join(cwd, "tests"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "tests", "t.test.mjs"), "export const t = 1;\n");
  deed(cwd, "plan");
  const said = deed(cwd, "project", "--shape", "software", "--layers", "core=core:,app=app:core,tests=tests:core+app", "--extras", "scripts", "--background", "一个本地工具；不碰网络。");
  assert.equal(said.status, 0, said.stdout + said.stderr);
  assert.equal(kinds(cwd).filter((one) => one === "project.declare").length, 1, "声明是账本上的一行");

  const declared = deed(cwd, "check");
  assert.match(declared.stdout, /项目 · software · 3\/3 条通过/u);
  assert.match(deed(cwd, "state").stdout, /项目 · software · 3\/3/u);

  // 树一走样，状态自己掉回去：它是当前值，不是一次性的徽章。
  fs.writeFileSync(path.join(cwd, "core", "a.mjs"), 'import "../app/x.mjs";\nexport const a = 1;\n');
  const fell = deed(cwd, "check");
  assert.equal(fell.status, 0, "未通过也不是命令失败：它不挡三种状态");
  assert.match(fell.stdout, /2\/3 条通过/u);
  assert.match(fell.stdout, /✗ 文件树符合范式/u);
  assert.match(fell.stdout, /未通过 1 条；它们不挡三种状态/u);
});

// 旧名字不静默消失：敲 tick 要当场被拒，并且指到新名字。
test("the old round verb points at the new one instead of doing nothing", () => {
  const cwd = workspace("moved");
  deed(cwd, "init", "--said", "开始");
  const old = deed(cwd, "tick", "--said", "一句话");
  assert.equal(old.status, 1);
  assert.match(old.stderr, /tick 已经改成/, "被拒时要说清新名字是什么");
  assert.match(old.stderr, /deed say/u);
  assert.equal(deed(cwd, "say", "一句话").status, 0);
});

// 旧名字不静默消失：封免审段、归档、写目的这三条都被并进已有动词了。
test("the merged verbs point at their new home instead of doing nothing", () => {
  const cwd = workspace("moved-again");
  deed(cwd, "init", "--said", "开始");
  const seal = deed(cwd, "seal", "--why", "不用审");
  assert.equal(seal.status, 1);
  assert.match(seal.stderr, /deed review --segment S\d+\.\d+ --skip/u);
  const shelve = deed(cwd, "shelve", "--why", "换方向");
  assert.equal(shelve.status, 1);
  assert.match(shelve.stderr, /deed sign --shelve/u);
  const goal = deed(cwd, "goal", "把文档写完");
  assert.equal(goal.status, 1);
  assert.match(goal.stderr, /清单第一行/u);
  // 条目也不再是动词：一条命令记账的做法没了，只剩"写清单 + submit"这条。
  const task = deed(cwd, "task", "add", "改重放", "--criteria", "同账本同文档");
  assert.equal(task.status, 1, "deed task 已经下线");
  assert.match(task.stderr, /deed plan/u);
  assert.match(task.stderr, /deed submit/u);
  assert.doesNotMatch(deed(cwd, "help").stdout, /deed task/u, "帮助里也不该再有这个动作");
  assert.equal(deed(cwd, "plan").status, 0, "写清单这条路照常");
});

// 账本坏一行时，体检的第一条先红：别的检查都没有输入，也不该报一个通过率。
test("a broken ledger turns the first check red and says where to look", () => {
  const cwd = workspace("broken-ledger");
  deed(cwd, "init", "--said", "开始");
  writeLines(cwd, [{ k: "no-such-kind", at: "2026-11-01T00:00:00.000Z", v: EVENT_VERSION }]);
  const run = deed(cwd, "check");
  assert.equal(run.status, 1, "账本读不动时退出码是 1，不是 0");
  assert.match(run.stdout, /✗ 账本可读、审查设置已声明 · 账本读不动/u);
  assert.match(run.stdout, /deed check --ledger/u);
  assert.match(run.stdout, /先处理那一行/u);
});

// 不合格点名的条目全被放弃之后：没有活可重交，但也没有清单可以判——
// 下一步是先出一份新清单（由人在面板上按），不是直接落 pass。
test("a fail whose named work was given up asks for a new brief, not a verdict", () => {
  const cwd = workspace("fail-all-dropped");
  deed(cwd, "init", "--said", "开始", "--review", "core/**");
  addTask(cwd, "一", "跑得通");
  addTask(cwd, "二", "跑得通");
  assert.equal(deliverTask(cwd, "T1", "跑：跑得通").status, 0);
  assert.equal(deliverTask(cwd, "T2", "跑：跑得通").status, 0);
  assert.equal(startReview(cwd, "S01.1").status, 0);
  assert.equal(
    deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=unmet", "--result", "T2=unmet", "--rework", "T1,T2", "--why", "没做到").status,
    0,
  );
  dropTask(cwd, "T1", "改主意了");
  dropTask(cwd, "T2", "改主意了");
  const out = deed(cwd, "state").stdout;
  assert.match(out, /下一步 · user · 开始审查/u, "先出一份新清单（面板上按）：" + out.split("下一步")[1]?.slice(0, 120));
  assert.match(out, /deed panel/u);
});
