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
import { EVENT_VERSION, validateEvent } from "../core/events/index.mjs";
import { panelRecord, buildNow, watchedFiles } from "../lib/panel.mjs";
import { applyGate, gatesOf } from "../board/gates.mjs";
import {
  CLI, OFF, deed, later, gate, judgeAll, judgeHere, signHere, judged, kinds, briefs, proof,
  freshPlan,

  addTask, deliverTask, undoDelivery, dropTask, writeLines, planFile, writePlan, readPlan,
  setGoal,startReview, startPeriodReview} from "./support/cli.mjs";


// 名字由通道决定：命令写的行是 agent 做的，命令行上没有名字可填；写下的名字不靠谁自报。
test("a verdict is written by the channel, and no name goes on the command line", () => {
  const cwd = workspace("name-not-a-flag");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "改重放", "总账能重放");
  deliverTask(cwd, "T1", "跑了 16 条", { file: "core/fold.mjs" });
  assert.equal(startReview(cwd, "S01.1").status, 0, "先把清单交出去");
  const named = deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met", "--by", "qa");
  assert.equal(named.status, 1, "命令面不再收名字");
  assert.match(named.stderr, /不认 --by/);
  assert.equal(kinds(cwd).filter((one) => one === "review.log").length, 0, "被拒的结论不进账本");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met").status, 0);
  const row = readEvents(cwd).filter((one) => one.k === "review.log").pop();
  assert.equal(row.by, "agent", "命令写下的那条结论按通道记成 agent 做的");
});


// 3) a fail verdict asks for a rework, not for a pass
test("a failed review hands the named work back, and nobody is asked to sign off on it", () => {
  const cwd = workspace("fail-next");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "先交一条", "交了就成");
  const pinned = proof(cwd);
  deliverTask(cwd, "T1", "交了", { file: "proof.txt" });
  const brief = startReview(cwd, "S01.1");
  assert.equal(brief.status, 0);
  const log = deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=unmet", "--rework", "T1", "--why", "交付记录只说了半句", "--finding", "依据只说了半句");
  assert.equal(log.status, 0, log.stderr);
  const state = deed(cwd, "state");
  assert.match(state.stdout, /deed submit/, "被点名的那条回到未做，下一步是在清单里再勾一次");
  assert.doesNotMatch(state.stdout, /deed judge --pass/, "结论是不合格，下一步不可能是放行");
});


// 4) a task added after the brief is handed out makes that paper old
test("new work waits for the verdict in the next segment, and a brief only ages when its own segment moves", () => {
  const cwd = workspace("brief-task-drift");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "第一条", "做到");
  const pinned = proof(cwd);
  deliverTask(cwd, "T1", "做了", { file: "proof.txt" });
  const first = startReview(cwd, "S01.1");
  assert.equal(first.status, 0);

  // 清单发出去了还在等结论：这一段不再收新活，新条目自己落到下一段——
  // 旧清单没被这一条顶掉，这一段从发出去到现在确实没变过。
  // 这一段已经送审：新活写在空标题的 ## 段里，submit 时领下一段的号。
  freshPlan(cwd);
  const briefLines = readPlan(cwd).replace(/\s*$/u, "").split("\n");
  const briefAt = briefLines.findIndex((one) => /^## （/u.test(one));
  writePlan(cwd, [...briefLines.slice(0, briefAt), "", "## ", "", "- ? 又想起一条", "  标准：也得做到"].join("\n") + "\n");
  assert.equal(deed(cwd, "submit").status, 0);
  const session = fold(readEvents(cwd)).sessions[0];
  assert.equal(session.tasks.find((one) => one.id === "T2").segment, "S01.2", "送审之后的新活开下一段");
  assert.equal(session.segments[0].closedAt, null, "等结论的那一段没被封：它只是不再收东西");

  const pass = deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met");
  assert.equal(pass.status, 0, pass.stderr);
  assert.match(pass.stdout, /交回给你判/);

  // 前一段判过、关闭之后，排在后面的那一段才收交付。
  assert.equal(judgeHere(cwd, "S01.1").status, 0);
  deliverTask(cwd, "T2", "也做了", { file: "proof.txt" });
  assert.equal(startReview(cwd, "S01.2").status, 0);
  // 清单发出去之后这一段冻结：再交一遍会被拒——要改，先撤回这份清单。
  // 这一段每条都已交付：勾上已交的条目在 submit 里不产生新的交付，
  // 拒的是"没有要落的改动"，不是"在审"；冻结对交付的拦截在这里量不到。
  const frozen = deliverTask(cwd, "T2", "又做了一遍", { file: "proof.txt" });
  assert.equal(frozen.status, 1, "在审的段落不能交付");
  assert.match(frozen.stderr, /在审/, "拒的时候说清是冻结");
  assert.equal(deed(cwd, "review", "--segment", "S01.2", "--withdraw", "--why", "要按新的一版重交").status, 0);
  // 已经交过的那条要再交一版：先取消勾选写理由，再勾上写新的交付。
  assert.equal(undoDelivery(cwd, "T2", "上一版作废，按新的一版重交").status, 0);
  assert.equal(deliverTask(cwd, "T2", "又做了一遍", { file: "proof.txt" }).status, 0, "撤回之后这一段回到执行态");
  assert.equal(startReview(cwd, "S01.2").status, 0, "撤回之后要重出一份清单");
  const older = deed(cwd, "review", "--segment", "S01.2", "--verdict", "fail", "--result", "T2=unmet", "--rework", "T2", "--why", "再看法");
  assert.equal(older.status, 0, older.stdout + older.stderr);
});


