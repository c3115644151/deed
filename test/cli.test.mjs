import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import net from "node:net";
import { workspace } from "../support/lib.mjs";
import { readEvents } from "../lib/store.mjs";
import { fold } from "../core/fold.mjs";
import { EVENT_VERSION, validateEvent } from "../core/events.mjs";
import { panelRecord, buildNow, watchedFiles } from "../lib/panel.mjs";
import { auditDelivered, movedSince, requireUnchanged } from "../cli/pins.mjs";

const CLI = path.join(import.meta.dirname, "..", "cli", "deed.mjs");
// 面板默认关掉：每条命令都去拉一个后台服务，测试就成了端口和进程的集合。
const OFF = { ...process.env, DEED_NO_PANEL: "1" };
const deed = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: OFF });
const later = (cwd, ...args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: OFF });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });
const kinds = (cwd) => readEvents(cwd).map((one) => one.k);
const briefs = (cwd) => fs.readdirSync(path.join(cwd, ".deed", "review"));
// A delivery that pins nothing cannot be checked afterwards, so the tests pin a
// file the way a real run does before a reviewed segment can be judged.
const proof = (cwd, name = "proof.txt") => {
  fs.writeFileSync(path.join(cwd, name), name);
  return name;
};

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

test("init refuses to overwrite a workspace that is already bound", () => {
  const cwd = workspace("rebind");
  deed(cwd, "init", "--said", "开始");
  const again = deed(cwd, "init", "--said", "又一次");
  assert.equal(again.status, 0);
  assert.match(again.stdout, /已经接过钩子/);
  assert.match(again.stdout, /deed serve/, "已经接过的也要说一次剩下的可选项");
  assert.equal(kinds(cwd).length, 4);
});

test("init says what else can be done, so one round can finish it", () => {
  const cwd = workspace("init-optional");
  const out = deed(cwd, "init", "--said", "开始", "--port", "7420");
  assert.equal(out.status, 0);
  for (const one of ["deed init --print-agents", "deed serve", "deed doctor", "deed gate", "deed init --force"])
    assert.ok(out.stdout.includes(one), one + " 应该出现在 init 的反馈里");
  assert.match(out.stdout, /127\.0\.0\.1:7420/, "面板地址用这个工作区的端口");
  assert.match(out.stdout, /都可选/, "说清楚不做也不会坏");
});

test("init --print-agents hands over the rules without writing into the workspace", () => {
  const cwd = workspace("print-agents");
  const said = deed(cwd, "init", "--print-agents");
  assert.equal(said.status, 0);
  assert.match(said.stdout, /deed state/, "那段里得点名查下一步的命令");
  assert.match(said.stdout, /deed tick/);
  assert.equal(fs.existsSync(path.join(cwd, ".deed")), false, "只打印，不建账本");
  assert.equal(fs.existsSync(path.join(cwd, "AGENTS.md")), false, "规则归属人，deed 不替它写文件");
});

test("doctor keeps saying it until the workspace tells its agents where to ask", () => {
  const cwd = workspace("doctor-words");
  deed(cwd, "init", "--said", "开始");
  assert.match(deed(cwd, "doctor").stdout, /接入 · 这个工作区没有 AGENTS\.md/);
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# 管理\n\n下一步看 `deed state`。\n");
  const told = deed(cwd, "doctor");
  assert.equal(told.status, 0);
  assert.match(told.stdout, /账本干净/);
  assert.doesNotMatch(told.stdout, /接入 · /, "已经写清楚了就别再念，否则这句提示会变成噪音");
});

test("a turn must say what was said", () => {
  const cwd = workspace("tick");
  deed(cwd, "init", "--said", "开始");
  assert.equal(deed(cwd, "tick").status, 1);
});

test("a task needs a promise and a standard of done", () => {
  const cwd = workspace("task");
  deed(cwd, "init", "--said", "开始");
  assert.equal(deed(cwd, "task", "add", "只有标题").status, 1);
});

test("delivery needs evidence, and the reviewer decides what counts", () => {
  const cwd = workspace("gate");
  deed(cwd, "init", "--said", "改重放函数");
  assert.equal(deed(cwd, "task", "add", "改重放函数", "--criteria", "同样的账本折出同样的文档", "--files", "core/fold.mjs").status, 0);
  assert.equal(deed(cwd, "task", "done", "T1").status, 1, "没有交付记录不算交付");
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "node --test 25/25", "--digest", proof(cwd)).status, 0);
  const blocked = deed(cwd, "sign", "--words", "可以", "--by", "user");
  assert.equal(blocked.status, 1, "碰了要审的路径就要审查");
  assert.match(blocked.stderr, /审查/);
  assert.equal(deed(cwd, "review").status, 0, "先发清单");
  const passed = deed(cwd, "review", "--by", "reviewer", "--verdict", "pass");
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /段已封存/, "审查者放行就是这一段的结局");
  assert.equal(deed(cwd, "sign", "--words", "可以", "--by", "user").status, 0);
});

// 一期要做成什么：一句话，可改，账本留每一次；签收核对与签收都拿它当尺子。
test("a period says what it is for, and the sentence can change", () => {
  const cwd = workspace("goal-set");
  deed(cwd, "init", "--said", "开始");
  const first = deed(cwd, "goal", "把面板做到一眼看懂", "--by", "user");
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /目的 · S01 · 把面板做到一眼看懂/);
  const changed = deed(cwd, "goal", "这一期只把面板做完", "--why", "范围收窄", "--by", "user");
  assert.equal(changed.status, 0, changed.stderr);
  assert.equal(kinds(cwd).filter((one) => one === "goal.set").length, 2, "改一次也是账本上的一次");
  assert.equal(fold(readEvents(cwd)).sessions[0].goal.text, "这一期只把面板做完");
  assert.equal(fold(readEvents(cwd)).sessions[0].goals.length, 1, "旧的那句留在历史里");
  assert.match(deed(cwd, "state").stdout, /目的 · 这一期只把面板做完/);
  assert.equal(deed(cwd, "goal", "--by", "user").status, 1, "目的要写成一句话");
});

// 签收只看各段的结论与条件：最后一段放行之后，下一步就是签收，整期上不再另审一遍。
// `deed review --all` 已经不是命令：那件事不存在了，开关也被拒。
test("the last segment's verdict is the whole story, and --all is not a command any more", () => {
  const cwd = workspace("two-segments-sign");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "甲", "--criteria", "能跑", "--files", "core/a.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass").status, 0);
  deed(cwd, "task", "add", "乙", "--criteria", "能跑", "--files", "core/b.mjs");
  deed(cwd, "task", "done", "T2", "--evidence", "node --test", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.2");
  const state1 = deed(cwd, "state");
  assert.match(state1.stdout, /S01.2/, "第二段还开着，下一步在那一段上");
  assert.equal(deed(cwd, "review", "--segment", "S01.2", "--by", "qa", "--verdict", "pass").status, 0);
  const state2 = deed(cwd, "state");
  assert.match(state2.stdout, /下一步 · user · 签收/, "段都放行了，就轮到你一句话");
  const gone = deed(cwd, "review", "--all");
  assert.equal(gone.status, 1, "--all 不再是命令");
  assert.match(gone.stderr, /--all/);
  assert.equal(kinds(cwd).filter((one) => one === "review.brief").length, 2, "只有两段的清单，没有整期的那一份");
  assert.equal(deed(cwd, "sign", "--words", "可以", "--by", "user").status, 0, "不用目的，也不用第二道结论");
});

// 一段的一期不审两遍：段放行就是这一期的结局，下一步直接是签收。
test("a period with one segment has one verdict, and nothing else is asked for", () => {
  const cwd = workspace("single-whole");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "甲", "--criteria", "能跑", "--files", "core/a.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test", "--digest", proof(cwd));
  const alone = deed(cwd, "review", "--all");
  assert.equal(alone.status, 1, "整期上没有审查这件事");
  assert.match(alone.stderr, /--all/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "review.brief").length, 0, "被拒的一个字都不写");
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass").status, 0);
  const state = deed(cwd, "state");
  assert.equal(state.status, 0);
  assert.match(state.stdout, /下一步 · user · 签收/, "段放行之后只剩一句话");
  assert.doesNotMatch(state.stdout, /deed review --all/, "不能又叫一份整期清单");
  assert.doesNotMatch(state.stdout, /deed goal/, "一段的一期不要额外的目的");
  assert.equal(deed(cwd, "sign", "--words", "可以", "--by", "user").status, 0);
});

test("handing the brief out is a fact, and a verdict answers that document", () => {
  const cwd = workspace("brief");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写服务", "--criteria", "能推事件", "--files", "core/serve.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "curl 200", "--digest", proof(cwd));
  const handed = deed(cwd, "review");
  assert.equal(handed.status, 0, "只出清单不需要结论");
  const out = readEvents(cwd).filter((one) => one.k === "review.brief");
  assert.equal(out.length, 1, "交出去这件事本身记一条事件");
  const first = briefs(cwd).sort();
  assert.equal(first.length, 2, "两份一起交出去：清单与角色包");
  const sheet = first.find((name) => !name.endsWith("-reviewer.md"));
  const pack = first.find((name) => name.endsWith("-reviewer.md"));
  assert.match(sheet, /^S01\.1-.*\.md$/);
  assert.equal(out[0].brief, ".deed/review/" + sheet, "账本记的是审查者拿到的那一份");
  assert.equal(out[0].guide.endsWith(pack), true, "角色包记在同一个目录下");
  assert.equal(
    out[0].guideDigest,
    createHash("sha256").update(fs.readFileSync(path.join(cwd, ".deed", "review", pack))).digest("hex"),
    "角色包的指纹也是交出去那一刻的",
  );
  assert.match(fs.readFileSync(path.join(cwd, ".deed", "review", pack), "utf8"), /不信交付记录，逐条复跑/);
  assert.equal(
    out[0].briefDigest,
    createHash("sha256").update(fs.readFileSync(path.join(cwd, ".deed", "review", sheet))).digest("hex"),
    "指纹记在交出去的那一刻，不是结论落盘时现算",
  );
  const text = fs.readFileSync(path.join(cwd, ".deed", "review", sheet), "utf8");
  assert.match(text, /做完的标准：能推事件/);
  assert.match(text, /交付记录：curl 200/);
  assert.match(text, /deed review --segment S01\.1 --by/, "清单自己说清怎么把结论写回来");
  // 没人回答的那份还在手上：再要一次只是把路径再报一遍，不是再写一份。
  const twice = deed(cwd, "review");
  assert.equal(twice.status, 0);
  assert.match(twice.stdout, /已经出过/);
  assert.equal(briefs(cwd).length, 2, "没答的那两份还在手上，不再写一份");
  assert.equal(readEvents(cwd).filter((one) => one.k === "review.brief").length, 1);
  assert.match(deed(cwd, "state").stdout, /落结论/, "下一步是结论，不是又一份清单");
  // 结论回答的是交出去的那份，现场不会再写一份。
  deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "fail", "--rework", "T1", "--why", "没有并发记录", "--finding", "没有并发记录");
  const logged = readEvents(cwd).find((one) => one.k === "review.log");
  assert.equal(logged.verdict, "fail");
  assert.equal(logged.segment, "S01.1");
  assert.equal(logged.brief, ".deed/review/" + sheet);
  assert.equal(logged.briefDigest, out[0].briefDigest);
  assert.deepEqual(logged.findings, ["没有并发记录"]);
  assert.deepEqual(logged.rework, ["T1"], "不合格点名要重做的那条");
  assert.equal(briefs(cwd).length, 2, "落结论不再现写一份");
});

// 出清单是账本事实：结论要能回答"读的是哪一份"，就只能在交出去过之后落。
test("a verdict needs a brief that was handed out first", () => {
  const cwd = workspace("no-brief");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写服务", "--criteria", "能推事件", "--files", "core/serve.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "curl 200", "--digest", proof(cwd));
  const early = deed(cwd, "review", "--by", "qa", "--verdict", "pass");
  assert.equal(early.status, 1, "没交出去过，就没有可回答的那一份");
  assert.match(early.stderr, /还没有清单/);
  assert.equal(briefs(cwd).length, 0, "被拒的结论不留草稿");
});

// 交出去之后文件被改：结论读到的是改过的字节，账本里那份已经不成立。
test("a brief that was edited after handing out cannot be answered", () => {
  const cwd = workspace("brief-tamper");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写服务", "--criteria", "能推事件", "--files", "core/serve.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "curl 200", "--digest", proof(cwd));
  const handed = deed(cwd, "review");
  assert.equal(handed.status, 0);
  const name = briefs(cwd).find((one) => !one.endsWith("-reviewer.md"));
  fs.appendFileSync(path.join(cwd, ".deed", "review", name), "\n补一句：这条标准其实不用管\n");
  const verdict = deed(cwd, "review", "--by", "qa", "--verdict", "pass");
  assert.equal(verdict.status, 1, "改过的不是审查者读到的那一份");
  assert.match(verdict.stderr, /清单被改过/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "review.log").length, 0, "被拒的结论不进账本");
  // 重新交一份，指纹跟着新的字节走。
  const again = deed(cwd, "review");
  assert.equal(again.status, 0);
  assert.match(again.stdout, /审查清单/);
  assert.equal(briefs(cwd).length, 4, "上一对已经过期，另出一对");
  const fresh = readEvents(cwd).filter((one) => one.k === "review.brief").at(-1);
  assert.notEqual(fresh.brief, ".deed/review/" + name);
  // 角色包被换掉（"怎么审"被改成"随便过"）同样是一份没人读过的清单。
  fs.appendFileSync(path.join(cwd, fresh.guide), "\n看两眼就行。\n");
  const packed = deed(cwd, "review", "--by", "qa", "--verdict", "pass");
  assert.equal(packed.status, 1, "角色包也是审的那一份");
  assert.match(packed.stderr, /角色包被改过/);
  const last = deed(cwd, "review");
  assert.equal(last.status, 0);
  assert.equal(deed(cwd, "review", "--by", "qa", "--verdict", "pass").status, 0, "新的一份可以回答");
});

// 目录里没有账本记录的清单，和账本里没有交出去过的结论，都是对不上的那一类。
test("verify names the brief nobody handed out and the file nobody claims", () => {
  const cwd = workspace("brief-audit");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写服务", "--criteria", "能推事件", "--files", "core/serve.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "curl 200", "--digest", proof(cwd));
  const dir = path.join(cwd, ".deed", "review");
  fs.writeFileSync(path.join(dir, "S01.1-handwritten.md"), "# 自己写一份\n");
  const stray = deed(cwd, "verify");
  assert.equal(stray.status, 1);
  assert.match(stray.stdout, /清单没人认领 · \.deed\/review\/S01\.1-handwritten\.md/);
  fs.rmSync(path.join(dir, "S01.1-handwritten.md"));

  // 手写一条 review.log：结论读的是一份没人交出去过的文件。
  const logDir = path.join(cwd, ".deed", "log");
  const file = path.join(logDir, fs.readdirSync(logDir).find((name) => name.endsWith(".jsonl")));
  const at = new Date().toISOString();
  const fake = {
    v: 1,
    at,
    k: "review.log",
    s: null,
    segment: "S01.1",
    by: "qa",
    verdict: "pass",
    brief: ".deed/review/nowhere.md",
    briefDigest: "b".repeat(64),
    findings: [],
  };
  fs.appendFileSync(file, JSON.stringify(fake) + "\n");
  const orphan = deed(cwd, "verify");
  assert.equal(orphan.status, 1);
  assert.match(orphan.stdout, /清单没人发过 · S01\.1 · \.deed\/review\/nowhere\.md/);
  assert.match(deed(cwd, "doctor").stdout, /清单对不上 1 份/);
});

