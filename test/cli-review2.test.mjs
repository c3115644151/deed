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


// 身份是自述：账本剩不下"两个不同的人"这层保证，能查的只有"同一只手"。
test("the hand that delivered a segment cannot write its verdict", () => {
  const cwd = workspace("self-review");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "改重放", "--criteria", "总账能重放", "--files", "core/fold.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "跑了 16 条", "--by", "agent");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa").status, 0, "先把清单交出去");
  const self = deed(cwd, "review", "--segment", "S01.1", "--by", "agent", "--verdict", "pass", "--result-all", "met");
  assert.equal(self.status, 1, "交付者不能判自己交付的段");
  assert.match(self.stderr, /同一个人不能判自己交付的段/);
  assert.equal(kinds(cwd).filter((one) => one === "review.log").length, 0, "被拒的结论不进账本");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass", "--result-all", "met").status, 0);
});


// 3) a fail verdict asks for a rework, not for a pass
test("a failed review hands the named work back, and nobody is asked to sign off on it", () => {
  const cwd = workspace("fail-next");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "先交一条", "--criteria", "交了就成", "--files", "proof.txt");
  const pinned = proof(cwd);
  deed(cwd, "task", "done", "T1", "--evidence", "交了", "--digest", pinned);
  const brief = deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  assert.equal(brief.status, 0);
  const log = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "fail", "--rework", "T1", "--why", "交付记录只说了半句", "--finding", "依据只说了半句");
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
  const first = deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  assert.equal(first.status, 0);

  // 清单发出去了还在等结论：这一段不再收新活，新条目自己落到下一段——
  // 旧清单没被这一条顶掉，这一段从发出去到现在确实没变过。
  deed(cwd, "task", "add", "又想起一条", "--criteria", "也得做到", "--files", "proof.txt");
  const session = fold(readEvents(cwd)).sessions[0];
  assert.equal(session.tasks.find((one) => one.id === "T2").segment, "S01.2", "送审之后的新活开下一段");
  assert.equal(session.segments[0].closedAt, null, "等结论的那一段没被封：它只是不再收东西");

  const pass = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass", "--result-all", "met");
  assert.equal(pass.status, 0, pass.stderr);
  assert.match(pass.stdout, /交回给你判/);

  deed(cwd, "task", "done", "T2", "--evidence", "也做了", "--digest", pinned);
  assert.equal(deed(cwd, "review", "--segment", "S01.2", "--by", "qa").status, 0);
  // 清单发出去之后这一段冻结：再交一遍会被拒——要改，先撤回这份清单。
  const frozen = deed(cwd, "task", "done", "T2", "--evidence", "又做了一遍", "--digest", pinned);
  assert.equal(frozen.status, 1, "在审的段落不能交付");
  assert.match(frozen.stderr, /在审/, "拒的时候说清是冻结");
  assert.equal(deed(cwd, "review", "--segment", "S01.2", "--withdraw", "--why", "要按新的一版重交", "--by", "agent").status, 0);
  assert.equal(deed(cwd, "task", "done", "T2", "--evidence", "又做了一遍", "--digest", pinned).status, 0, "撤回之后这一段回到执行态");
  assert.equal(deed(cwd, "review", "--segment", "S01.2", "--by", "qa").status, 0, "撤回之后要重出一份清单");
  const older = deed(cwd, "review", "--segment", "S01.2", "--by", "qa", "--verdict", "fail", "--rework", "T2", "--why", "再看法");
  assert.equal(older.status, 0, older.stdout + older.stderr);
});


