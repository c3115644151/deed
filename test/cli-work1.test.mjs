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

  addTask, deliverTask, undoDelivery, dropTask,
} from "./support/cli.mjs";


test("an entry needs a standard of done, and the plan says so instead of recording it", () => {
  const cwd = workspace("task");
  deed(cwd, "init", "--said", "开始");
  writePlan(cwd, ["# 这一期要做成什么", "写一句话。", "", "- ? 只有标题"].join("\n"));
  const run = deed(cwd, "submit");
  assert.equal(run.status, 1, "没有标准就没有做完的样子");
  assert.match(run.stderr, /标准/u);
});


// --- What the two independent reviews found, one guard per test ---------------

test("a fail sends the named work back, so a pass cannot land until it is delivered again", () => {
  const cwd = workspace("verdict-order");
  deed(cwd, "init", "--said", "改重放函数");
  addTask(cwd, "改重放", "同账本同文档", "--files", "core/fold.mjs");
  deliverTask(cwd, "T1", "node --test");
  deed(cwd, "review", "--segment", "S01.1");
  const failed = deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--rework", "T1", "--why", "没有并发记录");
  assert.equal(failed.status, 0, failed.stderr);
  const back = deed(cwd, "state");
  assert.match(back.stdout, /deed submit/, "点名的那条回到未做，下一步是在清单里再勾一次");
  const early = deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met");
  assert.equal(early.status, 1, "在案的不合格不能被一条 pass 顶掉");
  assert.match(early.stderr, /还有没交付的（T1）/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "review.log").length, 1, "被拒的那条不进账本");
  assert.equal(deliverTask(cwd, "T1", "跑了 8 个并发").status, 0);
  deed(cwd, "review", "--segment", "S01.1");
  const after = deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met");
  assert.equal(after.status, 0, "重新交付、重新审过才放行");
  assert.match(after.stdout, /交回给你判/);
});



test("a fail names every task it sends back", () => {
  const cwd = workspace("rework-many");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "一", "c", "--files", "core/a.mjs");
  addTask(cwd, "二", "c", "--files", "core/b.mjs");
  deliverTask(cwd, "T1", "写完了");
  deliverTask(cwd, "T2", "写完了");
  deed(cwd, "review", "--segment", "S01.1");
  const back = deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--rework", "T1,T2", "--why", "两处都要补");
  assert.equal(back.status, 0, back.stdout + back.stderr);
  const state = deed(cwd, "state");
  assert.match(state.stdout, /○ T1/);
  assert.match(state.stdout, /○ T2/);
});



test("a delivery that said the wrong thing is taken back, not rewritten", () => {
  const cwd = workspace("undo");
  deed(cwd, "init", "--said", "开始");
  const said = addTask(cwd, "先说一句要做的事", "做完了", "--files", "proof.txt");
  assert.equal(said.status, 0);
  const pinned = proof(cwd);
  assert.equal(deliverTask(cwd, "T1", "说要被撤回的那条", { file: pinned }).status, 0);
  const undo = undoDelivery(cwd, "T1", "这条交付是我手滑打进去的乱码");
  assert.equal(undo.status, 0);
  assert.match(undo.stdout, /撤回 · T1/, "撤回这一个动词就够了");

  const after = deed(cwd, "state");
  assert.match(after.stdout, /（未做 1 · 已交付 0）/, "收回之后这条又回到未做");
  assert.match(after.stdout, /deed submit/, "下一步重新是在清单里交付它");

  assert.equal(deliverTask(cwd, "T1", "这次说的是真的").status, 0);
  assert.deepEqual(kinds(cwd).filter((one) => one.startsWith("task.")), ["task.add", "task.done", "task.undo", "task.done"]);

  assert.equal(deed(cwd, "review").status, 0);
  const handed = briefs(cwd).map((one) => path.join(cwd, ".deed", "review", one)).sort().pop();
  const text = fs.readFileSync(handed, "utf8");
  assert.equal(text.includes("说要被撤回的那条"), false, "撤回的那条不算数");
  assert.match(text, /- 撤回的交付：这条交付是我手滑打进去的乱码/, "清单要说清哪一条不算数");
  assert.match(text, /- 交付†：这次说的是真的/);
  // 撤回的那条从账本里消失了，可它当时指着哪份字节是复核这条撤回的唯一依据。
  assert.match(text, /它当时动过的是 proof\.txt/, "撤回也要说清它当时指着什么");
  const taken = readEvents(cwd).find((one) => one.k === "task.undo");
  // 写在账本那一行上的，不是重放时算出来的：重放会跟着将来的形状改口。
  assert.equal(taken.undoes[0].path, "proof.txt", "撤回那行自己带着被撤的路径");
  const logged = fold(readEvents(cwd)).sessions[0].tasks[0].undone;
  assert.equal(logged.length, 1, "账本里留下一条撤回记录");
  assert.equal(logged[0].undoes[0].path, "proof.txt", "撤回带上被撤那条记下的文件");
  assert.equal(taken.id, "T1");
});