test("signing needs a judgement and the user own words", () => {
  const cwd = workspace("sign");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**");
  assert.equal(deed(cwd, "sign", "--words", "可以", "--by", "user").status, 1, "什么都没交付不能签收");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  deed(cwd, "task", "done", "T1", "--evidence", "写完了");
  assert.equal(deed(cwd, "sign", "--words", "可以", "--by", "user").status, 1, "段还没封");
  deed(cwd, "seal", "--why", "只改了文档，审查设置说不用审", "--by", "agent");
  assert.equal(deed(cwd, "sign", "--by", "user").status, 1, "签收要留原话");
  assert.equal(deed(cwd, "sign", "--words", "可以，就这样", "--title", "上手", "--by", "user").status, 0);
  const signed = readEvents(cwd).find((one) => one.k === "sign");
  assert.equal(signed.words, "可以，就这样");
  assert.equal(signed.title, "上手");
});

// 账本替人签过名：judge --pass 与 sign 以前默认写 by: "user"，于是 agent 交付、
// 判决、签收一条龙之后，记录上写着是用户按的。名字现在必须由写者给。
test("a piped seal or signing names the hand that typed it", () => {
  const cwd = workspace("name-it");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  deed(cwd, "task", "done", "T1", "--evidence", "写完了");
  const unnamed = deed(cwd, "seal", "--why", "只改了文档");
  assert.equal(unnamed.status, 1, "管道里跑的封存不能自动记成用户按的");
  assert.match(unnamed.stderr, /--by/);
  assert.equal(deed(cwd, "seal", "--why", "只改了文档", "--by", "agent:claude").status, 0);
  const typed = deed(cwd, "sign", "--words", "可以");
  assert.equal(typed.status, 1, "签收同理");
  assert.match(typed.stderr, /--by/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "sign").length, 0, "被拒的签收一行都不落");
});

// 4 MB 以上没称重的文件以前直接跳过：只声明文档的交付能把它盖过去，段还判"免审"。
test("a file too large to weigh still counts as a change", () => {
  const cwd = workspace("unweighed");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "# a\n");
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "fixture.bin"), Buffer.alloc(4_000_001));
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "文档写完了").status, 0, "交付本身不被挡");
  const delivery = readEvents(cwd).find((one) => one.k === "task.done");
  assert.ok(delivery.changed.includes("src/fixture.bin"), "没称重的文件也是改动：" + delivery.changed);
  assert.match(deed(cwd, "state").stdout, /要审/, "碰撞了要审的路径，段不能再叫免审");
});

// PowerShell 5.1 会把 --did "" 变成裸开关，账本落 did: true，读起来像"这轮做过事"。
test("a turn cannot record a did it never wrote", () => {
  assert.throws(() => validateEvent({ k: "turn", who: "user", said: "开始", did: 5 }), /did/);
  assert.ok(validateEvent({ k: "turn", who: "user", said: "开始", did: true }));
  assert.ok(validateEvent({ k: "turn", who: "user", said: "开始", did: "跑了一遍测试" }));
});


// The slip the review found: an action that fold refuses must leave nothing behind.
test("a refused action never reaches the ledger, and the workspace keeps working", () => {
  const cwd = workspace("refused");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  deed(cwd, "task", "done", "T1", "--evidence", "一次");
  const before = readEvents(cwd).length;
  const unknown = deed(cwd, "task", "drop", "T9", "--why", "不存在");
  assert.equal(unknown.status, 1, "点名不存在的任务要被拒");
  assert.match(unknown.stderr, /没有任务|不在/);
  assert.equal(readEvents(cwd).length, before, "被拒的动作一个字节也没写进去");
  deed(cwd, "seal", "--why", "只改了文档", "--by", "agent");
  const sealed = deed(cwd, "task", "done", "T1", "--evidence", "封过之后又改");
  assert.equal(sealed.status, 1, "判过的段不能再往任务上写");
  assert.match(sealed.stderr, /已封存/);
  assert.equal(readEvents(cwd).length, before + 1, "只多了那一条封存");
  assert.equal(deed(cwd, "state").status, 0, "工作区没被写坏");
  assert.equal(deed(cwd, "verify").status, 0);
  assert.equal(deed(cwd, "doctor").status, 0);
});

test("a closed period cannot be written into, and no verb invents a new one", () => {
  const cwd = workspace("closed");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  deed(cwd, "task", "done", "T1", "--evidence", "写完了");
  deed(cwd, "seal", "--why", "只改了文档", "--by", "agent");
  deed(cwd, "sign", "--words", "可以", "--by", "user");
  const after = readEvents(cwd).length;
  const stray = deed(cwd, "task", "add", "又一件", "--criteria", "x");
  assert.equal(stray.status, 1, "签收之后不能靠 task add 开新期");
  assert.match(stray.stderr, /还没有会话|已经结束/);
  assert.equal(readEvents(cwd).length, after);
  assert.equal(deed(cwd, "tick", "--who", "user", "--said", "新的一轮").status, 0, "只有一轮对话能开新期");
  assert.equal(deed(cwd, "task", "add", "又一件", "--criteria", "x").status, 0);
  // The turn that opens a period carries no pointer: it is the birth itself.
  assert.deepEqual(readEvents(cwd).map((one) => one.s ?? "-"), ["-", "-", "-", "-", "S01", "S01", "S01", "S01", "-", "S02"]);
});

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

test("verify reports evidence pinned to content that has since changed, and holds the judgement", () => {
  const cwd = workspace("digest");
  fs.writeFileSync(path.join(cwd, "thing.txt"), "v1");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "记下内容", "--criteria", "文件不变", "--files", "docs/a.md");
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "内容如下", "--digest", "missing.txt").status, 1, "记下的文件要真的在");
  deed(cwd, "task", "done", "T1", "--evidence", "内容如下", "--digest", "thing.txt");
  assert.equal(deed(cwd, "verify").status, 0);
  fs.writeFileSync(path.join(cwd, "thing.txt"), "v2");
  const stale = deed(cwd, "verify");
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /交付记录过期/);
  const judge = deed(cwd, "seal", "--why", "只改了文档", "--by", "agent");
  assert.equal(judge.status, 1, "记下的内容变了,这一条不能再算数");
  assert.match(judge.stderr, /过期/);
});

test("a pass seals the segment, and a fail after overturning it reopens that same one", () => {
  const cwd = workspace("rework");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "改重放", "--criteria", "同账本同文档", "--files", "core/fold.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass").status, 0);
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "封过之后又改").status, 1, "封过的段不能再往任务上写");
  assert.equal(deed(cwd, "judge", "--overturn", "R1", "--why", "这份结论看错了一处", "--by", "user").status, 0);
  const back = deed(cwd, "review", "--segment", "S01.1", "--by", "qa2", "--verdict", "fail", "--rework", "T1", "--why", "少了一节");
  assert.equal(back.status, 0, back.stdout + back.stderr);
  const doc = readEvents(cwd);
  assert.equal(doc.filter((one) => one.k === "review.overturn").length, 1);
  assert.equal(doc.filter((one) => one.s === "S01" && one.k === "task.add").length, 1, "退回不开新段");
  assert.match(deed(cwd, "state").stdout, /● T1|○ T1/);
  assert.match(deed(cwd, "state").stdout, /段 S01\.1/);
});

test("doctor names the line that broke the ledger and the only repair it allows", () => {
  const cwd = workspace("doctor");
  deed(cwd, "init", "--said", "开始");
  assert.match(deed(cwd, "doctor").stdout, /账本干净/);
  const file = fs.readdirSync(path.join(cwd, ".deed", "log")).find((one) => one.endsWith(".jsonl"));
  const written = fs.readFileSync(path.join(cwd, ".deed", "log", file), "utf8").split("\n").filter(Boolean).length;
  fs.appendFileSync(path.join(cwd, ".deed", "log", file), "{ oh no\n");
  const broken = deed(cwd, "doctor");
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, new RegExp("账本坏了 · .* 第 " + (written + 1) + " 行"));
  assert.match(broken.stdout, /移到 .deed\/log\/rejected/);
});

// The gates are the host commands, run in the order the config declares.
test("the declared gates run in order and a failing one stops the run", () => {
  const cwd = workspace("gate-run");
  deed(cwd, "init", "--said", "开始");
  const configFile = path.join(cwd, ".deed", "config.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  config.gates = {
    commit: [process.execPath + " -e \"require('fs').writeFileSync('mark.txt','ran')\""],
    check: [process.execPath + " -e \"process.exit(7)\""],
  };
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  assert.equal(deed(cwd, "init", "--force", "--why", "测试里加两道门").status, 0, "门要记账才生效");
  const passed = deed(cwd, "gate", "commit");
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(fs.readFileSync(path.join(cwd, "mark.txt"), "utf8"), "ran");
  const failed = deed(cwd, "gate");
  assert.equal(failed.status, 1, "第二条命令失败就要停");
  assert.match(failed.stderr, /门 check 没过/);
});

test("a workspace with no declared gates says so, instead of blaming a gate", () => {
  const cwd = workspace("gate-empty");
  deed(cwd, "init", "--said", "开始");
  const run = deed(cwd, "gate");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /这个工作区没有门/);
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
  deed(cwd, "task", "add", "改重放", "--criteria", "同账本同文档", "--files", "core/fold.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test", "--digest", proof(cwd));
  const blocked = deed(cwd, "seal", "--why", "全部免审", "--by", "user");
  assert.equal(blocked.status, 1, "改文件不改变规则");
  assert.match(blocked.stderr, /要审|审查/);
  const drift = deed(cwd, "verify");
  assert.equal(drift.status, 1);
  assert.match(drift.stdout, /审查设置对不上 · review/);
  assert.match(deed(cwd, "state").stdout, /审查设置 文件与账本不一致/);
  assert.equal(deed(cwd, "init", "--force", "--why", "全部免审，只留文档").status, 0);
  assert.equal(deed(cwd, "verify").status, 0, "收进账本之后文件与账本一致");
  const last = readEvents(cwd).filter((one) => one.k === "config.change").at(-1);
  assert.equal(last.key, "review");
  assert.equal(last.why, "全部免审，只留文档");
  assert.deepEqual(last.to.required, [], "账本记的是改成什么样");
  assert.deepEqual(last.to.exempt, ["**"]);
  assert.equal(deed(cwd, "seal", "--why", "全部免审", "--by", "user").status, 0, "账本放开了才算放开");
});

test("a config.json saved with a BOM reads the same as one without", () => {
  // 记事本存 UTF-8 会带 BOM；这个文件本来就是给人改的，编码不该变成"审查设置 JSON 坏了"。
  const cwd = workspace("config-bom");
  assert.equal(deed(cwd, "init", "--said", "开始").status, 0);
  const configFile = path.join(cwd, ".deed", "config.json");
  fs.writeFileSync(configFile, "\uFEFF" + fs.readFileSync(configFile, "utf8"));
  const state = deed(cwd, "state");
  assert.equal(state.status, 0);
  assert.doesNotMatch(state.stdout, /审查设置 文件与账本不一致/);
  assert.equal(deed(cwd, "verify").status, 0);
});

test("a gate is a ledger fact: writing it in the file and not recording it runs nothing", () => {
  const cwd = workspace("config-gate");
  deed(cwd, "init", "--said", "开始");
  const configFile = path.join(cwd, ".deed", "config.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  config.gates = { commit: [process.execPath + ' -e "require(\'fs\').writeFileSync(\'mark.txt\',\'ran\')"'] };
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  const silent = deed(cwd, "gate");
  assert.equal(silent.status, 1, "文件里的门还没记账");
  assert.match(silent.stderr, /没有门/);
  assert.equal(deed(cwd, "init", "--force", "--why", "加一道提交门").status, 0);
  assert.equal(deed(cwd, "gate").status, 0);
  assert.equal(fs.readFileSync(path.join(cwd, "mark.txt"), "utf8"), "ran");
});

test("naming a segment the ledger does not have lists the ones it does", () => {
  const cwd = workspace("segment-typo");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "甲", "--criteria", "c");
  const run = deed(cwd, "review", "--segment", "S01.7");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /里没有段 S01\.7/);
  assert.match(run.stderr, /S01\.1/);
});

test("a workspace that never had a session says that, not that the last one closed", () => {
  const cwd = workspace("virgin");
  assert.equal(deed(cwd, "init").status, 0, "接过 deed、但还一轮都没记");
  const run = deed(cwd, "state");
  assert.equal(run.status, 0);
  assert.match(run.stdout, /还没有会话/);
  assert.doesNotMatch(run.stdout, /上一期已结束/);
});

// --- What the two independent reviews found, one guard per test ---------------

test("a fail sends the named work back, so a pass cannot land until it is delivered again", () => {
  const cwd = workspace("verdict-order");
  deed(cwd, "init", "--said", "改重放函数");
  deed(cwd, "task", "add", "改重放", "--criteria", "同账本同文档", "--files", "core/fold.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1");
  const failed = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "fail", "--rework", "T1", "--why", "没有并发记录");
  assert.equal(failed.status, 0, failed.stderr);
  const back = deed(cwd, "state");
  assert.match(back.stdout, /deed submit/, "点名的那条回到未做，下一步是在清单里再勾一次");
  const early = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass");
  assert.equal(early.status, 1, "在案的不合格不能被一条 pass 顶掉");
  assert.match(early.stderr, /还有没交付的（T1）/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "review.log").length, 1, "被拒的那条不进账本");
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "跑了 8 个并发", "--digest", proof(cwd)).status, 0);
  deed(cwd, "review", "--segment", "S01.1");
  const after = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass");
  assert.equal(after.status, 0, "重新交付、重新审过才放行");
  assert.match(after.stdout, /段已封存/);
});

