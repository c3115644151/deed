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


test("a plan with a line nobody can read lands nothing, and a task cannot vanish", () => {
  const cwd = workspace("plan-bad");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "say", "写一条");
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

// 一次只做一件事：一批勾两条当场拒，说清先交哪一条，账本一个字不动。
test("one submit takes one delivery, not a batch", () => {
  const cwd = workspace("one-at-a-time");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "say", "一次交两条");
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
  const before = readEvents(cwd).length;
  const refused = deed(cwd, "submit");
  assert.equal(refused.status, 1, "一次勾两条整批拒");
  assert.match(refused.stderr, /一次只交一条/u);
  assert.match(refused.stderr, /先交此刻在做的那一条/u);
  assert.equal(readEvents(cwd).length, before, "被拒的批一个字都不落");

  // 分两次：一次一条，各落各的，不再有批号
  writePlan(
    cwd,
    readPlan(cwd)
      .replace("- [x] T2 写 b", "- [ ] T2 写 b")
      .replace("  标准：docs/b.md 有一句话\n  交付：写下 docs/b.md", "  标准：docs/b.md 有一句话"),
  );
  assert.equal(deed(cwd, "submit").status, 0);
  // 做下一条：又动了一次那份文件，再勾
  fs.writeFileSync(path.join(cwd, "docs", "b.md"), "b2", "utf8");
  writePlan(
    cwd,
    readPlan(cwd)
      .replace("- [ ] T2 写 b", "- [x] T2 写 b")
      .replace("  标准：docs/b.md 有一句话", "  标准：docs/b.md 有一句话\n  交付：写下 docs/b.md，改成了 b2"),
  );
  assert.equal(deed(cwd, "submit").status, 0);
  const dones = readEvents(cwd).filter((one) => one.k === "task.done");
  assert.equal(dones.length, 2, "两条都交上了");
  assert.equal(dones[0].batch ?? null, null, "单条交付不写批号");
  assert.equal(dones[1].batch ?? null, null);
});


// 一次 submit 不能既新增又交付同一条：任务得在交付之前记账。

test("an entry that is new cannot be ticked in the same submit", () => {
  const cwd = workspace("plan-newtick");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "say", "写一条");
  writePlan(cwd, ["# 这一期要做成什么", "写一句话。", "", "- [x] ? 写一句话", "  标准：docs/a.md 有一句话", "  交付：写了"].join("\n"));
  const landed = deed(cwd, "submit");
  assert.equal(landed.status, 1);
  assert.match(landed.stderr, /一次 submit 不能既新增又交付/);
  assert.equal(kinds(cwd).filter((one) => one.startsWith("task.")).length, 0, "整批不记账");
});

// 勾上就要指着点什么：没改动、也没文件可指时，写下去是一条谁也核不了的空话，
// 而后面的交付一记就把它盖住——审计永远看不见它。

