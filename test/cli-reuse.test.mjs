// T141：同一份字节上跑过的同一条命令不必再跑——账本记着那次跑站在哪一版字节上。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workspace } from "../support/lib.mjs";
import { readEvents } from "../lib/store.mjs";
import { addTask, deed, planFile } from "./support/cli.mjs";

// 一条会"记下自己跑过几次"的命令：它把记号写在仓库外，工作区字节不动。
const countingRun = (counter) =>
  'node -e "require(\'fs\').appendFileSync(process.argv[1], \'x\'); console.log(\'# tests 1\'); console.log(\'# pass 1\'); console.log(\'# fail 0\')" ' +
  JSON.stringify(counter);

test("the same bytes are not run twice: a plan-only fix reuses the recorded run", () => {
  const cwd = workspace("run-reuse");
  const counter = path.join(os.tmpdir(), "deed-run-count-" + process.pid + "-" + Date.now());
  const command = countingRun(counter);
  try {
    assert.equal(deed(cwd, "init", "--said", "开始", "--review", "core/**").status, 0);
    addTask(cwd, "只做一条", "跑得通 1/1");
    fs.writeFileSync(path.join(cwd, "notes.md"), "一处真的改动\n");
    // 清单里先写一个与跑出来的数不符的 2/2：记账前会发现，整批拒。
    const plan = fs.readFileSync(planFile(cwd), "utf8");
    fs.writeFileSync(
      planFile(cwd),
      plan.replace("- [ ] T1 只做一条", "- [x] T1 只做一条").replace("  标准：跑得通 1/1", "  标准：跑得通 1/1\n  交付：跑：2/2"),
    );
    const refused = deed(cwd, "submit", "--run", command);
    assert.equal(refused.status, 1, "--run 跑过之后被拒");
    assert.match(refused.stderr, /1\/1|2\/2|抄/, "拒的理由是数对不上");
    assert.equal(fs.readFileSync(counter, "utf8").length, 1, "第一次真跑了一次");
    // 只改清单（在 .deed 里，不算工作区字节）把数改对，再交一次：这一次该复用。
    const fixed = fs.readFileSync(planFile(cwd), "utf8").replace("  交付：跑：2/2", "  交付：跑：1/1");
    fs.writeFileSync(planFile(cwd), fixed);
    const ok = deed(cwd, "submit", "--run", command);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /复用上一次的跑/u, "说出这次没有真跑");
    assert.equal(fs.readFileSync(counter, "utf8").length, 1, "同一份字节上没有再跑一次");
    const done = readEvents(cwd).filter((one) => one.k === "task.done").at(-1);
    assert.equal(done.run.reused, true, "账本里写明这是复用");
    assert.ok(done.run.fingerprint, "记着它站在哪一版字节上");
  } finally {
    fs.rmSync(counter, { force: true });
  }
});

test("bytes that moved make the recorded run stale: the command really runs again", () => {
  const cwd = workspace("run-stale");
  const counter = path.join(os.tmpdir(), "deed-run-count2-" + process.pid + "-" + Date.now());
  const command = countingRun(counter);
  try {
    assert.equal(deed(cwd, "init", "--said", "开始", "--review", "core/**").status, 0);
    addTask(cwd, "做一", "跑得通 1/1");
    addTask(cwd, "做二", "跑得通 1/1");
    fs.writeFileSync(path.join(cwd, "a.md"), "第一处改动\n");
    let plan = fs.readFileSync(planFile(cwd), "utf8").replace("- [ ] T1 做一", "- [x] T1 做一")
      .replace("  标准：跑得通 1/1", "  标准：跑得通 1/1\n  交付：跑：1/1");
    fs.writeFileSync(planFile(cwd), plan);
    assert.equal(deed(cwd, "submit", "--run", command).status, 0);
    assert.equal(fs.readFileSync(counter, "utf8").length, 1);
    // 换了字节再交下一条：旧的跑不作数，真跑一次。
    fs.writeFileSync(path.join(cwd, "b.md"), "第二处改动\n");
    plan = fs.readFileSync(planFile(cwd), "utf8").replace("- [ ] T2 做二", "- [x] T2 做二")
      .replace("  标准：跑得通 1/1", "  标准：跑得通 1/1\n  交付：跑：1/1");
    fs.writeFileSync(planFile(cwd), plan);
    const ok = deed(cwd, "submit", "--run", command);
    assert.equal(ok.status, 0, ok.stderr);
    assert.doesNotMatch(ok.stdout, /复用上一次的跑/u, "字节变了就不能复用");
    assert.equal(fs.readFileSync(counter, "utf8").length, 2, "这份字节上真跑了一次");
    const done = readEvents(cwd).filter((one) => one.k === "task.done").at(-1);
    assert.equal(done.run.reused, undefined, "不是复用");
  } finally {
    fs.rmSync(counter, { force: true });
  }
});
