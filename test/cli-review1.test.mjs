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
  addTask, deliverTask, dropTask, writeLines, planFile, writePlan, readPlan, freshPlan,
} from "./support/cli.mjs";


test("delivery needs evidence, and the reviewer decides what counts", () => {
  const cwd = workspace("gates");
  deed(cwd, "init", "--said", "改重放函数");
  proof(cwd, "fold.mjs");
  assert.equal(addTask(cwd, "改重放函数", "同样的账本折出同样的文档").status, 0);
  // 勾上却没有写 交付：一行记录都没有，这条不算交付。
  const bare = deliverTask(cwd, "T1", "", { file: "fold.mjs" });
  assert.equal(bare.status, 1, "没有交付记录不算交付");
  assert.match(bare.stderr, /没有写一行 交付/, "拒的原因还是同一条：勾上了，但没有交付记录");
  assert.equal(deliverTask(cwd, "T1", "node --test 25/25", { file: "fold.mjs" }).status, 0);
  const blocked = signHere(cwd, "可以");
  assert.equal(blocked.status, 1, "碰了要审的路径就要审查");
  assert.match(blocked.stderr, /审查/);
  assert.equal(deed(cwd, "review").status, 0, "先发清单");
  const passed = deed(cwd, "review", "--verdict", "pass", "--result-all", "met");
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /交回给你判/, "审查通过只是把这一段交回来：关闭等你判");
  // 段判过之后这一期还要一次期审：那一步在判决之后，签收在期审之后。
  assert.equal(deed(cwd, "review", "--all").status, 1, "段还开着，期审还没到时候");
  assert.equal(judged(cwd, "review", "--all").status, 0);
  assert.equal(judged(cwd, "review", "--all", "--verdict", "pass").status, 0);
  assert.equal(signHere(cwd, "可以").status, 0);
});


