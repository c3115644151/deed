import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { workspace } from "../support/lib.mjs";
import { readEvents } from "../lib/store.mjs";
import { fold } from "../core/fold.mjs";
import { EVENT_VERSION, validateEvent } from "../core/events.mjs";

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
  assert.equal(deed(cwd, "init", "--said", "开始").status, 0);
  const config = JSON.parse(fs.readFileSync(path.join(cwd, ".deed", "config.json"), "utf8"));
  assert.ok(config.review.required.includes("core/**"));
  assert.deepEqual(kinds(cwd), ["config.change", "config.change", "config.change", "turn"], "门槛的基线也落在账本里");
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

// 一期要做成什么：一句话，可改，账本留每一次；整期审与签收都拿它当尺子。
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

// 多段的一期：段都封了还差一句落在整期上的结论；它拿目的当尺子，
// 一次通过同时封掉还没封的段。
test("a whole review reads the period, and its pass seals what it read", () => {
  const cwd = workspace("whole-review");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "甲", "--criteria", "能跑", "--files", "core/a.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass").status, 0);
  deed(cwd, "task", "add", "乙", "--criteria", "能跑", "--files", "core/b.mjs");
  deed(cwd, "task", "done", "T2", "--evidence", "node --test", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.2");
  assert.equal(deed(cwd, "review", "--segment", "S01.2", "--by", "qa", "--verdict", "pass").status, 0);
  const aimless = deed(cwd, "review", "--all");
  assert.equal(aimless.status, 1, "没有目的，整期审没有尺子");
  assert.match(aimless.stderr, /还没写目的/);
  assert.equal(deed(cwd, "goal", "把两段活收成一件", "--by", "user").status, 0);
  assert.match(deed(cwd, "state").stdout, /deed review --all/, "段都封了，下一步是整期一句");
  const handed = deed(cwd, "review", "--all");
  assert.equal(handed.status, 0, handed.stderr);
  assert.match(handed.stdout, /整体审材料/);
  const pair = briefs(cwd).filter((one) => one.includes("-all-"));
  assert.equal(pair.length, 2, "整期材料也是清单加角色包");
  const passed = deed(cwd, "review", "--all", "--by", "qa", "--verdict", "pass");
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.match(passed.stdout, /整体审通过/);
  const review = fold(readEvents(cwd)).sessions[0].reviews.at(-1);
  assert.equal(review.scope, "session");
  assert.equal(review.segment, null);
  assert.equal(deed(cwd, "sign", "--words", "可以", "--by", "user").status, 0, "整期结论落了，签收才可行");
});

// 整期审打回可以点名上一段已经封存的任务：那一段要跟着打开，否则那一条连重新交付都做不了。
test("a whole review can send back work from a segment it already sealed", () => {
  const cwd = workspace("whole-rework");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "goal", "把两段活收成一件", "--by", "user");
  deed(cwd, "task", "add", "甲", "--criteria", "能跑", "--files", "core/a.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass").status, 0);
  deed(cwd, "task", "add", "乙", "--criteria", "能跑", "--files", "core/b.mjs");
  deed(cwd, "task", "done", "T2", "--evidence", "node --test", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.2");
  assert.equal(deed(cwd, "review", "--segment", "S01.2", "--by", "qa", "--verdict", "pass").status, 0);
  deed(cwd, "review", "--all");
  const back = deed(cwd, "review", "--all", "--by", "qa", "--verdict", "fail", "--rework", "T1", "--why", "第一段的交付记录没说清");
  assert.equal(back.status, 0, back.stdout + back.stderr);
  const session = fold(readEvents(cwd)).sessions[0];
  assert.equal(session.tasks[0].status, "todo", "被点名的回到未做");
  assert.equal(session.segments[0].closedAt, null, "它所在的那一段跟着打开");
  assert.equal(session.tasks[1].status, "accepted", "没被点名的段不动");
  assert.equal(session.segments[1].closedAt !== null, true);
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "补了并发记录", "--digest", proof(cwd)).status, 0, "打开了才交得进去");
});