// 结论按条落下：pass 要这一段每条都判过；判过又没变的条目，下一份清单不再要人重判。
test("a verdict is per item, and the next brief stops asking for ones already judged", () => {
  const cwd = workspace("per-item");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "甲", "能跑");
  deliverTask(cwd, "T1", "node --test 1/1", { file: "a.mjs" });
  addTask(cwd, "乙", "能跑");
  deliverTask(cwd, "T2", "node --test 2/2", { file: "b.mjs" });
  assert.equal(startReview(cwd, "S01.1").status, 0);

  const bare = deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass");
  assert.equal(bare.status, 1, "一条都没判就 pass，等于替审查者签字");
  assert.match(bare.stderr, /pass 要每条都判过/, "缺了哪几条要说出来");
  assert.match(bare.stderr, /T1、T2/);

  const half = deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result", "T1=met");
  assert.equal(half.status, 1, "只判一条也不行");
  assert.match(half.stderr, /T2 还没有判定/);

  // 一条达成、一条没达成：结论带 results，打回点名没达成的那条。
  const failed = deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=met", "--result", "T2=unmet:跑不起来", "--rework", "T2", "--why", "第二条不行");
  assert.equal(failed.status, 0, failed.stdout + failed.stderr);
  const ledger = readEvents(cwd).find((one) => one.k === "review.log");
  assert.deepEqual(ledger.results.map((one) => one.id + "=" + one.verdict), ["T1=met", "T2=unmet"], "账本上按条落下");
  assert.equal(ledger.results[0].files, undefined, "每条判定只留结论，不再带字节");

  // 补完被点名的那条，再出清单：判过又没变的 T1 不再要人重判。
  deliverTask(cwd, "T2", "node --test 3/3", { file: "b.mjs" });
  assert.equal(startReview(cwd, "S01.1").status, 0);
  const sheet = briefs(cwd)
    .filter((one) => !one.endsWith("-reviewer.md"))
    .map((one) => ({ one, at: fs.statSync(path.join(cwd, ".deed", "review", one)).mtimeMs }))
    .sort((a, b) => a.at - b.at)
    .pop().one;
  const text = fs.readFileSync(path.join(cwd, ".deed", "review", sheet), "utf8");
  assert.doesNotMatch(text, /## 判过了、这次不再判/, "清单每次列全部条目，不再分「判过的」一节");
  assert.match(text.split("## 要审的任务")[1] ?? "", /T1/, "判过的条目也在这一份里：改过没有要人当场看");
});