// 被点名的活改主意不做了，交付就没有可结清的东西：结论落得下来，但它必须说出这件事。
test("a named entry that was given up settles, and the verdict says so", () => {
  const cwd = workspace("verdict-dropped");
  deed(cwd, "init", "--said", "改重放函数");
  deed(cwd, "task", "add", "改重放", "--criteria", "同账本同文档", "--files", "core/fold.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "fail", "--rework", "T1", "--why", "没有并发记录").status, 0);
  assert.equal(deed(cwd, "task", "drop", "T1", "--why", "这一期不做了：重放改到下一期").status, 0);
  const step = deed(cwd, "state");
  assert.match(step.stdout, /它们改主意不做了/, "放弃已结清，下一步该是落结论");
  assert.match(step.stdout, /deed review --segment S01\.1 --by/, "下一步指向审查者的 pass，不是推翻");
  deed(cwd, "review", "--segment", "S01.1");
  const after = deed(cwd, "review", "--segment", "S01.1", "--by", "qa2", "--verdict", "pass");
  assert.equal(after.status, 0, after.stderr);
  assert.match(after.stdout, /被点名但已放弃 · T1 · 这一期不做了/);
  assert.match(after.stdout, /段已封存/);
  const logged = readEvents(cwd).find((one) => one.k === "review.log" && one.verdict === "pass");
  assert.deepEqual(logged.gaveUp, [{ id: "T1", why: "这一期不做了：重放改到下一期" }], "放弃与理由要进账本：只印在终端里，读账本的人看不到");
  const sheet = fs.readFileSync(path.join(cwd, logged.brief), "utf8");
  assert.match(sheet, /状态：dropped · 理由：这一期不做了/, "审查者手上那份要看得出为什么放弃");
});

test("a verdict cannot answer work that has not been delivered yet", () => {
  const cwd = workspace("verdict-early");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写服务", "--criteria", "能推事件", "--files", "core/serve.mjs");
  deed(cwd, "task", "add", "写页面", "--criteria", "看得懂", "--files", "core/render.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "curl 200", "--digest", proof(cwd));
  const before = briefs(cwd).length;
  const early = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass");
  assert.equal(early.status, 1, "还有一条没交付，结论没有对象");
  assert.match(early.stderr, /没交付|交付之后/);
  assert.equal(briefs(cwd).length, before, "被拒的结论不留清单：没人会读的草稿不该躺在磁盘上");
});

test("a verdict is tied to the brief it read, and verify notices when that file drifts", () => {
  const cwd = workspace("brief-pin");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写服务", "--criteria", "能推事件", "--files", "core/serve.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "curl 200", "--digest", proof(cwd));
  assert.equal(deed(cwd, "review").status, 0);
  assert.equal(deed(cwd, "review", "--by", "qa", "--verdict", "pass").status, 0);
  const logged = readEvents(cwd).find((one) => one.k === "review.log");
  assert.match(logged.briefDigest, /^[0-9a-f]{64}$/, "结论要记下它读的那份清单的 sha256");
  assert.equal(deed(cwd, "verify").status, 0);

  const file = path.join(cwd, logged.brief);
  fs.appendFileSync(file, "\n补一句\n");
  const edited = deed(cwd, "verify");
  assert.equal(edited.status, 1, "清单改过，结论就对不上它");
  assert.match(edited.stdout, /清单对不上/);

  fs.rmSync(file);
  const gone = deed(cwd, "verify");
  assert.equal(gone.status, 1);
  assert.match(gone.stdout, /清单不在了/);
});

test("a review without a brief digest is not a verdict the ledger accepts", () => {
  const at = "2026-11-23T00:00:00.000Z";
  const base = { v: 1, at, k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "pass", brief: ".deed/review/x.md" };
  assert.throws(() => validateEvent({ ...base }, at), /briefDigest/);
  assert.throws(() => validateEvent({ ...base, briefDigest: "abc" }, at), /sha256/);
  assert.equal(validateEvent({ ...base, briefDigest: "a".repeat(64) }, at).briefDigest, "a".repeat(64));
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

test("a lock left by a dead process is taken at once, not after ten seconds", () => {
  const cwd = workspace("lock-dead");
  deed(cwd, "init", "--said", "开始");
  fs.writeFileSync(path.join(cwd, ".deed", "log", "lock"), JSON.stringify({ pid: 999999, start: Date.now() }));
  const began = Date.now();
  const added = deed(cwd, "task", "add", "写服务", "--criteria", "能推事件", "--files", "core/serve.mjs");
  assert.equal(added.status, 0, "持有者不在了，锁就是一个残留文件");
  assert.ok(Date.now() - began < 3000, "不该为一把死锁等满等待预算");
  assert.deepEqual(kinds(cwd).filter((one) => one !== "config.change"), ["turn", "task.add"]);
});

test("a pass seals the segment, so later work opens a new one instead of making that conclusion stale", () => {
  const cwd = workspace("verdict-stale");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "改重放", "--criteria", "同账本同文档", "--files", "core/fold.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass").status, 0);
  const sealed = deed(cwd, "state");
  assert.match(sealed.stdout, /签收/, "关闭这一段之后下一步就是签收");
  assert.doesNotMatch(sealed.stdout, /结论过期/);
  // 封了段之后再想起一件事：新任务开出 S01.2，上一段的结论不会因此变旧。
  assert.equal(deed(cwd, "task", "add", "再改一处", "--criteria", "还是一样", "--files", "core/fold.mjs").status, 0);
  assert.equal(deed(cwd, "task", "done", "T2", "--evidence", "又跑一遍", "--digest", proof(cwd)).status, 0);
  const state = deed(cwd, "state");
  assert.match(state.stdout, /S01\.2/, "后来的事落在新的一段");
  assert.doesNotMatch(state.stdout, /结论过期/, "S01.1 的结论回答的是它自己那几条，不会因为后来的事变旧");
  const sign = deed(cwd, "sign", "--words", "可以", "--by", "user");
  assert.equal(sign.status, 1, "新的一段还没审，签收就还差一步");
  assert.match(sign.stderr, /S01\.2/);
});

test("an overturned conclusion stays in the ledger but stops counting", () => {
  const cwd = workspace("rework-void");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "改重放", "--criteria", "同账本同文档", "--files", "core/fold.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass").status, 0);
  assert.match(deed(cwd, "state").stdout, /签收/, "pass 关闭这一段之后只剩签收");
  const overturned = deed(cwd, "judge", "--overturn", "R1", "--why", "结论没看交付记录", "--by", "user");
  assert.equal(overturned.status, 0, overturned.stdout + overturned.stderr);
  const review = fold(readEvents(cwd)).sessions[0].reviews[0];
  assert.equal(review.voidedBy, "user");
  assert.notEqual(review.voidedAt, null, "作废的那条留着，只是不再算");
  assert.match(deed(cwd, "state").stdout, /deed review --segment S01\.1$|deed review --segment S01\.1/, "这一段回到要审");
  const blocked = deed(cwd, "sign", "--words", "可以", "--by", "user");
  assert.equal(blocked.status, 1, "没有在案的结论不能签收");
  assert.match(blocked.stderr, /S01\.1/);
});

test("a fail names every task it sends back", () => {
  const cwd = workspace("rework-many");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "一", "--criteria", "c", "--files", "core/a.mjs");
  deed(cwd, "task", "add", "二", "--criteria", "c", "--files", "core/b.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "写完了", "--digest", proof(cwd));
  deed(cwd, "task", "done", "T2", "--evidence", "写完了", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1");
  const back = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "fail", "--rework", "T1,T2", "--why", "两处都要补");
  assert.equal(back.status, 0, back.stdout + back.stderr);
  const state = deed(cwd, "state");
  assert.match(state.stdout, /○ T1/);
  assert.match(state.stdout, /○ T2/);
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
    deed(cwd, "task", "done", "T1", "--evidence=--dry-run 跑了 3 条", "--digest", proof(cwd)).status,
    0,
    "写成 --k=v 就说得清",
  );
});

test("a digest only names a plain file inside the workspace", () => {
  const cwd = workspace("digest-guard");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  fs.writeFileSync(path.join(cwd, "..", "deed-outside.txt"), "outside");
  const outside = deed(cwd, "task", "done", "T1", "--evidence", "写完了", "--digest", "../deed-outside.txt");
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /工作区/);
  const dir = deed(cwd, "task", "done", "T1", "--evidence", "写完了", "--digest", ".");
  assert.equal(dir.status, 1);
  assert.match(dir.stderr, /文件/);
});

test("verify tells apart a stale pin, a path that left the workspace, and no pin at all", () => {
  const cwd = workspace("verify-three");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  deed(cwd, "task", "done", "T1", "--evidence", "写完了");
  const bare = deed(cwd, "verify");
  assert.equal(bare.status, 0);
  assert.match(bare.stdout, /没记下内容/);
  deed(cwd, "task", "done", "T1", "--evidence", "又写了一遍", "--digest", proof(cwd));
  fs.writeFileSync(path.join(cwd, "proof.txt"), "changed after the pin");
  const stale = deed(cwd, "verify");
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /交付记录过期/);

  const other = workspace("verify-outside");
  deed(other, "init", "--said", "开始");
  deed(other, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  const log = readEvents(other).length;
  fs.appendFileSync(
    path.join(other, ".deed", "log", new Date().toISOString().slice(0, 7) + ".jsonl"),
    JSON.stringify({ v: 1, at: new Date(Date.now() + 1000).toISOString(), k: "task.done", s: null, id: "T1", evidence: "写完了", by: "agent", digest: "b".repeat(64), digestPath: "../elsewhere.txt", changed: [] }) + "\n",
  );
  assert.equal(readEvents(other).length, log + 1);
  const escaped = deed(other, "verify");
  assert.equal(escaped.status, 1);
  assert.match(escaped.stdout, /路径越界/);
});

test("--session that names no period is refused by every verb that takes one", () => {
  const cwd = workspace("session-matrix");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  for (const args of [
    ["task", "done", "T1", "--evidence", "写完了", "--session", "S99"],
    ["review", "--segment", "S01.1", "--session", "S99"],
    ["seal", "--why", "免审", "--by", "user", "--session", "S99"],
    ["sign", "--words", "可以", "--by", "user", "--session", "S99"],
  ]) {
    const refused = deed(cwd, ...args);
    assert.equal(refused.status, 1, args.join(" ") + " 要点名真存在的会话");
    assert.match(refused.stderr, /没有这个会话|S99/);
  }
});

test("a forced re-init keeps the gates it did not name, and says why it changed", () => {
  const cwd = workspace("reinit");
  deed(cwd, "init", "--said", "开始", "--review", "core/**,src/**", "--exempt", "docs/**");
  const before = JSON.parse(fs.readFileSync(path.join(cwd, ".deed", "config.json"), "utf8"));
  const changes = () => kinds(cwd).filter((one) => one === "config.change").length;
  assert.equal(changes(), 3, "首次 init 把审查设置的基线一次记全");
  assert.equal(deed(cwd, "init", "--force").status, 0, "什么都不说就什么都不改");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, ".deed", "config.json"), "utf8")), before);
  assert.equal(changes(), 3, "没有改动的 --force 不落事件");
  const silent = deed(cwd, "init", "--force", "--exempt", "**");
  assert.equal(silent.status, 1, "改审查设置不留理由就是不留痕");
  assert.match(silent.stderr, /--why/);
  assert.equal(deed(cwd, "init", "--force", "--exempt", "**", "--why", "文档全部免审").status, 0);
  const after = JSON.parse(fs.readFileSync(path.join(cwd, ".deed", "config.json"), "utf8"));
  assert.deepEqual(after.review.required, before.review.required, "没点名的审查设置原样留着");
  assert.deepEqual(after.gates, before.gates, "--force 不再顺手清空门");
  assert.deepEqual(after.review.exempt, ["**"]);
  const change = readEvents(cwd).filter((one) => one.k === "config.change").at(-1);
  assert.equal(change.key, "review");
  assert.equal(change.why, "文档全部免审");
  assert.equal(change.from.exempt.length, before.review.exempt.length, "改动带着它改之前的样子");
});

test("a gate command is run in order, and the first failure stops it", () => {
  const cwd = workspace("gates");
  deed(cwd, "init", "--said", "开始");
  const config = JSON.parse(fs.readFileSync(path.join(cwd, ".deed", "config.json"), "utf8"));
  config.gates = { commit: [process.execPath + ' -e "process.exit(0)"', process.execPath + ' -e "process.exit(3)"'] };
  fs.writeFileSync(path.join(cwd, ".deed", "config.json"), JSON.stringify(config, null, 2));
  assert.equal(deed(cwd, "init", "--force", "--why", "两道门").status, 0, "门要记账才生效");
  const gate = deed(cwd, "gate");
  assert.equal(gate.status, 1);
  assert.match(gate.stderr, /退出码 3/);
});

// 身份是自述：账本剩不下"两个不同的人"这层保证，能查的只有"同一只手"。
test("the hand that delivered a segment cannot write its verdict", () => {
  const cwd = workspace("self-review");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "改重放", "--criteria", "总账能重放", "--files", "core/fold.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "跑了 16 条", "--digest", proof(cwd), "--by", "agent");
  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0, "先把清单交出去");
  const self = deed(cwd, "review", "--segment", "S01.1", "--by", "agent", "--verdict", "pass");
  assert.equal(self.status, 1, "交付者不能判自己交付的段");
  assert.match(self.stderr, /同一个人不能判自己交付的段/);
  assert.equal(kinds(cwd).filter((one) => one === "review.log").length, 0, "被拒的结论不进账本");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass").status, 0);
});

// 心跳只说两件能查的事：认得的宿主配置里有没有跑 deed tick，账本多久没动。
test("doctor says whether anything is keeping the record warm", () => {
  const cwd = workspace("heartbeat");
  deed(cwd, "init", "--said", "开始");
  const before = deed(cwd, "doctor");
  assert.equal(before.status, 0);
  assert.match(before.stdout, /心跳 · 未接：/);
  assert.match(before.stdout, /账本最后一条 .+（/);
  fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".claude", "settings.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ command: "deed tick" }] } }));
  const after = deed(cwd, "doctor");
  assert.match(after.stdout, /心跳 · 已接/);
  assert.doesNotMatch(deed(cwd, "state").stdout, /分钟前/, "状态页不读时钟，只有体检读");
});


// 账本可能比程序新：这一行是别人写下的真事，只是这本程序读不懂。
// 两种情形的话术和动作相反（升级 vs 挪走），所以不能共用一套。
const writeLines = (cwd, extra) => {
  const file = fs.readdirSync(path.join(cwd, ".deed", "log")).find((one) => one.endsWith(".jsonl"));
  fs.appendFileSync(path.join(cwd, ".deed", "log", file), extra.map((one) => JSON.stringify(one) + "\n").join(""));
};