// 签收只看各段的结论与条件：最后一段放行之后，下一步就是签收，整期上不再另审一遍。
// `deed review --all` 已经不是命令：那件事不存在了，开关也被拒。
test("the last segment closed is not the end: the period judgement comes before signing", () => {
  const cwd = workspace("two-segments-sign");
  deed(cwd, "init", "--said", "开始");
  proof(cwd, "a.mjs");
  addTask(cwd, "甲", "能跑");
  deliverTask(cwd, "T1", "node --test", { file: "a.mjs" });
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met").status, 0);
  const state1 = deed(cwd, "state");
  assert.match(state1.stdout, /下一步 · user · 判决/, "第一段审查通过了，轮到你判它");
  proof(cwd, "b.mjs");
  // 第一段还在等你判，新活先在清单里排到下一段；交付要等它判过、关闭。
  freshPlan(cwd);
  const draftLines = readPlan(cwd).replace(/\s*$/u, "").split("\n");
  const placeholder = draftLines.findIndex((one) => /^## （/u.test(one));
  writePlan(cwd, [...draftLines.slice(0, placeholder), "", "## ", "", "- ? 乙", "  标准：能跑"].join("\n") + "\n");
  assert.equal(deed(cwd, "submit").status, 0);
  assert.equal(judgeHere(cwd, "S01.1").status, 0);
  deliverTask(cwd, "T2", "node --test", { file: "b.mjs" });
  deed(cwd, "review", "--segment", "S01.2");
  assert.match(deed(cwd, "state").stdout, /S01\.2/, "判过之后第二段还开着，下一步在那一段上");
  assert.equal(deed(cwd, "review", "--segment", "S01.2", "--verdict", "pass", "--result-all", "met").status, 0);
  assert.equal(judgeHere(cwd, "S01.2").status, 0);
  const state2 = deed(cwd, "state");
  assert.match(state2.stdout, /下一步 · reviewer · 期审/, "两段都判过了，轮到这一期做成的样子");
  assert.match(signHere(cwd, "可以").stderr, /期审/, "期审没判过，签收挡着");
  assert.equal(judged(cwd, "review", "--all").status, 0, "--all 是期审的命令");
  assert.equal(judged(cwd, "review", "--all", "--verdict", "pass").status, 0);
  assert.equal(kinds(cwd).filter((one) => one === "review.brief").length, 3, "两段的清单 + 这一期的期审清单");
  assert.equal(signHere(cwd, "可以").status, 0, "期审过了，等你一句话");
});


test("handing the brief out is a fact, and a verdict answers that document", () => {
  const cwd = workspace("brief");
  deed(cwd, "init", "--said", "开始");
  proof(cwd, "serve.mjs");
  addTask(cwd, "写服务", "能推事件");
  deliverTask(cwd, "T1", "curl 200", { file: "serve.mjs" });
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
  assert.equal(out[0].guideDigest, undefined, "账本只记交出去的那两份文件，不再记指纹");
  assert.match(fs.readFileSync(path.join(cwd, ".deed", "review", pack), "utf8"), /不信交付记录，逐条复跑/);

  const text = fs.readFileSync(path.join(cwd, ".deed", "review", sheet), "utf8");
  assert.match(text, /- 标准：能推事件/u);
  assert.match(text, /- 交付†：curl 200/u, "没有可核的命令的交付带 †");
  assert.match(text, /deed review --segment S01\.1/, "清单自己说清怎么把结论写回来");
  // 没人回答的那份还在手上：再要一次只是把路径再报一遍，不是再写一份。
  const twice = deed(cwd, "review");
  assert.equal(twice.status, 0);
  assert.match(twice.stdout, /已经出过/);
  assert.equal(briefs(cwd).length, 2, "没答的那两份还在手上，不再写一份");
  assert.equal(readEvents(cwd).filter((one) => one.k === "review.brief").length, 1);
  assert.match(deed(cwd, "state").stdout, /落结论/, "下一步是结论，不是又一份清单");
  // 结论回答的是交出去的那份，现场不会再写一份。
  deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=unmet", "--rework", "T1", "--why", "没有并发记录", "--finding", "没有并发记录");
  const logged = readEvents(cwd).find((one) => one.k === "review.log");
  assert.equal(logged.verdict, "fail");
  assert.equal(logged.segment, "S01.1");
  assert.equal(logged.brief, ".deed/review/" + sheet);
  assert.equal(logged.briefDigest, undefined, "结论不再对清单的指纹");
  assert.deepEqual(logged.findings, ["没有并发记录"]);
  assert.deepEqual(logged.rework, ["T1"], "不合格点名要重做的那条");
  assert.equal(briefs(cwd).length, 2, "落结论不再现写一份");
});


// 出清单是账本事实：结论要能回答"读的是哪一份"，就只能在交出去过之后落。
test("a verdict needs a brief that was handed out first", () => {
  const cwd = workspace("no-brief");
  deed(cwd, "init", "--said", "开始");
  proof(cwd, "serve.mjs");
  addTask(cwd, "写服务", "能推事件");
  deliverTask(cwd, "T1", "curl 200", { file: "serve.mjs" });
  const early = deed(cwd, "review", "--verdict", "pass", "--result-all", "met");
  assert.equal(early.status, 1, "没交出去过，就没有可回答的那一份");
  assert.match(early.stderr, /还没有清单/);
  assert.equal(briefs(cwd).length, 0, "被拒的结论不留草稿");
});








test("signing needs a judgement and the user own words", () => {
  const cwd = workspace("sign");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**");
  assert.equal(signHere(cwd, "可以").status, 1, "什么都没交付不能签收");
  addTask(cwd, "写文档", "读完能上手");
  deliverTask(cwd, "T1", "写完了", { file: "docs/a.md" });
  assert.equal(signHere(cwd, "可以").status, 1, "段还没封");
  deed(cwd, "review", "--skip", "--why", "只改了文档，审查设置说不用审");
  judged(cwd, "review", "--all");
  assert.equal(judged(cwd, "review", "--all", "--verdict", "pass").status, 0);
  assert.equal(signHere(cwd, "").status, 1, "签收要留原话");
  assert.equal(signHere(cwd, "可以，就这样", { title: "上手" }).status, 0);
  const signed = readEvents(cwd).find((one) => one.k === "sign");
  assert.equal(signed.words, "可以，就这样");
  assert.equal(signed.title, "上手");
});


// 人的动作不走命令行：封存、判决、签收里只有封存是 agent 的活，另外两个在面板上。
// 账本按通道记，不靠自报名字。
test("sealing is the agent's act, and signing is not on the command line at all", () => {
  const cwd = workspace("name-it");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**");
  addTask(cwd, "写文档", "读完能上手");
  deliverTask(cwd, "T1", "写完了", { file: "docs/a.md" });
  assert.equal(deed(cwd, "review", "--skip", "--why", "只改了文档").status, 0, "封存是 agent 的结论，不需要报名");
  assert.equal(judged(cwd, "review", "--all").status, 0);
  assert.equal(judged(cwd, "review", "--all", "--verdict", "pass").status, 0);
  const typed = deed(cwd, "sign", "--words", "可以");
  assert.equal(typed.status, 1, "签收只在面板上");
  assert.match(typed.stderr, /面板/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "sign").length, 0, "被拒的签收一行都不落");
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
  const passed = deed(cwd, "check", "--gates", "commit");
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(fs.readFileSync(path.join(cwd, "mark.txt"), "utf8"), "ran");
  const failed = deed(cwd, "check", "--gates");
  assert.equal(failed.status, 1, "第二条命令失败就要停");
  assert.match(failed.stderr, /门 check 没过/);
});