// 清单没被回答之前这一段冻结；撤回是唯一的出路，账本上留着谁、为什么。
test("a frozen segment refuses work until the brief is withdrawn, and the withdrawal is recorded", () => {
  const cwd = workspace("frozen");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "甲", "能跑");
  deliverTask(cwd, "T1", "node --test 1/1", { file: "a.mjs" });
  assert.equal(startReview(cwd, "S01.1").status, 0);

  // 交付那条也走 deliverTask：这一段每条都已交付，submit 对已交条目不产生交付事件，
  // 拒的是"没有要落的改动"，不是"在审"；冻结对交付的拦截在这里量不到。
  for (const [what, attempt] of [
    ["交付", () => deliverTask(cwd, "T1", "又跑了一遍", { file: "a.mjs" })],
    ["撤回交付", () => undoDelivery(cwd, "T1", "说错了话")],
  ]) {
    const refused = attempt();
    assert.equal(refused.status, 1, what + "在冻结的段里不该被收下");
    assert.match(refused.stderr, /在审/, what + "要说出冻结这件事");
  }
  // 冻结挡的是文件改动：记录层面的交互照旧——记轮次、记要点、放弃一条。
  assert.equal(deed(cwd, "say", "再看看").status, 0, "记轮次不受冻结影响");
  assert.equal(deed(cwd, "point", "换一种做法，先记着").status, 0, "记要点不受冻结影响");
  // 新活不进冻结的段：清单里另开空标题的一节，submit 时领下一段的号。
  freshPlan(cwd);
  const frozenLines = readPlan(cwd).replace(/\s*$/u, "").split("\n");
  const frozenAt = frozenLines.findIndex((one) => /^## （/u.test(one));
  writePlan(cwd, [...frozenLines.slice(0, frozenAt), "", "## ", "", "- ? 又想起一条", "  标准：也行"].join("\n") + "\n");
  assert.equal(deed(cwd, "submit").status, 0, "新活不进冻结的段");
  assert.equal(dropTask(cwd, "T2", "不做了").status, 0, "放弃是记录，不是换字节");
  assert.equal(fold(readEvents(cwd)).sessions[0].tasks.find((one) => one.id === "T2").segment, "S01.2");

  const left = deed(cwd, "review", "--segment", "S01.1", "--withdraw");
  assert.equal(left.status, 1, "撤回要写清为什么");
  assert.match(left.stderr, /--why/);
  const done_ = deed(cwd, "review", "--segment", "S01.1", "--withdraw", "--why", "要按新的一版重交");
  assert.equal(done_.status, 0, done_.stdout + done_.stderr);
  assert.match(done_.stdout, /撤回清单 · S01\.1/);
  const told = readEvents(cwd).find((one) => one.k === "review.withdraw");
  assert.equal(told.why, "要按新的一版重交", "撤回的理由留在账本上");
  assert.equal(told.by, "agent");
  // 已交过的那条要再交一版：先取消勾选写理由，再勾上写新的交付。
  assert.equal(undoDelivery(cwd, "T1", "上一版作废，按新的一版重交").status, 0);
  assert.equal(deliverTask(cwd, "T1", "又跑了一遍", { file: "a.mjs" }).status, 0, "撤回之后这一段回到执行态");
});


test("a brief handed out before the ledger moved is replaced, not answered", () => {
  const cwd = workspace("brief-moved");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "先说一句要做的事", "做完了");
  const pinned = proof(cwd);
  deliverTask(cwd, "T1", "第一次交付", { file: "proof.txt" });

  const first = startReview(cwd, "S01.1");
  assert.equal(first.status, 0, first.stderr);
  const seen = new Set(briefs(cwd));
  const again = startReview(cwd, "S01.1");
  assert.match(again.stdout, /已经出过清单，正在判/, "账本没动时，同一份清单就继续等结论");

  // 清单在等结论时这一段是冻结的：撤回一条交付会被拒——要改就先撤回清单。
  const blocked = undoDelivery(cwd, "T1", "那条交付说错了话");
  assert.equal(blocked.status, 1, "在审的段落不能改");
  assert.match(blocked.stderr, /在审/);
  assert.equal(deed(cwd, "review", "--withdraw", "--why", "要按新的一版重交").status, 0);
  undoDelivery(cwd, "T1", "那条交付说错了话");
  deliverTask(cwd, "T1", "第二次交付", { file: "proof.txt" });
  const third = startReview(cwd, "S01.1");
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
  addTask(cwd, "改文件", "改完");
  deliverTask(cwd, "T1", "改完", { file: "core/a.mjs" });
  startReview(cwd, "S01.1");
  const one = deed(
    cwd,
    "review",
    "--segment",
    "S01.1",
    "--verdict", "fail", "--result", "T1=unmet", "--rework", "T1",
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
  const cwd = workspace("skip-seal");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "交一条", "交了");
  deliverTask(cwd, "T1", "交了", { file: "proof.txt" });
  startReview(cwd, "S01.1");
  const pass = deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met");
  assert.match(pass.stdout, /S01\.1 .*交回给你判/);
  const state = deed(cwd, "state");
  assert.equal(state.status, 0);
  assert.match(state.stdout, /判决/, "审查通过之后轮到人判，不是签收");
  assert.doesNotMatch(state.stdout, /deed judge --pass/);
  const again = deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=unmet", "--rework", "T1", "--why", "再看");
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
  assert.equal(addTask(cwd, "写两份小文档", "两份都在").status, 0);
  // 文件已经在盘上：这次交付量的是它，不替它写内容。
  deliverTask(cwd, "T1", "写下 docs/a.md", { file: "docs/a.md", keep: true });
  const weighed = readEvents(cwd).find((one) => one.k === "task.done");
  assert.equal(typeof weighed.bytes, "object", "交付那一刻称过字节");
  assert.equal(weighed.bytes["docs/a.md"], 1, "1 个字节的文档");
  assert.ok(fs.statSync(path.join(cwd, "docs", "a.md")).size === 1);
  // 一份 30KB 的文档照样只是文档，但它不再是"小改动"。
  fs.writeFileSync(path.join(cwd, "docs", "b.md"), "x".repeat(30000));
  addTask(cwd, "拷一份大文档", "在那儿");
  deliverTask(cwd, "T2", "拷进 docs/b.md", { file: "docs/b.md", keep: true });
  const state = deed(cwd, "state");
  assert.match(state.stdout, /T2|要审/, "大改动让这一段要审");
});


