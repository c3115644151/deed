// The command surface. Every verb appends an event; none of them edit state
// directly, because there is no state to edit -- only a ledger to extend.
//
// The order inside a verb is the contract: fold it first, write it second. An
// action that would make the ledger unreadable is refused before it lands, so a
// single slip (done twice, judging a sealed segment) cannot brick the workspace.
// Every verb that reads then writes holds the lock while it does both.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { digest } from "../core/digest.mjs";
import { fold } from "../core/fold.mjs";
import { EVENT_VERSION, UnknownKindError, validateEvent } from "../core/events.mjs";
import { currentVersion, unknownKindNotice } from "../lib/version.mjs";
import { costOf, edges, countIn, currentSession, debt, goalOf, needsWhole, nextAction, openSegment, pendingAsks, pressure, reading, reviewOf, configDrift, reviewState, sessionById, signBlockers, tasksIn, userTurns } from "../core/rules.mjs";
import { append, appendMany, paths, readConfigFile, readEvents, withLock } from "../lib/store.mjs";
import { SPEC, closest } from "./spec.mjs";
import { auditEvidence, staleEvidence } from "./audit.mjs";
import { stamp0 } from "../lib/format.mjs";

export const ROOT = process.cwd();
export const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const stamp = () => new Date().toISOString();



export function parse(argv, verb) {
  const spec = SPEC[verb];
  const booleans = new Set(spec.booleans ?? []);
  const repeat = new Set(spec.repeat ?? []);
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
    const name = equals > 0 ? body.slice(0, equals) : body;
    if (!spec.flags.includes(name)) {
      const guess = closest(name, spec.flags);
      throw new Error(
        "deed " + verb + " 不认 --" + name + " 这个开关" +
          (guess ? "：是不是 --" + guess + "？" : spec.flags.length === 0 ? "；deed " + verb + " 不收开关" : "；它认的是 --" + spec.flags.join("、--")),
      );
    }
    if (equals > 0) {
      put(name, body.slice(equals + 1));
      continue;
    }
    if (booleans.has(body)) {
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
    else if (repeat.has(key)) flags[key] = values;
    else
      throw new Error(
        "--" + key + " 只收一个值，这条命令里写了 " + values.length + " 遍：把要一起说的写成一条（--" + key + '="…"）',
      );
  }
  return { flags, words };
}

// 接过的目录：审查设置落过盘（.deed/config.json）。只看这一个文件，不猜。
const bound = (root) => fs.existsSync(path.join(root, ".deed", "config.json"));

export const load = () => {
  const events = readEvents(ROOT);
  return { events, doc: fold(events) };
};

// Fold before append: `build` sees the current document, so ids are chosen
// inside the lock instead of guessed from a stale read.
// commit runs only after the line is on disk: derived state (the workspace
// snapshot) may not move for an event that was refused before appending.
// mayBind：唯一允许在没接过的目录里写的东西是"把审查设置落进账本"（init 自己）。
export function transact(flags, build, commit, mayBind = false) {
  // 接过的目录才谈得上写：没接过就先拒绝，连 .deed/ 也不该留下——
  // 拿锁会顺手把目录建出来，而被拒的动作不该在工作区里留下任何痕迹。
  if (!mayBind && !bound(ROOT))
    fail("这个目录还没接 deed：先 deed init（没有审查设置的账本，读不出状态，也判不了任何一段）");
  return withLock(ROOT, () => {
    const events = readEvents(ROOT);
    const doc = fold(events);
    // 写的时候带上当前含义版本：校验按它读，旧行（没带 v）才不会被今天的规矩重判。
    const stamped = validateEvent({ ...build(doc, flags), v: EVENT_VERSION }, stamp());
    // w 记的是写这一行的程序版本，不是事件含义的版本（那是 v）。它让"读到不认得的
    // 类型"以后能有一个可查的答案：账本比程序新，还是这一行本来就有问题。
    stamped.w = currentVersion() || undefined;
    // 没有审查设置的账本谁也没法判：还没接过的目录只能由 init 先落基线。
    if (!doc.config && stamped.k !== "config.change")
      fail("这个目录还没接 deed：先 deed init（没有审查设置的账本，读不出状态，也判不了任何一段）");
    const after = fold([...events, stamped]);
    append(ROOT, stamped);
    if (commit) commit(stamped);
    return { doc: after, ev: stamped };
  });
}

