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
import { auditDelivered, movedSince, requireUnchanged } from "../cli/pins.mjs";
import { applyGate, gatesOf } from "../board/gates.mjs";
import {
  CLI, OFF, deed, later, gate, judgeAll, judgeHere, signHere, judged, kinds, briefs, proof,
  writeLines, planFile, writePlan, readPlan,
} from "./support/cli.mjs";


test("a task needs a promise and a standard of done", () => {
  const cwd = workspace("task");
  deed(cwd, "init", "--said", "开始");
  assert.equal(deed(cwd, "task", "add", "只有标题").status, 1);
});


// --- What the two independent reviews found, one guard per test ---------------

test("a fail sends the named work back, so a pass cannot land until it is delivered again", () => {
  const cwd = workspace("verdict-order");
  deed(cwd, "init", "--said", "改重放函数");
  deed(cwd, "task", "add", "改重放", "--criteria", "同账本同文档", "--files", "core/fold.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "node --test", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  const failed = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "fail", "--rework", "T1", "--why", "没有并发记录");
  assert.equal(failed.status, 0, failed.stderr);
  const back = deed(cwd, "state");
  assert.match(back.stdout, /deed submit/, "点名的那条回到未做，下一步是在清单里再勾一次");
  const early = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass", "--result-all", "met");
  assert.equal(early.status, 1, "在案的不合格不能被一条 pass 顶掉");
  assert.match(early.stderr, /还有没交付的（T1）/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "review.log").length, 1, "被拒的那条不进账本");
  assert.equal(deed(cwd, "task", "done", "T1", "--evidence", "跑了 8 个并发", "--digest", proof(cwd)).status, 0);
  deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  const after = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass", "--result-all", "met");
  assert.equal(after.status, 0, "重新交付、重新审过才放行");
  assert.match(after.stdout, /交回给你判/);
});



test("a fail names every task it sends back", () => {
  const cwd = workspace("rework-many");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "一", "--criteria", "c", "--files", "core/a.mjs");
  deed(cwd, "task", "add", "二", "--criteria", "c", "--files", "core/b.mjs");
  deed(cwd, "task", "done", "T1", "--evidence", "写完了", "--digest", proof(cwd));
  deed(cwd, "task", "done", "T2", "--evidence", "写完了", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  const back = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "fail", "--rework", "T1,T2", "--why", "两处都要补");
  assert.equal(back.status, 0, back.stdout + back.stderr);
  const state = deed(cwd, "state");
  assert.match(state.stdout, /○ T1/);
  assert.match(state.stdout, /○ T2/);
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

  assert.equal(deed(cwd, "review", "--by", "qa").status, 0);
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


test("taking back a delivery that never landed is refused, and nothing is written", () => {
  const cwd = workspace("undo-empty");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "一条还没交的任务", "--criteria", "做完了");
  const run = deed(cwd, "task", "undo", "T1", "--why", "手滑");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /没有可撤回的交付/);
  assert.equal(kinds(cwd).includes("task.undo"), false);
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
  const now = fold(readEvents(cwd));
  assert.doesNotMatch(gatesOf(now, now.config).sign.why, /过期/, "现行那份是新的，签收不该再被过期的交付记录挡住");
  fs.writeFileSync(path.join(cwd, "thing.txt"), "v3");
  const stale = deed(cwd, "verify");
  assert.equal(stale.status, 1, "现行那份跟着变了才算过期");
  assert.match(stale.stdout, /交付记录过期 · T1/);
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
  assert.match(
    done.stdout,
    /记账之前再核一遍 · 2 条没有变/,
    "量差之后、记账之前要再核一遍：没有这一句，接线掉了一眼看不出来",
  );
  assert.equal(deed(cwd, "verify").status, 0);

  const review = deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  assert.equal(review.status, 0, review.stdout + review.stderr);
  const brief = fs.readFileSync(path.join(cwd, ".deed", "review", briefs(cwd).sort().at(-1)), "utf8");
  assert.match(brief, /记下：a\.md [0-9a-f]{12}、b\.md [0-9a-f]{12}/, "审查者要拿到每一份的指纹");

  fs.writeFileSync(path.join(cwd, "b.md"), "b2");
  const stale = deed(cwd, "verify");
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /交付记录过期 · T1 · b\.md/, "改了哪一份就点名哪一份");
  assert.doesNotMatch(stale.stdout, /过期 · T1 · a\.md/, "没改的那份不该被连坐");
});


test("a fail that names nobody is refused, and a pass cannot carry a rework", () => {
  const cwd = workspace("fail-names");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "task", "add", "交一条", "--criteria", "交了", "--files", "proof.txt");
  deed(cwd, "task", "done", "T1", "--evidence", "交了", "--digest", proof(cwd));
  deed(cwd, "review", "--segment", "S01.1", "--by", "qa");
  const nameless = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "fail", "--why", "不行");
  assert.equal(nameless.status, 1, "不点名的结论没人能接");
  assert.match(nameless.stderr, /--rework/);
  const unclear = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "fail", "--rework", "T1");
  assert.equal(unclear.status, 1, "点名要说为什么");
  assert.match(unclear.stderr, /--why/);
  const mixed = deed(cwd, "review", "--segment", "S01.1", "--by", "qa", "--verdict", "pass", "--result-all", "met", "--rework", "T1");
  assert.equal(mixed.status, 1, "放行不负责任何重做");
  assert.match(mixed.stderr, /--rework 只跟|只跟 --verdict fail/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "review.log").length, 0, "被拒的结论一条都不写");
});



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
  assert.match(second.stdout, /记账之前再核一遍 · \d+ 条没有变/, "记账之前那一次核对也要说得出来：接线掉了它就不会印");
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
  // 清单按状态分组印：一条了结就会把它自己挪到下半截，所以先后那一条（task.order）
  // 可能出现——它是这一改动带来的真事实，不算噪声。这里只盯四种实打实的动作。
  assert.deepEqual(
    kinds(cwd).filter((one) => one.startsWith("task.") && one !== "task.order"),
    ["task.add", "task.add", "task.done", "task.undo", "task.drop"],
  );
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