// 两段都由 deed review --skip 关的期：没人需要写的东西，不该有人等到它——直接签收。
test("a period whose segments all sat out review signs without anything else", () => {
  const cwd = workspace("all-exempt-sign");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**,*.md");
  deed(cwd, "say", "改两份文档");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a", "utf8");
  addTask(cwd, "改 a", "docs/a.md 有一句话");
  deliverTask(cwd, "T1", "改好 docs/a.md", { file: "docs/a.md" });
  assert.equal(deed(cwd, "review", "--skip", "--segment", "S01.1", "--why", "只改文档").status, 0);
  fs.writeFileSync(path.join(cwd, "docs", "b.md"), "b", "utf8");
  // S01.1 已经封存关闭：新活写在空标题的 ## 段里，submit 时领 S01.2。
  freshPlan(cwd);
  const exemptLines = readPlan(cwd).replace(/\s*$/u, "").split("\n");
  const exemptAt = exemptLines.findIndex((one) => /^## （/u.test(one));
  writePlan(cwd, [...exemptLines.slice(0, exemptAt), "", "## ", "", "- ? 改 b", "  标准：docs/b.md 有一句话"].join("\n") + "\n");
  assert.equal(deed(cwd, "submit").status, 0);
  deliverTask(cwd, "T2", "改好 docs/b.md", { file: "docs/b.md" });
  assert.equal(deed(cwd, "review", "--skip", "--segment", "S01.2", "--why", "只改文档").status, 0);
  // 两段都免审也得有人判这一期：段没人看过，不等于这一期做成的样子不用人看。
  assert.match(deed(cwd, "state").stdout, /下一步 · user · 开始期审/);
  assert.equal(startPeriodReview(cwd).status, 0);
  assert.equal(judged(cwd, "review", "--all", "--verdict", "pass").status, 0);
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
  assert.equal(addTask(cwd, "改服务端", "端口能读").status, 0);
  assert.equal(deliverTask(cwd, "T1", "node -e 读过", { file: "app/server.mjs" }).status, 0);
  assert.match(deed(cwd, "state").stdout, /开始审查/, "没人声明过的路径照样要审：面板上按下去才出清单");
  assert.equal(deed(cwd, "init", "--force", "--exempt", "app/**", "--why", "服务端不在审查范围").status, 0);
  const sealed = deed(cwd, "review", "--skip", "--why", "app 全部免审");
  assert.equal(sealed.status, 0, sealed.stderr);
  assert.match(sealed.stdout, /封存/, "工作区自己声明之后才算免审");
});


test("the second and third brief of one segment say how many there have been", () => {
  const cwd = workspace("brief-nth");
  deed(cwd, "init", "--said", "开始");
  proof(cwd, "a.mjs");
  addTask(cwd, "甲", "能跑");
  deliverTask(cwd, "T1", "node --test 1/1", { file: "a.mjs" });
  assert.match(startReview(cwd, "S01.1").stdout, /S01\.1 的第 1 份/);
  // 这一段在等结论时冻结：要改这一段的活，先撤回手上那份清单，再重出一份。
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--withdraw", "--why", "要交新的一版").status, 0);
  undoDelivery(cwd, "T1", "上一版作废，要交新的一版");
  deliverTask(cwd, "T1", "node --test 2/2", { file: "a.mjs" });
  const second = startReview(cwd, "S01.1");
  assert.match(second.stdout, /S01\.1 的第 2 份/);
  assert.doesNotMatch(second.stdout, /先看上一份/, "第二份还用不着提醒");
  // 每段花了多少不进门也不上屏：它一次也没改变过做法，就删了。
  assert.doesNotMatch(deed(cwd, "state").stdout, /花了 ·/);
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--withdraw", "--why", "还有一版").status, 0);
  undoDelivery(cwd, "T1", "上一版作废，还有一版");
  deliverTask(cwd, "T1", "node --test 3/3", { file: "a.mjs" });
  const third = startReview(cwd, "S01.1");
  assert.match(third.stdout, /S01\.1 的第 3 份/);
  assert.match(third.stdout, /先看上一份的审查者点了哪几条/);
});


// 没人审过的段不是被静默放过：签收那一刻，它和「凭什么不审」一起摊在眼前。
test("a segment nobody reviewed says at signing why it was not reviewed", () => {
  const cwd = workspace("seal-why");
  deed(cwd, "init", "--said", "把文档写完", "--exempt", "docs/**");
  setGoal(cwd, "把文档写完");
  addTask(cwd, "写文档", "读完能上手");
  deliverTask(cwd, "T1", "写完了", { file: "docs/a.md" });
  assert.equal(deed(cwd, "review", "--skip", "--why", "只改了文档，审查设置说不用审").status, 0);
  // 段都关了：这一期做成的样子还要有人判，签收压在期审后面。
  assert.equal(startPeriodReview(cwd).status, 0, "期审清单出得来");
  assert.equal(judged(cwd, "review", "--all", "--verdict", "pass").status, 0, "期审要落得下结论");
  const signed = signHere(cwd, "可以");
  assert.equal(signed.status, 0, signed.stderr);
  assert.match(signed.stdout, /没经过审查 · S01\.1（只改了文档，审查设置说不用审）/, "理由不能印成空括号");
});


// 一份清单交出去就等结论：不回答就再出一份只是重写一张没人读过的卷子；
// 期审判的是这一期做成的样子，各段判过才有它。
test("a handed-out brief waits for its verdict, and the period review comes after every segment", () => {
  const cwd = workspace("review-order");
  deed(cwd, "init", "--said", "开始", "--review", "core/**");
  fs.mkdirSync(path.join(cwd, "core"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "core", "a.mjs"), "x\n");
  addTask(cwd, "写一处实现", "文件在");
  deliverTask(cwd, "T1", "写了 core/a.mjs", { file: "core/a.mjs" });

  const first = startReview(cwd, "S01.1");
  assert.equal(first.status, 0, first.stderr);
  assert.doesNotMatch(first.stdout, /--by/, "印出来的命令不带名字");
  const again = startReview(cwd, "S01.1");
  assert.match(again.stdout, /已经出过清单，正在判/, "同一份清单继续等结论，不重出");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met").status, 0);

  assert.equal(judgeHere(cwd, "S01.1").status, 0, "段判过才轮到这一期");
  const period = startPeriodReview(cwd);
  assert.equal(period.status, 0, period.stderr);
  assert.match(period.stdout, /S01 的第 1 份/);
  assert.equal(judged(cwd, "review", "--all", "--verdict", "pass").status, 0);
  assert.equal(signHere(cwd, "可以").status, 0, "期审过了才签得下来");
});


// 期审不合格点名的是段：那一段重新打开，条目保持交付，另出一份清单重判。
test("a period verdict that names a segment reopens it, and its items stay delivered", () => {
  const cwd = workspace("period-fail");
  deed(cwd, "init", "--said", "开始", "--review", "core/**");
  fs.mkdirSync(path.join(cwd, "core"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "core", "a.mjs"), "a\n");
  addTask(cwd, "写 a", "a 在");
  deliverTask(cwd, "T1", "写了 a", { file: "core/a.mjs" });
  startReview(cwd, "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met").status, 0);
  fs.writeFileSync(path.join(cwd, "core", "b.mjs"), "b\n");
  // S01.1 审查通过、等你判决：新活排到 S01.2，交付等这一段判过、关闭。
  freshPlan(cwd);
  const periodLines = readPlan(cwd).replace(/\s*$/u, "").split("\n");
  const periodAt = periodLines.findIndex((one) => /^## （/u.test(one));
  writePlan(cwd, [...periodLines.slice(0, periodAt), "", "## ", "", "- ? 写 b", "  标准：b 在"].join("\n") + "\n");
  assert.equal(deed(cwd, "submit").status, 0);
  assert.equal(judgeHere(cwd, "S01.1").status, 0);
  deliverTask(cwd, "T2", "写了 b", { file: "core/b.mjs" });
  startReview(cwd, "S01.2");
  assert.equal(deed(cwd, "review", "--segment", "S01.2", "--verdict", "pass", "--result-all", "met").status, 0);

  assert.equal(judgeHere(cwd, "S01.2").status, 0, "第二段判过才轮到期审");
  assert.equal(startPeriodReview(cwd).status, 0);
  const failed = judged(cwd, "review", "--all", "--verdict", "fail", "--result", "S01.1=unmet", "--rework", "S01.1", "--why", "这一段的结论没对上这一期");
  assert.equal(failed.status, 0, failed.stderr);
  const state = deed(cwd, "state");
  assert.match(state.stdout, /S01\.1[^\n]*开于/, "被点名的段重新打开");
  const blocked = signHere(cwd, "可以");
  assert.equal(blocked.status, 1, "还有段没被判过，签不下来");
  assert.equal(startReview(cwd, "S01.1").status, 0, "被点名的段继续出清单");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met").status, 0);
  assert.equal(judgeHere(cwd, "S01.1").status, 0, "重判的那一段再由人判一次");
  assert.equal(startPeriodReview(cwd).status, 0, "重判之后期审再出清单");
  assert.equal(judged(cwd, "review", "--all", "--verdict", "pass").status, 0);
  const signed = signHere(cwd, "可以");
  assert.equal(signed.status, 0, signed.stderr);
});


test("a delivery with no command behind it says so in the brief", () => {
  const cwd = workspace("run-saying");
  deed(cwd, "init", "--said", "开始");
  fs.writeFileSync(path.join(cwd, "note.md"), "one\n");
  addTask(cwd, "改一句话", "改好了");
  deed(cwd, "plan");
  const file = path.join(cwd, ".deed", "plan.md");
  fs.writeFileSync(
    file,
    fs.readFileSync(file, "utf8").replace(/- \[ \] T1 (.*)\n/, "- [x] T1 $1\n  交付：改了一句，看起来没问题\n"),
    "utf8",
  );
  const ok = deed(cwd, "submit");
  assert.equal(ok.status, 0, ok.stderr);
  startReview(cwd, "S01.1");
  const brief = fs
    .readdirSync(path.join(cwd, ".deed", "review"))
    .filter((one) => !one.endsWith("-reviewer.md"))
    .map((one) => fs.readFileSync(path.join(cwd, ".deed", "review", one), "utf8"))
    .at(-1);
  // 没有命令核过的交付在清单上只算说法：审查者看得到它和「跑过」「核过」的区别
  assert.match(brief, /† 的交付没有配可核的命令/, "只是说法在抬头说一次，不再逐条重复");
  assert.match(brief, /交付†：/);
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
  assert.equal(judge.status, 1, "推翻那个动作不在命令行上");
  assert.match(judge.stderr, /面板/u, "要指到面板，别让人去别处找");
  const topic = deed(cwd, "topic", "release", "I1");
  assert.equal(topic.status, 1, "议题那一条连动词都还没有");
  assert.equal(readEvents(cwd).length, before, "三条路都不记账");
});


// 审查通过只是把这一段交回来：判决是用户按的第二道闸，按完这一段才关闭。
test("review passing hands the segment back, and only the user's judgement closes it", () => {
  const cwd = workspace("judgement");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "交一条", "交了");
  deliverTask(cwd, "T1", "交了", { file: "proof.txt" });
  // 审查还没通过，判不得：判决在审查之后。
  const early = judgeHere(cwd, "S01.1");
  assert.equal(early.status, 1, "没有审查通过就没有可判的东西");
  assert.match(early.stderr, /审查通过/);
  startReview(cwd, "S01.1");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met").status, 0);
  const waiting = fold(readEvents(cwd)).sessions[0].segments[0];
  assert.equal(waiting.closedAt, null, "审查通过不等于这一段结束了");
  assert.equal(waiting.verdict, "pass");
  assert.equal(waiting.reviewedBy, "agent", "命令落下的结论按通道记");
  // 签收闸挡着：这一段还没有人判。
  const blocked = gate(cwd, { action: "sign", words: "可以" });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /等你判决/);
  // 冻结照样：审查者判的是那份字节，人判之前又换掉它，判决就落在一份没人看过的内容上。
  // 已交过的条目再勾一次不产生交付，submit 回"没有要落的改动"，不是"等你判决"；
  // 冻结对交付的拦截在这里量不到。
  const frozen = deliverTask(cwd, "T1", "又改了一遍", { file: "proof.txt" });
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

// 已经判过、之后没动过的条目：重审清单里只留一行（编号 · 标题 · 上次判定），
// 不再展开标准与交付——重判一遍等于把别人的工作重做。
test("a second brief only expands what has to be judged again", () => {
  const cwd = workspace("brief-second");
  deed(cwd, "init", "--said", "开始", "--review", "core/**");
  addTask(cwd, "第一条", "跑得通");
  addTask(cwd, "第二条", "跑得通");
  assert.equal(deliverTask(cwd, "T1", "跑：跑得通").status, 0);
  assert.equal(deliverTask(cwd, "T2", "跑：跑得通").status, 0);
  assert.equal(startReview(cwd, "S01.1").status, 0);
  const bare = deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T2=unmet", "--rework", "T2", "--why", "第二条没做到");
  assert.equal(bare.status, 1, "不合格也要逐条判定，不然重审没有可沿用的东西");
  assert.match(bare.stderr, /要每条都判过/u);
  const wrong = deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--rework", "T2", "--why", "x",
    "--result", "T1=met", "--result", "T2=met");
  assert.equal(wrong.status, 1, "退回的那条不能判成 met");
  assert.match(wrong.stderr, /要判成 unmet/u);
  const ok = deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--rework", "T2", "--why", "第二条没做到",
    "--result", "T1=met", "--result", "T2=unmet");
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.status, 0, ok.stderr);
  // 被点名的那条重新交付之后，再出一份清单：它要重判，T1 的判定沿用。
  assert.equal(deliverTask(cwd, "T2", "又跑一遍").status, 0);
  // 按命令印出来的那份读：文件名带 "-2" 的那种，字母序排在第一份前面，不能靠 at(-1) 猜。
  const made = startReview(cwd, "S01.1");
  assert.equal(made.status, 0, made.stderr);
  const brief = fs.readFileSync(path.join(cwd, made.stdout.match(/\.deed[\\/]review[\\/]\S+\.md/u)[0]), "utf8");
  assert.match(brief, /要重判的/u);
  assert.match(brief, /### T2 · 第二条/u, "被退回的那条要展开");
  assert.doesNotMatch(brief, /### T1 · 第一条/u, "没动过的那条不再展开");
  assert.match(brief, /- T1 · 第一条 · 上次 met[^\n]*判定沿用/u);
});

