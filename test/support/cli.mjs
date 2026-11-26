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
// 目的不再是独立动作：它写在清单第一行（# 这一期要做成什么 下面那句），submit 记账。

// 命令面里已经没有 deed task 了：加条目、交付、撤回都走清单 + submit。
// 这三个助手只是把"改文件"写短，做的事与人在编辑器里做的一样。
const planLines = (cwd) => readPlan(cwd).split("\n");

const writeEntry = (cwd, id, change) => {
  const lines = planLines(cwd);
  const at = lines.findIndex((one) => one.startsWith("- ") && one.includes(" " + id + " "));
  if (at < 0) throw new Error("清单里没有 " + id + "：先 addTask");
  const next = lines.findIndex((one, i) => i > at && (one.startsWith("- ") || one.startsWith("## ") || one.startsWith("<!--")));
  const end = next < 0 ? lines.length : next;
  const body = lines.slice(at + 1, end);
  const tail = body.filter((one) => !one.startsWith("  交付：") && !one.startsWith("  理由："));
  lines[at] = change.box === "x" ? lines[at].replace(/^- \[[ x]\]/, "- [x]") : lines[at].replace(/^- \[[ x]\]/, "- [ ]");
  const extra = change.box === "x" && change.claim ? ["  交付：" + change.claim] : change.why ? ["  理由：" + change.why] : [];
  lines.splice(at + 1, end - at - 1, ...tail, ...extra);
  writePlan(cwd, lines.join("\n"));
};

// 加一条：写进清单再 submit（条目与段都是 submit 领的）。
// 草稿尾部有一节「## 下一段」占位：留着它，新条目就会被当成"要开的下一段"。
export const addTask = (cwd, title, criteria, opts = {}) => {
  // 每次从账本重出一份草稿：加一条就 submit，磁盘上那份从不领先账本。
  // 这样换来的是，"上一期签收之后再加一条"落到新一期，而不是撞在旧清单上。
  deed(cwd, "plan", "--force");
  let lines = readPlan(cwd).replace(/\s*$/u, "").split("\n");
  const placeholder = lines.findIndex((one) => one.startsWith("## 下一段"));
  if (placeholder >= 0) lines = lines.slice(0, placeholder);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  lines.push("", "- ? " + title, "  标准：" + criteria);
  writePlan(cwd, lines.join("\n") + "\n");
  return opts.session ? deed(cwd, "submit", "--session", opts.session) : deed(cwd, "submit");
};

// 交付：先真的动一个文件（submit 按快照差记下动过哪些路径），再勾上写一句。
export const deliverTask = (cwd, id, claim, opts = {}) => {
  // 默认替它写一个凭据文件；删文件那类场景用 keep，让"删掉"本身成为这次改动。
  const file = opts.file ?? "proof-" + id + ".txt";
  if (!opts.keep) {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), claim);
  }
  // 被拒时把清单还原：一次没落地的改动不该留在文件里，下一次交付会被它连坐。
  const before = readPlan(cwd);
  writeEntry(cwd, id, { box: "x", claim });
  const out = deed(cwd, "submit");
  if (out.status !== 0) writePlan(cwd, before);
  return out;
};

export const undoDelivery = (cwd, id, why) => {
  const before = readPlan(cwd);
  writeEntry(cwd, id, { box: " ", why });
  const out = deed(cwd, "submit");
  if (out.status !== 0) writePlan(cwd, before);
  return out;
};

export const dropTask = (cwd, id, why) => {
  const lines = planLines(cwd);
  const at = lines.findIndex((one) => one.startsWith("- ") && one.includes(" " + id + " "));
  if (at < 0) throw new Error("清单里没有 " + id);
  lines[at] = lines[at].replace(/^- \[[ x]\]/, "~~");
  lines.splice(at + 1, 0, "  理由：" + why);
  writePlan(cwd, lines.join("\n"));
  return deed(cwd, "submit");
};

export const setGoal = (cwd, text) => {
  const file = planFile(cwd);
  if (!fs.existsSync(file)) {
    writePlan(cwd, ["# 这一期要做成什么", text].join("\n"));
  } else {
    const lines = readPlan(cwd).split("\n");
    const head = lines.findIndex((one) => one.startsWith("# "));
    if (head < 0) lines.unshift("# 这一期要做成什么", text);
    else if (head + 1 < lines.length) lines[head + 1] = text;
    else lines.push(text);
    writePlan(cwd, lines.join("\n"));
  }
  return deed(cwd, "submit");
};
