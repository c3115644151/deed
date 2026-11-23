#!/usr/bin/env node
// The command surface. Every verb appends an event; none of them edit state
// directly, because there is no state to edit -- only a ledger to extend.
//
// The order inside a verb is the contract: fold it first, write it second. An
// action that would make the ledger unreadable is refused before it lands, so a
// single slip (done twice, judging a sealed segment) cannot brick the workspace.
// Every verb that reads then writes holds the lock while it does both.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/digest.mjs";
import { fold } from "../core/fold.mjs";
import { UnknownKindError, validateEvent } from "../core/events.mjs";
import { currentVersion, unknownKindNotice } from "../lib/version.mjs";
import {
  countIn,
  currentSession,
  debt,
  judgeBlockers,
  lastBrief,
  lastDelivery,
  lastSegmentChange,
  nextAction,
  openSegment,
  pendingAsks,
  pressure,
  reading,
  reviewOf,
  configDrift,
  reviewState,
  sessionById,
  signBlockers,
  tasksIn,
} from "../core/rules.mjs";
import {
  DEFAULT_CONFIG,
  append,
  changedPaths,
  ensureDirs,
  paths,
  readConfigFile,
  readEvents,
  withLock,
  writeConfig,
  rel,
  writeSnapshot,
} from "../lib/store.mjs";
import { start } from "../board/serve.mjs";
import { auditBriefs, auditEvidence, bareEvidence, briefTrouble, staleEvidence } from "./audit.mjs";
import { planBrief, writeBrief } from "./brief.mjs";
import { fileStamp, stamp0 } from "../lib/format.mjs";
import { BLOCK as AGENTS_BLOCK, wordsNotice } from "../lib/words.mjs";
import { hookNotice, silenceNotice } from "../lib/heartbeat.mjs";

const ROOT = process.cwd();
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const stamp = () => new Date().toISOString();

// Flags that carry no value. Everything else must be followed by one: a value
// that starts with -- is almost always a forgotten quote, and silently storing
// "true" would turn evidence into a word nobody can check later.
const BOOLEAN_FLAGS = new Set(["pass", "force", "print-agents"]);

// Two things a flag can mean when it is given twice: "all of these" or "the
// caller is confused". Only one flag means the first; for the rest, quietly
// keeping the last value throws away what someone typed.
const REPEATABLE = new Set(["finding", "digest"]);

function parse(argv) {
  const given = new Map();
  const words = [];
  const put = (key, value) => {
    const seen = given.get(key);
    if (seen === undefined) given.set(key, [value]);
    else seen.push(value);
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      words.push(token);
      continue;
    }
    const body = token.slice(2);
    const equals = body.indexOf("=");
    if (equals > 0) {
      put(body.slice(0, equals), body.slice(equals + 1));
      continue;
    }
    if (BOOLEAN_FLAGS.has(body)) {
      put(body, true);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined) {
      put(body, true);
      continue;
    }
    if (next.startsWith("--"))
      throw new Error("--" + body + " 的值不能以 -- 开头：值就是那一串的话，写成 --" + body + '="…"');
    put(body, next);
    i += 1;
  }
  const flags = {};
  for (const [key, values] of given) {
    if (values.length === 1) flags[key] = values[0];
    else if (REPEATABLE.has(key)) flags[key] = values;
    else
      throw new Error(
        "--" + key + " 只收一个值，这条命令里写了 " + values.length + " 遍：把要一起说的写成一条（--" + key + '="…"）',
      );
  }
  return { flags, words };
}

// 接过的目录：门槛落过盘（.deed/config.json）。只看这一个文件，不猜。
const bound = (root) => fs.existsSync(path.join(root, ".deed", "config.json"));

const load = () => {
  const events = readEvents(ROOT);
  return { events, doc: fold(events) };
};

// Fold before append: `build` sees the current document, so ids are chosen
// inside the lock instead of guessed from a stale read.
// commit runs only after the line is on disk: derived state (the workspace
// snapshot) may not move for an event that was refused before appending.
// mayBind：唯一允许在没接过的目录里写的东西是"把门槛落进账本"（init 自己）。
function transact(flags, build, commit, mayBind = false) {
  // 接过的目录才谈得上写：没接过就先拒绝，连 .deed/ 也不该留下——
  // 拿锁会顺手把目录建出来，而被拒的动作不该在工作区里留下任何痕迹。
  if (!mayBind && !bound(ROOT))
    fail("这个目录还没接 deed：先 deed init（没有门槛的账本，读不出状态，也判不了任何一段）");
  return withLock(ROOT, () => {
    const events = readEvents(ROOT);
    const doc = fold(events);
    const stamped = validateEvent(build(doc, flags), stamp());
    // w 记的是写这一行的程序版本，不是事件含义的版本（那是 v）。它让"读到不认得的
    // 类型"以后能有一个可查的答案：账本比程序新，还是这一行本来就有问题。
    stamped.w = currentVersion() || undefined;
    // 没有门槛的账本谁也没法判：还没接过的目录只能由 init 先落基线。
    if (!doc.config && stamped.k !== "config.change")
      fail("这个目录还没接 deed：先 deed init（没有门槛的账本，读不出状态，也判不了任何一段）");
    const after = fold([...events, stamped]);
    append(ROOT, stamped);
    if (commit) commit(stamped);
    return { doc: after, ev: stamped };
  });
}

const session = (doc) => {
  const found = currentSession(doc);
  if (!found) fail("现在没有在推进的会话：先记一轮，会话自己开出来");
  return found;
};

// --session lets a parked period still be read and addressed; writes into a
// closed period are refused by fold, not here.
const targetSession = (doc, flags) => {
  if (!flags.session) return session(doc);
  const found = sessionById(doc, String(flags.session));
  if (!found) fail("账本里没有这个会话：" + flags.session);
  return found;
};

const nextId = (doc, prefix) => {
  const used = doc.sessions.flatMap((one) => [...one.tasks.map((t) => t.id), ...one.asks.map((a) => a.id)]);
  const numbers = used
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)))
    .filter((n) => Number.isInteger(n));
  return prefix + (Math.max(0, ...numbers) + 1);
};

// A refusal must reach the terminal: process.exit() would cut the pipe before
// the line lands on Windows, so the refusal travels as a thrown value instead.
class Refused extends Error {
  constructor(message) {
    super(message);
    this.refused = true;
  }
}