// 审查者的临时区开在仓库外：仓库里的目录一旦被当成临时区，把整个工作区复制进去
// 就成了自己套自己；角色包里也明说不能提交。
test("the reviewer's scratch sits outside the workspace and the pack says no commits", () => {
  const cwd = workspace("scratch-outside");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "改重放", "总账能重放");
  deliverTask(cwd, "T1", "跑了 16 条", { file: "core/fold.mjs" });
  assert.equal(startReview(cwd, "S01.1").status, 0);
  const guide = fs
    .readdirSync(path.join(cwd, ".deed", "review"))
    .filter((one) => one.endsWith("-reviewer.md"))
    .map((one) => fs.readFileSync(path.join(cwd, ".deed", "review", one), "utf8"))
    .pop();
  const line = guide.split("\n").find((one) => one.includes("deed-scratch"));
  assert.ok(line, "角色包写出了临时区在哪");
  const scratch = line.trim();
  assert.ok(!path.resolve(scratch).startsWith(path.resolve(cwd) + path.sep), "临时区在仓库外：" + scratch);
  // 六句话各是一个边界：少一句要红（不是"写了就算"）。
  for (const one of [
    "仓库里的东西一个字节都别动",
    "别改账本",
    "不能提交",
    "别替作者修",
    "每条结论与发现都要配复现路径",
    "有没达成的：",
  ])
    assert.ok(guide.includes(one), "角色包里少了这一句：" + one);

  // 结论一落，临时区连同里面的一切一起没了。
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=unmet",
    "--rework", "T1", "--why", "没做到").status, 0);
  assert.equal(fs.existsSync(scratch), false, "结论落地时临时区被删掉");
});