// 一份清单说几件事，就把几件事一起落进账本：任何一行被拒，磁盘上一个字都不动。
// 整批先在内存里重放到最后一行，通过了才一次性写——半批落盘会让清单和账本对不上，
// 而对不上的那一刻没人知道哪一条算数。
export function transactMany(flags, buildAll, commit) {
  if (!bound(ROOT))
    fail("这个目录还没接 deed：先 deed init（没有审查设置的账本，读不出状态，也判不了任何一段）");
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
      const one = validateEvent({ ...spec, v: EVENT_VERSION }, at);
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
export function lateWork(root, doc) {
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

export const session = (doc) => {
  const found = currentSession(doc);
  if (!found) fail("现在没有在推进的会话：先记一轮，会话自己开出来");
  return found;
};

// --session lets a parked period still be read and addressed; writes into a
// closed period are refused by fold, not here.
export const targetSession = (doc, flags) => {
  if (!flags.session) return session(doc);
  const found = sessionById(doc, String(flags.session));
  if (!found) fail("账本里没有这个会话：" + flags.session);
  return found;
};

export const nextId = (doc, prefix) => {
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
export const reject = (message) => {
  console.error("deed: " + message);
  process.exitCode = 1;
};

export function fail(message) {
  reject(message);
  throw new Refused(message);
}

export const guard = (fn) => {
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

export const period = (doc) => "第 " + doc.sessions.length + " 期";

// 撤的是哪份字节，撤的那一刻就写下：重放再去推，等于让后来的形状改口。
// 两条入口（deed task undo 与 submit 里把勾去掉）落的是同一个事实，共用这一处。
export const undoesOf = (task) => {
  const last = task.evidence[task.evidence.length - 1];
  if (!last) return null;
  return last.files ?? (last.digest && last.path ? [{ path: last.path, digest: last.digest }] : []);
};

export function split(value) {
  if (value === undefined || value === null || value === true) return [];
  return String(value)
    .split(",")
    .map((one) => one.trim())
    .filter(Boolean);
}

export function list(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function show(value) {
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
export function signer(flags, act) {
  if (flags.by) return flags.by;
  if (process.stdin.isTTY && process.stdout.isTTY) return "user";
  fail("「" + act + "」没有写名字：deed 不替任何动作填名字。写 --by「谁」（比如 agent:claude）");
}

export function printState() {
  const { doc, events } = load();
  const config = doc.config;
  const open = currentSession(doc);
  // 没接过 deed 的目录不能看起来"一切正常"：状态里每个字都得有账本撑着。
  if (!config) {
    console.log("");
    console.log("这个目录还没接 deed · 先 deed init（把审查设置基线记进账本）");
    console.log("  账本 " + (events.length ? events.length + " 条，但没有审查设置：不知道哪些改动要审" : "还没有"));
    console.log("");
    return;
  }
  console.log("");
  console.log("状态 · " + ({ idle: "没有在推进的会话", discuss: "讨论", execute: "执行", accept: "验收" }[reading(doc)]));
  if (!open) {
    console.log(
      doc.sessions.length === 0
        ? "（还没有会话；下一轮对话会开第一期）"
        : "（上一期已结束；下一轮对话会自己开新期）",
    );
  } else {
    const seg = openSegment(open);
    console.log(
      "会话 " + open.id + " · 开于 " + stamp0(open.openedAt) + " · " + userTurns(open).length + " 轮 · " + open.segments.length + " 段",
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
      const spent = costOf(open, shown);
      console.log(
        "  段 " + shown.id + " · 开于 " + stamp0(shown.openedAt) + " · " + count.total + " 条（未做 " + count.todo + " · 已交付 " + (count.done + count.accepted) + "）· " + (shown.closedAt
          ? (shown.verdict === "exempt" ? "免审 · " : "判过 · ") + stamp0(shown.closedAt)
          : REVIEW_LABEL[reviewState(config, open, shown)]),
      );
      // 花了多少：慢要看得见，才谈得上省。这是账本里现成的数，不挡任何一步。
      const tail = [];
      if (spent.briefs > 1) tail.push(spent.briefs + " 份清单");
      if (spent.undos > 0) tail.push("重交 " + spent.undos + " 次");
      if (spent.minutes !== null) tail.push("开了 " + spent.minutes + " 分钟");
      if (tail.length) console.log("    花了 · " + tail.join(" · "));
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
      console.log("  还没结 · 延后 " + show(owed.deferred) + " · 放弃 " + show(owed.dropped));
    const settled = edges(open);
    for (const one of settled)
      console.log("  " + (one.kind === "border" ? "边界" : "弃") + " · " + one.text + "（" + one.id + (one.by ? " · " + one.by : "") + "）");
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
        "  已结束 · " + one.id + " · " + (one.title ?? "未命名") + " · " + (one.closeKind === "signed" ? "签收" : "强制归档") + " · " + stamp0(one.closedAt),
      );
  for (const change of doc.changes)
    console.log("  审查设置改过 · " + change.key + " · " + stamp0(change.at) + " · " + change.by + " · " + change.why);
  const drift = configDrift(doc.config, readConfigFile(ROOT));
  if (drift.length > 0)
    console.log(
      "  审查设置 文件与账本不一致 · " + drift.map((one) => one.key).join("、") + "（规则只认账本；deed verify 看细节，改审查设置用 deed init --force … --why）",
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
export function optionalBlock(config) {
  const port = config.board.port;
  return [
    " 接下来这几件都能现在做完（都可选，不做也不会坏）：",
    "   规则     deed init --print-agents  → 原样粘进 AGENTS.md 或 CLAUDE.md（deed 不写那个文件）",
    "   面板     deed serve                → 本机只读 http://127.0.0.1:" + port,
    "   体检     deed doctor               → 账本坏在哪、接入还缺什么",
    "   审查设置     deed gate                 → 看这个工作区的门（没有门时它会说没有，并给一行写法）",
    "   改审查设置   deed init --force --review \"…\" --exempt \"…\" --port " + port + " --why \"为什么改\"",
  ];
}

// 记下的内容变了，那一条交付回答的就不是现在的工作区：关闭这一段、落结论都不能装作
// 没发生过。这里只问账本与磁盘的差，不看谁的判断。
export const auditSegment = (doc, session, seg) => {
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
      "这一段有交付记录过期（" + stale.map((spot) => spot.id + " 记下 " + spot.path).join("、") + "），记下的内容已经变了：重新交付再关闭这一段",
    );
};

// 整期审的同一件差事：抄一遍这一期全部任务，不再按段过滤。
export const auditAll = (doc, session) => {
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