test("a ledger written by a newer deed says so instead of calling itself broken", () => {
  const cwd = workspace("newer-ledger");
  deed(cwd, "init", "--said", "开始");
  writeLines(cwd, [{ v: 1, at: new Date().toISOString(), k: "task.block", s: "S01", id: "T1", why: "0.9 才有的事件", w: "9.9.9" }]);
  const doctor = deed(cwd, "doctor");
  assert.equal(doctor.status, 1, "读不动就是读不动：不猜语义");
  assert.match(doctor.stdout, /账本比 deed 新/);
  assert.match(doctor.stdout, /升级 deed/);
  assert.doesNotMatch(doctor.stdout, /移到 \.deed\/log\/rejected/, "账本新的时候指去挪走，等于让人删真事");
  const state = deed(cwd, "state");
  assert.equal(state.status, 1);
  assert.match(state.stderr, /账本比 deed 新/);
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

test("every line records the deed that wrote it", () => {
  const cwd = workspace("writer-version");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "改重放", "--criteria", "总账能重放");
  const written = readEvents(cwd).map((one) => one.w);
  assert.ok(written.length >= 5);
  assert.ok(written.every((one) => /^\d+\.\d+\.\d+$/.test(one)), "没有写者版本的账本，以后说不清是账本新还是这一行坏了");
});
test("an unknown verb is refused in one line, not a stack trace", () => {
  const cwd = workspace("unknown-verb");
  const run = deed(cwd, "watch");
  assert.equal(run.status, 1);
  assert.equal(run.stderr.trim(), "deed: 没有这个动作：watch（deed help 看全部）");
  assert.equal(/at ModuleJob|Refused/.test(run.stdout + run.stderr), false, "拒绝不该带调用栈");
});

test("--version answers with the version this program ships as", () => {
  const cwd = workspace("version");
  const shipped = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")).version;
  const run = deed(cwd, "--version");
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), shipped);
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

// 2) --help for a verb with no arguments
test("asking a verb that takes no arguments answers with its line, not the whole page", () => {
  const cwd = workspace("usage-noargs");
  for (const verb of ["state", "verify", "doctor"]) {
    const run = deed(cwd, verb, "--help");
    assert.equal(run.status, 0);
    assert.equal(run.stdout.trim(), "deed " + verb, verb + " --help 只该打这一行");
  }
  const task = deed(cwd, "task", "--help");
  assert.match(task.stdout, /deed task undo/);
  assert.doesNotMatch(task.stdout, /deed judge --pass/, "问 task 的用法不该回 judge 的行");
});

// 3) a fail verdict asks for a rework, not for a pass
test("a failed review hands the named work back, and nobody is asked to sign off on it", () => {
  const cwd = workspace("fail-next");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "先交一条", "--criteria", "交了就成", "--files", "proof.txt");
  const pinned = proof(cwd);
  deed(cwd, "task", "done", "T1", "--evidence", "交了", "--digest", pinned);
  const brief = deed(cwd, "review", "--segment", "S01.1");
  assert.equal(brief.status, 0);
  const log = deed(cwd, "review", "--segment", "S01.1", "--by", "reviewer:x", "--verdict", "fail", "--rework", "T1", "--why", "交付记录只说了半句", "--finding", "依据只说了半句");
  assert.equal(log.status, 0, log.stderr);
  const state = deed(cwd, "state");
  assert.match(state.stdout, /deed submit/, "被点名的那条回到未做，下一步是在清单里再勾一次");
  assert.doesNotMatch(state.stdout, /deed judge --pass/, "结论是不合格，下一步不可能是放行");
});

// 4) a task added after the brief is handed out makes that paper old
test("new work waits for the verdict in the next segment, and a brief only ages when its own segment moves", () => {
  const cwd = workspace("brief-task-drift");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "第一条", "--criteria", "做到", "--files", "proof.txt");
  const pinned = proof(cwd);
  deed(cwd, "task", "done", "T1", "--evidence", "做了", "--digest", pinned);
  const first = deed(cwd, "review", "--segment", "S01.1");
  assert.equal(first.status, 0);

  // 清单发出去了还在等结论：这一段不再收新活，新条目自己落到下一段——
  // 旧清单没被这一条顶掉，这一段从发出去到现在确实没变过。
  deed(cwd, "task", "add", "又想起一条", "--criteria", "也得做到", "--files", "proof.txt");
  const session = fold(readEvents(cwd)).sessions[0];
  assert.equal(session.tasks.find((one) => one.id === "T2").segment, "S01.2", "送审之后的新活开下一段");
  assert.equal(session.segments[0].closedAt, null, "等结论的那一段没被封：它只是不再收东西");

  const pass = deed(cwd, "review", "--segment", "S01.1", "--by", "reviewer:x", "--verdict", "pass");
  assert.equal(pass.status, 0, pass.stderr);
  assert.match(pass.stdout, /段已封存/);

  deed(cwd, "task", "done", "T2", "--evidence", "也做了", "--digest", pinned);
  assert.equal(deed(cwd, "review", "--segment", "S01.2").status, 0);
  // 清单发出去之后又交了一遍：清单上写的不是这一版，结论回答不了它。
  deed(cwd, "task", "done", "T2", "--evidence", "又做了一遍", "--digest", pinned);
  const older = deed(cwd, "review", "--segment", "S01.2", "--by", "reviewer:x", "--verdict", "fail", "--rework", "T2", "--why", "再看法");
  assert.equal(older.status, 1);
  assert.match(older.stderr, /又动过/, "清单上没有这一版，结论回答不了它");
});


test("a delivery that said the wrong thing is taken back, not rewritten", () => {
  const cwd = workspace("undo");
  deed(cwd, "init", "--said", "开始");
  const said = deed(cwd, "task", "add", "先说一句要做的事", "--criteria", "做完了", "--files", "proof.txt");
  assert.equal(said.status, 0);
  const pinned = proof(cwd);
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "说要被撤回的那条", "--digest", pinned).status, 0);
  const undo = deed(cwd, "task", "undo", "T1", "--why", "这条交付是我手滑打进去的乱码");
  assert.equal(undo.status, 0);
  assert.match(undo.stdout, /撤回交付 · T1/);

  const after = deed(cwd, "state");
  assert.match(after.stdout, /（未做 1 · 已交付 0）/, "收回之后这条又回到未做");
  assert.match(after.stdout, /deed submit/, "下一步重新是在清单里交付它");

  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "这次说的是真的", "--digest", pinned).status, 0);
  assert.deepEqual(kinds(cwd).filter((one) => one.startsWith("task.")), ["task.add", "task.done", "task.undo", "task.done"]);

  assert.equal(deed(cwd, "review").status, 0);
  const handed = briefs(cwd).map((one) => path.join(cwd, ".deed", "review", one)).sort().pop();
  const text = fs.readFileSync(handed, "utf8");
  assert.equal(text.includes("说要被撤回的那条"), false, "撤回的那条不算数");
  assert.match(text, /- 撤回的交付：这条交付是我手滑打进去的乱码/, "清单要说清哪一条不算数");
  assert.match(text, /- 交付记录：这次说的是真的/);
  // 撤回的那条从账本里消失了，可它当时指着哪份字节是复核这条撤回的唯一依据。
  assert.match(text, /它当时记下的是 proof\.txt/, "撤回也要说清它当时指着什么");
  const taken = readEvents(cwd).find((one) => one.k === "task.undo");
  // 写在账本那一行上的，不是重放时算出来的：重放会跟着将来的形状改口。
  assert.equal(taken.undoes[0].path, "proof.txt", "撤回那行自己带着被撤的路径");
  assert.match(taken.undoes[0].digest, /^[0-9a-f]{64}$/, "撤回那行自己带着被撤的 sha256");
  const logged = fold(readEvents(cwd)).sessions[0].tasks[0].undone;
  assert.equal(logged.length, 1, "账本里留下一条撤回记录");
  assert.equal(logged[0].undoes[0].path, "proof.txt", "撤回带上被撤那条记下的文件与 sha256");
  assert.equal(taken.id, "T1");
});

// 只删不改也算动过：那时没有字节可记，但改动的痕迹在 changed 上。
// 少了这一条，删掉一份文件就再也没法在清单里交这一条。
test("a delivery that only removes a file still points at the change it made", () => {
  const cwd = workspace("delete-only");
  deed(cwd, "init", "--said", "开始");
  fs.writeFileSync(path.join(cwd, "gone.md"), "x");
  deed(cwd, "task", "add", "先把文件建出来", "--criteria", "它在", "--files", "gone.md");
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "建了 gone.md", "--digest", "gone.md").status, 0);
  deed(cwd, "task", "add", "再把它删掉", "--criteria", "它不在了", "--files", "gone.md");
  fs.rmSync(path.join(cwd, "gone.md"));
  deed(cwd, "plan", "--force");
  fs.writeFileSync(
    path.join(cwd, ".deed", "plan.md"),
    ["# 这一期要做成什么", "把那份文件建出来，再删掉。", "", "- [x] T1 先把文件建出来", "  标准：它在", "  交付：建了 gone.md", "", "- [x] T2 再把它删掉", "  标准：它不在了", "  交付：gone.md 已删"].join("\n") + "\n",
  );
  const run = deed(cwd, "submit");
  assert.equal(run.status, 0, run.stderr);
  const done = readEvents(cwd).filter((one) => one.k === "task.done" && one.id === "T2").at(-1);
  assert.deepEqual(done.files, [], "文件走了，没有字节可记");
  assert.deepEqual(done.changed, ["gone.md"], "可它确实动过那条路径");
});

// 空交付写在账本里就一直在：现行那条已经不是它了，挡不了门，但报告要能看见它。
// 两条来路都要看见：后来被重交盖住的，和撤回时自己什么也没记下的。
test("a delivery that pointed at nothing is reported even after a later one covers it", () => {
  const cwd = workspace("bare-history");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写一份东西", "--criteria", "东西在");
  deed(cwd, "task", "add", "再写一份", "--criteria", "第二份也在");
  // 一条谁也不指的交付现在进不了账本（entry 当场就报），所以这种历史只能造出来：
  // 旧账本里真有过这种行，verify 还得读得懂它们。
  const bare = (id, words) => {
    const file = path.join(cwd, ".deed", "log", "9999-01.jsonl");
    const line = { at: new Date().toISOString(), k: "task.done", s: null, id, evidence: words, by: "agent" };
    fs.appendFileSync(file, JSON.stringify(line) + "\n", "utf8");
  };
  bare("T1", "写了，但没指任何文件");
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "这次指上了", "--digest", proof(cwd)).status, 0);
  bare("T2", "说到底写了什么，没指东西");
  assert.equal(deed(cwd, "task", "undo", "T2", "--why", "那条什么也没记下").status, 0);
  assert.equal(deed(cwd, "task", "done", "T2", "--evidence", "重交，指上了", "--digest", proof(cwd, "two.txt")).status, 0);
  const run = deed(cwd, "verify");
  assert.equal(run.status, 0, "后来的交付盖住了它们，不挡放行");
  assert.match(run.stdout, /空交付 · T1 · .*那时没记下文件.*后来重交过，不挡放行/);
  assert.match(run.stdout, /空交付 · T2 · .*撤回时没记下内容.*后来重交过，不挡放行/);
});

// 面板跟着命令走：你不必记得先跑 serve，也不必在 dsh 重启之后手动把它拉回来。
test("a panel comes up with the first command, and the next one leaves it alone", () => {
  const cwd = workspace("panel");
  const env = { ...process.env };
  delete env.DEED_NO_PANEL;
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env });
  try {
    run("init", "--said", "起点");
    const first = run("tick", "--who", "user", "--said", "看看面板");
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /面板 · http:\/\/127\.0\.0\.1:\d+/, "第一条命令就把面板拉起来了");

    const second = run("state");
    assert.equal(second.status, 0, second.stderr);
    assert.doesNotMatch(second.stdout, /面板 · /, "已经在跑就不再拉第二个，也不再刷屏");

    const now = run("panel");
    assert.equal(now.status, 0, now.stderr);
    const port = Number(now.stdout.match(/127\.0\.0\.1:(\d+)/)[1]);
    assert.equal(port > 0, true);

    const stop = run("panel", "--stop");
    assert.match(stop.stdout, /面板已停/);
    const after = run("state");
    assert.match(after.stdout, /面板 · http:\/\/127\.0\.0\.1:\d+/, "停掉之后下一条命令又把它拉起来");
  } finally {
    run("panel", "--stop");
  }
});

// 地址要能收藏：面板守在工作区审查设置里写的那个端口；那个号被别人占着时，
// 它挨着往后找一格（+1、+2…），并且"哪个被占、改开在哪"这句话必须由拉它起来的那一头说出来——
// 子进程不接管道，它自己那句只会掉进虚空。
// 起点号每跑一次现挑一格：写死 7433 会让并发的另一次跑抢走同一格，红了也说明不了代码有问题。
test("a panel says when the declared port was taken, and goes back to it when the port is free", async () => {
  const cwd = workspace("panel-port");
  const env = { ...process.env };
  delete env.DEED_NO_PANEL;
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env });
  // 子进程在 listen 之后才写记号，探活成功与记号落盘之间有几毫秒：读到就等它写完，
  // 不让这条用例因为「差几毫秒」红（跑全量时机器更慢，这个窗口会放大）。
  const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const record = () => {
    for (let step = 0; step < 40; step += 1) {
      try {
        return JSON.parse(fs.readFileSync(panelRecord(cwd), "utf8"));
      } catch {
        nap(100);
      }
    }
    throw new Error("面板的记号一直没写出来：" + panelRecord(cwd));
  };
  const url = (out) => Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);
  const canBind = (port) =>
    new Promise((ok) => {
      const probe = net.createServer(() => {});
      probe.once("error", () => ok(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => ok(true)));
    });
  const pick = async () => {
    for (let step = 0; step < 40; step += 1) {
      const want = 5200 + Math.floor(Math.random() * 600);
      if (await canBind(want)) return want;
    }
    return 0;
  };
  const held = net.createServer(() => {});
  const base = await pick();
  assert.notEqual(base, 0, "找不到一格空号，这一条跑不了");
  const listen = () => new Promise((ok) => held.listen(base, "127.0.0.1", ok));
  const free = () => new Promise((ok) => held.close(() => ok()));
  try {
    assert.equal(run("init", "--said", "起点", "--port", String(base)).status, 0);
    await listen();
    const taken = run("tick", "--who", "user", "--said", "看看面板");
    assert.equal(taken.status, 0, taken.stderr);
    const fell = url(taken.stdout);
    assert.ok(fell > base && fell <= base + 9, "被占着就挨着往后找，落点离声明号不超过九格：" + fell + " 对 " + base);
    for (let step = 1; step < fell - base; step += 1)
      assert.equal(await canBind(base + step), true, base + step + " 当时是空的，却跳了过去");
    assert.match(taken.stdout, new RegExp("端口 " + base + " 被占着；面板改开在 " + fell), "退到哪儿要说出来，不是无声换掉一条地址");
    assert.equal(record().port, fell, "记号里记的就是它实际在听的那个号");
    assert.match(String(record().build), /^[0-9a-f]{16}$/, "记号里带着面板代码的指纹");
    // 停了再起：声明号还被占着，退回的地址也得是同一格，否则每次重启都要人重收一次书签。
    run("panel", "--stop");
    const restarted = run("state");
    assert.equal(restarted.status, 0, restarted.stderr);
    assert.equal(url(restarted.stdout), fell, "重新起来还是那一格");
    // 号让出来了：下一条命令要把它挪回审查设置里写的那个地址——地址是用来收藏的。
    // 这里不先停下旧面板：活着的那个停在退回的号上，得由"号空出来了"这件事把它挪回去，
    // 否则它一辈子守着那个意外落点，声明过的地址就再也没人用过。
    await free();
    const again = run("state");
    assert.equal(again.status, 0, again.stderr);
    assert.equal(url(again.stdout), base, "号空出来之后回到声明的那个地址");
    assert.equal(record().port, base, "记号里也跟着挪回去了");
    assert.notEqual(record().pid, fell, "挪回去的是另一个进程，不是一个改过口的进程");
    // 面板代码换过（记号里的指纹对不上）：下一条命令自己把旧的换掉，
    // 不必有人记得"改完要重启"——换过之后地址不变。
    const heard = record();
    fs.writeFileSync(panelRecord(cwd), JSON.stringify({ pid: heard.pid, port: heard.port, build: "0000000000000000" }));
    const swapped = run("state");
    assert.equal(swapped.status, 0, swapped.stderr);
    const now = record();
    assert.notEqual(now.pid, heard.pid, "旧进程被换掉了");
    assert.equal(now.port, base, "换掉的进程守的还是同一个号");
  } finally {
    run("panel", "--stop");
    if (held.listening) await free();
  }
});