// 交付记录里的那三样只服务当场核对与不重跑：审查清单里不出现它们（尤其是指纹）。
test("the review sheet carries the claim, not the byte counts or fingerprints", () => {
  const cwd = workspace("sheet-hides-hashes");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "做一", "跑得通");
  deliverTask(cwd, "T1", "跑：跑得通", { file: "a.md" });
  assert.equal(startReview(cwd, "S01.1").status, 0);
  const sheet = fs
    .readdirSync(path.join(cwd, ".deed", "review"))
    .filter((one) => !one.endsWith("-reviewer.md"))
    .map((one) => fs.readFileSync(path.join(cwd, ".deed", "review", one), "utf8"))
    .pop();
  assert.doesNotMatch(sheet, /sha256|[0-9a-f]{16}/u, "清单里没有指纹");
});

// 清单是一份卷子：卷子外新加的条目（还没交的）不该把这一份结论挡死——
// 挡死等于作者每加一条就要换一份清单，审查者手上那份永远判不完。
test("an entry that is not on the sheet does not hold the verdict back", () => {
  const cwd = workspace("verdict-outside-sheet");
  assert.equal(deed(cwd, "init", "--said", "开始", "--review", "core/**").status, 0);
  addTask(cwd, "做一", "跑得通");
  fs.writeFileSync(path.join(cwd, "core.mjs"), "x\n");
  deliverTask(cwd, "T1", "跑：跑得通", { file: "core.mjs" });
  assert.equal(startReview(cwd, "S01.1").status, 0, "第一份清单");

  // 卷子之外新加一条，还没交：卷子上的 T1 交完了，结论该能落。
  addTask(cwd, "后来的一条", "也算跑通");
  const pass = deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result", "T1=met");
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.match(pass.stdout + pass.stderr, /审查通过/u);

  // 再把卷子外那一条交掉：那份结论不覆盖它，要覆盖就另出一份，只判它一条。
  fs.writeFileSync(path.join(cwd, "core.mjs"), "x2\n");
  deliverTask(cwd, "T2", "跑：也行", { file: "core.mjs" });
  const next = startReview(cwd, "S01.1");
  assert.equal(next.status, 0, next.stdout + next.stderr);
  const doc = fold(readEvents(cwd));
  const one = doc.sessions[0];
  const sheet = one.briefs.filter((b) => b.segment === "S01.1").at(-1);
  assert.deepEqual(sheet.tasks, ["T2"], "第二份清单只展开卷子外新交的那一条");
  const pass2 = deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result", "T2=met");
  assert.equal(pass2.status, 0, pass2.stdout + pass2.stderr);
});