// 结论按条落下：pass 要这一段每条都判过；判过又没变的条目，下一份清单不再要人重判。
test("a verdict is per item, and the next brief stops asking for ones already judged", () => {
  const cwd = workspace("per-item");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "甲", "--criteria", "能跑", "--files", "a.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test 1/1");
  deed(cwd, "task", "add", "乙", "--criteria", "能跑", "--files", "b.mjs");
  deed(cwd, "task", "done", "T2", "--evidence", "node --test 2/2");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa").status, 0);

  const bare = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass");
  assert.equal(bare.status, 1, "一条都没判就 pass，等于替审查者签字");
  assert.match(bare.stderr, /pass 要每条都判过/, "缺了哪几条要说出来");
  assert.match(bare.stderr, /T1、T2/);

  const half = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass", "--result", "T1=met");
  assert.equal(half.status, 1, "只判一条也不行");
  assert.match(half.stderr, /T2 还没有判定/);

  // 一条达成、一条没达成：结论带 results，打回点名没达成的那条。
  const failed = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "fail", "--result", "T1=met", "--result", "T2=unmet:跑不起来", "--rework", "T2", "--why", "第二条不行");
  assert.equal(failed.status, 0, failed.stdout + failed.stderr);
  const ledger = readEvents(cwd).find((one) => one.k === "review.log");
  assert.deepEqual(ledger.results.map((one) => one.id + "=" + one.verdict), ["T1=met", "T2=unmet"], "账本上按条落下");
  assert.match(ledger.results[0].files[0].digest, /^[0-9a-f]{64}$/, "每条判定带着它判的那份字节");

  // 补完被点名的那条，再出清单：判过又没变的 T1 不再要人重判。
  deed(cwd, "task", "done", "T2", "--evidence", "node --test 3/3");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa").status, 0);
  const sheet = briefs(cwd)
    .filter((one) => !one.endsWith("-reviewer.md"))
    .map((one) => ({ one, at: fs.statSync(path.join(cwd, ".deed", "review", one)).mtimeMs }))
    .sort((a, b) => a.at - b.at)
    .pop().one;
  const text = fs.readFileSync(path.join(cwd, ".deed", "review", sheet), "utf8");
  assert.match(text, /## 判过了、这次不再判/, "判过的条目不再占审查者的时间");
  assert.match(text, /- T1 · 达成/);
  assert.doesNotMatch(text.split("## 要审的任务")[1] ?? "", /T1 · 甲/, "要审的那一节里不再有它");
});


// 清单没被回答之前这一段冻结；撤回是唯一的出路，账本上留着谁、为什么。
test("a frozen segment refuses work until the brief is withdrawn, and the withdrawal is recorded", () => {
  const cwd = workspace("frozen");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "甲", "--criteria", "能跑", "--files", "a.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test 1/1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa").status, 0);

  for (const [what, args] of [
    ["交付", ["task", "done", "T1", "--evidence", "又跑了一遍"]],
    ["撤回交付", ["task", "undo", "T1", "--why", "说错了话"]],
  ]) {
    const refused = deed(cwd, ...args);
    assert.equal(refused.status, 1, what + "在冻结的段里不该被收下");
    assert.match(refused.stderr, /在审/, what + "要说出冻结这件事");
  }
  // 冻结挡的是文件改动：记录层面的交互照旧——记轮次、写题、放弃一条。
  assert.equal(deed(cwd, "tick", "--who", "user", "--said", "再看看").status, 0, "记轮次不受冻结影响");
  assert.equal(deed(cwd, "ask", "要不要换做法", "--reading", "换成另一种", "--why", "拿不准").status, 0, "写题不受冻结影响");
  assert.equal(deed(cwd, "task", "add", "又想起一条", "--criteria", "也行").status, 0, "新活不进冻结的段");
  assert.equal(deed(cwd, "task", "drop", "T2", "--why", "不做了").status, 0, "放弃是记录，不是换字节");
  assert.equal(fold(readEvents(cwd)).sessions[0].tasks.find((one) => one.id === "T2").segment, "S01.2");

  const left = deed(cwd, "review", "--segment", "S01.1", "--withdraw", "--why", "要按新的一版重交");
  assert.equal(left.status, 1, "撤回也要写清谁撤的");
  assert.match(left.stderr, /--by/);
  const done_ = deed(cwd, "review", "--segment", "S01.1", "--withdraw", "--why", "要按新的一版重交", "--by", "agent");
  assert.equal(done_.status, 0, done_.stdout + done_.stderr);
  assert.match(done_.stdout, /撤回清单 · S01\.1/);
  const told = readEvents(cwd).find((one) => one.k === "review.withdraw");
  assert.equal(told.why, "要按新的一版重交", "撤回的理由留在账本上");
  assert.equal(told.by, "agent");
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "又跑了一遍").status, 0, "撤回之后这一段回到执行态");
});