// 一段的一期不审两遍：段放行就是这一期的结局，下一步直接是签收；
// --all 指的是这一期，只有一段的期上它走错对象，被拒并指回段审。
test("a period with one segment has one verdict, and --all does not ask for a second", () => {
  const cwd = workspace("single-whole");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "甲", "--criteria", "能跑", "--files", "core/a.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test", "--digest", proof(cwd));
  const alone = deed(cwd, "review", "--all");
  assert.equal(alone.status, 1, "这一期只有一段：它的审查就是整期的审查");
  assert.match(alone.stderr, /只有一段/);
  const both = deed(cwd, "review", "--all", "--segment", "S01.1");
  assert.equal(both.status, 1, "一次只审一个对象");
  assert.match(both.stderr, /一次只审一个对象/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "review.brief").length, 0, "被拒的一个字都不写");
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass").status, 0);
  const state = deed(cwd, "state");
  assert.equal(state.status, 0);
  assert.match(state.stdout, /下一步 · user · 签收/, "段放行之后只剩一句话");
  assert.doesNotMatch(state.stdout, /deed review --all/, "不能又叫一份整期材料");
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
  // 角色包被换掉（"怎么审"被改成"随便过"）同样是一份没人读过的材料。
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
  deed(cwd, "init", "--said", "开始");
  assert.equal(deed(cwd, "sign", "--words", "可以", "--by", "user").status, 1, "什么都没交付不能签收");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  deed(cwd, "task", "done", "T1", "--evidence", "写完了");
  assert.equal(deed(cwd, "sign", "--words", "可以", "--by", "user").status, 1, "段还没封");
  deed(cwd, "seal", "--why", "只改了文档，门槛说不用审", "--by", "agent");
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
  deed(cwd, "init", "--said", "开始");
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
  deed(cwd, "init", "--said", "开始");
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
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  deed(cwd, "task", "done", "T1", "--evidence", "写完了");
  deed(cwd, "seal", "--why", "只改了文档", "--by", "agent");
  deed(cwd, "sign", "--words", "可以", "--by", "user");
  const after = readEvents(cwd).length;
  const stray = deed(cwd, "task", "add", "又一件", "--criteria", "x");
  assert.equal(stray.status, 1, "签收之后不能靠 task add 开新期");
  assert.match(stray.stderr, /还没有会话|已经收口/);
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
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "内容如下", "--digest", "missing.txt").status, 1, "钉的文件要真的在");
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
  assert.match(drift.stdout, /门槛对不上 · review/);
  assert.match(deed(cwd, "state").stdout, /门槛 文件与账本不一致/);
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
  // 记事本存 UTF-8 会带 BOM；这个文件本来就是给人改的，编码不该变成"门槛 JSON 坏了"。
  const cwd = workspace("config-bom");
  assert.equal(deed(cwd, "init", "--said", "开始").status, 0);
  const configFile = path.join(cwd, ".deed", "config.json");
  fs.writeFileSync(configFile, "\uFEFF" + fs.readFileSync(configFile, "utf8"));
  const state = deed(cwd, "state");
  assert.equal(state.status, 0);
  assert.doesNotMatch(state.stdout, /门槛 文件与账本不一致/);
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
  assert.doesNotMatch(run.stdout, /上一期已收口/);
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
  assert.match(sealed.stdout, /签收/, "封段之后下一步就是签收");
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
  assert.match(deed(cwd, "state").stdout, /签收/, "pass 封段之后只剩签收");
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
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence=--dry-run 跑了 3 条").status, 0, "写成 --k=v 就说得清");
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
  assert.match(bare.stdout, /没钉内容/);
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
  assert.equal(changes(), 3, "首次 init 把门槛的基线一次记全");
  assert.equal(deed(cwd, "init", "--force").status, 0, "什么都不说就什么都不改");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, ".deed", "config.json"), "utf8")), before);
  assert.equal(changes(), 3, "没有改动的 --force 不落事件");
  const silent = deed(cwd, "init", "--force", "--exempt", "**");
  assert.equal(silent.status, 1, "改门槛不留理由就是不留痕");
  assert.match(silent.stderr, /--why/);
  assert.equal(deed(cwd, "init", "--force", "--exempt", "**", "--why", "文档全部免审").status, 0);
  const after = JSON.parse(fs.readFileSync(path.join(cwd, ".deed", "config.json"), "utf8"));
  assert.deepEqual(after.review.required, before.review.required, "没点名的门槛原样留着");
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