// Reporting a refusal is separate from raising one: a catch block that raised
// again would escape the very guard that was supposed to swallow it.
const reject = (message) => {
  console.error("deed: " + message);
  process.exitCode = 1;
};

function fail(message) {
  reject(message);
  throw new Refused(message);
}

const guard = (fn) => {
  try {
    return fn();
  } catch (err) {
    if (err?.refused) return undefined;
    if (err instanceof UnknownKindError) {
      // 账本比程序新时，拒绝是对的（折不动就是折不动），但话要指对路：
      // 这不是坏账，升级 deed 就能读。
      const notice = unknownKindNotice(err.kind, err.writer, currentVersion(), err.meaning);
      reject(notice.headline);
      console.error("  " + notice.advice);
      return undefined;
    }
    reject(err?.message ?? String(err));
    return undefined;
  }
};

const period = (doc) => "第 " + doc.sessions.length + " 期";

function split(value) {
  if (value === undefined || value === null || value === true) return [];
  return String(value)
    .split(",")
    .map((one) => one.trim())
    .filter(Boolean);
}

function list(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function show(value) {
  if (value === undefined) return "—";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join("、");
  return String(value);
}

const REVIEW_LABEL = {
  exempt: "免审（全部落在 exempt）",
  missing: "要审 · 结论还没落盘",
  pass: "审查通过",
  fail: "审查不合格",
  stale: "结论过期 · 审的是旧内容，要重审",
};

// 账本替人签过名：判决和签收以前默认写 by: "user"，于是 agent 交付、判决、
// 签收一条龙之后，记录上写着是用户按的。名字现在必须由写者给；只有真的在终端
// 里敲（stdin 与 stdout 都是 tty）才允许默认 "user"——那是"有个人在键盘前"这个
// 事实，不是"这个人是用户"这个推断。
function signer(flags, act) {
  if (flags.by) return flags.by;
  if (process.stdin.isTTY && process.stdout.isTTY) return "user";
  fail(act + "不是从终端敲的：deed 不会替你写「用户按的」。写 --by「谁」（比如 agent:claude）");
}

function printState() {
  const { doc, events } = load();
  const config = doc.config;
  const open = currentSession(doc);
  // 没接过 deed 的目录不能看起来"一切正常"：状态里每个字都得有账本撑着。
  if (!config) {
    console.log("");
    console.log("这个目录还没接 deed · 先 deed init（把门槛基线记进账本）");
    console.log("  账本 " + (events.length ? events.length + " 条，但没有门槛：不知道哪些改动要审" : "还没有"));
    console.log("");
    return;
  }
  console.log("");
  console.log("状态 · " + ({ idle: "没有在推进的会话", discuss: "讨论", execute: "执行", accept: "验收" }[reading(doc)]));
  if (!open) {
    console.log(
      doc.sessions.length === 0
        ? "（还没有会话；下一轮对话会开第一期）"
        : "（上一期已收口；下一轮对话会自己开新期）",
    );
  } else {
    const seg = openSegment(open);
    console.log(
      "会话 " + open.id + " · 开于 " + stamp0(open.openedAt) + " · " + open.turns.length + " 轮 · " + open.segments.length + " 段",
    );
    const shown = seg ?? open.segments[open.segments.length - 1];
    if (!shown) {
      console.log("  还没有段：范围说完就写第一条任务");
    } else {
      const count = countIn(open, shown);
      console.log(
        "  段 " + shown.id + " · 开于 " + stamp0(shown.openedAt) + " · " + count.total + " 条（未做 " + count.todo + " · 已交付 " + (count.done + count.accepted) + "）· " + (shown.closedAt ? "判过 · " + stamp0(shown.closedAt) : REVIEW_LABEL[reviewState(config, open, shown)]),
      );
      for (const task of tasksIn(open, shown)) {
        const mark = { todo: "○", done: "●", accepted: "✓", deferred: "…", dropped: "×" }[task.status];
        console.log("    " + mark + " " + task.id + " " + task.title + "  ·  " + task.criteria);
      }
      const review = reviewOf(open, shown);
      if (review) {
        console.log("    审查 " + review.id + " · " + review.by + " · " + review.verdict + " · " + stamp0(review.at));
        for (const one of review.findings) console.log("      发现 · " + one);
      }
    }
    for (const ask of pendingAsks(open)) console.log("  待裁 " + ask.id + " · " + ask.text);
    const owed = debt(open);
    if (owed.deferred.length + owed.dropped.length > 0)
      console.log("  欠着 · 延后 " + show(owed.deferred) + " · 放弃 " + show(owed.dropped));
    const blockers = signBlockers(doc, open, config);
    console.log("  签收 " + (blockers.length === 0 ? "可行" : "差：" + blockers.join("；")));
    const watch = pressure(open);
    if (watch && watch.tasks > 3) console.log("  提示 · 这一段已经 " + watch.tasks + " 条，还压着 " + watch.undecided + " 条待判");
    const stale = staleEvidence(ROOT, doc, open.id);
    if (stale.length > 0) console.log("  交付记录过期 · " + stale.map((one) => one.id).join("、") + "（记下的文件变了，deed verify 看细节）");
  }
  for (const one of doc.sessions)
    if (one.closedAt)
      console.log(
        "  已收口 · " + one.id + " · " + (one.title ?? "未命名") + " · " + (one.closeKind === "signed" ? "签收" : "强制归档") + " · " + stamp0(one.closedAt),
      );
  for (const change of doc.changes)
    console.log("  门槛改过 · " + change.key + " · " + stamp0(change.at) + " · " + change.by + " · " + change.why);
  const drift = configDrift(doc.config, readConfigFile(ROOT));
  if (drift.length > 0)
    console.log(
      "  门槛 文件与账本不一致 · " + drift.map((one) => one.key).join("、") + "（规则只认账本；deed verify 看细节，改门槛用 deed init --force … --why）",
    );
  const step = nextAction(doc, config);
  console.log("");
  console.log("下一步 · " + step.who + " · " + step.what + "：" + step.text);
  console.log("  " + step.command);
  console.log("");
  if (!fs.existsSync(paths(ROOT).log)) console.log("还没有账本 · deed init 之后才有");
  else console.log("账本 " + events.length + " 条 · " + (path.relative(ROOT, paths(ROOT).log) || ".deed/log"));
  console.log("");
}

// The brief is the reviewer input: one file per verdict, never overwritten.
// The bytes are decided here, written only once the event is on disk -- a
// verdict that fold refuses must not leave a brief nobody will ever read.
// 接过之后能立刻做完的几件事。一次说全，省得 agent 再翻文档去猜；
// 每一件都是可选的：没人做，账本照样能往下走。
function optionalBlock(config) {
  const port = config.board.port;
  return [
    " 接下来这几件都能现在做完（都可选，不做也不会坏）：",
    "   规则     deed init --print-agents  → 原样粘进 AGENTS.md 或 CLAUDE.md（deed 不写那个文件）",
    "   面板     deed serve                → 本机只读 http://127.0.0.1:" + port,
    "   体检     deed doctor               → 账本坏在哪、接入还缺什么",
    "   门槛     deed gate                 → 看这个工作区的门（没有门时它会说没有，并给一行写法）",
    "   改门槛   deed init --force --review \"…\" --exempt \"…\" --port " + port + " --why \"为什么改\"",
  ];
}

const commands = {
  init(argv) {
    const { flags, words } = parse(argv);
    // Printing the block is the only way deed helps a workspace describe it
    // without writing into files it does not own; it must therefore work before
    // init has touched anything, and must not touch anything itself.
    if (flags["print-agents"]) {
      console.log(AGENTS_BLOCK);
      return;
    }
    const p = ensureDirs(ROOT);
    const { doc: before } = load();
    const ledger = before.config;             // 账本里的门槛：规则只认这个
    const disk = readConfigFile(ROOT);        // 磁盘上的草稿：init 收下才算数
    const drift = configDrift(ledger, disk);
    if (ledger && !flags.force) {
      console.log("deed: 这个工作区已经接过钩子（.deed/config.json 在）");
      if (drift.length > 0)
        console.log("  注意：磁盘上的门槛和账本不一致（" + drift.map((one) => one.key).join("、") + "）；规则只认账本，deed verify 会报出来。");
      console.log("  要收下磁盘上的值：deed init --force --why \"为什么改\"");
      console.log("  要改门槛：deed init --force --review \"…\" --exempt \"…\" --why \"为什么改\"（改动会记进账本）");
      for (const line of optionalBlock(ledger ?? disk ?? DEFAULT_CONFIG)) console.log(line);
      return;
    }
    // What this run did not name stays what the workspace already chose: a
    // forced re-init must not quietly drop the review gate or empty the gates.
    // What this run did not name stays what the workspace chose: the file as it
    // stands, else the ledger, else the defaults.
    const base = disk ?? ledger;
    const config = {
      review: {
        required: split(flags.review ?? (base?.review?.required ?? DEFAULT_CONFIG.review.required).join(",")),
        exempt: split(flags.exempt ?? (base?.review?.exempt ?? DEFAULT_CONFIG.review.exempt).join(",")),
      },
      gates: base?.gates ?? DEFAULT_CONFIG.gates,
      board: { port: Number(flags.port ?? base?.board?.port ?? DEFAULT_CONFIG.board.port) },
    };
    if (!Number.isInteger(config.board.port) || config.board.port < 0 || config.board.port > 65535)
      fail("端口要写成 0–65535 的整数：" + String(flags.port) + "；例如 --port 7317");
    // A ledger with no threshold yet has nothing to compare against: the first
    // init records the baseline, and every change after it has to say why.
    for (const key of ["review", "gates", "board"]) {
      const from = ledger?.[key] ?? null;
      const to = config[key];
      if (sameJson(from, to)) continue;
      if (ledger && !flags.why) fail("改门槛要写清为什么：--why \"…\"（这一改会进账本，谁都能看到）");
      transact(
        {},
        () => ({
          k: "config.change",
          s: null,
          key,
          from,
          to,
          why: flags.why ?? "init 收下的门槛",
          by: flags.by ?? "user",
        }),
        undefined,
        true, // 门槛落盘之前这个目录还不算接过：init 是唯一的例外
      );
    }
    writeConfig(ROOT, config);
    writeSnapshot(ROOT, changedPaths(ROOT).now);
    console.log("deed: 建好 " + path.relative(ROOT, p.dir) + "/（账本、审查清单、配置）");
    console.log("  要审的路径：" + show(config.review.required));
    console.log("  免审的路径：" + show(config.review.exempt));
    const said = flags.said ?? words.join(" ");
    if (said) {
      const { doc } = transact(flags, () => ({ k: "turn", s: null, who: flags.who ?? "user", said }));
      console.log("  记下第一轮，会话 " + currentSession(doc).id + " 已经开出来");
    }
    const after = load().doc;
    const step = nextAction(after, after.config);
    console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
    console.log("  " + step.command);
    for (const line of optionalBlock(config)) console.log(line);
  },

  tick(argv) {
    const { flags, words } = parse(argv);
    const said = flags.said ?? words.join(" ");
    if (!said) fail("tick 要说清这一轮说了什么：deed tick --who user --said \"…\"");
    guard(() => {
      const { doc, ev } = transact(flags, () => ({ k: "turn", s: flags.session ?? null, who: flags.who ?? "agent", said, did: flags.did }));
      const one = sessionById(doc, ev.s ?? doc.sessions[doc.sessions.length - 1].id);
      console.log("已记一轮 · 会话 " + one.id + " · 第 " + one.turns.length + " 轮" + (ev.did ? " · 做了：" + ev.did : ""));
    });
  },

  task(argv) {
    const [verb, ...rest] = argv;
    const { flags, words } = parse(rest);
    const id = words[0] ?? flags.id;
    guard(() => {
      if (verb === "add") {
        const title = flags.title ?? words.join(" ");
        if (!title) fail("task add 要写清这件事：deed task add \"…\" --criteria \"…\"");
        if (!flags.criteria) fail("task add 要写清做完的标准：--criteria \"…\"");
        const { doc, ev } = transact(flags, (doc0) => ({
          k: "task.add",
          s: flags.session ?? null,
          id: flags.id ?? nextId(doc0, "T"),
          title,
          criteria: flags.criteria,
          files: split(flags.files),
        }));
        const one = sessionById(doc, ev.s ?? doc.sessions[doc.sessions.length - 1].id);
        const task = one.tasks.find((t) => t.id === ev.id);
        console.log("写进清单 · " + ev.id + " · 段 " + task.segment + " · 做完的标准：" + flags.criteria);
        return;
      }
      if (verb === "done") {
        if (!id) fail("task done 要点名任务");
        if (!flags.evidence) fail("task done 必须带一条交付记录：--evidence \"命令与结果\"");
        // 一次交付常常动了不止一个文件，而"记下的那个文件"才是事后能核的唯一凭据：
        // 只收一枚，剩下的只能靠人挑，挑漏的那几份就成了没人担保的字节。
        // --digest 可以写多遍，每一遍指一个文件。
        const pins = list(flags.digest).map((given) => {
          const file = path.resolve(ROOT, String(given));
          const inside = path.relative(ROOT, file);
          if (inside.startsWith("..") || path.isAbsolute(inside))
            fail("--digest 只认工作区里的文件：" + given + " 在外面（工作区是 " + ROOT + "）");
          let stat;
          try {
            stat = fs.statSync(file);
          } catch {
            fail("--digest 指的文件不在：" + given);
          }
          if (!stat.isFile()) fail("--digest 要指一个文件，不是目录：" + given + "（例如 docs/a.md）");
          return { path: rel(ROOT, file), digest: digest(fs.readFileSync(file)) };
        });
        // Snapshot before taking the lock: hashing the tree is the slow part of a
        // delivery, and holding the lock across it would make every other writer
        // wait for a scan. The snapshot is derived data; the ledger line is not.
        const scanned = changedPaths(ROOT);
        let moved = scanned.changed;
        let snapshotFiles = scanned.now;
        transact(
          flags,
          () => {
            const taken = scanned;
            return {
              k: "task.done",
              s: flags.session ?? null,
              id,
              evidence: flags.evidence,
              by: flags.by ?? "agent",
              digest: pins[0]?.digest ?? null,
              digestPath: pins[0]?.path ?? null,
              files: pins,
              changed: taken.changed,
            };
          },
          () => writeSnapshot(ROOT, snapshotFiles),
        );
        console.log(
          "交付 · " + id + " · 交付记录：" + flags.evidence +
            (pins.length === 0 ? "" : " · 记下 " + pins.map((one) => one.path + " " + one.digest.slice(0, 12)).join("、")),
        );
        if (moved.length > 0) console.log("  这一交付动了 " + moved.length + " 个路径（门槛按它判，不只按声明的 --files）");
        return;
      }
      // A delivery that said the wrong thing is taken back, not rewritten: the
      // ledger keeps both facts, and the brief stops counting it as proof.
      if (verb === "undo") {
        if (!id) fail("task undo 要点名任务");
        if (!flags.why) fail("task undo 要说清为什么收回：--why \"…\"");
        transact(flags, () => ({ k: "task.undo", s: flags.session ?? null, id, why: flags.why, by: flags.by ?? "agent" }));
        console.log("撤回交付 · " + id + " · " + flags.why);
        return;
      }
      if (verb === "defer" || verb === "drop") {
        if (!id) fail("task " + verb + " 要点名任务");
        if (!flags.why) fail("task " + verb + " 要说清为什么：--why \"…\"");
        transact(flags, () => ({ k: verb === "defer" ? "task.defer" : "task.drop", s: flags.session ?? null, id, why: flags.why }));
        console.log((verb === "defer" ? "延后" : "放弃") + " · " + id + " · " + flags.why);
        return;
      }
      fail("task 只认 add / done / undo / defer / drop");
    });
  },

  ask(argv) {
    const [verb, ...rest] = argv;
    const { flags, words } = parse(rest);
    const id = words[0] ?? flags.id;
    guard(() => {
      if (verb === "resolve" || verb === "withdraw") {
        if (!id) fail("ask " + verb + " 要点名待裁项");
        if (verb === "resolve" && !flags.decision) fail("ask resolve 要写清裁定：--decision \"…\"");
        if (verb === "withdraw" && !flags.why) fail("ask withdraw 要说清为什么撤回：--why \"…\"");
        transact(flags, () => ({
          k: verb === "resolve" ? "ask.resolve" : "ask.withdraw",
          s: flags.session ?? null,
          id,
          decision: flags.decision,
          why: flags.why,
          by: flags.by ?? "user",
        }));
        console.log((verb === "resolve" ? "裁定" : "撤回") + " · " + id + " · " + (flags.decision ?? flags.why));
        return;
      }
      const text = verb && verb !== "raise" ? [verb, ...words].join(" ") : words.join(" ");
      if (!text) fail("ask 要写清问题：deed ask \"…\" --reading \"…\" --why \"…\"");
      if (!flags.reading) fail("ask 必须写清我理解成什么：--reading \"…\"");
      if (!flags.why) fail("ask 必须写清为什么不确定：--why \"…\"");
      const { ev } = transact(flags, (doc0) => ({
        k: "ask.raise",
        s: flags.session ?? null,
        id: flags.id ?? nextId(doc0, "A"),
        text,
        reading: flags.reading,
        why: flags.why,
      }));
      console.log("待裁 · " + ev.id + " · " + text);
    });
  },

  // Two verbs in one, on purpose: handing out the brief and landing a verdict
  // are different people at different times.
  review(argv) {
    const { flags } = parse(argv);
    guard(() => {
      const { doc } = load();
      const one = targetSession(doc, flags);
      const seg = flags.segment ? one.segments.find((s) => s.id === flags.segment) : openSegment(one);
      if (!seg)
        fail(
          flags.segment
            ? "会话 " + one.id + " 里没有段 " + flags.segment + "：账本里的段是 " + (one.segments.map((s) => s.id).join("、") || "（一个都没有）")
            : "现在没有待审的段",
        );
      if (seg.closedAt) fail("段 " + seg.id + " 已经封存，结论不能再落");
      if (!flags.verdict) {
        // 清单写的是"这些条目、这些交付记录"。还有条目没交，清单就是一份没人能答的卷子：
        // 交完再出，否则它一出生就是旧的。
        const pending = tasksIn(one, seg).filter((task) => task.status === "todo");
        if (pending.length > 0)
          fail("段 " + seg.id + " 还有没交付的（" + pending.map((task) => task.id).join("、") + "）：清单等交付完再出");
        const handed = lastBrief(one, seg.id);
        const answered = handed && one.reviews.some((rv) => rv.brief === handed.brief);
        if (handed && !answered) {
          // 交出去的那份只要没被动过，就在等结论；被改过或删了就另出一份——
          // 手上那份已经不是账本里记的那一份，谁读它都不算数。
          const file = path.resolve(ROOT, handed.brief);
          const pack = handed.guide ? path.resolve(ROOT, handed.guide) : null;
          // 两份材料是一起交出去的：任何一份被动过，手上就不是审查者读过的那一份。
          const intact =
            fs.existsSync(file) &&
            digest(fs.readFileSync(file)) === handed.briefDigest &&
            (!pack || (fs.existsSync(pack) && digest(fs.readFileSync(pack)) === handed.guideDigest));
          // 清单写的是它发出那一刻的条目与交付记录。之后这一段又动了（加任务、
          // 交付、收回），这份清单就不再说这一段现在的事——换一份，别让人审旧内容。
          const moved = lastSegmentChange(one, seg);
          const stale = moved !== null && moved > handed.at;
          if (intact && stale) console.log("上一份清单(" + handed.brief + ")出在这一段最近一次改动之前：另出一份");
          else if (intact) {
            console.log("审查清单 · " + handed.brief + "（这一段已经出过，等结论落盘）");
            console.log("  结论用 deed review --segment " + seg.id + " --by \"…\" --verdict pass|fail");
            return;
          } else console.log("上一份材料(" + handed.brief + " 与角色包)改过或丢了：另出一份，旧的那条账本记录留着（verify 会报）");
        }
        const plan = planBrief(ROOT, one, seg, stamp());
        const brief = rel(ROOT, plan.file);
        const guide = rel(ROOT, plan.guideFile);
        transact(
          flags,
          () => ({ k: "review.brief", s: one.id, segment: seg.id, brief, briefDigest: plan.digest, guide, guideDigest: plan.guideDigest }),
          () => writeBrief(plan, brief),
        );
        console.log("审查清单 · " + brief + "（审什么）");
        console.log("  角色包 · " + guide + "（怎么审）· 两份一起交给审查者");
        console.log("  结论用 deed review --segment " + seg.id + " --by \"…\" --verdict pass|fail");
        return;
      }
      if (!flags.by) fail("review 要给结论就要写清谁审的：--by \"…\"");
      const waiting = tasksIn(one, seg).filter((task) => task.status === "todo");
      if (waiting.length > 0)
        fail("段 " + seg.id + " 还有没交付的（" + waiting.map((task) => task.id).join("、") + "）：结论只能落在交付之后");
      // A verdict answers the document that was handed out. Writing a fresh one
      // here would pin bytes produced after the reading -- a brief nobody read.
      const handed = lastBrief(one, seg.id);
      if (!handed) fail("这一段还没有清单：先 deed review --segment " + seg.id + " 出清单，再把结论落回来");
      const file = path.resolve(ROOT, handed.brief);
      if (!fs.existsSync(file)) fail("清单不在了（" + handed.brief + "）：先 deed review --segment " + seg.id + " 重出一份");
      if (digest(fs.readFileSync(file)) !== handed.briefDigest)
        fail("清单被改过（" + handed.brief + "）：它不是审查者读到的那一份；重新出一次再审（deed review --segment " + seg.id + "）");
      // 角色包和清单成对交出去，结论回答的是两份一起。换掉角色包（"怎么审"
      // 被改成"随便过"）同样是一份没人读过的材料。
      if (handed.guide) {
        const pack = path.resolve(ROOT, handed.guide);
        if (!fs.existsSync(pack)) fail("角色包不在了（" + handed.guide + "）：先 deed review --segment " + seg.id + " 重出一份");
        if (digest(fs.readFileSync(pack)) !== handed.guideDigest)
          fail("角色包被改过（" + handed.guide + "）：它不是审查者读到的那一份；重新出一次再审（deed review --segment " + seg.id + "）");
      }
      // 清单变了，结论就没法回答它：那一份写的不是现在这一段。
      const moved = lastSegmentChange(one, seg);
      if (moved !== null && moved > handed.at)
        fail("这一段在清单出过之后又动过（" + handed.brief + "）：结论只能回答清单上那几条，deed review --segment " + seg.id + " 另出一份再审");
      const findings = list(flags.finding);
      // 一条结论要么放行，要么说清哪几条要重做。不合格而不点名，接到结论的人
      // 只能回来猜——那是把判断留给没看过活的人。
      const rework = split(flags.rework).filter(Boolean);
      if (flags.verdict === "fail") {
        if (rework.length === 0) fail("不合格要点名要重做的条目：--rework T1,T2（不点名的结论没人能接）");
        if (!flags.why) fail("不合格要说清为什么：--why \"一句话总结\"（具体问题写在 --finding 里）");
      } else if (rework.length > 0) {
        fail("--rework 只跟 --verdict fail 一起用：pass 的意思是这一段过了，没有要退回的条目");
      }
      const after = transact(flags, () => ({
        k: "review.log",
        s: one.id,
        segment: seg.id,
        by: flags.by,
        verdict: flags.verdict,
        brief: handed.brief,
        briefDigest: handed.briefDigest,
        findings,
        ...(flags.verdict === "fail" ? { rework, why: flags.why } : {}),
      })).doc;
      if (flags.verdict === "pass") {
        console.log("审查通过 · " + seg.id + " · " + flags.by + " · 段已封存");
        console.log("  清单 " + handed.brief);
        for (const one2 of findings) console.log("  发现 · " + one2);
        const step = nextAction(after, after.config);
        console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
        console.log("  " + step.command);
        return;
      }
      console.log("审查不合格 · " + seg.id + " · " + flags.by + " · 退回 " + rework.join("、") + " · " + flags.why);
      console.log("  清单 " + handed.brief);
      for (const one2 of findings) console.log("  发现 · " + one2);
      console.log("  被点名的条目回到未做；补完再交，deed review --segment " + seg.id + " 另出清单再审");
    });
  },

  judge(argv) {
    const { flags, words } = parse(argv);
    guard(() => {
      const { doc } = load();
      // 推翻一条结论是例外，不是步骤：段由审查者的 pass 自己封，人不签字；
      // 人只在"这一份结论错了"的时候出手，而且要写明为什么。它会点名一条结论，
      // 所以按结论找会话，而不是按"现在开着哪一期"找。
      const overturned = flags.overturn
        ? doc.sessions.flatMap((one2) => one2.reviews.map((rv) => ({ session: one2, review: rv }))).find((pair) => pair.review.id === flags.overturn)
        : null;
      if (flags.overturn && !overturned) {
        const known = doc.sessions.flatMap((one2) => one2.reviews.map((rv) => one2.id + "/" + rv.id + "（" + rv.verdict + "）"));
        fail("账本里没有结论 " + flags.overturn + "：账本里的结论是 " + (known.join("、") || "（一条都没有）"));
      }
      const one = overturned ? overturned.session : targetSession(doc, flags);
      if (flags.overturn) {
        const review = overturned.review;
        if (review.voidedAt) fail("结论 " + review.id + " 已经作废过（" + review.voidedBy + "）：再推翻它没有意义");
        if (!flags.why) fail("推翻一条结论要说清为什么：--why \"…\"");
        if (one.closeKind)
          fail(
            "这一期已经" + (one.closeKind === "signed" ? "签收" : "搁下") + "（" + one.words + "）：账本不往回改，" +
              "错在哪就开新一期把要补的记进去；要推翻结论得在签收之前",
          );
        const after = transact(flags, () => ({
          k: "review.overturn",
          s: one.id,
          review: review.id,
          why: flags.why,
          by: signer(flags, "推翻结论"),
        })).doc;
        console.log("推翻 · 段 " + review.segment + " · " + review.id + " · " + flags.by + " · " + flags.why);
        console.log("  这一段回到没判过的样子：重新出清单、重新审");
        const step = nextAction(after, after.config);
        console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
        console.log("  " + step.command);
        return;
      }
      // A pass judges the segment still open; a rework may reach back into the
      // one a verdict just closed, because that is how settled work reopens.
      const newest = one.segments[one.segments.length - 1];
      const seg = flags.segment
        ? one.segments.find((s) => s.id === flags.segment)
        : flags.rework
          ? (openSegment(one) ?? newest)
          : openSegment(one);
      if (!seg)
        fail(
          (flags.segment ? "会话 " + one.id + " 里没有段 " + flags.segment : "现在没有待判的段") +
            "：账本里的段是 " +
            (one.segments.map((s) => s.id + (s.closedAt ? "（判过）" : "")).join("、") || "（一个都没有）") +
            (openSegment(one) ? "；开着的段是 " + openSegment(one).id : "；没有开着的段"),
        );
      if (flags.pass) {
        const inSegment = new Set(tasksIn(one, seg).map((t) => t.id));
        const audit = auditEvidence(ROOT, doc, one.id);
        const stale = audit.stale.filter((s) => inSegment.has(s.id));
        const outside = audit.outside.filter((s) => inSegment.has(s.id));
        if (outside.length > 0)
          fail("这一段有交付记录指到工作区外面（" + outside.map((s) => s.id + " → " + s.path).join("、") + "）：deed 只认工作区里的文件，改回来重新交付");
        if (stale.length > 0)
          fail("这一段有交付记录过期（" + stale.map((s) => s.id + " 记下 " + s.path).join("、") + "），记下的内容已经变了：重新交付再判");
        const blockers = judgeBlockers(doc.config, one, seg);
        if (blockers.length > 0) fail("这一段还不能判：" + blockers.join("；"));
        const after = transact(flags, () => ({ k: "judge.pass", s: one.id, segment: seg.id, by: signer(flags, "判决") })).doc;
        console.log("判决通过 · " + seg.id + " · 段已封存");
        const step = nextAction(after, after.config);
        console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
        console.log("  " + step.command);
        return;
      }
      if (flags.rework) {
        // Both spellings name tasks; ignoring the positional one silently
        // reworked a subset of what the reviewer asked for.
        const named2 = [...split(flags.rework), ...words].filter(Boolean);
        if (named2.length === 0) fail("judge --rework 要点名要重做的任务");
        if (!flags.why) fail("judge --rework 要说清为什么：--why \"…\"");
        // 撤一条审查结论和发一份清单一样要署名：否则账本只记得谁判过，不记得谁推翻的。
        if (!flags.by) fail("judge --rework 要写清谁打回的：--by \"…\"");
        transact(flags, () => ({ k: "judge.rework", s: one.id, segment: seg.id, tasks: named2, why: flags.why, by: flags.by }));
        console.log("打回 · " + seg.id + " · " + named2.join("、") + " · " + flags.by + " · " + flags.why);
        console.log("  段没封，补完再判；上一份审查结论已经作废");
        return;
      }
      fail("judge 只认 --overturn <R1> --why \"…\"（推翻一条结论）；审查者放行就是封段，不再需要人签字");
    });
  },

  sign(argv) {
    const { flags } = parse(argv);
    guard(() => {
      const { doc } = load();
      const one = targetSession(doc, flags);
      const blockers = signBlockers(doc, one, doc.config);
      if (blockers.length > 0) fail("还不能签收：" + blockers.join("；"));
      if (!flags.words) fail("签收要留用户原话：--words \"…\"");
      const title = flags.title ?? period(doc);
      transact(flags, () => ({ k: "sign", s: one.id, words: flags.words, title, by: signer(flags, "签收") }));
      console.log("签收 · " + one.id + " · " + title + " · 「" + flags.words + "」");
      const owed = debt(one);
      if (owed.deferred.length + owed.dropped.length > 0)
        console.log("  带着走的欠账 · 延后 " + show(owed.deferred) + " · 放弃 " + show(owed.dropped));
      console.log("  会话封存，下一轮对话会自己开新期");
    });
  },

  shelve(argv) {
    const { flags } = parse(argv);
    guard(() => {
      const { doc } = load();
      const one = targetSession(doc, flags);
      if (!flags.why) fail("强制归档要说清为什么：--why \"…\"");
      transact(flags, () => ({ k: "shelve", s: one.id, why: flags.why, by: "user" }));
      console.log("强制归档 · " + one.id + " · 未结清 · " + flags.why);
      const owed = debt(one);
      console.log("  （异常结束会一直带着这个标记；欠账 延后 " + show(owed.deferred) + " · 放弃 " + show(owed.dropped) + "）");
    });
  },

  state() {
    guard(printState);
  },

  verify() {
    guard(() => {
      const { doc } = load();
      if (!doc.config) {
        console.log("这个目录还没接 deed：deed init 之后才有账本和交付记录可查");
        process.exitCode = 1;
        return;
      }
      const { stale, outside, covered } = auditEvidence(ROOT, doc);
      if (covered.length > 0)
        console.log("早先的交付 " + covered.length + " 条 · 已被后来的交付覆盖（" + covered.map((one) => one.id).join("、") + "；钉过的内容现在是什么不再核对）");
      const bare = bareEvidence(doc);
      const briefs = auditBriefs(ROOT, doc);
      const looseBriefs = briefTrouble(briefs);
      for (const one of bare) console.log("没钉内容 · " + one.id + "（--evidence 里没有 --digest：说得出做了什么，查不了）");
      for (const one of briefs.unpinned) console.log("清单没指纹 · " + one.segment + " · " + one.brief + "（账本没记 sha256：改没改过查不出来）");
      for (const one of briefs.orphan)
        console.log("清单没人发过 · " + one.segment + " · " + one.brief + "（账本里没有 review.brief：这份结论读的是谁给的？）");
      for (const one of briefs.stray) console.log("清单没人认领 · " + one.brief + "（账本没记过这一份：手写的，或者出了没落成事件）");
      for (const one of briefs.gone) console.log("清单不在了 · " + one.segment + " · " + one.brief);
      for (const one of briefs.edited)
        console.log("清单对不上 · " + one.segment + " · " + one.brief + " · 账本记的 " + one.digest.slice(0, 12) + "，现在是 " + one.actual.slice(0, 12));
      for (const one of briefs.outside) console.log("清单越界 · " + one.segment + " · " + one.brief + "（不在这个工作区里）");
      // The threshold is a ledger fact; the file is a mirror. A mirror that
      // disagrees is not a broken ledger -- it is a decision nobody recorded.
      const drift = configDrift(doc.config, readConfigFile(ROOT));
      for (const one of drift)
        console.log("门槛对不上 · " + one.key + " · 账本里是 " + JSON.stringify(one.ledger) + "，磁盘上写的是 " + JSON.stringify(one.disk));
      const wrong = stale.length + outside.length;
      if (wrong === 0 && looseBriefs === 0 && drift.length === 0) {
        if (bare.length === 0) console.log("交付记录有效：每一条都说得出做了什么，也都记下了一份内容的 sha256");
        else console.log("交付记录有效：记下内容的都还在，另有 " + bare.length + " 条没记文件（要审的段判决前会被挡）");
        return;
      }
      for (const one of stale) console.log("交付记录过期 · " + one.id + " · " + one.path + " · 记下 " + one.digest.slice(0, 12));
      for (const one of outside) console.log("路径越界 · " + one.id + " · " + one.path + "（不在这个工作区里）");
      const reasons = [];
      if (wrong > 0)
        reasons.push(
          "有 " + wrong + " 处交付记录对不上" + (stale.length ? "：过期 " + stale.length : "") + (outside.length ? "：越界 " + outside.length : "") + "；重新交付，或者把它们从判决范围里去掉",
        );
      if (drift.length > 0)
        reasons.push(
          "门槛文件和账本对不上：规则只认账本，这一改没进过账本；要么用 deed init --force --why \"为什么改\" 把磁盘上的值收下，要么把文件改回账本里的值",
        );
      if (looseBriefs > 0)
        reasons.push(
          "有 " + looseBriefs + " 份清单对不上账本：结论读的那份被改过、丢了、没人发过，或者目录里躺着一份账本不认识的；审查者判不合格就点名退回（--verdict fail --rework T1 --why 「为什么」），再重新出一份、重新审一次——发清单本身会记成事件，指纹在那条事件上",
        );
      fail(reasons.join("；"));
    });
  },

  doctor() {
    guard(() => {
      const p = paths(ROOT);
      if (!fs.existsSync(p.log)) {
        console.log("没有账本：deed init 之后才有");
        return;
      }
      const files = fs
        .readdirSync(p.log)
        .filter((name) => /^\d{4}-\d{2}\.jsonl$/.test(name))
        .sort();
      const events = [];
      let bad = null;
      for (const name of files) {
        const lines = fs.readFileSync(path.join(p.log, name), "utf8").split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          if (!lines[i].trim()) continue;
          let ev;
          try {
            ev = JSON.parse(lines[i]);
          } catch {
            bad = { file: name, line: i + 1, why: "这一行不是合法 JSON" };
            break;
          }
          try {
            validateEvent(ev, ev.at);
            fold([...events, ev]);
          } catch (err) {
            const notice = err instanceof UnknownKindError ? unknownKindNotice(err.kind, err.writer, currentVersion(), err.meaning) : null;
            bad = {
              file: name,
              line: i + 1,
              why: notice ? notice.headline : err.message,
              advice: notice?.advice ?? null,
              newer: notice?.newer ?? false,
            };
            break;
          }
          events.push(ev);
        }
        if (bad) break;
      }
      if (!bad) {
        console.log("账本干净 · " + events.length + " 条事件都能重放");
        const { doc } = load();
        const stale = staleEvidence(ROOT, doc);
        if (stale.length > 0) console.log("  交付记录过期 " + stale.length + " 处（不算坏账）：" + stale.map((s) => s.id).join("、"));
        const briefs = auditBriefs(ROOT, doc);
        const loose = briefTrouble(briefs);
        const words = wordsNotice(ROOT);
        if (words) console.log("  接入 · " + words);
        const last = events[events.length - 1];
        const silence = silenceNotice(last?.at, stamp0);
        console.log("  心跳 · " + hookNotice(ROOT) + (silence ? " · " + silence : ""));
        if (loose > 0)
          console.log(
            "  清单对不上 " + loose + " 份（不算坏账，deed verify 看细节）：" +
              [...briefs.unpinned, ...briefs.gone, ...briefs.edited, ...briefs.outside, ...briefs.orphan].map((s) => s.segment).join("、") +
              (briefs.stray.length ? (briefs.unpinned.length + briefs.gone.length + briefs.edited.length + briefs.outside.length + briefs.orphan.length ? "、" : "") + briefs.stray.map((s) => s.brief).join("、") : ""),
          );
        return;
      }
      // 账本比程序新不是坏账：这一行是别人写下的真事，只是这本程序读不懂。
      // 两种情形的动作相反（升级 vs 挪走），所以不能共用一套话。
      if (bad.newer) {
        console.log("账本比 deed 新 · " + bad.file + " 第 " + bad.line + " 行");
        console.log("  " + bad.why);
        console.log("  " + bad.advice);
        fail("先升级 deed 再读这本账：当前版本读不动的类型只在更新的账本里才有");
        return;
      }
      console.log("账本坏了 · " + bad.file + " 第 " + bad.line + " 行 · " + bad.why);
      if (bad.advice) {
        console.log("  " + bad.advice);
      } else {
        console.log("  账本只追加，唯一允许的人工修法是把这一行整行移到 .deed/log/rejected/ 下并记下为什么；");
        console.log("  不要改动其它行，也不要手写补账：缺的那件事，用正常命令重新做一次。");
      }
      fail("坏账需要人处理：" + bad.file + " 第 " + bad.line + " 行");
    });
  },

  // The gates belong to the host: deed knows the list and the order, nothing
  // about what a pass means. Running them is the only thing promised here.
  gate(argv) {
    const { flags, words } = parse(argv);
    guard(() => {
      const config = load().doc.config ?? {};
      const declared = Object.entries(config.gates ?? {}).filter(([, commands]) => Array.isArray(commands) && commands.length > 0);
      const wanted = words.length > 0 ? words.map((name) => [name, config.gates?.[name]]) : declared;
      if (wanted.length === 0)
        fail(
          "这个工作区没有门：先在 .deed/config.json 的 gates 里写上命令（例如 { \"gates\": { \"commit\": [\"npm test\"] } }），再用 deed init --force --why \"加门\" 把它记进账本",
        );
      for (const [name, commands] of wanted) {
        if (!Array.isArray(commands) || commands.length === 0)
          fail("门 " + name + " 没写命令：账本里的 gates." + name + " 是空数组（改文件后用 deed init --force --why 收进账本）");
        for (const command of commands) {
          console.log("门 " + name + " · " + command);
          const done = spawnSync(command, { cwd: ROOT, shell: true, stdio: "inherit" });
          if (done.status !== 0)
            fail("门 " + name + " 没过：" + command + "（退出码 " + (done.status ?? ("信号 " + done.signal)) + "）");
        }
        console.log("门 " + name + " 过 · " + commands.length + " 条命令");
      }
      if (flags.digest) fail("门不需要 --digest");
    });
  },

  serve(argv) {
    const { flags } = parse(argv);
    guard(() => {
      const { doc } = load();
      // Serving a directory that never took the hook would create .deed just to
      // render an empty board, leaving a workspace that looks initialised.
      if (!doc.config) fail("这个目录还没接 deed：" + ROOT + " 里没有账本门槛，先 deed init");
      const port = Number(flags.port ?? doc.config.board?.port ?? 7317);
      if (!Number.isInteger(port) || port < 0 || port > 65535)
        fail("端口要写成 0–65535 的整数：" + String(flags.port) + "；例如 deed serve --port 7317");
      start(ROOT, port);
    });
  },
};