test("a brief handed out before the ledger moved is replaced, not answered", () => {
  const cwd = workspace("brief-moved");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "先说一句要做的事", "--criteria", "做完了", "--files", "proof.txt");
  const pinned = proof(cwd);
  deed(cwd, "task", "done", "T1", "--evidence", "第一次交付", "--digest", pinned);

  const first = deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  assert.equal(first.status, 0, first.stderr);
  const seen = new Set(briefs(cwd));
  const again = deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  assert.match(again.stdout, /已经出过，等结论落盘/, "账本没动时，同一份清单就继续等结论");

  // 清单在等结论时这一段是冻结的：撤回一条交付会被拒——要改就先撤回清单。
  const blocked = deed(cwd, "task", "undo", "T1", "--why", "那条交付说错了话");
  assert.equal(blocked.status, 1, "在审的段落不能改");
  assert.match(blocked.stderr, /在审/);
  assert.equal(deed(cwd, "review", "--withdraw", "--why", "要按新的一版重交", "--by", "agent").status, 0);
  deed(cwd, "task", "undo", "T1", "--why", "那条交付说错了话");
  deed(cwd, "task", "done", "T1", "--evidence", "第二次交付", "--digest", pinned);
  const third = deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  assert.match(third.stdout, /第 2 份/, "撤回之后重出，是这一段的第二份");
  const fresh = briefs(cwd).filter((one) => !seen.has(one));
  assert.equal(fresh.length, 2, "只该多出一对：清单与角色包");
  const sheet = fresh.find((one) => !one.endsWith("-reviewer.md"));
  const text = fs.readFileSync(path.join(cwd, ".deed", "review", sheet), "utf8");
  assert.match(text, /第二次交付/);
  assert.match(text, /撤回的交付：那条交付说错了话/);
});


