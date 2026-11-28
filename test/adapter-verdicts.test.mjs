// 结论落进账本之后，得有人把作者叫回来：这条盯账本的线自己不能猜，也不能重播。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { workspace } from "../support/lib.mjs";
import { deed, addTask, deliverTask } from "./support/cli.mjs";
import { newVerdicts, pollVerdicts, wakeMessage } from "../adapters/dsh/verdicts.mjs";

const verdict = (root, extra = []) =>
  deed(root, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=unmet", "--rework", "T1", "--why", "没做到", ...extra);

test("a verdict on the ledger is what wakes the author, once", async () => {
  const cwd = workspace("adapter-verdicts");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "做一", "跑得通");
  deliverTask(cwd, "T1", "跑：跑得通", { file: "a.md" });
  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0, "先把清单交出去");

  const said = [];
  const agent = { status: "idle", followup: (message) => said.push(message) };
  const state = { watermark: null };

  // 第一次只记水线：重载之后不把旧结论当新消息再讲一遍。
  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(said.length, 0, "还没有结论：谁也不叫");

  assert.equal(verdict(cwd).status, 0, "审查者落了不合格");
  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(said.length, 1, "账本上出现结论 → 叫一次");
  const text = said[0].content.map((one) => one.text).join("\n");
  assert.match(text, /不合格/u);
  assert.match(text, /T1/u, "点名要写出来");
  assert.equal(said[0].source.kind, "deed-verdict", "不是人说的话，不记轮次");

  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(said.length, 1, "同一条结论只叫一次");
});

test("while the author is running, the verdict waits for the next turn", async () => {
  const cwd = workspace("adapter-verdicts-busy");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "做一", "跑得通");
  deliverTask(cwd, "T1", "跑：跑得通", { file: "a.md" });
  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0);
  const queued = [];
  const agent = { status: "running", send: (message, target) => queued.push({ message, target }) };
  const state = { watermark: null };
  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(verdict(cwd).status, 0);
  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(queued.length, 1, "正在跑：排到下一轮，不打断");
  assert.equal(queued[0].target, "next-turn");
});

test("several rows landing together become one turn, and the message says what happened", () => {
  const message = wakeMessage([
    { k: "review.log", verdict: "pass", segment: "S01.2", at: "2026-01-01T00:00:00Z" },
    { k: "verdict.pass", segment: "S01.2", at: "2026-01-01T00:00:01Z" },
  ], null);
  const text = message.content.map((one) => one.text).join("\n");
  assert.match(text, /通过/u);
  assert.match(text, /判决通过/u);
  assert.equal(text.split("\n").filter((one) => one.startsWith("· ")).length, 2);
});

// 结论落到作者眼前时是完整的那一份：为什么、每条怎么判的、发现、清单在哪。
test("the wake message carries the verdict in full, not just the names", () => {
  const message = wakeMessage([
    {
      k: "review.log",
      verdict: "fail",
      segment: "S02.20",
      why: "两条在这一份字节上不成立：一个是注释撞了守卫，一个是标准自己写错",
      rework: ["T143", "T153"],
      results: [
        { id: "T97", verdict: "met", note: "三条断言都对" },
        { id: "T143", verdict: "unmet", note: "交付记录还带 sha" },
        { id: "T153", verdict: "unmet", note: "全量 282 条里 1 红在 docs" },
      ],
      findings: ["T143 的放弃没有可核的依据", "T153 那句话改成审查清单就可绿"],
      brief: ".deed/review/S02.20-11281045.md",
      at: "2026-01-01T00:00:00Z",
    },
  ], null);
  const text = message.content.map((one) => one.text).join("\n");
  assert.match(text, /不合格/u);
  assert.match(text, /为什么：两条在这一份字节上不成立/u);
  assert.match(text, /逐条 3 条 · 达成 1 · 没过 2/u);
  assert.match(text, /T143 · unmet · 交付记录还带 sha/u);
  assert.match(text, /T153 · unmet · 全量 282 条里 1 红在 docs/u);
  assert.match(text, /发现 · T143 的放弃没有可核的依据/u);
  assert.match(text, /清单 · .deed\/review\/S02\.20-11281045\.md/u);
  assert.doesNotMatch(text, /T97 · met/u, "达成的只报数，不逐条念");
});

