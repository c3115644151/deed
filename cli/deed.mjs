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
  goalOf,
  lastBrief,
  lastDelivery,
  lastSegmentChange,
  needsWhole,
  nextAction,
  openSegment,
  pendingAsks,
  periodChange,
  pressure,
  reading,
  reviewOf,
  configDrift,
  reviewState,
  exemptSegments,
  sealBlockers,
  sessionById,
  signBlockers,
  tasksIn,
} from "../core/rules.mjs";
import {
  DEFAULT_CONFIG,
  append,
  appendMany,
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
import { ensurePanel, panelNow, panelOff, startPanel, stopPanel } from "./panel.mjs";
import { auditBriefs, auditEvidence, bareEvidence, bareHistory, briefTrouble, staleEvidence } from "./audit.mjs";
import { planBrief, planWhole, writeBrief } from "./brief.mjs";
import { FORMAT as PLAN_FORMAT, draft as planDraft, parse as parsePlan } from "./plan.mjs";
import { fileStamp, stamp0 } from "../lib/format.mjs";
import { BLOCK as AGENTS_BLOCK, wordsNotice } from "../lib/words.mjs";
import { hookNotice, silenceNotice } from "../lib/heartbeat.mjs";

const ROOT = process.cwd();
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const stamp = () => new Date().toISOString();

// Flags that carry no value. Everything else must be followed by one: a value
// that starts with -- is almost always a forgotten quote, and silently storing
// "true" would turn evidence into a word nobody can check later.
const BOOLEAN_FLAGS = new Set(["pass", "force", "print-agents", "all", "format"]);

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

// 一份清单说几件事，就把几件事一起落进账本：任何一行被拒，磁盘上一个字都不动。
// 整批先在内存里重放到最后一行，通过了才一次性写——半批落盘会让清单和账本对不上，
// 而对不上的那一刻没人知道哪一条算数。
function transactMany(flags, buildAll, commit) {
  if (!bound(ROOT))
    fail("这个目录还没接 deed：先 deed init（没有门槛的账本，读不出状态，也判不了任何一段）");
  return withLock(ROOT, () => {
    const events = readEvents(ROOT);
    const doc = fold(events);
    const at = stamp();
    const specs = buildAll(doc, flags);
    if (specs.length === 0) fail("清单里没有要落的改动：改了哪一条再来一次");
    // 一批里的交付共用一次工作区差：进来的 batch: true 在这里换成这一批的时刻与条数。
    // 条数写进账本，撤回同批的一条之后清单仍说得出原本几条；只记时刻的话，
    // 剩下的条数会当成原来的数目，两条一批撤回一条就成了「单条的一批」。
    // 换要在校验之前：before: true 不是账本里的形状，校验只看得到最终的 { at, size }。
    const marked = specs.filter((one) => one.batch === true);
    if (marked.length > 0) {
      const batch = { at, size: marked.length };
      for (const one of marked) one.batch = batch;
    }
    const stamped = specs.map((spec) => {
      const one = validateEvent(spec, at);
      one.w = currentVersion() || undefined;
      return one;
    });
    const after = fold([...events, ...stamped]);
    appendMany(ROOT, stamped);
    if (commit) commit(stamped, after);
    return { doc: after, evs: stamped };
  });
}

// 「先做后记」：一条交付记下的文件，如果它最后一次写入的时刻早于这条任务
// 被写进账本的时刻，那这条任务是追认已经做完的事，不是先答应再做。账本里的时刻
// 改不了；这里拿文件的写入时刻对一次，只报事实——不是坏账，是账本和事实对不上。
function lateWork(root, doc) {
  const git = (args) => {
    const one = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    return one.status === 0 ? one.stdout.trim() : null;
  };
  // 只在 git 工作区里比。mtime 只在能被 git 解释的工作树里代表「写下来的时刻」：
  // 从别处拷来的、解压出来的、检出出来的目录，mtime 是搬运的时刻，比任务被记下
  // 的时刻早晚都没有意义。没有 git 就整段不报，也不报错。
  if (git(["rev-parse", "--is-inside-work-tree"]) !== "true") return [];
  const seen = new Map();
  // 比的是文件的最后写入时刻：提交时刻总在任务被记下之后（先写、再记、再提交），
  // 拿它来比永远看不出这件事。代价是 clone 出来的工作副本 mtime 全是检出时刻，
  // 这条检查在那种副本上不报——报不出来的方向是安静，不是诬告。
  const when = (file) => {
    if (!seen.has(file)) {
      try {
        seen.set(file, fs.statSync(path.resolve(root, file)).mtimeMs);
      } catch {
        seen.set(file, null);
      }
    }
    return seen.get(file);
  };
  const late = [];
  for (const session of doc.sessions) {
    for (const task of session.tasks) {
      const last = task.evidence[task.evidence.length - 1];
      if (!last) continue;
      const recorded = Date.parse(task.createdAt);
      if (!Number.isFinite(recorded)) continue;
      for (const pin of last.files ?? []) {
        const written = when(pin.path);
        if (written === null || written >= recorded) continue;
        late.push({ id: task.id, path: pin.path, written, recorded });
        break;
      }
    }
  }
  return late;
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

// 撤的是哪份字节，撤的那一刻就写下：重放再去推，等于让后来的形状改口。
// 两条入口（deed task undo 与 submit 里把勾去掉）落的是同一个事实，共用这一处。
const undoesOf = (task) => {
  const last = task.evidence[task.evidence.length - 1];
  if (!last) return null;
  return last.files ?? (last.digest && last.path ? [{ path: last.path, digest: last.digest }] : []);
};

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
  fail("「" + act + "」没有写名字：deed 不替任何动作填名字。写 --by「谁」（比如 agent:claude）");
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
    // 一期要做成什么：整期审与签收都拿它当尺子，所以它得在状态里看得见。
    const aim = goalOf(open);
    if (aim) console.log("  目的 · " + aim);
    else if (open.segments.length > 1 && needsWhole(config, open))
      console.log('  目的 · 还没有（deed goal "…"）：整期审与签收都拿它当尺子');
    const shown = seg ?? open.segments[open.segments.length - 1];
    if (!shown) {
      console.log("  还没有段：范围说完就写第一条任务");
    } else {
      const count = countIn(open, shown);
      console.log(
        "  段 " + shown.id + " · 开于 " + stamp0(shown.openedAt) + " · " + count.total + " 条（未做 " + count.todo + " · 已交付 " + (count.done + count.accepted) + "）· " + (shown.closedAt
          ? (shown.verdict === "exempt" ? "免审 · " : "判过 · ") + stamp0(shown.closedAt)
          : REVIEW_LABEL[reviewState(config, open, shown)]),
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

// 记下的内容变了，那一条交付回答的就不是现在的工作区：封段、落结论都不能装作
// 没发生过。这里只问账本与磁盘的差，不看谁的判断。
const auditSegment = (doc, session, seg) => {
  const inSegment = new Set(tasksIn(session, seg).map((task) => task.id));
  const audit = auditEvidence(ROOT, doc, session.id);
  const outside = audit.outside.filter((spot) => inSegment.has(spot.id));
  if (outside.length > 0)
    fail(
      "这一段有交付记录指到工作区外面（" + outside.map((spot) => spot.id + " → " + spot.path).join("、") + "）：deed 只认工作区里的文件，改回来重新交付",
    );
  const stale = audit.stale.filter((spot) => inSegment.has(spot.id));
  if (stale.length > 0)
    fail(
      "这一段有交付记录过期（" + stale.map((spot) => spot.id + " 记下 " + spot.path).join("、") + "），记下的内容已经变了：重新交付再封段",
    );
};

// 整期审的同一件差事：抄一遍这一期全部任务，不再按段过滤。
const auditAll = (doc, session) => {
  const audit = auditEvidence(ROOT, doc, session.id);
  if (audit.outside.length > 0)
    fail(
      "这一期有交付记录指到工作区外面（" + audit.outside.map((spot) => spot.id + " → " + spot.path).join("、") + "）：deed 只认工作区里的文件，改回来重新交付",
    );
  if (audit.stale.length > 0)
    fail(
      "这一期有交付记录过期（" + audit.stale.map((spot) => spot.id + " 记下 " + spot.path).join("、") + "），记下的内容已经变了：重新交付再落结论",
    );
};

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
      const { doc, ev } = transact(flags, (doc0) => {
        const who = flags.who ?? "agent";
        // 一轮记的是「这一轮这个人说了什么」。agent 把用户原话抄进 --said，
        // 账本上就成了同一句由两个人说过——那句话只属于说它的人，抄一遍
        // 会让读的人以为重复了一轮。
        if (who === "agent") {
          const one = flags.session ? doc0.sessions.find((s) => s.id === flags.session) : doc0.sessions[doc0.sessions.length - 1];
          const lastUser = one?.turns.filter((turn) => turn.who === "user").at(-1);
          if (lastUser && lastUser.said.trim() === said.trim())
            fail("这句是用户说的（" + lastUser.at + " 那一轮已经记下）：--said 写你自己这一轮说的话");
        }
        return { k: "turn", s: flags.session ?? null, who, said, did: flags.did };
      });
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
        const pinSizes = {};
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
          pinSizes[rel(ROOT, file)] = stat.size;
          return { path: rel(ROOT, file), digest: digest(fs.readFileSync(file)) };
        });
        // Snapshot before taking the lock: hashing the tree is the slow part of a
        // delivery, and holding the lock across it would make every other writer
        // wait for a scan. The snapshot is derived data; the ledger line is not.
        const scanned = changedPaths(ROOT);
        let moved = scanned.changed;
        let snapshotFiles = scanned.now;
        // 规模是规则看得见的一半：碰了几个文件数得出来，几个字节得在交付那一刻称。
        // 删掉的文件记 0——它今天占的字节就是零，不是"没称过"。
        const sizes = {};
        for (const one of moved) {
          try {
            sizes[one] = fs.statSync(path.join(ROOT, one)).size;
          } catch {
            sizes[one] = 0;
          }
        }
        // 手工 --digest 常常指一份这次没动过、但这条任务得担着的文件：它不在工作区差里，
        // 于是没人称过它，门槛只好按要审处理。称它一下，规模这一半才说得清。
        for (const [file, size] of Object.entries(pinSizes)) if (sizes[file] === undefined) sizes[file] = size;
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
              bytes: sizes,
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
        transact(flags, (doc) => {
          const one = currentSession(doc);
          const task = one ? one.tasks.find((t) => t.id === id) : null;
          if (!task) fail("这个会话里没有任务 " + id);
          const undoes = undoesOf(task);
          return {
            k: "task.undo", s: flags.session ?? null, id, why: flags.why, by: flags.by ?? "agent",
            ...(undoes === null ? {} : { undoes }),
          };
        });
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

  // 一期要做成什么。它不是一个备注：签收签的是它，整体审拿它当尺子。
  // 可以改，改一次一条记录——"当初说要什么"活着，才谈得上"做到了没有"。
  goal(argv) {
    const { flags, words } = parse(argv);
    guard(() => {
      const { doc } = load();
      const one = targetSession(doc, flags);
      const text = flags.text ?? words.join(" ").trim();
      if (!text) fail('目的要写成一句话：deed goal "这一期要做成什么"');
      const after = transact(flags, () => ({ k: "goal.set", s: one.id, text, why: flags.why ?? null, by: signer(flags, "记目的") })).doc;
      console.log("目的 · " + one.id + " · " + text);
      if (flags.why) console.log("  为什么改 · " + flags.why);
      const step = nextAction(after, after.config);
      console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
      console.log("  " + step.command);
    });
  },

  // Two verbs in one, on purpose: handing out the brief and landing a verdict
  // are different people at different times.
  review(argv) {
    const { flags } = parse(argv);
    guard(() => {
      const { doc } = load();
      const one = targetSession(doc, flags);
      // 整体审：对象是这一期，不是某一段。材料覆盖它全部的任务，pass 时把还没封的段
      // 一起封，fail 时点名的条目可以跨段。一段的一期不审两遍：它的段审就是整期审。
      if (flags.all) {
        if (flags.segment) fail("--all 说的是这一期，--segment 说的是某一段：一次只审一个对象");
        if (one.segments.length === 1)
          fail(
            "这一期只有一段：" + one.segments[0].id + " 的审查就是这一期的审查（deed review --segment " + one.segments[0].id + "）",
          );
        const goal = goalOf(one);
        if (!flags.verdict) {
          if (!goal) fail('这一期还没写目的：先说清这一期要做成什么（deed goal "…"），整体审才有尺子');
          const openSegs = one.segments.filter((s) => s.closedAt === null);
          if (one.segments.length !== 1 && openSegs.length > 0)
            fail("还有段没封：" + openSegs.map((s) => s.id).join("、") + "：多段的一期先逐段封，最后整体审");
          const pending = one.tasks.filter((task) => task.status === "todo");
          if (pending.length > 0)
            fail("这一期还有没交付的（" + pending.map((task) => task.id).join("、") + "）：整体审的材料等交付完再发");
          // 门槛说各段都不用审时，整期结论没人需要：允许出，但先把话说在前面，
          // 免得账本上留下一条看着像「这一期被整体审过」的结论。这句话排在检查
          // 之后：还有段没封的期上说「各段都免审」是假话。
          if (!needsWhole(doc.config, one))
            console.log("这一期的各段都免审（门槛说不用审，段是 deed seal 封的）：不需要整期结论——要出一份也行，签收不看它");
          const last = one.briefs.filter((b) => b.scope === "session").at(-1) ?? null;
          const answered = last && one.reviews.some((rv) => rv.scope === "session" && rv.brief === last.brief);
          if (last && !answered) {
            const file = path.resolve(ROOT, last.brief);
            const pack = last.guide ? path.resolve(ROOT, last.guide) : null;
            const intact =
              fs.existsSync(file) &&
              digest(fs.readFileSync(file)) === last.briefDigest &&
              (!pack || (fs.existsSync(pack) && digest(fs.readFileSync(pack)) === last.guideDigest));
            const moved = periodChange(one);
            const stale = moved !== null && moved > last.at;
            if (intact && stale) console.log("上一份整体审材料(" + last.brief + ")出在这一期最近一次改动之前：另出一份");
            else if (intact) {
              console.log("整体审材料 · " + last.brief + "（这一期已经出过，等结论落盘）");
              console.log('  结论用 deed review --all --by "…" --verdict pass|fail');
              return;
            } else console.log("上一份材料(" + last.brief + " 与角色包)改过或丢了：另出一份，旧的那条账本记录留着（verify 会报）");
          }
          const plan = planWhole(ROOT, one, stamp());
          const brief = rel(ROOT, plan.file);
          const guide = rel(ROOT, plan.guideFile);
          transact(
            flags,
            () => ({
              k: "review.brief",
              s: one.id,
              scope: "session",
              goal,
              brief,
              briefDigest: plan.digest,
              guide,
              guideDigest: plan.guideDigest,
            }),
            () => writeBrief(plan, brief),
          );
          console.log("整体审材料 · " + brief + "（审什么）");
          console.log("  角色包 · " + guide + "（怎么审）· 两份一起交给审查者");
          console.log('  结论用 deed review --all --by "…" --verdict pass|fail');
          return;
        }
        if (!flags.by) fail('review 要给结论就要写清谁审的：--by "…"');
        auditAll(doc, one);
        const waiting = one.tasks.filter((task) => task.status === "todo");
        if (waiting.length > 0)
          fail("这一期还有没交付的（" + waiting.map((task) => task.id).join("、") + "）：结论只能落在交付之后");
        const handed = one.briefs.filter((b) => b.scope === "session").at(-1) ?? null;
        if (!handed) fail("这一期还没有整体审材料：先 deed review --all 出材料，再把结论落回来");
        const file = path.resolve(ROOT, handed.brief);
        if (!fs.existsSync(file)) fail("整体审材料不在了（" + handed.brief + "）：先 deed review --all 重出一份");
        if (digest(fs.readFileSync(file)) !== handed.briefDigest)
          fail("整体审材料被改过（" + handed.brief + "）：它不是审查者读到的那一份；重新出一次再审（deed review --all）");
        if (handed.guide) {
          const pack = path.resolve(ROOT, handed.guide);
          if (!fs.existsSync(pack)) fail("角色包不在了（" + handed.guide + "）：先 deed review --all 重出一份");
          if (digest(fs.readFileSync(pack)) !== handed.guideDigest)
            fail("角色包被改过（" + handed.guide + "）：它不是审查者读到的那一份；重新出一次再审（deed review --all）");
        }
        const moved = periodChange(one);
        if (moved !== null && moved > handed.at)
          fail("这一期在材料出过之后又动过（" + handed.brief + "）：结论只能回答材料上那一份，deed review --all 另出一份再审");
        const findings = list(flags.finding);
        const rework = split(flags.rework).filter(Boolean);
        if (flags.verdict === "fail") {
          if (rework.length === 0) fail("不合格要点名要重做的条目：--rework T1,T2（不点名的结论没人能接）");
          if (!flags.why) fail('不合格要说清为什么：--why "一句话总结"（具体问题写在 --finding 里）');
        } else if (rework.length > 0) {
          fail("--rework 只跟 --verdict fail 一起用：pass 的意思是这一期过了，没有要退回的条目");
        }
        const after = transact(flags, () => ({
          k: "review.log",
          s: one.id,
          scope: "session",
          by: flags.by,
          verdict: flags.verdict,
          brief: handed.brief,
          briefDigest: handed.briefDigest,
          goal: handed.goal ?? null,
          findings,
          ...(flags.verdict === "fail" ? { rework, why: flags.why } : {}),
        })).doc;
        if (flags.verdict === "pass") {
          console.log("整体审通过 · " + one.id + " · " + flags.by + " · 段已封存");
          console.log("  材料 " + handed.brief);
          for (const one2 of findings) console.log("  发现 · " + one2);
        } else {
          console.log("整体审不合格 · " + one.id + " · " + flags.by + " · 退回 " + rework.join("、") + " · " + flags.why);
          console.log("  材料 " + handed.brief);
          for (const one2 of findings) console.log("  发现 · " + one2);
          console.log("  被点名的条目回到未做；补完再交，deed review --all 另出材料再审");
        }
        const step = nextAction(after, after.config);
        console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
        console.log("  " + step.command);
        return;
      }
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
      auditSegment(doc, one, seg);
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

  // 清单：人和 agent 改同一份文件，submit 一次落账。命令面因此只剩一个入口，
  // 而「改了什么」由工作区快照自己称——清单上不写路径，也不写 sha256。
  plan(argv) {
    const { flags } = parse(argv);
    guard(() => {
      if (flags.format) {
        console.log(PLAN_FORMAT);
        return;
      }
      const { doc } = load();
      const one = targetSession(doc, flags);
      const text = planDraft(one);
      if (flags.print) {
        console.log(text);
        return;
      }
      const file = path.join(ROOT, ".deed", "plan.md");
      if (fs.existsSync(file) && !flags.force)
        fail("清单已经在 " + rel(ROOT, file) + "：改它，改完 deed submit（要按账本重出一份，加 --force）");
      ensureDirs(ROOT);
      fs.writeFileSync(file, text + "\n", "utf8");
      console.log("清单 · " + rel(ROOT, file) + " · " + one.id + " · " + one.tasks.length + " 条");
      console.log("  勾上 = 交付（写一行 交付：）；取消勾选 = 撤回（写一行 理由：）；? = 新条目；~~ = 放弃（写一行 理由：）；延后：= 延后");
    });
  },

  submit(argv) {
    const { flags } = parse(argv);
    guard(() => {
      const file = path.join(ROOT, ".deed", "plan.md");
      if (!fs.existsSync(file)) fail("还没有清单：先 deed plan 出一份草稿，改完再 deed submit");
      const plan = parsePlan(fs.readFileSync(file, "utf8"));
      if (plan.problems.length > 0)
        fail("清单有 " + plan.problems.length + " 处看不懂，一个字都没落：" + "\n" + "  " + plan.problems.join("\n" + "  "));
      // 称重与快照在锁外做：跑一遍工作区是慢的那一半，锁里只做判与落。
      const scanned = changedPaths(ROOT);
      const by = flags.by ?? "agent";
      const sizes = {};
      for (const one of scanned.changed) {
        try {
          sizes[one] = fs.statSync(path.join(ROOT, one)).size;
        } catch {
          sizes[one] = 0;
        }
      }
      const pins = [];
      for (const one of scanned.changed) {
        const full = path.join(ROOT, one);
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
        pins.push({ path: one, digest: scanned.now.get(one) });
      }
      const { doc, evs } = transactMany(
        flags,
        (doc0) => {
          const one = targetSession(doc0, flags);
          if (one.closeKind)
            fail("这一期已经" + (one.closeKind === "signed" ? "签收" : "搁下") + "：账本不往回改；要接着做就记一轮，会话自己开新一期");
          const specs = [];
          const said = plan.goal.startsWith("（还没写") ? "" : plan.goal;
          if (said && said !== (one.goal?.text ?? "")) specs.push({ k: "goal.set", s: one.id, text: said, by });
          if (plan.items.length === 0 && one.tasks.length === 0) fail("清单里一条都没有：先写一条再 submit");
          const known = new Map(one.tasks.map((t) => [t.id, t]));
          const mentioned = new Set();
          let seq = Number(nextId(doc0, "T").slice(1));
          for (const item of plan.items) {
            if (item.box === "?") {
              if (!item.criteria) fail("第 " + item.at + " 行是新条目，但没有写一行 标准：——没有标准就不算一件事");
              const id = "T" + seq;
              seq += 1;
              specs.push({ k: "task.add", s: one.id, id, title: item.title, criteria: item.criteria, files: [] });
              mentioned.add(id);
              continue;
            }
            if (item.box === "x" && !item.id)
              fail(
                "第 " + item.at + " 行勾上了却没有编号：一次 submit 不能既新增又交付——先把条目写成任务，做完再勾上交",
              );
            const task = known.get(item.id);
            if (!task) fail("第 " + item.at + " 行的 " + item.id + " 账本里没有：新条目写成 - ? 标题，submit 时领号");
            mentioned.add(item.id);
            if (item.title && item.title !== task.title)
              fail(item.id + " 的标题和账本不一样：清单只做四件事（勾上、撤勾、~~、?），改标题不算其中");
            if (item.criteria && item.criteria !== task.criteria)
              fail(item.id + " 的标准和账本不一样：清单不改已经写下的标准；做法变了就新开一条，把旧的那条说清为什么不做");
            if (item.box === "~") {
              if (task.status === "dropped") continue;
              if (!item.why) fail(item.id + " 要放弃，但没有写一行 理由：——放弃是账本里的一件事实，得说清为什么");
              specs.push({ k: "task.drop", s: one.id, id: item.id, why: item.why });
              continue;
            }
            if (item.box === "x") {
              // 判过（accepted）的条目在清单里也是勾着的：它已经交过、也有人判过，
              // 再交一次既没有意义，也会撞上「封了的段不能再改」。
              if (task.status === "done" || task.status === "accepted") continue;
              if (task.status === "dropped") fail(item.id + " 已经放弃过：要接着做就新开一条");
              if (!item.claim) fail(item.id + " 勾上了，但没有写一行 交付：——勾上就是交付，得写清跑了什么、结果几比几");
              // 一条交付总要指着点什么：既没量到改动、也没有文件可指时，写下去就是一条谁也核不了的空话。
              // 只删不改也算动了——那时 pins 是空的，但 changed 里有那条走了的路径，得放行。
              if (pins.length === 0 && scanned.changed.length === 0)
                fail(
                  item.id +
                    " 勾上了，但这一批没有量到任何改动、也没有文件可指：先真的动过再勾，或者用 deed task done " +
                    item.id +
                    " --evidence \"…\" --digest <工作区里的文件> 手工指那份内容",
                );
              specs.push({
                k: "task.done",
                s: one.id,
                id: item.id,
                evidence: item.claim,
                by,
                digest: pins[0]?.digest ?? null,
                digestPath: pins[0]?.path ?? null,
                files: pins,
                changed: scanned.changed,
                bytes: sizes,
              });
              continue;
            }
            if (task.status === "done") {
              if (!item.why) fail(item.id + " 的勾去掉了，但没有写一行 理由：——撤回一条交付得说清为什么");
              const undoes = undoesOf(task);
              specs.push({
                k: "task.undo", s: one.id, id: item.id, why: item.why, by,
                ...(undoes === null ? {} : { undoes }),
              });
              continue;
            }
            if (item.later) {
              if (task.status === "deferred") continue;
              specs.push({ k: "task.defer", s: one.id, id: item.id, why: item.later });
            }
          }
          // 一批交付不止一条时，工作区只量了一次差：谁改了什么分不出来。
          // 给它们同一个批号，账本上写着「这几条共用一份差」，而不是谎称各钉各的。
          const dones = specs.filter((spec) => spec.k === "task.done");
          if (dones.length > 1) for (const spec of dones) spec.batch = true;
          const gone = one.tasks.filter((t) => !mentioned.has(t.id) && t.status !== "dropped");
          if (gone.length > 0)
            fail("清单里少了 " + gone.map((t) => t.id).join("、") + "：账本里有的条目不能自己消失——不做了就写 ~~ " + gone[0].id + " " + gone[0].title + "，再加一行 理由：");
          return specs;
        },
        (stamped) => {
          // 只有真交付过才刷新基线：一次只加条目或只领号的 submit 如果也刷新，
          // 工作区里那些改动就被它吃掉了——下一条交付看起来什么都没动。
          if (stamped.some((ev) => ev.k === "task.done")) writeSnapshot(ROOT, scanned.now);
        },
      );
      // 落过账就把清单按账本重写一遍：新条目领到的号要写回去，不然下一次 submit
      // 会把同一个 ? 再加一条。文件里说过的话都已经在账本上，重写不丢东西。
      const after = sessionById(doc, evs[0].s ?? targetSession(doc, flags).id);
      fs.writeFileSync(file, planDraft(after) + "\n", "utf8");
      for (const ev of evs) {
        if (ev.k === "goal.set") console.log("目的 · " + ev.s + " · " + ev.text);
        if (ev.k === "task.add") console.log("写进清单 · " + ev.id + " · " + ev.title);
        if (ev.k === "task.done") console.log("交付 · " + ev.id + " · " + ev.evidence);
        if (ev.k === "task.undo") console.log("撤回 · " + ev.id + " · " + ev.why);
        if (ev.k === "task.defer") console.log("延后 · " + ev.id + " · " + ev.why);
        if (ev.k === "task.drop") console.log("放弃 · " + ev.id + " · " + ev.why);
      }
      console.log("落账 " + evs.length + " 条 · 清单 " + rel(ROOT, file));
      const step = nextAction(doc, doc.config);
      console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
      console.log("  " + step.command);
    });
  },
  judge(argv) {
    const { flags, words } = parse(argv);
    guard(() => {
      const { doc } = load();
      // 一段的结局由审查者的结论定：pass 当场封段，fail 点名退回。judge 只剩
      // "推翻一份结论"这一个动作——人替审查者放行，会让"谁判的"变成两处。
      if (flags.pass || flags.rework)
        fail(
          (flags.pass
            ? 'judge --pass 已经没有了：审查者的结论就是一段的结局（deed review --segment S01.1 --by "谁" --verdict pass）'
            : 'judge --rework 已经没有了：判不合格要由审查者点名（deed review --verdict fail --rework T1,T2 --why "为什么"）') +
            '；人只在结论本身错了时推翻它：deed judge --overturn R1 --why "为什么"',
        );
      if (!flags.overturn)
        fail('judge 只认 --overturn <R1> --why "…"（推翻一条结论）；一段的结局由审查者的结论落，人不再签字');
      // 推翻一条结论是例外，不是步骤：它点名一条在案的结论，所以按结论找会话，
      // 而不是按"现在开着哪一期"找——签收之后就没有开着的一期了。
      const overturned = doc.sessions
        .flatMap((one2) => one2.reviews.map((rv) => ({ session: one2, review: rv })))
        .find((pair) => pair.review.id === flags.overturn);
      if (!overturned) {
        const known = doc.sessions.flatMap((one2) => one2.reviews.map((rv) => one2.id + "/" + rv.id + "（" + rv.verdict + "）"));
        fail("账本里没有结论 " + flags.overturn + "：账本里的结论是 " + (known.join("、") || "（一条都没有）"));
      }
      const one = overturned.session;
      const review = overturned.review;
      if (review.voidedAt) fail("结论 " + review.id + " 已经作废过（" + review.voidedBy + "）：再推翻它没有意义");
      if (!flags.why) fail('推翻一条结论要说清为什么：--why "…"');
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
      const where = review.scope === "session" ? "整期 " + one.id : "段 " + review.segment;
      console.log("推翻 · " + where + " · " + review.id + " · " + flags.by + " · " + flags.why);
      console.log("  " + (review.scope === "session" ? "这一期回到没审过的样子：重新出材料、重新审" : "这一段回到没判过的样子：重新出清单、重新审"));
      const step = nextAction(after, after.config);
      console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
      console.log("  " + step.command);
    });
  },

  // 免审段的结局。门槛说这一段不用审，于是没有审查结论可落——但段仍然要封，
  // 不然它永远开在 state 里，谁也签不了收。封存要写清凭什么不用审，因为
  // "没人看过"必须留在账本上，不能变成默认的沉默。
  seal(argv) {
    const { flags } = parse(argv);
    guard(() => {
      const { doc } = load();
      const one = targetSession(doc, flags);
      const seg = flags.segment
        ? one.segments.find((s) => s.id === flags.segment)
        : openSegment(one);
      if (!seg)
        fail(
          (flags.segment ? "会话 " + one.id + " 里没有段 " + flags.segment : "现在没有开着的段") +
            "：账本里的段是 " +
            (one.segments.map((s) => s.id + (s.closedAt ? "（已封存）" : "")).join("、") || "（一个都没有）"),
        );
      auditSegment(doc, one, seg);
      const blockers = sealBlockers(doc.config, one, seg);
      if (blockers.length > 0) fail("这一段不能封存：" + blockers.join("；"));
      if (!flags.why) fail('封存要写清凭什么不用审：--why "…"');
      const after = transact(flags, () => ({
        k: "segment.seal",
        s: one.id,
        segment: seg.id,
        why: flags.why,
        by: signer(flags, "封存"),
      })).doc;
      console.log("封存 · " + seg.id + " · 免审 · " + flags.by + " · " + flags.why);
      console.log("  没人审过这一段：签收时它会列出来");
      const step = nextAction(after, after.config);
      console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
      console.log("  " + step.command);
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
      // 没人审过的段不能被静默放过：签收这一刻把它们摆出来。
      const unread = exemptSegments(one);
      if (unread.length > 0)
        console.log("  没经过审查 · " + unread.map((s) => s.id + "（" + s.sealedWhy + "）").join("、"));
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
      const past = bareHistory(doc);
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
      // 历史上写过、后来被重交盖住的空交付：不挡门，但账本里那句话确实存在过。
      for (const one of past)
        console.log(
          "空交付 · " +
            one.id +
            " · " +
            stamp0(one.at) +
            "（" +
            (one.withdrawn ? "撤回时没记下内容" : "那时没记下文件") +
            "：后来重交过，不挡放行）",
        );
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
        const late = lateWork(ROOT, doc);
        if (late && late.length > 0)
          console.log(
            "  先做后记 " + late.length + " 条（不算坏账）：" +
              late.map((one) => one.id + " 的 " + one.path + " 最后写于 " + stamp0(one.written) + "，这条任务记于 " + stamp0(one.recorded)).join("；"),
          );
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

  panel(argv) {
    const { flags } = parse(argv);
    guard(() => {
      if (flags.stop) {
        const one = stopPanel(ROOT);
        if (one.stopped) console.log("面板已停 · 端口 " + one.port);
        else console.log("面板本来就没在跑");
        return;
      }
      panelNow(ROOT)
        .then((now) => {
          if (now.running) {
            console.log("面板 · http://127.0.0.1:" + now.port + " · pid " + now.pid);
            return null;
          }
          return startPanel(ROOT).then((one) => {
            if (!one.running) fail("面板起不来：直接跑 deed serve --port 7317 看它报什么");
            console.log("面板 · http://127.0.0.1:" + one.port);
            return null;
          });
        })
        .catch((err) => reject(err?.message ?? String(err)));
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
  "deed · 一个工作区的放行协议",
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
  "deed goal \"<这一期要做成什么>\" [--why \"…\"]   签收与整体审都拿它当尺子",
  "deed review [--segment S01.1]          发审查清单与角色包（记一条 review.brief），打印两份路径",
  "deed review --all                      发整期材料（段都封之后用它；一段的一期由那一段的结论回答）",
  "deed review --segment S01.1 --by \"谁\" --verdict pass [--finding \"…\"]   pass 直接封段",
  "deed review --segment S01.1 --by \"谁\" --verdict fail --rework T1,T2 --why \"…\" [--finding \"…\"]",
  "deed review --all --by \"谁\" --verdict pass|fail [--rework T1,…] [--why \"…\"]   结论落在整期",
  "deed seal [--segment S01.1] --why \"…\"  封一个免审段（门槛说不用审，没人审过）",
  "deed judge --overturn R1 --why \"…\"    推翻一条在案的结论（例外，不是步骤）",
  "deed sign --words \"<用户原话>\" [--title \"<这一期的名字>\"]",
  "deed shelve --why \"…\"",
  "deed state",
  "deed verify",
  "deed doctor",
  "deed gate [名字…]              按账本里的 gates 顺序跑门，失败即退出",
  "deed serve [--port 7317]",
  "deed panel [--stop]              看面板在不在（没在跑就拉起来，打印 URL）",
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
// 面板跟着命令走，不跟着开机走：你要用它的那一下，页面应该在；没人用它的时候
// 它没有理由占着一格端口。serve 与 panel 自己不算（它们就是在做这件事）；
// 还没接 deed 的目录由 ensurePanel 自己放过（没账本就没页面），不在这里另立一条。
if (!panelOff() && verb !== "serve" && verb !== "panel") {
  try {
    const one = await ensurePanel(ROOT);
    if (one && one.started) console.log("面板 · http://127.0.0.1:" + one.port);
  } catch {
    // 面板起不来不该让命令失败：账本的事比页面重要。
  }
}
// An unknown verb is refused, not thrown: fail() raises, and the raise would
// reach the terminal as a stack trace with nobody left to swallow it.
const command = commands[verb];
if (!command) reject("没有这个动作：" + verb + "（deed help 看全部）");
else guard(() => command(rest));