test("a review may carry more than one finding, and all of them land", () => {
  const cwd = workspace("many-findings");
  const pin = proof(cwd);
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "改文件", "--criteria", "改完", "--files", "core/a.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "改完", "--digest", pin);
  deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  const one = deed(
    cwd,
    "review",
    "--segment",
    "S01.1",
    "--by",
    "qa",
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




test("a pass names the segment it sealed, and the next step is the signature", () => {
  const cwd = workspace("seal");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "交一条", "--criteria", "交了", "--files", "proof.txt");
  deed(cwd, "task", "done", "T1", "--evidence", "交了");
  deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  const pass = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass", "--result-all", "met");
  assert.match(pass.stdout, /S01\.1 .*交回给你判/);
  const state = deed(cwd, "state");
  assert.equal(state.status, 0);
  assert.match(state.stdout, /判决/, "审查通过之后轮到人判，不是签收");
  assert.doesNotMatch(state.stdout, /deed judge --pass/);
  const again = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "fail", "--rework", "T1", "--why", "再看");
  assert.equal(again.status, 1, "结论落过、在等判决的段不能再落一份");
  assert.match(again.stderr, /等你判决/);
});

// 规模规则得在真工作区里说得通：一次只碰两份小文档的交付免审，一份大文档就要审。

test("a delivery weighs what it moved, and a big change asks for a review", () => {
  const cwd = workspace("weigh");
  deed(cwd, "init", "--said", "开始");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a");
  fs.writeFileSync(path.join(cwd, "proof.txt"), "proof");
  assert.equal(deed(cwd, "task", "add", "写两份小文档", "--criteria", "两份都在", "--files", "docs/a.md").status, 0);
  deed(cwd, "task", "done", "T1", "--evidence", "写下 docs/a.md");
  const weighed = readEvents(cwd).find((one) => one.k === "task.done");
  assert.equal(typeof weighed.bytes, "object", "交付那一刻称过字节");
  assert.equal(weighed.bytes["docs/a.md"], 1, "1 个字节的文档");
  assert.ok(fs.statSync(path.join(cwd, "docs", "a.md")).size === 1);
  // 一份 30KB 的文档照样只是文档，但它不再是"小改动"。
  fs.writeFileSync(path.join(cwd, "docs", "b.md"), "x".repeat(30000));
  deed(cwd, "task", "add", "拷一份大文档", "--criteria", "在那儿", "--files", "docs/b.md");
  deed(cwd, "task", "done", "T2", "--evidence", "拷进 docs/b.md");
  const state = deed(cwd, "state");
  assert.match(state.stdout, /T2|要审/, "大改动让这一段要审");
});


// 两段都由 deed seal 关的期：没人需要写的东西，不该有人等到它——直接签收。
test("a period whose segments all sat out review signs without anything else", () => {
  const cwd = workspace("all-exempt-sign");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**,*.md");
  deed(cwd, "tick", "--who", "user", "--said", "改两份文档");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a", "utf8");
  deed(cwd, "task", "add", "改 a", "--criteria", "docs/a.md 有一句话");
  deed(cwd, "task", "done", "T1", "--evidence", "改好 docs/a.md");
  assert.equal(deed(cwd, "seal", "--segment", "S01.1", "--why", "只改文档", "--by", "agent").status, 0);
  fs.writeFileSync(path.join(cwd, "docs", "b.md"), "b", "utf8");
  deed(cwd, "task", "add", "改 b", "--criteria", "docs/b.md 有一句话");
  deed(cwd, "task", "done", "T2", "--evidence", "改好 docs/b.md");
  assert.equal(deed(cwd, "seal", "--segment", "S01.2", "--why", "只改文档", "--by", "agent").status, 0);
  // 两段都免审也得有人判这一期：段没人看过，不等于这一期做成的样子不用人看。
  assert.match(deed(cwd, "state").stdout, /下一步 · reviewer · 期审/);
  assert.equal(judged(cwd, "review", "--all", "--by", "period-1").status, 0);
  assert.equal(judged(cwd, "review", "--all", "--by", "period-1", "--verdict", "pass").status, 0);
  assert.match(deed(cwd, "state").stdout, /下一步 · user · 签收/);
  const signed = signHere(cwd, "可以");
  assert.equal(signed.status, 0, signed.stderr);
  assert.match(signed.stdout, /没经过审查 · S01.1/, "没人看过的段在签收这一刻摊开说");
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
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "node -e 读过").status, 0);
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
  deed(cwd, "task", "done", "T1", "--evidence", "node --test 1/1");
  assert.match(deed(cwd, "review", "--segment", "S01.1", "--by", "qa").stdout, /S01\.1 的第 1 份/);
  // 这一段在等结论时冻结：要改这一段的活，先撤回手上那份清单，再重出一份。
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--withdraw", "--why", "要交新的一版", "--by", "agent").status, 0);
  deed(cwd, "task", "done", "T1", "--evidence", "node --test 2/2");
  const second = deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  assert.match(second.stdout, /S01\.1 的第 2 份/);
  assert.doesNotMatch(second.stdout, /先看上一份/, "第二份还用不着提醒");
  // 慢要看得见：这一段出过几份清单，state 直接摆出来，不挡任何一步。
  assert.match(deed(cwd, "state").stdout, /花了 · 2 份清单/);
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--withdraw", "--why", "还有一版", "--by", "agent").status, 0);
  deed(cwd, "task", "done", "T1", "--evidence", "node --test 3/3");
  const third = deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  assert.match(third.stdout, /S01\.1 的第 3 份/);
  assert.match(third.stdout, /先看上一份的审查者点了哪几条/);
});