test("the panel stays out of the way when it is told to", () => {
  const cwd = workspace("panel-off");
  deed(cwd, "init", "--said", "起点");
  const run = deed(cwd, "state");
  assert.doesNotMatch(run.stdout, /面板 · /, "DEED_NO_PANEL=1 时一条都不许起");
});
// 主路线是清单：把勾去掉再加一行 理由：。它落的那一行，同样要写清撤的是哪份字节——
// 两条入口落的是同一个事实，只有一条写了就等于事实写在半路上。
test("taking a delivery back from the plan records the bytes too", () => {
  const cwd = workspace("undo-plan");
  deed(cwd, "init", "--said", "开始");
  const pinned = proof(cwd);
  deed(cwd, "task", "add", "先说一句要做的事", "--criteria", "做完了", "--files", "proof.txt");
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "说要被撤回的那条", "--digest", pinned).status, 0);
  deed(cwd, "plan", "--force");
  fs.writeFileSync(
    path.join(cwd, ".deed", "plan.md"),
    ["# 这一期要做成什么", "先说一句要做的事。", "", "- [ ] T1 先说一句要做的事", "  标准：做完了", "  理由：这条交付是我手滑打进去的乱码"].join("\n") + "\n",
  );
  const run = deed(cwd, "submit");
  assert.equal(run.status, 0, run.stderr);
  const taken = readEvents(cwd).find((one) => one.k === "task.undo");
  assert.equal(taken.undoes[0].path, "proof.txt", "清单那条路也要把被撤的字节写进账本");
  assert.match(taken.undoes[0].digest, /^[0-9a-f]{64}$/);
});

test("a take-back's shape is checked where it is written", () => {
  const base = { k: "task.undo", id: "T1", why: "说错了话", by: "agent" };
  assert.ok(validateEvent({ ...base, undoes: [] }), "什么也没记下的交付，撤回时是空数组");
  assert.ok(validateEvent({ ...base, undoes: [{ path: "a.txt", digest: "a".repeat(64) }] }));
  assert.throws(() => validateEvent({ ...base, undoes: "a.txt" }), /undoes 要是数组/);
  assert.throws(() => validateEvent({ ...base, undoes: [{ path: "a.txt" }] }), /path 与 digest/);
});

test("taking back a delivery that never landed is refused, and nothing is written", () => {
  const cwd = workspace("undo-empty");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "一条还没交的任务", "--criteria", "做完了");
  const run = deed(cwd, "task", "undo", "T1", "--why", "手滑");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /没有可撤回的交付/);
  assert.equal(kinds(cwd).includes("task.undo"), false);
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

test("a brief handed out before the ledger moved is replaced, not answered", () => {
  const cwd = workspace("brief-moved");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "先说一句要做的事", "--criteria", "做完了", "--files", "proof.txt");
  const pinned = proof(cwd);
  deed(cwd, "task", "done", "T1", "--evidence", "第一次交付", "--digest", pinned);

  const first = deed(cwd, "review");
  assert.equal(first.status, 0);
  const seen = new Set(briefs(cwd));
  const again = deed(cwd, "review");
  assert.match(again.stdout, /已经出过，等结论落盘/, "账本没动时，同一份清单就继续等结论");

  deed(cwd, "task", "undo", "T1", "--why", "那条交付说错了话");
  deed(cwd, "task", "done", "T1", "--evidence", "第二次交付", "--digest", pinned);
  const third = deed(cwd, "review");
  assert.match(third.stdout, /出在这一段最近一次改动之前：另出一份/, "账本动了，旧清单就不再是这一段现在的事");
  const fresh = briefs(cwd).filter((one) => !seen.has(one));
  assert.equal(fresh.length, 2, "只该多出一对：清单与角色包");
  const sheet = fresh.find((one) => !one.endsWith("-reviewer.md"));
  const text = fs.readFileSync(path.join(cwd, ".deed", "review", sheet), "utf8");
  assert.match(text, /第二次交付/);
  assert.match(text, /撤回的交付：那条交付说错了话/);
});

test("an older delivery is history, not a claim that keeps going stale", () => {
  const cwd = workspace("covered");
  fs.writeFileSync(path.join(cwd, "thing.txt"), "v1");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "记下内容", "--criteria", "文件不变", "--files", "docs/a.md");
  deed(cwd, "task", "done", "T1", "--evidence", "第一版", "--digest", "thing.txt");
  fs.writeFileSync(path.join(cwd, "thing.txt"), "v2");
  deed(cwd, "task", "done", "T1", "--evidence", "第二版：跟着改了", "--digest", "thing.txt");
  const ok = deed(cwd, "verify");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /早先的交付 1 条/, "覆盖掉的交付要说是历史，不能假装它还在核对");
  const judge = deed(cwd, "judge", "--pass", "--by", "qa");
  assert.doesNotMatch(judge.stdout + judge.stderr, /过期/, "现行那份是新的，判决不该再被过期的交付记录挡住");
  fs.writeFileSync(path.join(cwd, "thing.txt"), "v3");
  const stale = deed(cwd, "verify");
  assert.equal(stale.status, 1, "现行那份跟着变了才算过期");
  assert.match(stale.stdout, /交付记录过期 · T1/);
});

test("a pin in a closed segment stops blocking, but it still gets reported", () => {
  const cwd = workspace("shut-pins");
  fs.writeFileSync(path.join(cwd, "thing.txt"), "v1");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "记下内容", "--criteria", "文件在", "--files", "thing.txt");
  deed(cwd, "task", "done", "T1", "--evidence", "第一版", "--digest", "thing.txt");
  deed(cwd, "review", "--segment", "S01.1");
  const passed = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass");
  assert.equal(passed.status, 0, passed.stderr);
  fs.writeFileSync(path.join(cwd, "thing.txt"), "v2");
  const after = deed(cwd, "verify");
  assert.equal(after.status, 0, after.stdout + after.stderr);
  assert.doesNotMatch(after.stdout, /交付记录过期 · T1/, "已关闭的段里没人能再交付，追旧记录只会留一笔结不掉的未结项");
  assert.match(after.stdout, /已关闭的段里有 1 条记下的字节已经变了/, "跳过整条会让「字节变了」变成没人看的一格");
});

test("a file pinned again by a later delivery is covered, not stale", () => {
  const cwd = workspace("repinned");
  fs.writeFileSync(path.join(cwd, "shared.md"), "v1");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写第一部分", "--criteria", "写完", "--files", "shared.md");
  deed(cwd, "task", "done", "T1", "--evidence", "第一版", "--digest", "shared.md");
  fs.writeFileSync(path.join(cwd, "shared.md"), "v2");
  deed(cwd, "task", "add", "接着写第二部分", "--criteria", "写完剩下的", "--files", "shared.md");
  deed(cwd, "task", "done", "T2", "--evidence", "第二版：文件跟着改了", "--digest", "shared.md");

  const ok = deed(cwd, "verify");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /早先的交付 1 条/, "后来者重新记过的路径，早先那条算历史");

  fs.writeFileSync(path.join(cwd, "shared.md"), "v3");
  const stale = deed(cwd, "verify");
  assert.equal(stale.status, 1, "没人再记过的字节，得由最后记下它的人负责");
  assert.match(stale.stdout, /交付记录过期 · T2 · shared\.md/, "只该点名最后记下这一条路径的交付");
  assert.doesNotMatch(stale.stdout, /交付记录过期 · T1/, "被覆盖的那条不该跟着一起报");
});

test("verify names the covered deliveries while the list is short, and only counts them when it is long", () => {
  const small = workspace("covered-short");
  fs.writeFileSync(path.join(small, "shared.md"), "v1");
  deed(small, "init", "--said", "开始");
  deed(small, "task", "add", "写一遍", "--criteria", "写完", "--files", "shared.md");
  deed(small, "task", "done", "T1", "--evidence", "第一版", "--digest", "shared.md");
  fs.writeFileSync(path.join(small, "shared.md"), "v2");
  deed(small, "task", "done", "T1", "--evidence", "第二版", "--digest", "shared.md");
  const short = deed(small, "verify");
  assert.equal(short.status, 0, short.stdout + short.stderr);
  assert.match(short.stdout, /早先的交付 1 条（T1）/, "少的时候点得到号");

  // 一屏倒出几百个号，读者只看得到第一行——多的时候就只报名下。
  const wide = workspace("covered-long");
  fs.writeFileSync(path.join(wide, "shared.md"), "v1");
  deed(wide, "init", "--said", "开始");
  deed(wide, "task", "add", "反复改同一个文件", "--criteria", "改到第十几次", "--files", "shared.md");
  for (let n = 1; n <= 13; n += 1) {
    fs.writeFileSync(path.join(wide, "shared.md"), "v" + n);
    deed(wide, "task", "done", "T1", "--evidence", "第 " + n + " 版", "--digest", "shared.md");
  }
  const long = deed(wide, "verify");
  assert.equal(long.status, 0, long.stdout + long.stderr);
  assert.match(long.stdout, /早先的交付 12 条（分属 1 条任务）/, "多的时候只说条数与分属几条任务");
  assert.doesNotMatch(long.stdout, /T1、T1/, "不往一屏里倒号");
});

test("one delivery pins every file it says it produced", () => {
  const cwd = workspace("many-pins");
  fs.writeFileSync(path.join(cwd, "a.md"), "a1");
  fs.writeFileSync(path.join(cwd, "b.md"), "b1");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写两份", "--criteria", "两份都在", "--files", "a.md,b.md");
  const done = deed(cwd, "task", "done", "T1", "--evidence", "两份都写了", "--digest", "a.md", "--digest", "b.md");
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.match(done.stdout, /记下 a\.md [0-9a-f]{12}、b\.md [0-9a-f]{12}/, "两枚都要报出来");
  assert.equal(deed(cwd, "verify").status, 0);

  const review = deed(cwd, "review");
  assert.equal(review.status, 0, review.stdout + review.stderr);
  const brief = fs.readFileSync(path.join(cwd, ".deed", "review", briefs(cwd).sort().at(-1)), "utf8");
  assert.match(brief, /记下：a\.md [0-9a-f]{12}、b\.md [0-9a-f]{12}/, "审查者要拿到每一份的指纹");

  fs.writeFileSync(path.join(cwd, "b.md"), "b2");
  const stale = deed(cwd, "verify");
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /交付记录过期 · T1 · b\.md/, "改了哪一份就点名哪一份");
  assert.doesNotMatch(stale.stdout, /过期 · T1 · a\.md/, "没改的那份不该被连坐");
});

test("the word --help inside evidence is evidence", () => {
  const cwd = workspace("help-in-words");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  const done = deed(cwd, "task", "done", "T1", "--evidence", "跑过 review --help 与 task --help，都只打用法", "--digest", proof(cwd));
  assert.equal(done.status, 0, "交付记录里出现 --help 不该被当成在问用法");
  assert.match(done.stdout, /交付 · T1/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "task.done").length, 1);
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

test("a review may carry more than one finding, and all of them land", () => {
  const cwd = workspace("many-findings");
  const pin = proof(cwd);
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "改文件", "--criteria", "改完", "--files", "core/a.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "改完", "--digest", pin);
  deed(cwd, "review", "--segment", "S01.1");
  const one = deed(
    cwd,
    "review",
    "--segment",
    "S01.1",
    "--by",
    "reviewer",
    "--verdict",
    "fail",
    "--rework",
    "T1",
    "--why",
    "两条都得改",
    "--finding",
    "第一条",
    "--finding",
    "第二条",
  );
  assert.equal(one.status, 0, one.stdout + one.stderr);
  const log = readEvents(cwd).filter((event) => event.k === "review.log").pop();
  assert.deepEqual(log.findings, ["第一条", "第二条"], "写好的一条都不能丢");
});

test("a fail that names nobody is refused, and a pass cannot carry a rework", () => {
  const cwd = workspace("fail-names");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "交一条", "--criteria", "交了", "--files", "proof.txt");
  deed(cwd, "task", "done", "T1", "--evidence", "交了", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1");
  const nameless = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "fail", "--why", "不行");
  assert.equal(nameless.status, 1, "不点名的结论没人能接");
  assert.match(nameless.stderr, /--rework/);
  const unclear = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "fail", "--rework", "T1");
  assert.equal(unclear.status, 1, "点名要说为什么");
  assert.match(unclear.stderr, /--why/);
  const mixed = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass", "--rework", "T1");
  assert.equal(mixed.status, 1, "放行不负责任何重做");
  assert.match(mixed.stderr, /--rework 只跟|只跟 --verdict fail/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "review.log").length, 0, "被拒的结论一条都不写");
});

test("a person can overturn a conclusion, and that reopens the segment", () => {
  const cwd = workspace("overturn");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "交一条", "--criteria", "交了", "--files", "proof.txt");
  deed(cwd, "task", "done", "T1", "--evidence", "交了", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass").status, 0);
  const before = fold(readEvents(cwd)).sessions[0].reviews[0];
  assert.equal(before.id, "R1", "结论有自己的编号，人能点名它");
  const noReason = deed(cwd, "judge", "--overturn", before.id);
  assert.equal(noReason.status, 1, "推翻是一句要负责任的话");
  assert.match(noReason.stderr, /--why/);
  const done = deed(cwd, "judge", "--overturn", before.id, "--why", "审查者没看并发", "--by", "user");
  assert.equal(done.status, 0, done.stderr);
  const events = readEvents(cwd);
  const flip = events.filter((one) => one.k === "review.overturn").pop();
  assert.equal(flip.review, before.id, "作废的是哪一条，账本自己说");
  assert.equal(flip.why, "审查者没看并发");
  assert.match(done.stdout, /重新出清单、重新审/);
  const state = deed(cwd, "state");
  assert.match(state.stdout, /deed review --segment S01\.1/, "这里回到没判过的样子");
  assert.equal(deed(cwd, "review", "--by", "qa2", "--verdict", "pass").status, 0, "推翻过的段可以再判一次");
  assert.equal(deed(cwd, "sign", "--words", "可以", "--by", "user").status, 0, "再判过才签得动");
  // 一句话已经签收成历史，账本不往回改：推翻只能发生在签收之前。
  const second = fold(readEvents(cwd)).sessions[0].reviews[1];
  assert.equal(second.verdict, "pass");
  const settled = deed(cwd, "judge", "--overturn", second.id, "--why", "太晚了");
  assert.equal(settled.status, 1);
  assert.match(settled.stderr, /已经签收/);
  assert.equal(events.filter((one) => one.k === "review.overturn").length, 1, "被拒的那条不写");
});