// 只删不改也算动过：那时没有字节可记，但改动的痕迹在 changed 上。
// 少了这一条，删掉一份文件就再也没法在清单里交这一条。
test("a delivery that only removes a file still points at the change it made", () => {
  const cwd = workspace("delete-only");
  deed(cwd, "init", "--said", "开始");
  fs.writeFileSync(path.join(cwd, "gone.md"), "x");
  addTask(cwd, "先把文件建出来", "它在", "--files", "gone.md");
  assert.equal(deliverTask(cwd, "T1", "建了 gone.md").status, 0);
  addTask(cwd, "再把它删掉", "它不在了", "--files", "gone.md");
  fs.rmSync(path.join(cwd, "gone.md"));
  freshPlan(cwd);
  fs.writeFileSync(
    path.join(cwd, ".deed", "plan.md"),
    ["# 这一期要做成什么", "把那份文件建出来，再删掉。", "", "- [x] T1 先把文件建出来", "  标准：它在", "  交付：建了 gone.md", "", "- [x] T2 再把它删掉", "  标准：它不在了", "  交付：gone.md 已删"].join("\n") + "\n",
  );
  const run = deed(cwd, "submit");
  assert.equal(run.status, 0, run.stderr);
  const done = readEvents(cwd).filter((one) => one.k === "task.done" && one.id === "T2").at(-1);
  assert.deepEqual(done.files, [{ path: "gone.md" }], "只删不改也算动过：文件走了，路径留下");
  assert.deepEqual(done.changed, ["gone.md"], "可它确实动过那条路径");
});




// 主路线是清单：把勾去掉再加一行 理由：。它落的那一行，同样要写清撤的是哪份字节——
// 两条入口落的是同一个事实，只有一条写了就等于事实写在半路上。
test("taking a delivery back from the plan records the bytes too", () => {
  const cwd = workspace("undo-plan");
  deed(cwd, "init", "--said", "开始");
  const pinned = proof(cwd);
  addTask(cwd, "先说一句要做的事", "做完了");
  assert.equal(deliverTask(cwd, "T1", "说要被撤回的那条", { file: pinned }).status, 0);
  freshPlan(cwd);
  fs.writeFileSync(
    path.join(cwd, ".deed", "plan.md"),
    ["# 这一期要做成什么", "先说一句要做的事。", "", "- [ ] T1 先说一句要做的事", "  标准：做完了", "  理由：这条交付是我手滑打进去的乱码"].join("\n") + "\n",
  );
  const run = deed(cwd, "submit");
  assert.equal(run.status, 0, run.stderr);
  const taken = readEvents(cwd).find((one) => one.k === "task.undo");
  assert.equal(taken.undoes[0].path, "proof.txt", "清单那条路也要把被撤的文件写进账本");
});


test("taking back a delivery that never landed is refused, and nothing is written", () => {
  const cwd = workspace("undo-empty");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "一条还没交的任务", "做完了");
  const run = undoDelivery(cwd, "T1", "手滑");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /没有要落的改动|没有可撤回的交付/u);
  assert.equal(kinds(cwd).includes("task.undo"), false);
});