// 没人审过的段不是被静默放过：签收那一刻，它和「凭什么不审」一起摊在眼前。
test("a segment nobody reviewed says at signing why it was not reviewed", () => {
  const cwd = workspace("seal-why");
  deed(cwd, "init", "--said", "把文档写完", "--exempt", "docs/**");
  deed(cwd, "goal", "把文档写完", "--by", "user");
  deed(cwd, "task", "add", "写文档", "--criteria", "读完能上手", "--files", "docs/a.md");
  deed(cwd, "task", "done", "T1", "--evidence", "写完了");
  assert.equal(deed(cwd, "seal", "--why", "只改了文档，审查设置说不用审", "--by", "agent").status, 0);
  // 段都关了：这一期做成的样子还要有人判，签收压在期审后面。
  assert.equal(judged(cwd, "review", "--all", "--by", "period-1").status, 0, "期审清单出得来");
  assert.equal(judged(cwd, "review", "--all", "--by", "period-1", "--verdict", "pass").status, 0, "期审要落得下结论");
  const signed = signHere(cwd, "可以");
  assert.equal(signed.status, 0, signed.stderr);
  assert.match(signed.stdout, /没经过审查 · S01\.1（只改了文档，审查设置说不用审）/, "理由不能印成空括号");
});


// 段审一直用同一双手：清单交给谁，这一段的清单与结论都归他；期审反过来，每次都换一双手。
test("one segment keeps one hand, and the period review takes a fresh one", () => {
  const cwd = workspace("review-hands");
  deed(cwd, "init", "--said", "开始", "--review", "core/**");
  fs.mkdirSync(path.join(cwd, "core"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "core", "a.mjs"), "x\n");
  deed(cwd, "task", "add", "写一处实现", "--criteria", "文件在", "--files", "core/a.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "写了 core/a.mjs");

  const first = deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /交给 qa/, "清单要写明交给谁");
  const otherHand = deed(cwd, "review", "--segment", "S01.1", "--by", "qb");
  assert.equal(otherHand.status, 1, "这一段已经交给 qa：再出清单不能换人");
  assert.match(otherHand.stderr, /段审一直用同一双手/);
  const otherVerdict = deed(cwd, "review", "--segment", "S01.1", "--by", "qb", "--verdict", "pass", "--result-all", "met");
  assert.equal(otherVerdict.status, 1, "结论也要由那一双手落");
  assert.match(otherVerdict.stderr, /这一段是交给 qa 判的/);
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass", "--result-all", "met").status, 0);

  const byJudge = judged(cwd, "review", "--all", "--by", "qa");
  assert.equal(byJudge.status, 1, "判过段的人不判这一期");
  assert.match(byJudge.stderr, /期审换一双手/);
  const period = judged(cwd, "review", "--all", "--by", "period-1");
  assert.equal(period.status, 0, period.stderr);
  assert.match(period.stdout, /S01 的第 1 份/);
  assert.equal(judged(cwd, "review", "--all", "--by", "period-2", "--verdict", "pass").status, 1, "清单交给 period-1：结论不能换人落");
  assert.equal(judged(cwd, "review", "--all", "--by", "period-1", "--verdict", "pass").status, 0);
  assert.equal(signHere(cwd, "可以").status, 0, "期审过了才签得下来");
});


