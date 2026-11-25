import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import net from "node:net";
import { workspace } from "../../support/lib.mjs";
import { readEvents } from "../../lib/store.mjs";
import { fold } from "../../core/fold.mjs";
import { EVENT_VERSION, validateEvent } from "../../core/events.mjs";
import { panelRecord, buildNow, watchedFiles } from "../../lib/panel.mjs";
import { auditDelivered, movedSince, requireUnchanged } from "../../cli/pins.mjs";
import { applyGate, gatesOf } from "../../board/gates.mjs";

export const CLI = path.join(import.meta.dirname, "..", "..", "cli", "deed.mjs");
// 面板默认关掉：每条命令都去拉一个后台服务，测试就成了端口和进程的集合。
export const OFF = { ...process.env, DEED_NO_PANEL: "1" };
export const deed = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: OFF });
export const later = (cwd, ...args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: OFF });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });
// 签收与推翻结论只在面板上按：用例走同一个入口，只是不经过 HTTP。
export const gate = (cwd, action) => {
  try {
    const result = applyGate(cwd, action);
    return { status: 0, stdout: (result.notes ?? []).join("\n") + "\n", stderr: "", ev: result.ev };
  } catch (error) {
    return { status: 1, stdout: "", stderr: String(error.message ?? error), ev: null };
  }
};
// 审查通过之后要人判一次：用例里由这个助手把手上等判决的段都按过去（专门测这道闸的
// 用例不经过它，直接用 gate）。
export const judgeAll = (cwd) => {
  const doc = fold(readEvents(cwd));
  const waiting = doc.sessions.flatMap((one) => one.segments.filter((seg) => seg.closedAt === null && seg.verdict === "pass"));
  for (const seg of waiting) {
    const out = gate(cwd, { action: "judgement", segment: seg.id });
    if (out.status !== 0) throw new Error("判决 " + seg.id + " 失败：" + out.stderr);
  }
  return waiting.length;
};
export const judgeHere = (cwd, segment) => gate(cwd, { action: "judgement", segment });
export const signHere = (cwd, words, extra = {}) => {
  judgeAll(cwd);
  return gate(cwd, { action: "sign", words, ...extra });
};
// 期审要求每一段都有结局：判决是那一步之前的事。
export const judged = (cwd, ...args) => {
  judgeAll(cwd);
  return deed(cwd, ...args);
};
export const kinds = (cwd) => readEvents(cwd).map((one) => one.k);
export const briefs = (cwd) => fs.readdirSync(path.join(cwd, ".deed", "review"));
// A delivery that pins nothing cannot be checked afterwards, so the tests pin a
// file the way a real run does before a reviewed segment can be judged.
export const proof = (cwd, name = "proof.txt") => {
  fs.writeFileSync(path.join(cwd, name), name);
  return name;
};

// 账本可能比程序新：这一行是别人写下的真事，只是这本程序读不懂。
export const writeLines = (cwd, extra) => {
  const file = fs.readdirSync(path.join(cwd, ".deed", "log")).find((one) => one.endsWith(".jsonl"));
  fs.appendFileSync(path.join(cwd, ".deed", "log", file), extra.map((one) => JSON.stringify(one) + "\n").join(""));
};
export const planFile = (cwd) => path.join(cwd, ".deed", "plan.md");
export const writePlan = (cwd, text) => fs.writeFileSync(planFile(cwd), text, "utf8");
export const readPlan = (cwd) => fs.readFileSync(planFile(cwd), "utf8");