const HELP = [
  "deed · 一个工作区的事实账本",
  "",
  "deed --version                   打印这个程序自己的版本",
  "deed init --print-agents         打印一段可粘贴的 AGENTS.md 规则，不改工作区",
  "deed init [--said \"…\"] [--review \"src/**,…\"] [--exempt \"docs/**\"] [--port 7317]",
  "deed tick --who user|agent --said \"…\" [--did \"…\"] [--session S01]",
  "deed task add \"<要做的事>\" --criteria \"<做完的标准>\" [--files \"src/a.mjs,docs/b.md\"]",
  "deed task done <T1> --evidence \"<命令与结果>\" [--digest <路径> …] [--session S01]",
  "deed task undo <T1> --why \"…\"         收回最后那条交付（说错了话用它，别改写成对的）",
  "deed task defer|drop <T1> --why \"…\"",
  "deed ask \"<问题>\" --reading \"我理解成…\" --why \"…\"",
  "deed ask resolve|withdraw <A1> [--decision \"…\"] [--why \"…\"]",
  "deed review [--segment S01.1]          发审查清单与角色包（记一条 review.brief），打印两份路径",
  "deed review --segment S01.1 --by \"谁\" --verdict pass [--finding \"…\"]   pass 直接封段",
  "deed review --segment S01.1 --by \"谁\" --verdict fail --rework T1,T2 --why \"…\" [--finding \"…\"]",
  "deed judge --overturn R1 --why \"…\"    推翻一条在案的结论（例外，不是步骤）",
  "deed sign --words \"<用户原话>\" [--title \"<这一期的名字>\"]",
  "deed shelve --why \"…\"",
  "deed state",
  "deed verify",
  "deed doctor",
  "deed gate [名字…]              按账本里的 gates 顺序跑门，失败即退出",
  "deed serve [--port 7317]",
  "",
  "所有写操作都先重放后落盘：会被拒的动作一个字也不会进账本。",
].join("\n");