// 期审不合格点名的是段：那一段重新打开，条目保持交付；判它的人还是原来那一双手。
test("a period verdict that names a segment reopens it, and the same hand judges it again", () => {
  const cwd = workspace("period-fail");
  deed(cwd, "init", "--said", "开始", "--review", "core/**");
  fs.mkdirSync(path.join(cwd, "core"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "core", "a.mjs"), "a\n");
  fs.writeFileSync(path.join(cwd, "core", "b.mjs"), "b\n");
  deed(cwd, "task", "add", "写 a", "--criteria", "a 在", "--files", "core/a.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "写了 a");
  deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass", "--result-all", "met").status, 0);
  deed(cwd, "task", "add", "写 b", "--criteria", "b 在", "--files", "core/b.mjs");
  deed(cwd, "task", "done", "T2", "--evidence", "写了 b");
  deed(cwd, "review", "--segment", "S01.2", "--by", "qa");
  assert.equal(deed(cwd, "review", "--segment", "S01.2", "--by", "qa", "--verdict", "pass", "--result-all", "met").status, 0);

  judged(cwd, "review", "--all", "--by", "period-1");
  const failed = judged(cwd, "review", "--all", "--by", "period-1", "--verdict", "fail", "--rework", "S01.1", "--why", "这一段的结论没对上这一期");
  assert.equal(failed.status, 0, failed.stderr);
  const state = deed(cwd, "state");
  assert.match(state.stdout, /S01\.1[^\n]*开于/, "被点名的段重新打开");
  const blocked = signHere(cwd, "可以");
  assert.equal(blocked.status, 1, "还有段没被判过，签不下来");
  assert.match(deed(cwd, "review", "--segment", "S01.1", "--by", "qb").stderr, /段审一直用同一双手/, "那一段还是原来那双手");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa").status, 0);
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass", "--result-all", "met").status, 0);
  assert.equal(judged(cwd, "review", "--all", "--by", "period-2").status, 0, "期审每一次都是新的一双手");
  assert.equal(judged(cwd, "review", "--all", "--by", "period-2", "--verdict", "pass").status, 0);
  assert.equal(signHere(cwd, "可以").status, 0);
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
  deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  const brief = fs
    .readdirSync(path.join(cwd, ".deed", "review"))
    .filter((one) => !one.endsWith("-reviewer.md"))
    .map((one) => fs.readFileSync(path.join(cwd, ".deed", "review", one), "utf8"))
    .at(-1);
  // 没有命令核过的交付在清单上只算说法：审查者看得到它和「跑过」「核过」的区别
  assert.match(brief, /只是说法：这条没配命令核过/);
});


// 三条只有人能按的路不再从命令行走：它们只回一句指到面板的话，账本一个字不动。
test("the three human gates are not on the command line", () => {
  const cwd = workspace("gates-closed");
  deed(cwd, "init", "--said", "开始");
  const before = readEvents(cwd).length;
  const sign = deed(cwd, "sign", "--words", "可以");
  assert.equal(sign.status, 1);
  assert.match(sign.stderr, /面板/);
  const judge = deed(cwd, "judge", "--overturn", "R1", "--why", "不服");
  assert.equal(judge.status, 1, "推翻那个动作连动词都不在了");
  assert.match(judge.stderr, /没有这个动作/);
  const topic = deed(cwd, "topic", "release", "I1");
  assert.equal(topic.status, 1, "议题那一条连动词都还没有");
  assert.equal(readEvents(cwd).length, before, "三条路都不记账");
});


// 审查通过只是把这一段交回来：判决是用户按的第二道闸，按完这一段才关闭。
test("review passing hands the segment back, and only the user's judgement closes it", () => {
  const cwd = workspace("judgement");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "交一条", "--criteria", "交了", "--files", "proof.txt");
  deed(cwd, "task", "done", "T1", "--evidence", "交了");
  // 审查还没通过，判不得：判决在审查之后。
  const early = judgeHere(cwd, "S01.1");
  assert.equal(early.status, 1, "没有审查通过就没有可判的东西");
  assert.match(early.stderr, /审查通过/);
  deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass", "--result-all", "met").status, 0);
  const waiting = fold(readEvents(cwd)).sessions[0].segments[0];
  assert.equal(waiting.closedAt, null, "审查通过不等于这一段结束了");
  assert.equal(waiting.verdict, "pass");
  assert.equal(waiting.reviewedBy, "qa");
  // 签收闸挡着：这一段还没有人判。
  const blocked = gate(cwd, { action: "sign", words: "可以" });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /等你判决/);
  // 冻结照样：审查者判的是那份字节，人判之前又换掉它，判决就落在一份没人看过的内容上。
  const frozen = deed(cwd, "task", "done", "T1", "--evidence", "又改了一遍");
  assert.equal(frozen.status, 1);
  assert.match(frozen.stderr, /等你判决/);
  const judged_ = judgeHere(cwd, "S01.1");
  assert.equal(judged_.status, 0, judged_.stderr);
  const after = fold(readEvents(cwd)).sessions[0];
  assert.equal(after.segments[0].closedAt !== null, true, "判过之后这一段才是结局");
  assert.equal(after.segments[0].judgedBy, "user");
  assert.equal(after.tasks[0].status, "accepted");
  const row = readEvents(cwd).filter((one) => one.k === "verdict.pass").pop();
  assert.deepEqual([row.by, row.via, row.segment], ["user", "panel", "S01.1"], "账本读得出是谁在哪按的");
  assert.equal(judgeHere(cwd, "S01.1").status, 1, "判过的段不再判");
});