test("a submit with nothing to point at refuses to write the delivery", () => {
  const cwd = workspace("empty-delivery");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "say", "写一份说明");
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


test("removing a file in a submit is not a small change either", () => {
  const cwd = workspace("delete-is-not-small-submit");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**,*.md");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "big.md"), "x".repeat(15000));
  addTask(cwd, "写一份一万五的文档", "它在", "--files", "docs/big.md");
  const plan = path.join(cwd, ".deed", "plan.md");
  freshPlan(cwd);
  fs.writeFileSync(plan, ["# 这一期要做成什么", "写一份，再删掉。", "", "- [x] T1 写一份一万五的文档", "  标准：它在", "  交付：写了 docs/big.md"].join("\n") + "\n");
  assert.equal(deed(cwd, "submit").status, 0);
  assert.match(deed(cwd, "state").stdout, /免审（全部落在 exempt）/u, "一万五千字节落在免审路径上，本来不用审");

  addTask(cwd, "再把它删掉", "它不在了", "--files", "docs/big.md");
  fs.rmSync(path.join(cwd, "docs", "big.md"));
  freshPlan(cwd);
  fs.writeFileSync(plan, ["# 这一期要做成什么", "写一份，再删掉。", "", "- [x] T1 写一份一万五的文档", "  标准：它在", "  交付：写了 docs/big.md", "", "- [x] T2 再把它删掉", "  标准：它不在了", "  交付：docs/big.md 已删"].join("\n") + "\n");
  const run = deed(cwd, "submit");
  assert.equal(run.status, 0, run.stderr);
  const done = readEvents(cwd).filter((one) => one.k === "task.done" && one.id === "T2").at(-1);
  assert.deepEqual(done.bytes, {}, "删掉的路径不记 0，记空");
  assert.doesNotMatch(deed(cwd, "state").stdout, /免审（全部落在 exempt）/u, "删掉一万五千字节，不再算小改动");
});


test("an entry still to be done is carried to the next segment from the plan", () => {
  const cwd = workspace("carry-plan");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "先做这一件", "能跑", "--files", "proof.txt");
  deliverTask(cwd, "T1", "跑了 1/1");
  addTask(cwd, "下一段再做", "也做完");
  const plan = path.join(cwd, ".deed", "plan.md");
  freshPlan(cwd);
  // 改到下一段要有落脚的地方：清单里那一段先排出来，条目才挪得过去。
  fs.writeFileSync(
    plan,
    fs.readFileSync(plan, "utf8").replace(/  标准：也做完\n/u, "  标准：也做完\n  改到下一段：这一段已经送审，下一段接着做\n").trimEnd() +
      "\n\n## 段\n- ? 下一段的一条\n  标准：也做完\n",
  );
  const run = deed(cwd, "submit");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /改到下一段 · T2 · S01\.2/);
  const session = fold(readEvents(cwd)).sessions[0];
  assert.equal(session.segments.length, 2, "改到下一段落进清单排好的那一段");
  assert.equal(session.tasks.find((one) => one.id === "T2").segment, "S01.2");

  // 交付过的条目改不了段：那等于把一条交付换个段说话，账本里没有这件事的位置。
  // 这一条要按清单自己画出来的形状写——交过的条目画的是 [x] + 交付：，
  // 按勾判会让这一行被当成"没有要落的改动"吞掉，用户只得到一句和 改到下一段： 无关的话。
  freshPlan(cwd);
  const drawn = fs.readFileSync(plan, "utf8");
  assert.match(drawn, /- \[x\] T1 先做这一件/u, "清单自己把交过的条目画成勾着的");
  fs.writeFileSync(plan, drawn.replace(/(  交付：跑了 1\/1\n)/u, "$1  改到下一段：换个段\n"));
  const refused = deed(cwd, "submit");
  assert.equal(refused.status, 1, "写了 改到下一段： 却 exit 0，等于静默吞掉");
  assert.match(refused.stderr, /已经交过（done）/u);
  assert.doesNotMatch(refused.stderr, /没有要落的改动/u);
});


test("the counts in a delivery are taken by running the command, not copied", () => {
  const cwd = workspace("run-counts");
  deed(cwd, "init", "--said", "开始");
  fs.writeFileSync(
    path.join(cwd, "x.test.mjs"),
    'import test from "node:test";\ntest("one", () => {});\ntest("two", () => {});\n',
  );
  addTask(cwd, "写两条测试", "node --test x.test.mjs 报 2/2");
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
  addTask(cwd, "再写一条", "也是 2/2");
  fs.writeFileSync(path.join(cwd, "note.txt"), "这次真动了一下\n");
  freshPlan(cwd);
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
  addTask(cwd, "写两条测试", "node --test x.test.mjs 报 2/2");
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


test("a delivery that says what it will show has to show it when the ledger is written", () => {
  const cwd = workspace("run-expect");
  deed(cwd, "init", "--said", "开始");
  fs.writeFileSync(path.join(cwd, "say.mjs"), 'console.log("hi");\n');
  addTask(cwd, "写一句话", "node say.mjs 印 hi");
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
  // 这一段已经在审：新的一条开下一段（在审的段不收新条目），这与真实用法一致。
  freshPlan(cwd);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\s*$/u, "") + "\n\n## 段\n- ? 再写一句\n  标准：印 bye\n", "utf8");
  assert.equal(deed(cwd, "submit").status, 0, "新的一条开到下一段");
  freshPlan(cwd);
  const next = fs
    .readFileSync(file, "utf8")
    .replace(/- \[ \] (T\d+) (.*)\n/, "- [x] $1 $2\n  交付：说 bye 就印 bye；期望：node say.mjs => bye\n");
  fs.writeFileSync(file, next, "utf8");
  const bad = deed(cwd, "submit");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /的期望没跑出来：命令「node say.mjs」要看到「bye」/);

});

