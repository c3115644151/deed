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