const [verb, ...rest] = process.argv.slice(2);
// HELP 里有的动词不带参数（state、verify、doctor），那一行没有尾空格；
// 要求尾空格会把它们漏掉，再回落成整本帮助。
const usageOf = (one) =>
  HELP.split("\n").filter((line) => line === "deed " + one || line.startsWith("deed " + one + " "));
// `deed review --help` used to hand out a brief: asking what a verb takes is
// not asking it to do the thing.
if (rest.some((one) => one === "--help" || one === "-h")) {
  const lines = usageOf(verb);
  console.log(lines.length > 0 ? [lines[0], ...lines.slice(1)].join("\n") : HELP);
  process.exit(0);
}
if (!verb || verb === "help" || verb === "--help") {
  console.log(HELP);
  process.exit(0);
}
// Asked before the verb table: this is the program talking about itself, and a
// missing answer is the first thing a fresh install trips over.
if (verb === "--version" || verb === "-v" || verb === "version") {
  console.log(currentVersion());
  process.exit(0);
}
// An unknown verb is refused, not thrown: fail() raises, and the raise would
// reach the terminal as a stack trace with nobody left to swallow it.
const command = commands[verb];
if (!command) reject("没有这个动作：" + verb + "（deed help 看全部）");
else guard(() => command(rest));