test("a fail that names nobody is refused, and a pass cannot carry a rework", () => {
  const cwd = workspace("fail-names");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "交一条", "交了", "--files", "proof.txt");
  deliverTask(cwd, "T1", "交了");
  deed(cwd, "review", "--segment", "S01.1");
  const nameless = deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--why", "不行");
  assert.equal(nameless.status, 1, "不点名的结论没人能接");
  assert.match(nameless.stderr, /--rework/);
  const unclear = deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--rework", "T1");
  assert.equal(unclear.status, 1, "点名要说为什么");
  assert.match(unclear.stderr, /--why/);
  const mixed = deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met", "--rework", "T1");
  assert.equal(mixed.status, 1, "放行不负责任何重做");
  assert.match(mixed.stderr, /--rework 只跟|只跟 --verdict fail/);
  assert.equal(readEvents(cwd).filter((one) => one.k === "review.log").length, 0, "被拒的结论一条都不写");
});



// 清单是两面都能改的那一个文件：一条命令一次落整批，新条目自己领号。

test("a plan lands as one batch: a ? takes a number, a tick is a delivery", () => {
  const cwd = workspace("plan-batch");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "say", "把清单做成一个文件");
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
  assert.match(second.stdout, /记账之后核对 · 1 条都指得到当时那份内容/u, "记账之后核一遍：这条记录指得到东西吗，指不到就说出来");
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
  deed(cwd, "say", "写一份说明");
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

// T140：完成一条不该让后面每条都落一条先后——先后只在相对次序真变了时才写。
test("finishing entries writes no order records until the rows are really reordered", () => {
  const cwd = workspace("order-noise");
  deed(cwd, "init", "--said", "开始", "--review", "core/**");
  const rows = ["一", "二", "三", "四", "五"];
  for (const name of rows) addTask(cwd, "做" + name, "跑得通");
  const countOrders = () => readEvents(cwd).filter((one) => one.k === "task.order").length;
  const orders = () => fold(readEvents(cwd)).sessions[0].tasks.map((one) => one.order);
  assert.deepEqual(orders(), [1, 2, 3, 4, 5], "新条目各带一个位置，写在 task.add 上");
  // 依次做完前三条：每做完一条，后面那些条目的位置都不该被重写。
  for (let at = 0; at < 3; at += 1) {
    deliverTask(cwd, "T" + (at + 1), "做完" + rows[at] + "：node --test 1/1");
    assert.equal(countOrders(), 0, "做完第 " + (at + 1) + " 条没有连累后面");
  }
  assert.deepEqual(orders(), [1, 2, 3, 4, 5], "位置原样留着，不因为前面空出来就往前挪");
  // 真把两条没做完的上下调换：只有这两条换到数字。
  const lines = readPlan(cwd).split(/\r?\n/u);
  const startOf = (id) => lines.findIndex((one) => one.startsWith("- [ ] " + id + " "));
  const blockOf = (at) => {
    let end = at + 1;
    while (end < lines.length && !lines[end].startsWith("- [")) end += 1;
    return lines.slice(at, end);
  };
  const a0 = startOf("T4");
  const b0 = startOf("T5");
  assert.ok(a0 >= 0 && b0 >= 0, "两条都还在待办里");
  const a = blockOf(a0);
  const b = blockOf(b0);
  // 先把靠前的那块删掉再插：下标会变，从后往前改。
  lines.splice(b0, b.length, ...a);
  lines.splice(a0, a.length, ...b);
  writePlan(cwd, lines.join("\n"));
  const moved = deed(cwd, "submit");
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(countOrders(), 2, "调换两条，只有这两条各落一条");
  const after = fold(readEvents(cwd)).sessions[0].tasks;
  assert.equal(after.find((one) => one.id === "T4").order, 5, "T4 挪到后面");
  assert.equal(after.find((one) => one.id === "T5").order, 4, "T5 挪到前面");
  assert.equal(after.find((one) => one.id === "T1").order, 1, "做完的不动");
});