test("a pass names the segment it sealed, and the next step is the signature", () => {
  const cwd = workspace("seal");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "交一条", "--criteria", "交了", "--files", "proof.txt");
  deed(cwd, "task", "done", "T1", "--evidence", "交了", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1");
  const pass = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass");
  assert.match(pass.stdout, /S01\.1 .*段已封存/);
  const state = deed(cwd, "state");
  assert.equal(state.status, 0);
  assert.match(state.stdout, /签收/);
  assert.doesNotMatch(state.stdout, /deed judge --pass/);
  const again = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "fail", "--rework", "T1", "--why", "再看");
  assert.equal(again.status, 1, "已关闭的段不能再落结论");
  assert.match(again.stderr, /已经封存/);
});
// 规模规则得在真工作区里说得通：一次只碰两份小文档的交付免审，一份大文档就要审。

test("a delivery weighs what it moved, and a big change asks for a review", () => {
  const cwd = workspace("weigh");
  deed(cwd, "init", "--said", "开始");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a");
  fs.writeFileSync(path.join(cwd, "proof.txt"), "proof");
  assert.equal(deed(cwd, "task", "add", "写两份小文档", "--criteria", "两份都在", "--files", "docs/a.md").status, 0);
  deed(cwd, "task", "done", "T1", "--evidence", "写下 docs/a.md", "--digest", "proof.txt");
  const weighed = readEvents(cwd).find((one) => one.k === "task.done");
  assert.equal(typeof weighed.bytes, "object", "交付那一刻称过字节");
  assert.equal(weighed.bytes["docs/a.md"], 1, "1 个字节的文档");
  assert.ok(fs.statSync(path.join(cwd, "docs", "a.md")).size === 1);
  // 一份 30KB 的文档照样只是文档，但它不再是"小改动"。
  fs.writeFileSync(path.join(cwd, "docs", "b.md"), "x".repeat(30000));
  deed(cwd, "task", "add", "拷一份大文档", "--criteria", "在那儿", "--files", "docs/b.md");
  deed(cwd, "task", "done", "T2", "--evidence", "拷进 docs/b.md", "--digest", "proof.txt");
  const state = deed(cwd, "state");
  assert.match(state.stdout, /T2|要审/, "大改动让这一段要审");
});

const planFile = (cwd) => path.join(cwd, ".deed", "plan.md");
const writePlan = (cwd, text) => fs.writeFileSync(planFile(cwd), text, "utf8");
const readPlan = (cwd) => fs.readFileSync(planFile(cwd), "utf8");

// 清单是两面都能改的那一个文件：一条命令一次落整批，新条目自己领号。

test("a plan lands as one batch: a ? takes a number, a tick is a delivery", () => {
  const cwd = workspace("plan-batch");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "tick", "--who", "user", "--said", "把清单做成一个文件");
  assert.equal(deed(cwd, "plan").status, 0);
  assert.match(readPlan(cwd), /# 这一期要做成什么/);
  writePlan(
    cwd,
    ["# 这一期要做成什么", "把清单做成一个文件。", "", "- ? 写一份说明", "  标准：docs/a.md 有一句话", "", "- ? 写另一份说明", "  标准：docs/b.md 有一句话"].join("\n"),
  );
  const first = deed(cwd, "submit");
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /写进清单 · T1 · S01\.1 · 写一份说明/, "领号时把落进哪一段一起说出来");
  assert.match(first.stdout, /写进清单 · T2 · S01\.1 · 写另一份说明/);
  assert.match(readPlan(cwd), /- \[ \] T1 写一份说明/, "领到的号要写回清单，不然下一次 submit 会再加一条");

  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a", "utf8");
  fs.writeFileSync(path.join(cwd, "docs", "b.md"), "b", "utf8");
  writePlan(
    cwd,
    readPlan(cwd)
      .replace("- [ ] T1 写一份说明", "- [x] T1 写一份说明")
      .replace("  标准：docs/a.md 有一句话", "  标准：docs/a.md 有一句话\n  交付：写了 docs/a.md"),
  );
  const second = deed(cwd, "submit");
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /交付 · T1 · 写了 docs\/a.md/);
  assert.match(second.stdout, /记账之后核对 · 1 条都对得上当时那份内容/, "记账之后要核一遍：没有这一句就没人知道它跑过");
  const done = readEvents(cwd).find((one) => one.k === "task.done" && one.id === "T1");
  assert.ok(done.files.some((one) => one.path === "docs/a.md"), "勾上就是交付：submit 按工作区自己称，记下动过的文件");
  assert.equal(done.evidence, "写了 docs/a.md", "交付记录就是清单上那一行");

  writePlan(cwd, readPlan(cwd).replace("- [x] T1 写一份说明", "- [ ] T1 写一份说明").replace("  交付：写了 docs/a.md", "  理由：这份说明写错了"));
  const undone = deed(cwd, "submit");
  assert.equal(undone.status, 0, undone.stderr);
  assert.match(undone.stdout, /撤回 · T1 · 这份说明写错了/);

  writePlan(cwd, readPlan(cwd).replace("- [ ] T2 写另一份说明", "~~ T2 写另一份说明").replace("  标准：docs/b.md 有一句话", "  标准：docs/b.md 有一句话\n  理由：不需要了"));
  const dropped = deed(cwd, "submit");
  assert.equal(dropped.status, 0, dropped.stderr);
  assert.match(dropped.stdout, /放弃 · T2 · 不需要了/);
  assert.deepEqual(kinds(cwd).filter((one) => one.startsWith("task.")), ["task.add", "task.add", "task.done", "task.undo", "task.drop"]);
});

// 一次只加条目的 submit 不该刷新基线：否则它把工作区里等着被交付的改动吃掉，
// 下一条交付看起来"什么都没动"——那是数据丢失，不是干净。

test("adding an entry does not swallow the changes waiting to be delivered", () => {
  const cwd = workspace("plan-baseline");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "tick", "--who", "user", "--said", "写一份说明");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a", "utf8");
  writePlan(cwd, ["# 这一期要做成什么", "- ? 写一份说明", "  标准：docs/a.md 有一句话"].join("\n"));
  assert.equal(deed(cwd, "submit").status, 0, "只加条目这一次不该失败");
  writePlan(
    cwd,
    readPlan(cwd)
      .replace("- [ ] T1 写一份说明", "- [x] T1 写一份说明")
      .replace("  标准：docs/a.md 有一句话", "  标准：docs/a.md 有一句话\n  交付：写了 docs/a.md"),
  );
  assert.equal(deed(cwd, "submit").status, 0);
  const done = readEvents(cwd).find((one) => one.k === "task.done");
  assert.ok(done.files.some((one) => one.path === "docs/a.md"), "基线没被上一条只加条目的 submit 吃掉");
  assert.deepEqual(Object.keys(done.bytes), ["docs/a.md"]);
});

test("a plan with a line nobody can read lands nothing, and a task cannot vanish", () => {
  const cwd = workspace("plan-bad");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "tick", "--who", "user", "--said", "写一条");
  writePlan(cwd, ["# 这一期要做成什么", "- ? 一条", "  标准：有", "这不是任何格式"].join("\n"));
  const before = kinds(cwd).length;
  const bad = deed(cwd, "submit");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /第 4 行看不懂/);
  assert.equal(kinds(cwd).length, before, "整批原子：一行不合格，一个字都不落");

  writePlan(cwd, ["# 这一期要做成什么", "- ? 一条", "  标准：有"].join("\n"));
  assert.equal(deed(cwd, "submit").status, 0);
  writePlan(
    cwd,
    ["# 这一期要做成什么", "# 什么也没有"].join("\n"),
  );
  const gone = deed(cwd, "submit");
  assert.equal(gone.status, 1);
  assert.match(gone.stderr, /清单里少了 T1/);
});

// 一批 submit 只量了一次工作区差：账本得说清"这几条共用一份差"，
// 而不是让三条一字不差的记录看起来各自记下了各自的东西。

test("one submit that delivers several entries says the changes belong to the batch", () => {
  const cwd = workspace("plan-batchmark");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "tick", "--who", "user", "--said", "一次交两条");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a", "utf8");
  writePlan(
    cwd,
    ["# 这一期要做成什么", "把两份说明写完。", "", "- ? 写 a", "  标准：docs/a.md 有一句话", "", "- ? 写 b", "  标准：docs/b.md 有一句话"].join("\n"),
  );
  assert.equal(deed(cwd, "submit").status, 0);
  fs.writeFileSync(path.join(cwd, "docs", "b.md"), "b", "utf8");
  writePlan(
    cwd,
    readPlan(cwd)
      .replace("- [ ] T1 写 a", "- [x] T1 写 a")
      .replace("  标准：docs/a.md 有一句话", "  标准：docs/a.md 有一句话\n  交付：写下 docs/a.md")
      .replace("- [ ] T2 写 b", "- [x] T2 写 b")
      .replace("  标准：docs/b.md 有一句话", "  标准：docs/b.md 有一句话\n  交付：写下 docs/b.md"),
  );
  const landed = deed(cwd, "submit");
  assert.equal(landed.status, 0, landed.stderr);
  const dones = readEvents(cwd).filter((one) => one.k === "task.done");
  assert.equal(dones.length, 2);
  assert.ok(dones[0].batch && dones[0].batch.at === dones[1].batch.at, "同一批里的两条交付记着同一个批号");
  const done = readEvents(cwd).find((one) => one.k === "task.done");
  assert.equal(done.batch.size, 2, "这一批几条也记进账本，不是拿剩下的数现算");
  assert.equal(typeof done.batch.at, "string", "批号是这一批的时刻，不是 true");

  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0);
  const sheet = fs
    .readdirSync(path.join(cwd, ".deed", "review"))
    .filter((one) => one.endsWith(".md") && !one.endsWith("-reviewer.md"))
    .at(-1);
  const text = fs.readFileSync(path.join(cwd, ".deed", "review", sheet), "utf8");
  assert.match(text, /同批交付：这一批共 2 条/, "清单上说清改动属于整批");

  // 单独交一条时不写批号：那份差就是它自己的。
  deed(cwd, "task", "add", "再写一份", "--criteria", "docs/c.md 有一句话");
  fs.writeFileSync(path.join(cwd, "docs", "c.md"), "c", "utf8");
  deed(cwd, "task", "done", "T3", "--evidence", "写下 docs/c.md", "--digest", "docs/c.md");
  const alone = readEvents(cwd).find((one) => one.k === "task.done" && one.id === "T3");
  assert.equal(alone.batch, undefined, "一条一批时不写批号");
});

// 一段的改动全落在免审路径时，出清单是白费：账本上会多一条等人回答的清单，
// 而这一段正确的结局是关闭（deed seal）。

test("a segment the settings exempt gets no brief, and the step says to close it", () => {
  const cwd = workspace("seg-not-needed");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**,*.md");
  deed(cwd, "tick", "--who", "user", "--said", "改一份文档");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a", "utf8");
  deed(cwd, "task", "add", "改 a", "--criteria", "docs/a.md 有一句话");
  deed(cwd, "task", "done", "T1", "--evidence", "改好 docs/a.md", "--digest", "docs/a.md");
  const before = readEvents(cwd).length;
  const r = deed(cwd, "review", "--segment", "S01.1");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /审查设置说这一段不用审/);
  assert.match(r.stdout, /deed seal --segment S01\.1/, "下一步是关闭这一段，不是另审一份");
  assert.equal(readEvents(cwd).length, before, "不写账本");
  assert.deepEqual(fs.readdirSync(path.join(cwd, ".deed", "review")), [], "不生成文件");
});

// 撤回同批的一条再重交：数目不能跟着剩下的条数变小，否则两条一批撤回一条
// 就成了「这一批共 1 条」——那正是标准禁止的单条一批。

test("taking one delivery back does not shrink the batch it belonged to", () => {
  const cwd = workspace("plan-batchundo");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "tick", "--who", "user", "--said", "一次交两条");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a", "utf8");
  fs.writeFileSync(path.join(cwd, "docs", "b.md"), "b", "utf8");
  writePlan(
    cwd,
    ["# 这一期要做成什么", "把两份说明写完。", "", "- ? 写 a", "  标准：docs/a.md 有一句话", "", "- ? 写 b", "  标准：docs/b.md 有一句话"].join("\n"),
  );
  assert.equal(deed(cwd, "submit").status, 0);
  writePlan(
    cwd,
    readPlan(cwd)
      .replace("- [ ] T1 写 a", "- [x] T1 写 a")
      .replace("  标准：docs/a.md 有一句话", "  标准：docs/a.md 有一句话\n  交付：写下 docs/a.md")
      .replace("- [ ] T2 写 b", "- [x] T2 写 b")
      .replace("  标准：docs/b.md 有一句话", "  标准：docs/b.md 有一句话\n  交付：写下 docs/b.md"),
  );
  assert.equal(deed(cwd, "submit").status, 0);
  assert.equal(deed(cwd, "task", "undo", "T2", "--why", "这条说错了").status, 0);
  assert.equal(deed(cwd, "task", "done", "T2", "--evidence", "重交 docs/b.md", "--digest", "docs/b.md").status, 0);
  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0);
  const sheet = fs
    .readdirSync(path.join(cwd, ".deed", "review"))
    .filter((one) => one.endsWith(".md") && !one.endsWith("-reviewer.md"))
    .at(-1);
  const text = fs.readFileSync(path.join(cwd, ".deed", "review", sheet), "utf8");
  assert.match(text, /同批交付：这一批共 2 条（其中 1 条已撤回）/, "撤回不改变这一批原本几条");
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

// 两段都由 deed seal 关的期：没人需要写的东西，不该有人等到它——直接签收。
test("a period whose segments all sat out review signs without anything else", () => {
  const cwd = workspace("all-exempt-sign");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**,*.md");
  deed(cwd, "tick", "--who", "user", "--said", "改两份文档");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a", "utf8");
  deed(cwd, "task", "add", "改 a", "--criteria", "docs/a.md 有一句话");
  deed(cwd, "task", "done", "T1", "--evidence", "改好 docs/a.md", "--digest", "docs/a.md");
  assert.equal(deed(cwd, "seal", "--segment", "S01.1", "--why", "只改文档", "--by", "agent").status, 0);
  fs.writeFileSync(path.join(cwd, "docs", "b.md"), "b", "utf8");
  deed(cwd, "task", "add", "改 b", "--criteria", "docs/b.md 有一句话");
  deed(cwd, "task", "done", "T2", "--evidence", "改好 docs/b.md", "--digest", "docs/b.md");
  assert.equal(deed(cwd, "seal", "--segment", "S01.2", "--why", "只改文档", "--by", "agent").status, 0);
  assert.match(deed(cwd, "state").stdout, /下一步 · user · 签收/);
  const signed = deed(cwd, "sign", "--words", "可以", "--by", "user");
  assert.equal(signed.status, 0, signed.stderr);
  assert.match(signed.stdout, /没经过审查 · S01.1/, "没人看过的段在签收这一刻摊开说");
});