// 叫人只认"事情有了结果"：清单出门只是有人在读，屏上看得见——把它也当成叫醒，
// 就会变成"出清单 → 叫作者 → 作者动手 → 又出清单"的轮子。
test("a sheet going out does not wake the author; a verdict does", async () => {
  const cwd = workspace("adapter-verdicts-brief");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "做一", "跑得通");
  deliverTask(cwd, "T1", "跑：跑得通", { file: "a.md" });

  const said = [];
  const agent = { status: "idle", followup: (message) => said.push(message) };
  const state = { watermark: null };
  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(said.length, 0, "还没有清单：谁也不叫");

  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0, "系统把清单交出去");
  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(said.length, 0, "清单出门不叫人");

  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=unmet", "--rework", "T1", "--why", "没做到").status, 0);
  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(said.length, 1, "结论写进账本才叫人");
  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(said.length, 1, "同一条只叫一次");
});

// 重启那一刻刚好有一份结论落下：那是"刚刚发生的事"，不是旧账，作者得听到。
// 以前第一次轮询只记水线，把这一条也一起吞了——屏幕上什么都没发生，人以为链断了。
test("a verdict written while the watcher is starting is news, not history", async () => {
  const cwd = workspace("adapter-verdicts-restart");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "做一", "跑得通");
  deliverTask(cwd, "T1", "跑：跑得通", { file: "a.md" });
  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0);

  const since = new Date().toISOString();
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=unmet", "--rework", "T1", "--why", "没做到").status, 0, "结论在起这条线之后才落");

  const said = [];
  const agent = { status: "idle", followup: (message) => said.push(message) };
  const state = { watermark: null, since };
  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(said.length, 1, "重启之后刚落的结论也要说一句");
  assert.match(said[0].content.map((one) => one.text).join("\n"), /不合格/u);
});

// 排队会滞后：这条消息可能十几分钟后才送到，那时账本早走远了。每条都带账本时间。
test("every wake line says when it happened in the ledger", async () => {
  const cwd = workspace("adapter-verdicts-stamp");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "做一", "跑得通");
  deliverTask(cwd, "T1", "跑：跑得通", { file: "a.md" });
  const said = [];
  const agent = { status: "idle", followup: (message) => said.push(message) };
  const state = { watermark: null };
  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0);
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=unmet", "--rework", "T1", "--why", "没做到").status, 0);
  await pollVerdicts({ root: cwd, agent, state });
  const text = said[0].content.map((one) => one.text).join("\n");
  assert.match(text, /（\d{2}:\d{2}:\d{2}Z）/u, "带了账本上的时刻");
  assert.match(text, /以 deed state 为准/u, "说清晚到这件事");
});

// 正在跑的时候连落两条结论：只排一条。排三条旧事，下一轮开头读到的全是已经走过的东西。
test("a running author gets one queued wake, not a stack of them", async () => {
  const cwd = workspace("adapter-verdicts-queue");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "做一", "跑得通");
  deliverTask(cwd, "T1", "跑：跑得通", { file: "a.md" });
  const queued = [];
  const agent = { status: "running", send: (message, target) => queued.push({ message, target }) };
  const state = { watermark: null };
  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0, "清单出去");
  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(queued.length, 0, "清单出门不排队");
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=unmet", "--rework", "T1", "--why", "没做到").status, 0);
  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(queued.length, 1, "一条结论排队");
  // 同一轮里又落一条（另一份清单的结论）：已经有一条排着，不再往里塞。
  deliverTask(cwd, "T1", "跑：改了一版", { file: "a.md" });
  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0);
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met").status, 0);
  await pollVerdicts({ root: cwd, agent, state });
  assert.equal(queued.length, 1, "已经有一条排着，不再往里塞");
});
