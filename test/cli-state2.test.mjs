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


test("two ids cannot collide, by hand or by two agents at once", async () => {
  const cwd = workspace("ids");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "一", "--criteria", "c", "--files", "docs/a.md");
  assert.equal(deed(cwd, "task", "add", "二", "--criteria", "c", "--files", "docs/a.md", "--id", "T1").status, 1, "手写的 id 撞车要被拒");
  const results = await Promise.all(
    ["一", "二", "三", "四", "五"].map((title) => later(cwd, "task", "add", title, "--criteria", "c", "--files", "docs/a.md")),
  );
  for (const one of results) assert.equal(one.status, 0, one.stderr);
  const ids = readEvents(cwd).filter((one) => one.k === "task.add").map((one) => one.id);
  assert.equal(new Set(ids).size, ids.length, "并发写入拿到的是不同的任务号：" + ids.join(","));
});


test("naming a segment the ledger does not have lists the ones it does", () => {
  const cwd = workspace("segment-typo");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "甲", "--criteria", "c");
  const run = deed(cwd, "review", "--segment", "S01.7", "--by", "qa");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /里没有段 S01\.7/);
  assert.match(run.stderr, /S01\.1/);
});


test("a lock that names no usable holder still gets its grace, not an instant steal", () => {
  for (const body of [{ start: Date.now() }, { pid: 0, start: Date.now() }]) {
    const cwd = workspace("lock-blank-" + (body.pid ?? "none"));
    deed(cwd, "init", "--said", "开始");
    const lockPath = path.join(cwd, ".deed", "log", "lock");
    fs.writeFileSync(lockPath, JSON.stringify(body));
    const born = fs.statSync(lockPath).mtimeMs;
    const added = deed(cwd, "task", "add", "写服务", "--criteria", "能推事件", "--files", "core/serve.mjs");
    assert.equal(added.status, 0, "锁里没有可用的持有者，宽限期过后就该接手");
    // 宽限期从锁落地那刻算，所以能算数的只有"写入发生在 250ms 之后"：
    // 进程耗时不能拿来相减——启动本身就要一百多毫秒，会被算进宽限期里。
    const at = Date.parse(readEvents(cwd).at(-1).at);
    assert.ok(at - born >= 200, "刚写下的锁要先等宽限期，不能一进来就夺：" + Math.round(at - born) + "ms");
  }
});


test("evidence that starts with -- is a missing quote, not a word", () => {
  const cwd = workspace("dash-value");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  const bare = deed(cwd, "task", "done", "T1", "--evidence", "--dry-run 跑了 3 条");
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /--evidence/);
  assert.equal(kinds(cwd).filter((one) => one === "task.done").length, 0, "被拒的交付一个字节也没写进去");
  assert.equal(
    deed(cwd, "task", "done", "T1", "--evidence=--dry-run 跑了 3 条").status,
    0,
    "写成 --k=v 就说得清",
  );
});


test("--session that names no period is refused by every verb that takes one", () => {
  const cwd = workspace("session-matrix");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  for (const args of [
    ["task", "done", "T1", "--evidence", "写完了", "--session", "S99"],
    ["review", "--segment", "S01.1", "--session", "S99"],
    ["review", "--skip", "--why", "免审", "--by", "user", "--session", "S99"],
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
  const doctor = deed(cwd, "doctor");
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /账本坏了/);
  assert.match(doctor.stdout, /没有写者版本/);
  assert.match(doctor.stdout, /rejected/);
});


test("every line records the deed that wrote it", () => {
  const cwd = workspace("writer-version");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "改重放", "--criteria", "总账能重放");
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
  for (const verb of ["state", "doctor"]) {
    const run = deed(cwd, verb, "--help");
    assert.equal(run.status, 0);
    assert.equal(run.stdout.trim(), "deed " + verb, verb + " --help 只该打这一行");
  }
  const task = deed(cwd, "task", "--help");
  assert.match(task.stdout, /deed task undo/);
  assert.doesNotMatch(task.stdout, /deed judge --pass/, "问 task 的用法不该回 judge 的行");
});