test("a workspace with no declared gates says so, instead of blaming a gate", () => {
  const cwd = workspace("gate-empty");
  deed(cwd, "init", "--said", "开始");
  const run = deed(cwd, "check", "--gates");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /这个工作区没有门/);
});


test("a gate is a ledger fact: writing it in the file and not recording it runs nothing", () => {
  const cwd = workspace("config-gate");
  deed(cwd, "init", "--said", "开始");
  const configFile = path.join(cwd, ".deed", "config.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  config.gates = { commit: [process.execPath + ' -e "require(\'fs\').writeFileSync(\'mark.txt\',\'ran\')"'] };
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  const silent = deed(cwd, "check", "--gates");
  assert.equal(silent.status, 1, "文件里的门还没记账");
  assert.match(silent.stderr, /没有门/);
  assert.equal(deed(cwd, "init", "--force", "--why", "加一道提交门").status, 0);
  assert.equal(deed(cwd, "check", "--gates").status, 0);
  assert.equal(fs.readFileSync(path.join(cwd, "mark.txt"), "utf8"), "ran");
});


// 被点名的活改主意不做了，交付就没有可结清的东西：结论落得下来，但它必须说出这件事。
test("a named entry that was given up settles, and the verdict says so", () => {
  const cwd = workspace("verdict-dropped");
  deed(cwd, "init", "--said", "改重放函数");
  proof(cwd, "fold.mjs");
  addTask(cwd, "改重放", "同账本同文档");
  deliverTask(cwd, "T1", "node --test", { file: "fold.mjs" });
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=unmet", "--rework", "T1", "--why", "没有并发记录").status, 0);
  assert.equal(dropTask(cwd, "T1", "这一期不做了：重放改到下一期").status, 0);
  const step = deed(cwd, "state");
  assert.match(step.stdout, /它们改主意不做了/, "放弃已结清，下一步该是落结论");
  assert.match(step.stdout, /deed review --segment S01\.1/, "下一步指向审查者的 pass，不是推翻");
  deed(cwd, "review", "--segment", "S01.1");
  const after = deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met");
  assert.equal(after.status, 0, after.stderr);
  assert.match(after.stdout, /被点名但已放弃 · T1 · 这一期不做了/);
  assert.match(after.stdout, /交回给你判/);
  const logged = readEvents(cwd).find((one) => one.k === "review.log" && one.verdict === "pass");
  assert.deepEqual(logged.gaveUp, [{ id: "T1", why: "这一期不做了：重放改到下一期" }], "放弃与理由要进账本：只印在终端里，读账本的人看不到");
  const sheet = fs.readFileSync(path.join(cwd, logged.brief), "utf8");
  assert.match(sheet, /- 放弃：这一期不做了/, "审查者手上那份要看得出为什么放弃");
});


test("a verdict cannot answer work that has not been delivered yet", () => {
  const cwd = workspace("verdict-early");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "写服务", "能推事件");
  addTask(cwd, "写页面", "看得懂");
  deliverTask(cwd, "T1", "curl 200", { file: "core/serve.mjs" });
  const before = briefs(cwd).length;
  const early = deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met");
  assert.equal(early.status, 1, "还有一条没交付，结论没有对象");
  assert.match(early.stderr, /没交付|交付之后/);
  assert.equal(briefs(cwd).length, before, "被拒的结论不留清单：没人会读的草稿不该躺在磁盘上");
});