// 放弃错了只有新开一条，账本里的错口径就永远挂着；撤回一条放弃是一条新事实，
// 撤回来它就回到未做，同一批再勾上就是重新交付。
test("a drop can be taken back in the plan, and then the entry can be delivered again", () => {
  const cwd = workspace("plan-undrop");
  deed(cwd, "init", "--said", "开始");
  deed(cwd, "say", "写一份说明");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "a", "utf8");
  writePlan(cwd, ["# 这一期要做成什么", "- ? 写一份说明", "  标准：docs/a.md 有一句话"].join("\n"));
  assert.equal(deed(cwd, "submit").status, 0);

  writePlan(cwd, readPlan(cwd).replace("- [ ] T1 写一份说明", "- [~] T1 写一份说明").replace("  标准：docs/a.md 有一句话", "  标准：docs/a.md 有一句话\n  理由：过时的活"));
  assert.equal(deed(cwd, "submit").status, 0);

  // 撤回来却没写理由：账本里会留下一条谁也读不出原因的事实，先拒。
  writePlan(cwd, readPlan(cwd).replace("- [~] T1 写一份说明", "- [ ] T1 写一份说明").replace("\n  理由：过时的活", ""));
  const bare = deed(cwd, "submit");
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /已经放弃过：要撤回来接着做，把它写回 - \[ \] 并在下面写一条 理由：/u);

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
  deed(cwd, "say", "排活");
  const first = ["- ? 先做的事", "  标准：做第一件", "- ? 后做的事", "  标准：做第二件"];
  writePlan(cwd, ["# 这一期要做成什么", "排活。", "", ...first].join("\n"));
  const added = deed(cwd, "submit");
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /下一步 · agent · 交付：T1 · 先做的事/u, "下一步挑清单上头一条");

  // 草稿就是盘上那份文件：submit 记账之后按账本重画过，读它等于看命令印的那一份。
  const draft = readPlan(cwd);
  assert.match(draft, /- \[ \] T1 先做的事/u);
  assert.ok(draft.indexOf("- [ ] T1 先做的事") < draft.indexOf("- [ ] T2 后做的事"), "草稿按账本里的位置印，不按编号印");

  // 把两条换个位置：账本里落 task.order，最后那条交付先做。
  // 草稿按状态分组印，所以不能拿「两条挨着」去换——按条目整块挪。
  const now = readPlan(cwd);
  const blockOf = (id) => {
    const lines = now.split("\n");
    const at = lines.findIndex((one) => one.includes(" " + id + " "));
    assert.notEqual(at, -1, "草稿里要有 " + id);
    const taken = [lines[at]];
    let k = at + 1;
    while (k < lines.length && /^  /.test(lines[k])) taken.push(lines[k++]);
    return { at, length: k - at, text: taken.join("\n") };
  };
  const one = blockOf("T1");
  const two = blockOf("T2");
  assert.ok(one.at < two.at, "T1 在 T2 前面");
  const lines = now.split("\n");
  const twoText = two.text;
  lines.splice(two.at, two.length);
  lines.splice(one.at, one.length, twoText);
  lines.splice(one.at + 2, 0, one.text);
  writePlan(cwd, lines.join("\n"));
  const reordered = deed(cwd, "submit");
  assert.equal(reordered.status, 0, reordered.stderr);
  assert.ok(kinds(cwd).filter((one) => one === "task.order").length >= 1, "换位置要落 task.order");
  const after = deed(cwd, "state");
  assert.ok(
    after.stdout.indexOf("T2 后做的事") < after.stdout.indexOf("T1 先做的事"),
    "state 的次序跟着清单里的位置走",
  );
  const step = deed(cwd, "state");
  assert.match(step.stdout, /下一步 · agent · 交付：T2 · 后做的事/u);
});