// 心跳只说两件能查的事：认得的宿主配置里有没有跑 deed tick，账本冷了多久。
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
  assert.equal(tick.stderr.trim(), "deed: 这个目录还没接 deed：先 deed init（没有门槛的账本，读不出状态，也判不了任何一段）");
  assert.deepEqual(kinds(cwd), [], "被拒的那一轮一个字也不该落盘");
  // 被拒是"什么都没发生"：拿锁时顺手建出来的东西也得擦干净，否则明天有人
  // 看见 .deed/ 会以为这个目录接过了。
  assert.equal(fs.existsSync(path.join(cwd, ".deed")), false, "被拒的写操作不该在目录里留下 .deed/");

  const state = deed(cwd, "state");
  assert.equal(state.status, 0);
  assert.equal(state.stdout.includes("这个目录还没接 deed · 先 deed init"), true);
  assert.equal(/下一步/.test(state.stdout), false, "没有门槛时不该给下一步");

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
test("a task added after the brief is handed out makes that brief old news", () => {
  const cwd = workspace("brief-task-drift");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "第一条", "--criteria", "做到", "--files", "proof.txt");
  const pinned = proof(cwd);
  deed(cwd, "task", "done", "T1", "--evidence", "做了", "--digest", pinned);
  const first = deed(cwd, "review", "--segment", "S01.1");
  assert.equal(first.status, 0);

  deed(cwd, "task", "add", "又想起一条", "--criteria", "也得做到", "--files", "proof.txt");
  const open = deed(cwd, "review", "--segment", "S01.1");
  assert.equal(open.status, 1, "还有没交付的条目，清单先别发");
  assert.match(open.stderr, /还有没交付的（T2）/);

  deed(cwd, "task", "done", "T2", "--evidence", "也做了", "--digest", pinned);
  const again = deed(cwd, "review", "--segment", "S01.1");
  assert.equal(again.status, 0);
  assert.match(again.stdout, /另出一份/, "交付把旧清单顶掉了，重出一份");
  const pass = deed(cwd, "review", "--segment", "S01.1", "--by", "reviewer:x", "--verdict", "pass");
  assert.equal(pass.status, 0);

  // 放行把这一段封了：再想起一条就落在下一段，不会把刚下的结论顶旧。
  deed(cwd, "task", "add", "第三条", "--criteria", "第三件", "--files", "proof.txt");
  assert.match(deed(cwd, "state").stdout, /S01\.2/);
  const early = deed(cwd, "review", "--segment", "S01.2");
  assert.equal(early.status, 1, "还有没交付的条目，清单先别发");
  assert.match(early.stderr, /还有没交付的/);
  deed(cwd, "task", "done", "T3", "--evidence", "也做了", "--digest", pinned);
  assert.equal(deed(cwd, "review", "--segment", "S01.2").status, 0);
  // 清单发出去之后又交了一遍：清单上写的不是这一版，结论回答不了它。
  deed(cwd, "task", "done", "T3", "--evidence", "又做了一遍", "--digest", pinned);
  const older = deed(cwd, "review", "--segment", "S01.2", "--by", "reviewer:x", "--verdict", "fail", "--rework", "T3", "--why", "再看法");
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

// 只删不改也算动过：那时没有字节可钉，但改动的痕迹在 changed 上。
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
  assert.deepEqual(done.files, [], "文件走了，没有字节可钉");
  assert.deepEqual(done.changed, ["gone.md"], "可它确实动过那条路径");
});

// 空交付写在账本里就一直在：现行那条已经不是它了，挡不了门，但报告要能看见它。
// 两条来路都要看见：后来被重交盖住的，和撤回时自己什么也没记下的。
test("a delivery that pointed at nothing is reported even after a later one covers it", () => {
  const cwd = workspace("bare-history");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "写一份东西", "--criteria", "东西在");
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "写了，但没指任何文件").status, 0);
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "这次指上了", "--digest", proof(cwd)).status, 0);
  deed(cwd, "task", "add", "再写一份", "--criteria", "第二份也在");
  assert.equal(deed(cwd, "task", "done", "T2", "--evidence", "说到底写了什么，没指东西").status, 0);
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

test("the panel stays out of the way when it is told to", () => {
  const cwd = workspace("panel-off");
  deed(cwd, "init", "--said", "起点");
  const run = deed(cwd, "state");
  assert.doesNotMatch(run.stdout, /面板 · /, "DEED_NO_PANEL=1 时一条都不许起");
});