// 不合格那一判同样只问卷子上的条目：清单外新交的一条不该把 fail 挡住。
test("a fail verdict is asked of the sheet's items, not of everything in the segment", () => {
  const cwd = workspace("fail-outside-sheet");
  assert.equal(deed(cwd, "init", "--said", "开始", "--review", "core/**").status, 0);
  addTask(cwd, "做一", "跑得通");
  fs.writeFileSync(path.join(cwd, "core.mjs"), "x\n");
  deliverTask(cwd, "T1", "跑：跑得通", { file: "core.mjs" });
  assert.equal(startReview(cwd, "S01.1").status, 0);
  // 卷子外新加并交掉一条：它不在这一份上。
  addTask(cwd, "后来的一条", "也算跑通");
  fs.writeFileSync(path.join(cwd, "core.mjs"), "x2\n");
  deliverTask(cwd, "T2", "跑：也行", { file: "core.mjs" });
  const fail = deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=unmet", "--rework", "T1", "--why", "没做到");
  assert.equal(fail.status, 0, fail.stdout + fail.stderr);
});

// 打回的返工只重开被点名的条目：其余交付不重判，重审清单上它们只留一行「判定沿用」。
test("a fail reopens what it named, and the next sheet does not re-expand the rest", () => {
  const cwd = workspace("fail-names-one");
  assert.equal(deed(cwd, "init", "--said", "开始", "--review", "core/**").status, 0);
  addTask(cwd, "做一", "跑得通");
  addTask(cwd, "做二", "也跑得通");
  fs.writeFileSync(path.join(cwd, "core.mjs"), "x\n");
  deliverTask(cwd, "T1", "跑：T1", { file: "core.mjs" });
  fs.writeFileSync(path.join(cwd, "core.mjs"), "y\n");
  deliverTask(cwd, "T2", "跑：T2", { file: "core.mjs" });
  assert.equal(startReview(cwd, "S01.1").status, 0);
  const fail = deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=met", "--result", "T2=unmet", "--rework", "T2", "--why", "T2 没做到");
  assert.equal(fail.status, 0, fail.stdout + fail.stderr);

  fs.writeFileSync(path.join(cwd, "core.mjs"), "y2\n");
  deliverTask(cwd, "T2", "跑：改了一版", { file: "core.mjs" });
  assert.equal(startReview(cwd, "S01.1").status, 0, "重审清单");
  const doc = fold(readEvents(cwd));
  const sheet = doc.sessions[0].briefs.at(-1);
  assert.deepEqual(sheet.tasks, ["T2"], "只展开被点名的那条；T1 的判定沿用");
});