// 清单里的每一节就是一个段：空标题的节 submit 领号，成为排好的下一段；
// 只有收活的那一段能交付，前一段判过它才轮到。
test("the plan can line up several segments, and only the first takes work", () => {
  const cwd = workspace("segments-queued");
  deed(cwd, "init", "--said", "开始");
  const plan = path.join(cwd, ".deed", "plan.md");
  fs.writeFileSync(
    plan,
    [
      "# 这一期要做成什么",
      "把两批活分开排。",
      "",
      "## 段",
      "- ? 先做这一条",
      "  标准：在账本里",
      "",
      "## 段",
      "- ? 下一段的一条",
      "  标准：等轮到再做",
      "",
    ].join("\n"),
  );
  const first = deed(cwd, "submit");
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const doc = fold(readEvents(cwd));
  const one = doc.sessions[0];
  assert.equal(one.segments.length, 2, "空标题的那一节领了一个新段");
  assert.equal(one.segments[1].id, "S01.2");
  assert.equal(one.tasks.find((t) => t.title === "先做这一条").segment, "S01.1");
  assert.equal(one.tasks.find((t) => t.title === "下一段的一条").segment, "S01.2", "条目不挤进当前那段");
  assert.equal(kinds(cwd).filter((k) => k === "segment.plan").length, 2, "两节都是账本上写下的行");

  // 排好的那一段此刻不收活：交付与送审都被拒，理由指得出现在收活的是哪一段。
  fs.writeFileSync(path.join(cwd, "proof.txt"), "p\n");
  const queued = deliverTask(cwd, "T2", "试试看");
  assert.equal(queued.status, 1, "还没轮到的那一段不能交付");
  assert.match(queued.stderr, /轮到它的那一段还没开/u);
  const early = deed(cwd, "review", "--segment", "S01.2");
  assert.equal(early.status, 1);
  assert.match(early.stderr, /轮到它的那一段还没开|还没轮到/u);

  // 第一段交付、审过、判过之后，第二段才接过活。
  assert.equal(deliverTask(cwd, "T1", "做完了").status, 0);
  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0);
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met").status, 0);
  assert.equal(judgeHere(cwd, "S01.1").status, 0);
  assert.match(deed(cwd, "state").stdout, /S01\.2/);
  assert.equal(deliverTask(cwd, "T2", "轮到它了").status, 0);
});

// 草稿自己印的占位节要能用：照它写的「## 下一段（…）」底下加一条，submit 就该开一段，
// 不能回「账本里没有这个段名」——那种话读的人只能猜是自己写错了。
test("the draft's own next-section heading takes a new item", () => {
  const cwd = workspace("draft-placeholder");
  deed(cwd, "init", "--said", "开始");
  assert.equal(deed(cwd, "plan").status, 0);
  const file = path.join(cwd, ".deed", "plan.md");
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^## （/mu, "新工作区的草稿带着这一节");
  fs.writeFileSync(file, text.replace(/\s*$/u, "") + "\n" + "- ? 照草稿写的第一条\n  标准：在账本里\n", "utf8");
  const out = deed(cwd, "submit");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const doc = fold(readEvents(cwd));
  const one = doc.sessions[0];
  assert.equal(one.segments.length, 1, "照草稿写的那一条落在新开的一段里");
  assert.equal(one.tasks[0].segment, one.segments[0].id);
});