test("a pass seals the segment, so later work opens a new one instead of making that conclusion stale", () => {
  const cwd = workspace("verdict-stale");
  deed(cwd, "init", "--said", "开始");
  proof(cwd, "replay.mjs");
  addTask(cwd, "改重放", "同账本同文档");
  deliverTask(cwd, "T1", "node --test", { file: "replay.mjs" });
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met").status, 0);
  assert.match(deed(cwd, "state").stdout, /判决/, "审查通过之后轮到你判");
  assert.equal(judgeHere(cwd, "S01.1").status, 0);
  const sealed = deed(cwd, "state");
  assert.match(sealed.stdout, /签收/, "判过这一段之后下一步就是签收");
  assert.doesNotMatch(sealed.stdout, /结论过期/);
  // 封了段之后再想起一件事：新任务开出 S01.2，上一段的结论不会因此变旧。
  // 这一段判过、已经关闭：新活写在空标题的 ## 段里，submit 时领号。
  freshPlan(cwd);
  const laterLines = readPlan(cwd).replace(/\s*$/u, "").split("\n");
  const laterAt = laterLines.findIndex((one) => /^## （/u.test(one));
  writePlan(cwd, [...laterLines.slice(0, laterAt), "", "## ", "", "- ? 再改一处", "  标准：还是一样"].join("\n") + "\n");
  assert.equal(deed(cwd, "submit").status, 0);
  assert.equal(deliverTask(cwd, "T2", "又跑一遍", { file: "core/fold.mjs" }).status, 0);
  const state = deed(cwd, "state");
  assert.match(state.stdout, /S01\.2/, "后来的事落在新的一段");
  assert.doesNotMatch(state.stdout, /结论过期/, "S01.1 的结论回答的是它自己那几条，不会因为后来的事变旧");
  const sign = signHere(cwd, "可以");
  assert.equal(sign.status, 1, "新的一段还没审，签收就还差一步");
  assert.match(sign.stderr, /S01\.2/);
});


// 推翻这个动作已经不收了（含义第 22 版）：旧账本里那一行照读成历史，命令面再也写不出来。
test("an overturned conclusion written into an old ledger still reads, and nothing writes one", () => {
  const cwd = workspace("rework-void");
  deed(cwd, "init", "--said", "开始");
  proof(cwd, "replay.mjs");
  addTask(cwd, "改重放", "同账本同文档");
  deliverTask(cwd, "T1", "node --test", { file: "replay.mjs" });
  deed(cwd, "review", "--segment", "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met").status, 0);
  assert.match(deed(cwd, "state").stdout, /判决/, "审查通过之后先等判决");
  // 手工把一行旧事件写进账本：那时这条动作还在。
  const logDir = path.join(cwd, ".deed", "log");
  const name = fs.readdirSync(logDir).find((one) => one.endsWith(".jsonl"));
  const file = path.join(logDir, name);
  const old = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const last = JSON.parse(old.at(-1));
  old.push(JSON.stringify({ v: 4, at: new Date(Date.now() + 1000).toISOString(), k: "review.overturn", s: "S01", review: "R1", why: "旧账本里那一行", by: "user" }));
  fs.writeFileSync(file, old.join("\n") + "\n");
  const review = fold(readEvents(cwd)).sessions[0].reviews[0];
  assert.equal(review.voidedAt !== null, true, "作废的那条留着，只是不再算");
  assert.match(deed(cwd, "state").stdout, /deed review --segment S01\.1/, "这一段回到要审");
  const blocked = signHere(cwd, "可以");
  assert.equal(blocked.status, 1, "没有在案的结论不能签收");
  assert.match(blocked.stderr, /S01\.1/);
  // 命令面没有这条路：写一条新的会被账本拒。
  assert.equal(deed(cwd, "judge", "--overturn", "R1", "--why", "再来一次").status, 1);
  assert.equal(readEvents(cwd).filter((one) => one.k === "review.overturn").length, 1, "没有第二条");
  assert.ok(last);
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
  const gate = deed(cwd, "check", "--gates");
  assert.equal(gate.status, 1);
  assert.match(gate.stderr, /退出码 3/);
});

// 角色包是审查者唯一的规矩来源：它说"怎么动手"的那几句要有用例盯着。
// 少一句就红——审查者没人可问，缺一条他就得自己猜边界。
test("the reviewer pack says how to work: experiments outside, zero change inside", () => {
  const cwd = workspace("guide-how-to-work");
  deed(cwd, "init", "--said", "开始", "--review", "core/**");
  addTask(cwd, "改一条判断", "同样的账本折出同样的文档");
  assert.equal(deliverTask(cwd, "T1", "跑：跑得通").status, 0);
  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0);
  const dir = path.join(cwd, ".deed", "review");
  const pack = fs
    .readdirSync(dir)
    .filter((one) => one.endsWith("-reviewer.md"))
    .map((one) => fs.readFileSync(path.join(dir, one), "utf8"))
    .at(-1);
  for (const line of [
    "## 你怎么动手",
    "可以跑任何命令",
    "把整个工作区复制到临时区做破坏性实验",
    "仓库里的东西一个字节都别动",
    "别改账本",
    "别替作者修",
    "每条结论与发现都要配复现路径",
  ])
    assert.ok(pack.includes(line), "角色包里少了这一句：" + line);
});