// 封存前要看清手上还有没有没回答的清单：有的话，封了它就是一件没人结的账。
test("sealing over a sheet nobody answered is refused, and says which one", () => {
  const cwd = workspace("seal-over-sheet");
  deed(cwd, "init", "--said", "开始", "--review", "docs/**");
  addTask(cwd, "写文档", "有");
  fs.writeFileSync(path.join(cwd, "a.md"), "x\n");
  deliverTask(cwd, "T1", "写了", { file: "a.md" });
  assert.equal(startReview(cwd, "S01.1").status, 0, "清单出门");
  const skip = deed(cwd, "review", "--segment", "S01.1", "--skip", "--why", "想省一道");
  assert.equal(skip.status, 1);
  assert.match(skip.stdout + skip.stderr, /还有一份交出去、没人回答的清单/u);
  assert.match(skip.stdout + skip.stderr, /--withdraw/u, "指路先撤回");
});

// 清单抬头只说账本上记的那句凭什么，不替封存编"审查设置说这一段不用审"。
test("the sheet prints the reason the ledger holds, not a stock sentence", () => {
  const cwd = workspace("seal-reason");
  deed(cwd, "init", "--said", "开始", "--review", "docs/**");
  addTask(cwd, "写文档", "有");
  dropTask(cwd, "T1", "这一期不做了");
  const sealed = deed(cwd, "review", "--segment", "S01.1", "--skip", "--why", "一条交付都没有，没有可审的");
  assert.equal(sealed.status, 0, sealed.stdout + sealed.stderr);
  const all = startPeriodReview(cwd);
  assert.equal(all.status, 0, all.stdout + all.stderr);
  const file = readEvents(cwd).filter((one) => one.k === "review.brief" && one.scope === "session").at(-1).brief;
  const text = fs.readFileSync(path.join(cwd, file), "utf8");
  assert.match(text, /凭什么：一条交付都没有，没有可审的/u);
  assert.doesNotMatch(text, /审查设置说这一段不用审/u);
});