// 一次 submit 不能既新增又交付同一条：任务得在交付之前记账。

test("an entry that is new cannot be ticked in the same submit", () => {
  const cwd = workspace("plan-newtick");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "tick", "--who", "user", "--said", "写一条");
  writePlan(cwd, ["# 这一期要做成什么", "写一句话。", "", "- [x] ? 写一句话", "  标准：docs/a.md 有一句话", "  交付：写了"].join("\n"));
  const landed = deed(cwd, "submit");
  assert.equal(landed.status, 1);
  assert.match(landed.stderr, /一次 submit 不能既新增又交付/);
  assert.equal(kinds(cwd).filter((one) => one.startsWith("task.")).length, 0, "整批不记账");
});

// 草稿把判过的条目也画成勾上：否则下一次 submit 会当成还没做。

test("the draft keeps judged entries ticked", () => {
  const cwd = workspace("plan-draft-accepted");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "tick", "--who", "user", "--said", "写一条");
  writePlan(cwd, ["# 这一期要做成什么", "写一句话。", "", "- ? 写一句话", "  标准：docs/a.md 有一句话"].join("\n"));
  assert.equal(deed(cwd, "submit").status, 0);
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a", "utf8");
  writePlan(cwd, readPlan(cwd).replace("- [ ] T1 写一句话", "- [x] T1 写一句话").replace("  标准：docs/a.md 有一句话", "  标准：docs/a.md 有一句话\n  交付：写下 docs/a.md"));
  assert.equal(deed(cwd, "submit").status, 0);
  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0);
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass").status, 0);
  const draft = deed(cwd, "plan", "--force");
  assert.equal(draft.status, 0, draft.stderr);
  assert.match(readPlan(cwd), /- \[x\] T1 写一句话/, "判过的条目在草稿里还是勾上的");
  const again = deed(cwd, "submit");
  assert.equal(again.status, 1, "判过的条目不会再交一次");
  assert.match(again.stderr, /没有要落的改动/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "task.done").length, 1);
});

// 先做后记：文件在任务被记下之前就写好了，那条任务记的是既成事实。
// doctor 只报事实，不算坏账。

test("doctor says when a promise came after the work", () => {
  const cwd = workspace("promise-late");
  deed(cwd, "init", "--said", "开始");
  // 这条检查只在 git 工作区里比：没有 git 的目录里 mtime 是文件被挪进来的时刻，不作数。
  spawnSync("git", ["init"], { cwd, encoding: "utf8" });
  fs.writeFileSync(path.join(cwd, "docs.txt"), "x", "utf8");
  const old = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(path.join(cwd, "docs.txt"), old, old);
  deed(cwd, "task", "add", "改 docs.txt", "--criteria", "docs.txt 有一句话", "--files", "docs.txt");
  deed(cwd, "task", "done", "T1", "--evidence", "写下 docs.txt", "--digest", "docs.txt");
  const doctor = deed(cwd, "doctor");
  assert.equal(doctor.status, 0);
  assert.match(doctor.stdout, /先做后记 1 条/);
  assert.match(doctor.stdout, /T1 的 docs.txt/);

  // 同一个目录，把 git 摘掉：不比了，也不报错。
  fs.rmSync(path.join(cwd, ".git"), { recursive: true, force: true });
  const bare = deed(cwd, "doctor");
  assert.equal(bare.status, 0, bare.stderr);
  assert.doesNotMatch(bare.stdout, /先做后记/);
  assert.doesNotMatch(bare.stdout, /没有 git|不在 git/);
});
// 审查设置的一半是规模，而手工 --digest 常常指一份这次没动、但这条任务得担着的文件：
// 它不在工作区差里，不称就一直「称不出」，审查设置只好按要审算。

test("pinning a file that did not move this time still weighs it", () => {
  const cwd = workspace("weigh-pin");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "T1", "--criteria", "做完的标准");
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "第一次", "--digest", proof(cwd)).status, 0);
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "重新记同一份", "--digest", "proof.txt").status, 0);
  const last = readEvents(cwd).filter((one) => one.k === "task.done").at(-1);
  assert.deepEqual(last.changed, [], "这一次什么都没动");
  assert.equal(last.bytes["proof.txt"], fs.statSync(path.join(cwd, "proof.txt")).size);
});
// 勾上就要指着点什么：没改动、也没文件可指时，写下去是一条谁也核不了的空话，
// 而后面的交付一记就把它盖住——审计永远看不见它。

test("a submit with nothing to point at refuses to write the delivery", () => {
  const cwd = workspace("empty-delivery");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "tick", "--who", "user", "--said", "写一份说明");
  writePlan(cwd, ["# 这一期要做成什么", "把说明写完。", "", "- ? 写一份说明", "  标准：docs/a.md 有一句话"].join("\n"));
  assert.equal(deed(cwd, "submit").status, 0, "新条目先记账");
  writePlan(
    cwd,
    ["# 这一期要做成什么", "把说明写完。", "", "- [x] T1 写一份说明", "  标准：docs/a.md 有一句话", "  交付：写了（可工作区里什么都没动）"].join("\n"),
  );
  const before = readEvents(cwd).length;
  const refused = deed(cwd, "submit");
  assert.equal(refused.status, 1, "什么都没动就不算交付");
  assert.match(refused.stderr, /没有量到任何改动、也没有文件可指/);
  assert.equal(readEvents(cwd).length, before, "一个字都没落");
});

test("removing a file nobody can weigh is not a small change", () => {
  const cwd = workspace("delete-is-not-small");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**,*.md");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  // 一万五千字节落在免审路径上，够小，够免审。
  fs.writeFileSync(path.join(cwd, "docs", "big.md"), "x".repeat(15000));
  deed(cwd, "task", "add", "写一份一万五的文档", "--criteria", "它在", "--files", "docs/big.md");
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "写了 docs/big.md", "--digest", "docs/big.md").status, 0);
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

test("removing a file in a submit is not a small change either", () => {
  const cwd = workspace("delete-is-not-small-submit");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**,*.md");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "big.md"), "x".repeat(15000));
  deed(cwd, "task", "add", "写一份一万五的文档", "--criteria", "它在", "--files", "docs/big.md");
  const plan = path.join(cwd, ".deed", "plan.md");
  deed(cwd, "plan", "--force");
  fs.writeFileSync(plan, ["# 这一期要做成什么", "写一份，再删掉。", "", "- [x] T1 写一份一万五的文档", "  标准：它在", "  交付：写了 docs/big.md"].join("\n") + "\n");
  assert.equal(deed(cwd, "submit").status, 0);
  assert.match(deed(cwd, "state").stdout, /免审（全部落在 exempt）/u, "一万五千字节落在免审路径上，本来不用审");

  deed(cwd, "task", "add", "再把它删掉", "--criteria", "它不在了", "--files", "docs/big.md");
  fs.rmSync(path.join(cwd, "docs", "big.md"));
  deed(cwd, "plan", "--force");
  fs.writeFileSync(plan, ["# 这一期要做成什么", "写一份，再删掉。", "", "- [x] T1 写一份一万五的文档", "  标准：它在", "  交付：写了 docs/big.md", "", "- [x] T2 再把它删掉", "  标准：它不在了", "  交付：docs/big.md 已删"].join("\n") + "\n");
  const run = deed(cwd, "submit");
  assert.equal(run.status, 0, run.stderr);
  const done = readEvents(cwd).filter((one) => one.k === "task.done" && one.id === "T2").at(-1);
  assert.deepEqual(done.bytes, {}, "删掉的路径不记 0，记空");
  assert.doesNotMatch(deed(cwd, "state").stdout, /免审（全部落在 exempt）/u, "删掉一万五千字节，不再算小改动");
});

// 默认审查设置是空的：deed 不知道别的项目把代码放在哪。替所有工作区写下一串必审目录，
// 没写进去的目录就会悄悄免审——外部工作区看不见这条规则，只会觉得"deed 说不用审"。
test("a fresh workspace reviews everything until it declares its own paths", () => {
  const cwd = workspace("default-gate");
  deed(cwd, "init", "--said", "开始");
  const config = JSON.parse(fs.readFileSync(path.join(cwd, ".deed", "config.json"), "utf8"));
  assert.deepEqual(config.review.required, [], "不给任何项目预设必审目录");
  assert.deepEqual(config.review.exempt, [], "也不预设免审目录");
  fs.mkdirSync(path.join(cwd, "app"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "app", "server.mjs"), "export const port = 1;\n");
  assert.equal(deed(cwd, "task", "add", "改服务端", "--criteria", "端口能读", "--files", "app/server.mjs").status, 0);
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "node -e 读过", "--digest", "app/server.mjs").status, 0);
  assert.match(deed(cwd, "state").stdout, /deed review --segment S01\.1/, "没人声明过的路径照样要审");
  assert.equal(deed(cwd, "init", "--force", "--exempt", "app/**", "--why", "服务端不在审查范围").status, 0);
  const sealed = deed(cwd, "seal", "--why", "app 全部免审", "--by", "user");
  assert.equal(sealed.status, 0, sealed.stderr);
  assert.match(sealed.stdout, /封存/, "工作区自己声明之后才算免审");
});

test("the second and third brief of one segment say how many there have been", () => {
  const cwd = workspace("brief-nth");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "甲", "--criteria", "能跑", "--files", "a.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test 1/1", "--digest", proof(cwd));
  assert.match(deed(cwd, "review", "--segment", "S01.1").stdout, /S01\.1 的第 1 份/);
  deed(cwd, "task", "done", "T1", "--evidence", "node --test 2/2", "--digest", proof(cwd));
  const second = deed(cwd, "review", "--segment", "S01.1");
  assert.match(second.stdout, /S01\.1 的第 2 份/);
  assert.doesNotMatch(second.stdout, /先看上一份/, "第二份还用不着提醒");
  // 慢要看得见：这一段出过几份清单，state 直接摆出来，不挡任何一步。
  assert.match(deed(cwd, "state").stdout, /花了 · 2 份清单/);
  deed(cwd, "task", "done", "T1", "--evidence", "node --test 3/3", "--digest", proof(cwd));
  const third = deed(cwd, "review", "--segment", "S01.1");
  assert.match(third.stdout, /S01\.1 的第 3 份/);
  assert.match(third.stdout, /先看上一份的审查者点了哪几条/);
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

test("a verb that takes no flags still says so instead of ignoring them", () => {
  // 只读动词以前不过开关表：拼错的开关被当成没写，命令照常 exit 0。
  const cwd = workspace("readonly-flags");
  deed(cwd, "init", "--said", "起点");
  for (const verb of ["state", "verify", "doctor"]) {
    const one = deed(cwd, verb, "--digset", "a.md");
    assert.equal(one.status, 1, verb + " 带了不认的开关却说没事：" + one.stdout);
    assert.match(one.stderr, /不认 --digset/);
    assert.match(one.stderr, /不收开关/, verb + " 一个开关都不收，别去猜最接近的名字");
  }
});

test("a settled decision keeps its border and what it gave up, and they are not tasks", () => {
  const cwd = workspace("decision-edges");
  deed(cwd, "init", "--said", "起点");
  deed(cwd, "tick", "--who", "user", "--said", "先谈谈怎么收尾");
  deed(cwd, "ask", "收尾要不要连文档一起改", "--reading", "只改代码", "--why", "两种都说得通");
  const refused = deed(cwd, "ask", "resolve", "A1", "--decision", "边界：", "--by", "user");
  assert.equal(refused.status, 1, "空边界要挡：写了个词根没写内容");
  assert.match(refused.stderr, /没写内容/);
  const settled = deed(cwd, "ask", "resolve", "A1", "--by", "user", "--decision", "只改代码\n边界：文档里的旧词不再新增\n弃：导出功能不做了");
  assert.equal(settled.status, 0, settled.stderr);
  assert.match(settled.stdout, /记下 · 2 条/);
  const state = deed(cwd, "state");
  assert.match(state.stdout, /边界 · 文档里的旧词不再新增（A1 · user）/);
  assert.match(state.stdout, /弃 · 导出功能不做了（A1 · user）/);
  // 它们不是任务：清单里没有多出条目，签收那一行的未结项也没变。
  const plan = deed(cwd, "plan", "--print");
  assert.doesNotMatch(plan.stdout, /文档里的旧词不再新增/);
});

test("an entry still to be done is carried to the next segment from the plan", () => {
  const cwd = workspace("carry-plan");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "先做这一件", "--criteria", "能跑", "--files", "proof.txt");
  deed(cwd, "task", "done", "T1", "--evidence", "跑了 1/1", "--digest", proof(cwd));
  deed(cwd, "task", "add", "下一段再做", "--criteria", "也做完");
  const plan = path.join(cwd, ".deed", "plan.md");
  deed(cwd, "plan", "--force");
  fs.writeFileSync(
    plan,
    fs.readFileSync(plan, "utf8").replace(/  标准：也做完\n/u, "  标准：也做完\n  改到下一段：这一段已经送审，下一段接着做\n"),
  );
  const run = deed(cwd, "submit");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /改到下一段 · T2 · S01\.2/);
  const session = fold(readEvents(cwd)).sessions[0];
  assert.equal(session.segments.length, 2, "改到下一段就是开下一段");
  assert.equal(session.tasks.find((one) => one.id === "T2").segment, "S01.2");

  // 交付过的条目改不了段：那等于把一条交付换个段说话，账本里没有这件事的位置。
  // 这一条要按清单自己画出来的形状写——交过的条目画的是 [x] + 交付：，
  // 按勾判会让这一行被当成"没有要落的改动"吞掉，用户只得到一句和 改到下一段： 无关的话。
  deed(cwd, "plan", "--force");
  const drawn = fs.readFileSync(plan, "utf8");
  assert.match(drawn, /- \[x\] T1 先做这一件/u, "清单自己把交过的条目画成勾着的");
  fs.writeFileSync(plan, drawn.replace(/(  交付：跑了 1\/1\n)/u, "$1  改到下一段：换个段\n"));
  const refused = deed(cwd, "submit");
  assert.equal(refused.status, 1, "写了 改到下一段： 却 exit 0，等于静默吞掉");
  assert.match(refused.stderr, /已经交过（done）/u);
  assert.doesNotMatch(refused.stderr, /没有要落的改动/u);
});

// 没人审过的段不是被静默放过：签收那一刻，它和「凭什么不审」一起摊在眼前。
test("a segment nobody reviewed says at signing why it was not reviewed", () => {
  const cwd = workspace("seal-why");
  deed(cwd, "init", "--said", "把文档写完", "--exempt", "docs/**");
  deed(cwd, "goal", "把文档写完", "--by", "user");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  deed(cwd, "task", "done", "T1", "--evidence", "写完了");
  assert.equal(deed(cwd, "seal", "--why", "只改了文档，审查设置说不用审", "--by", "agent").status, 0);
  const signed = deed(cwd, "sign", "--words", "可以", "--by", "user");
  assert.equal(signed.status, 0, signed.stderr);
  assert.match(signed.stdout, /没经过审查 · S01\.1（只改了文档，审查设置说不用审）/, "理由不能印成空括号");
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
  const signed = deed(cwd, "sign", "--words", "可以", "--by", "user");
  assert.equal(signed.status, 0, signed.stderr);
  assert.match(signed.stdout, /没经过审查 · S01\.1/, "这一行照旧要露面");
  // 理由缺的是 undefined 而不是空串：两种形状都不许露出来，否则守卫被删掉也没人知道
  assert.doesNotMatch(signed.stdout, /（）|undefined/u, "没有理由就不该有括号，也不该露出 undefined");
});