test("asking what a verb takes does not run it", () => {
  const cwd = workspace("verb-help");
  deed(cwd, "init", "--said", "开始");
  const before = briefs(cwd).length;
  const asked = deed(cwd, "review", "--help");
  assert.equal(asked.status, 0);
  assert.match(asked.stdout, /deed review --segment S01\.1 --by/);
  assert.equal(briefs(cwd).length, before, "问一句用法不该发一份清单");
  assert.equal(kinds(cwd).includes("review.brief"), false);

  const task = deed(cwd, "task", "--help");
  assert.equal(task.status, 0);
  assert.match(task.stdout, /deed task undo/);
});


test("the word --help inside evidence is evidence", () => {
  const cwd = workspace("help-in-words");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  const done = deed(cwd, "task", "done", "T1", "--evidence", "跑过 review --help 与 task --help，都只打用法");
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
  assert.equal(deed(cwd, "task", "undo", "T2", "--why", "这条说错了").status, 0);
  assert.equal(deed(cwd, "task", "done", "T2", "--evidence", "重交 docs/b.md").status, 0);
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa").status, 0);
  const sheet = fs
    .readdirSync(path.join(cwd, ".deed", "review"))
    .filter((one) => one.endsWith(".md") && !one.endsWith("-reviewer.md"))
    .at(-1);
  const text = fs.readFileSync(path.join(cwd, ".deed", "review", sheet), "utf8");
  assert.match(text, /同批交付：这一批共 2 条（其中 1 条已撤回）/, "撤回不改变这一批原本几条");
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
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa").status, 0);
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass", "--result-all", "met").status, 0);
  const draft = deed(cwd, "plan", "--force");
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
  deed(cwd, "task", "add", "写一份一万五的文档", "--criteria", "它在", "--files", "docs/big.md");
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "写了 docs/big.md").status, 0);
  assert.match(deed(cwd, "state").stdout, /免审（全部落在 exempt）/u, "一万五千字节落在免审路径上，本来不用审");

  deed(cwd, "task", "add", "再把它删掉", "--criteria", "它不在了", "--files", "docs/big.md");
  fs.rmSync(path.join(cwd, "docs", "big.md"));
  const run = deed(cwd, "task", "done", "T2", "--evidence", "docs/big.md 已删");
  assert.equal(run.status, 0, run.stderr);
  // 删掉的路径没有重量：按 0 字节算就等于说"删掉一万五不算大"，那是放行一条隧道。
  const events = readEvents(cwd).filter((one) => one.k === "task.done" && one.id === "T2");
  assert.deepEqual(events.at(-1).bytes, {}, "删掉的路径不记 0，记空");
  const state = deed(cwd, "state").stdout;
  assert.doesNotMatch(state, /免审（全部落在 exempt）/u, "删掉一万五千字节，不再算小改动");
  assert.match(state, /deed review --segment S01\.1/u, "下一步是发清单，不是封存");
});


test("a verb that takes no flags still says so instead of ignoring them", () => {
  // 只读动词以前不过开关表：拼错的开关被当成没写，命令照常 exit 0。
  const cwd = workspace("readonly-flags");
  deed(cwd, "init", "--said", "起点");
  for (const verb of ["state", "doctor"]) {
    const one = deed(cwd, verb, "--digset", "a.md");
    assert.equal(one.status, 1, verb + " 带了不认的开关却说没事：" + one.stdout);
    assert.match(one.stderr, /不认 --digset/);
    assert.match(one.stderr, /不收开关/, verb + " 一个开关都不收，别去猜最接近的名字");
  }
});


test("a red run cannot be handed in, and the refusal says what failed", () => {
  const cwd = workspace("run-red");
  deed(cwd, "init", "--said", "开始");
  fs.writeFileSync(
    path.join(cwd, "x.test.mjs"),
    'import test from "node:test";\ntest("one", () => { throw new Error("boom"); });\n',
  );
  deed(cwd, "task", "add", "写一条测试", "--criteria", "跑得绿");
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
  const said = deed(cwd, "project", "--shape", "software", "--layers", "core=core:,app=app:core,tests=tests:core+app", "--extras", "scripts", "--background", "一个本地工具；不碰网络。", "--by", "user");
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
});