// 在审（或等判决）的那一段不再收新条目：审查者手上那份清单还没答完，它上面又多一条，
// 他答的是哪一份就成了糊涂账。新的一条要另起一节，submit 时开下一段。
test("a segment waiting for its verdict takes no new items", () => {
  const cwd = workspace("frozen-takes-no-items");
  deed(cwd, "init", "--said", "开始", "--review", "core/**");
  addTask(cwd, "先交的这一条", "跑得通");
  assert.equal(deliverTask(cwd, "T1", "跑：跑得通").status, 0);
  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0, "清单发出去了，这一段在审");

  {
    const file = path.join(cwd, ".deed", "plan.md");
    const lines = fs.readFileSync(file, "utf8").replace(/\s*$/u, "").split("\n");
    // 写进手上那一段：应当拒，并指出去写一个新的空标题节。
    const plain = lines.slice();
    plain.push("", "- ? 在审时加的一条", "  标准：不该落进来");
    fs.writeFileSync(file, plain.join("\n") + "\n", "utf8");
    const refused = deed(cwd, "submit");
    assert.equal(refused.status, 1, "在审的段不收新条目");
    assert.match(refused.stderr, /不再收新条目/u);
    assert.match(refused.stderr, /空标题/u, "要说出路");
    // 另起一节：这一段不重画，直接追加一节，submit 领一个新段。
    const fresh = lines.slice();
    fresh.push("", "## 段", "- ? 在审时加的一条", "  标准：落到下一段");
    fs.writeFileSync(file, fresh.join("\n") + "\n", "utf8");
    const landed = deed(cwd, "submit");
    assert.equal(landed.status, 0, landed.stdout + landed.stderr);
    const doc = fold(readEvents(cwd));
    const one = doc.sessions[0];
    const added = one.tasks.find((t) => t.title === "在审时加的一条");
    assert.equal(added.segment, "S01.2", "新的一条落在下一段，不挤进在审的那一段");
  }
});

// 标准不是想改就改：只有它引用的命令与开关今天已经不在命令面上（照它敲只会撞上
// 「不认这个开关」）时才收，且要写清为什么。其余时候照旧拒。
test("a criteria that still names live commands is not rewritten through the plan", () => {
  const cwd = workspace("criteria-stale-only");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "看一眼", "deed state 印得出下一步");
  const file = path.join(cwd, ".deed", "plan.md");
  // 手上的命令都还在：标准不能改。
  const live = fs.readFileSync(file, "utf8").replace(/标准：.*\n/u, "标准：说成一句话就落一行\n  理由：想换个说法\n");
  fs.writeFileSync(file, live, "utf8");
  const refused = deed(cwd, "submit");
  assert.equal(refused.status, 1, "命令都还在，标准不能改");
  assert.match(refused.stderr, /今天都还在/u);

  // 标准写的是已经删掉的命令：可以改正，但要说清为什么。
  addTask(cwd, "另一条", "deed ask answer A1 --decision 说定了");
  const staleFile = fs.readFileSync(file, "utf8")
    .replace(/标准：deed ask[^\n]*\n/u, "标准：说成一句话就落一行\n")
    .replace(/- \[ \] (T\d+) 另一条\n\s*标准：说成一句话就落一行\n/u, "- [ ] $1 另一条\n  标准：说成一句话就落一行\n");
  fs.writeFileSync(file, staleFile, "utf8");
  const noWhy = deed(cwd, "submit");
  assert.equal(noWhy.status, 1, "改了标准却没有理由");
  assert.match(noWhy.stderr, /理由/u);

  fs.writeFileSync(file, staleFile.replace("标准：说成一句话就落一行\n", "标准：说成一句话就落一行\n  理由：ask 已经删了\n"), "utf8");
  const accepted = deed(cwd, "submit");
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.match(accepted.stdout, /改正标准 · T2/u);
  const doc = fold(readEvents(cwd));
  assert.equal(doc.sessions[0].tasks.find((one) => one.id === "T2").criteria, "说成一句话就落一行");
});