test("a panel is replaced when any module it loaded changes, not only its own files", () => {
  // 进程把模块装进内存：改了 core/fold.mjs 之后，旧进程手里的还是旧判断，
  // 页面上会印一段命令行根本不认的段号。指纹要盖住它加载过的每一份。
  const pkg = path.join(import.meta.dirname, "..");
  const listed = watchedFiles();
  for (const one of ["board/render.mjs", "board/serve.mjs", "core/fold.mjs", "core/rules.mjs", "lib/store.mjs"]) {
    assert.ok(listed.includes(one), "指纹要盖住 " + one);
  }
  const stale = createHash("sha256");
  for (const one of ["board/render.mjs", "board/serve.mjs", "lib/panel.mjs"]) {
    stale.update(one + "\n");
    stale.update(fs.readFileSync(path.join(pkg, one)));
  }
  assert.notEqual(buildNow(), stale.digest("hex").slice(0, 16), "只盖面板自己那三份，等于改了 core 也不换进程");
});

test("the counts in a delivery are taken by running the command, not copied", () => {
  const cwd = workspace("run-counts");
  deed(cwd, "init", "--said", "开始");
  fs.writeFileSync(
    path.join(cwd, "x.test.mjs"),
    'import test from "node:test";\ntest("one", () => {});\ntest("two", () => {});\n',
  );
  deed(cwd, "task", "add", "写两条测试", "--criteria", "node --test x.test.mjs 报 2/2");
  deed(cwd, "plan");
  const file = path.join(cwd, ".deed", "plan.md");
  const first = fs.readFileSync(file, "utf8").replace(/- \[ \] T1 (.*)\n/, "- [x] T1 $1\n  交付：写了 x.test.mjs，报 2/2 通过\n");
  fs.writeFileSync(file, first, "utf8");
  const good = deed(cwd, "submit", "--run", "node --test x.test.mjs");
  assert.equal(good.status, 0, good.stderr);
  const done = readEvents(cwd).find((one) => one.k === "task.done");
  // 数在账本里，是从那条命令的输出读出来的，不是从交付那句话里抄的
  assert.deepEqual(
    { tests: done.run.tests, pass: done.run.pass, fail: done.run.fail },
    { tests: 2, pass: 2, fail: 0 },
    "run 这一格要记下命令自己报的条数",
  );
  assert.equal(done.run.exit, 0);
  assert.equal(done.run.command, "node --test x.test.mjs");

  // 清单里早交过的那条还带着当时的数：再接一条新活，--run 只核这一次真交的那条
  deed(cwd, "task", "add", "再写一条", "--criteria", "也是 2/2");
  fs.writeFileSync(path.join(cwd, "note.txt"), "这次真动了一下\n");
  deed(cwd, "plan", "--force");
  fs.writeFileSync(
    file,
    fs.readFileSync(file, "utf8").replace(/- \[ \] T2 (.*)\n/, "- [x] T2 $1\n  交付：也报 2/2 通过\n"),
    "utf8",
  );
  const again = deed(cwd, "submit", "--run", "node --test x.test.mjs");
  assert.equal(again.status, 0, again.stderr);
});

test("a delivery whose numbers disagree with the run is refused before anything lands", () => {
  const cwd = workspace("run-lie");
  deed(cwd, "init", "--said", "开始");
  fs.writeFileSync(
    path.join(cwd, "x.test.mjs"),
    'import test from "node:test";\ntest("one", () => {});\ntest("two", () => {});\n',
  );
  deed(cwd, "task", "add", "写两条测试", "--criteria", "node --test x.test.mjs 报 2/2");
  deed(cwd, "plan");
  const file = path.join(cwd, ".deed", "plan.md");
  const before = readEvents(cwd).length;
  fs.writeFileSync(
    file,
    fs.readFileSync(file, "utf8").replace(/- \[ \] T1 (.*)\n/, "- [x] T1 $1\n  交付：写了 x.test.mjs，报 1/2 通过\n"),
    "utf8",
  );
  const bad = deed(cwd, "submit", "--run", "node --test x.test.mjs");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /T1 的记录写着 1\/2，--run 采到的是 2\/2/);
  assert.equal(readEvents(cwd).length, before, "整批拒：一条也不落");
  // 抄上一轮的「3/3」也一样落不下来：分母对不上，等于这条记录里根本没有这个数
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, "utf8")
      .replace(/- \[x\] T1 ([^\n]*)\n  交付：[^\n]*\n/, "- [x] T1 $1\n  交付：写了 x.test.mjs，报 3/3 通过\n"),
    "utf8",
  );
  const stale = deed(cwd, "submit", "--run", "node --test x.test.mjs");
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /T1 的记录里没有一处写着 --run 跑出来的 2\/2/);
  assert.equal(readEvents(cwd).length, before, "整批拒：一条也不落");
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

test("a delivery that says what it will show has to show it when the ledger is written", () => {
  const cwd = workspace("run-expect");
  deed(cwd, "init", "--said", "开始");
  fs.writeFileSync(path.join(cwd, "say.mjs"), 'console.log("hi");\n');
  deed(cwd, "task", "add", "写一句话", "--criteria", "node say.mjs 印 hi");
  deed(cwd, "plan");
  const file = path.join(cwd, ".deed", "plan.md");
  const base = fs.readFileSync(file, "utf8").replace(/- \[ \] T1 (.*)\n/, "- [x] T1 $1\n  交付：说 hi 就印 hi；期望：node say.mjs => hi\n");
  fs.writeFileSync(file, base, "utf8");
  const good = deed(cwd, "submit");
  assert.equal(good.status, 0, good.stderr);
  // 成立的那条留下了凭据：账本记下命令与它必须印出的那段话，清单上也看得到
  const first = readEvents(cwd).find((one) => one.k === "task.done");
  assert.deepEqual(first.expects, [{ command: "node say.mjs", want: "hi" }]);
  deed(cwd, "review", "--segment", "S01.1");
  const brief = fs
    .readdirSync(path.join(cwd, ".deed", "review"))
    .filter((one) => !one.endsWith("-reviewer.md"))
    .map((one) => fs.readFileSync(path.join(cwd, ".deed", "review", one), "utf8"))
    .at(-1);
  assert.match(brief, /核过：node say\.mjs => hi/);
  assert.doesNotMatch(brief, /只是说法/);

  // 说得出现象却跑不出来：记账前就拒
  deed(cwd, "task", "add", "再写一句", "--criteria", "印 bye");
  deed(cwd, "plan", "--force");
  const next = fs
    .readFileSync(file, "utf8")
    .replace(/- \[ \] T2 (.*)\n/, "- [x] T2 $1\n  交付：说 bye 就印 bye；期望：node say.mjs => bye\n");
  fs.writeFileSync(file, next, "utf8");
  const bad = deed(cwd, "submit");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /T2 的期望没跑出来：命令「node say.mjs」要看到「bye」/);
});

test("a delivery with no command behind it says so in the brief", () => {
  const cwd = workspace("run-saying");
  deed(cwd, "init", "--said", "开始");
  fs.writeFileSync(path.join(cwd, "note.md"), "one\n");
  deed(cwd, "task", "add", "改一句话", "--criteria", "改好了");
  deed(cwd, "plan");
  const file = path.join(cwd, ".deed", "plan.md");
  fs.writeFileSync(
    file,
    fs.readFileSync(file, "utf8").replace(/- \[ \] T1 (.*)\n/, "- [x] T1 $1\n  交付：改了一句，看起来没问题\n"),
    "utf8",
  );
  const ok = deed(cwd, "submit");
  assert.equal(ok.status, 0, ok.stderr);
  deed(cwd, "review", "--segment", "S01.1");
  const brief = fs
    .readdirSync(path.join(cwd, ".deed", "review"))
    .filter((one) => !one.endsWith("-reviewer.md"))
    .map((one) => fs.readFileSync(path.join(cwd, ".deed", "review", one), "utf8"))
    .at(-1);
  // 没有命令核过的交付在清单上只算说法：审查者看得到它和「跑过」「核过」的区别
  assert.match(brief, /只是说法：这条没配命令核过/);
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

test("a delivery is refused when a pinned path moved before it was written down", () => {
  const cwd = workspace("moved-refuse");
  fs.writeFileSync(path.join(cwd, "a.md"), "one");
  const pin = { path: "a.md", digest: createHash("sha256").update("one").digest("hex") };
  assert.doesNotThrow(() => requireUnchanged(cwd, [pin]), "没变的路径不该拦");
  fs.writeFileSync(path.join(cwd, "a.md"), "two");
  assert.throws(() => requireUnchanged(cwd, [pin]), /记账之前这些路径变了：a\.md/);
});
test("what a batch of deliveries points at is checked once the ledger has them", () => {
  // 记账之后那一刻的核对：这条交付还指得到那份内容吗？变了要能分开说「变了」与「不在了」，
  // 一条谁也没指着的交付要单独说成「空交付」——两种都不是可以放过去的样子。
  const cwd = workspace("audit-delivered");
  fs.writeFileSync(path.join(cwd, "a.md"), "one");
  const pin = { path: "a.md", digest: createHash("sha256").update("one").digest("hex") };
  const done = (files) => ({ k: "task.done", id: "T1", files });
  assert.deepEqual(auditDelivered(cwd, [done([pin])]), [], "对得上就说没事");
  assert.deepEqual(auditDelivered(cwd, [{ k: "task.add", id: "T2" }]), [], "不是交付的行不归它管");
  fs.writeFileSync(path.join(cwd, "a.md"), "two");
  const moved = auditDelivered(cwd, [done([pin])]);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].id, "T1");
  assert.equal(moved[0].path, "a.md");
  assert.equal(moved[0].empty, false);
  assert.equal(moved[0].now, createHash("sha256").update("two").digest("hex"));
  const empty = auditDelivered(cwd, [done([])]);
  assert.equal(empty.length, 1, "谁也没指着的交付也要说出来");
  assert.equal(empty[0].empty, true);
});

// 放弃错了只有新开一条，账本里的错口径就永远挂着；撤回一条放弃是一条新事实，
// 撤回来它就回到未做，同一批再勾上就是重新交付。
test("a drop can be taken back in the plan, and then the entry can be delivered again", () => {
  const cwd = workspace("plan-undrop");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "tick", "--who", "user", "--said", "写一份说明");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a", "utf8");
  writePlan(cwd, ["# 这一期要做成什么", "- ? 写一份说明", "  标准：docs/a.md 有一句话"].join("\n"));
  assert.equal(deed(cwd, "submit").status, 0);

  writePlan(cwd, readPlan(cwd).replace("- [ ] T1 写一份说明", "~~ T1 写一份说明").replace("  标准：docs/a.md 有一句话", "  标准：docs/a.md 有一句话\n  理由：过时的活"));
  assert.equal(deed(cwd, "submit").status, 0);

  // 撤回来却没写理由：账本里会留下一条谁也读不出原因的事实，先拒。
  writePlan(cwd, readPlan(cwd).replace("~~ T1 写一份说明", "- [ ] T1 写一份说明").replace("\n  理由：过时的活", ""));
  const bare = deed(cwd, "submit");
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /已经放弃过：要撤回来接着做，就在这一行下面写一条 理由：/u);

  writePlan(cwd, readPlan(cwd).replace("  标准：docs/a.md 有一句话", "  标准：docs/a.md 有一句话\n  理由：其实还得做"));
  const back = deed(cwd, "submit");
  assert.equal(back.status, 0, back.stderr);
  assert.match(back.stdout, /撤回放弃 · T1 · 其实还得做/u);

  const shown = deed(cwd, "state");
  assert.match(shown.stdout, /○ T1 写一份说明（撤回过放弃）/u);

  writePlan(
    cwd,
    readPlan(cwd)
      .replace(/^- \[ \] T1 .*$/mu, "- [x] T1 写一份说明")
      .replace("  标准：docs/a.md 有一句话", "  标准：docs/a.md 有一句话\n  交付：写了 docs/a.md"),
  );
  const again = deed(cwd, "submit");
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /交付 · T1 · 写了 docs\/a.md/u);
  assert.deepEqual(
    kinds(cwd).filter((one) => one.startsWith("task.")),
    ["task.add", "task.drop", "task.undo", "task.done"],
    "撤回来之后再交一次，账本里是两个事实、不是改写",
  );
});

// 顺序只有一个来源：条目在清单里的位置。把它上下挪一下，再 submit，账本落一条 task.order，
// state、deed plan --print 与面板印出来的次序跟着变——不按条目编号排。
test("the order of the rows is the order the work happens in", () => {
  const cwd = workspace("plan-order");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "tick", "--who", "user", "--said", "排活");
  const first = ["- ? 先做的事", "  标准：做第一件", "- ? 后做的事", "  标准：做第二件"];
  writePlan(cwd, ["# 这一期要做成什么", "排活。", "", ...first].join("\n"));
  const added = deed(cwd, "submit");
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /下一步 · agent · 交付：T1 · 先做的事/u, "下一步挑清单上头一条");

  const draft = deed(cwd, "plan", "--print");
  assert.match(draft.stdout, /- \[ \] T1 先做的事/u);
  assert.ok(
    draft.stdout.indexOf("- [ ] T1 先做的事") < draft.stdout.indexOf("- [ ] T2 后做的事"),
    "草稿按账本里的位置印，不按编号印",
  );

  // 把两行换个位置：账本里落一条 task.order，最后那条交付先做。
  const before = "- [ ] T1 先做的事\n  标准：做第一件\n- [ ] T2 后做的事\n  标准：做第二件";
  const swappedBlock = "- [ ] T2 后做的事\n  标准：做第二件\n- [ ] T1 先做的事\n  标准：做第一件";
  const now = readPlan(cwd);
  assert.ok(now.includes(before), "草稿里两块是挨着的，换位置要整块换");
  writePlan(cwd, now.replace(before, swappedBlock));
  const reordered = deed(cwd, "submit");
  assert.equal(reordered.status, 0, reordered.stderr);
  assert.equal(kinds(cwd).filter((one) => one === "task.order").length, 2, "两条都换了位置，各落一条 task.order");
  const after = deed(cwd, "state");
  assert.ok(
    after.stdout.indexOf("T2 后做的事") < after.stdout.indexOf("T1 先做的事"),
    "state 的次序跟着清单里的位置走",
  );
  const step = deed(cwd, "state");
  assert.match(step.stdout, /下一步 · agent · 交付：T2 · 后做的事/u);
});
