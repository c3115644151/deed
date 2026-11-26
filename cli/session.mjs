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
import { fold, frozenFor } from "../core/fold.mjs";
import { EVENT_VERSION, UnknownKindError, validateEvent } from "../core/events.mjs";
import { currentVersion, unknownKindNotice } from "../lib/version.mjs";
import { projectState } from "../core/checks.mjs";
import { treeOf } from "../lib/tree.mjs";
import { countIn, currentSession, debt, goalOf, nextAction, openSegment, pressure, reading, reviewOf, configDrift, reviewState, sessionById, signBlockers, tasksIn, userTurns } from "../core/rules.mjs";
import { append, appendMany, paths, readConfigFile, readEvents, withLock } from "../lib/store.mjs";
import { SPEC, closest } from "./spec.mjs";
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

// 冻结只拦写的一侧：账本里的行已经是发生的事实，重放不因为「这一段后来送了审」就把它
// 判成坏账（那样一次重放失败，面板整页都读不动）。落盘前一刻在这里拦，一条都不写。
const refuseFrozen = (doc, evs) => {
  for (const ev of evs) {
    if (ev.k !== "task.done" && ev.k !== "task.undo") continue;
    const session = ev.s ? sessionById(doc, ev.s) : currentSession(doc);
    const task = session?.tasks.find((one) => one.id === ev.id);
    if (!task) continue;
    // 撤回放弃、撤回一条改到下一段是记录层面的事：只有撤回一条交付才换掉审查者手上的文件。
    if (ev.k === "task.undo" && task.status !== "done" && task.status !== "accepted") continue;
    // 清单预排的那一段此刻只收条目：交付要等它轮到。
    const home = session.segments.find((one) => one.id === task.segment);
    const take =
      session.segments.find((one) => one.closedAt === null && one.plannedAt === null) ??
      session.segments.find((one) => one.closedAt === null) ??
      null;
    if (home && home.plannedAt !== null && home.closedAt === null && take && take.id !== home.id)
      fail(
        task.segment + " 还没轮到（现在收活的是 " + take.id + "）：清单预排的那一段只记条目，前面这段判过、关闭之后它才接过活",
      );
    if (!frozenFor(session, task.segment, EVENT_VERSION)) continue;
    const waiting = home && home.verdict === "pass" && home.closedAt === null;
    fail(
      waiting
        ? `${task.segment} 审查通过了、等你判决：这一段先冻着，判过之后才收新的交付（判决在面板上按）`
        : ev.k === "task.done"
          ? `${task.segment} 的清单已经发出去、还没人回答：这一段在审，不能交付（要改先把清单撤回：deed review --segment ${task.segment} --withdraw --why "…"）`
          : `${task.segment} 在审：撤回交付会换掉审查者手上那两份文件，等结论或先撤回清单`,
    );
  }
};

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
    refuseFrozen(doc, [stamped]);
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
    refuseFrozen(doc, stamped);
    const after = fold([...events, ...stamped]);
    appendMany(ROOT, stamped);
    if (commit) commit(stamped, after);
    return { doc: after, evs: stamped };
  });
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
  const used = doc.sessions.flatMap((one) => [
    ...one.tasks.map((t) => t.id), ...one.asks.map((a) => a.id),
    ...(one.points ?? []).map((p) => p.id), ...(one.topics ?? []).map((t) => t.id),
  ]);
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

// 被拒的动作一个字节也不进账本（那是原则），但"这个面好不好用"只有数能回答。
// 所以另记一处：.deed/tmp/refusals.log 一行一次，只记时间、动词、被拒的第一句。
// 它不在账本里，读它的人也不会以为那是发生过的事。
const noteRefusal = (message) => {
  try {
    const home = path.join(ROOT, ".deed");
    // 还没有 .deed 的地方（空目录、别人的仓库）：拒绝就是拒绝，不留任何记号。
    if (!fs.existsSync(home)) return;
    const dir = path.join(home, "tmp");
    fs.mkdirSync(dir, { recursive: true });
    const verb = process.argv[2] ?? "";
    fs.appendFileSync(
      path.join(dir, "refusals.log"),
      JSON.stringify({ at: new Date().toISOString(), verb, why: String(message).split("\n")[0].slice(0, 200) }) + "\n",
      "utf8",
    );
  } catch {
    // 记不下来就算了：这是观察用的，不该挡住一条正常命令的报错。
  }
};

export function fail(message) {
  reject(message);
  noteRefusal(message);
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
// 撤回只有一条路：清单里把勾去掉再 submit。这里只负责把那件事记下来。
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

// 旧账本替人签过名：判决和签收以前默认写 by: "user"，于是 agent 交付、判决、签收
// 一条龙之后，记录上写着是用户按的。现在名字由通道决定——命令写的行是 agent 做的，
// 面板按的行是人按的（via:"panel"），没有参数可填，也没有推断。
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
  // 体检层的一行：这个工作区是不是项目、通过了几条。状态是算出来的，所以每看一次算一次；
  // 目录快照只在这一条里用得上，算不出来也不影响下面的输出。
  const standing = projectState(doc, treeOf(ROOT));
  console.log(
    standing.declared
      ? "项目 · " + standing.shape + " · " + standing.passed + "/" + standing.total +
          (standing.missing.length ? "（未通过：" + standing.missing.join("、") + "）" : "（已认可）")
      : "项目 · 没有声明（工作区模式：三种状态照常）",
  );
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
    // 一期要做成什么：签收拿它当尺子，所以它得在状态里看得见。
    const aim = goalOf(open);
    if (aim) console.log("  目的 · " + aim);
    else if (open.segments.length > 1)
      console.log('  目的 · 还没有（写在清单第一行「# 这一期要做成什么」下面，deed submit 记账）：签收拿它当尺子');
    // 手上有两段时（一段等判决、一段在收活）两段都要露脸：只印"当前那一段"，
    // 读者会以为后来的活没地方去。等判决的那一段排在前面说一句，收活的那一段照旧细印。
    const unclosed = open.segments.filter((one) => one.closedAt === null);
    const taking = unclosed.filter((one) => one.verdict !== "pass").at(-1) ?? null;
    for (const other of unclosed.filter((one) => one !== taking)) {
      const c = countIn(open, other);
      const label = other.verdict === "pass" ? "审查通过、等你判决" : "还没轮到、只记条目";
      console.log(
        "  段 " + other.id + " · " + label + " · " + c.total + " 条（未做 " + c.todo + " · 已交付 " + (c.done + c.accepted) + "）",
      );
    }
    const shown = taking ?? seg ?? open.segments[open.segments.length - 1];
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
        console.log(
          "    " + mark + " " + task.id + " " + task.title +
            ((task.revived ?? []).length > 0 ? "（撤回过放弃）" : "") +
            "  ·  " + task.criteria,
        );
      }
      const review = reviewOf(open, shown);
      if (review) {
        console.log("    审查 " + review.id + " · " + review.by + " · " + review.verdict + " · " + stamp0(review.at));
        for (const one of review.findings) console.log("      发现 · " + one);
      }
    }
    const owed = debt(open);
    if (owed.deferred.length + owed.dropped.length > 0)
      console.log("  还没结 · 延后 " + show(owed.deferred) + " · 放弃 " + show(owed.dropped));
    const blockers = signBlockers(doc, open, config);
    console.log("  签收 " + (blockers.length === 0 ? "可行" : "差：" + blockers.join("；")));
    const watch = pressure(open);
    if (watch && watch.tasks > 3) console.log("  提示 · 这一段已经 " + watch.tasks + " 条，还压着 " + watch.undecided + " 条待判");
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
      "  审查设置 文件与账本不一致 · " + drift.map((one) => one.key).join("、") + "（规则只认账本；改审查设置用 deed init --force … --why）",
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
    "   面板     deed serve                → 本机 http://127.0.0.1:" + port + "（只读 + 签收与推翻两个闸）",
    "   体检     deed check --ledger       → 账本坏在哪、接入还缺什么",
    "   审查设置     deed check --gates        → 跑这个工作区的门（没有门时它会说没有，并给一行写法）",
    "   改审查设置   deed init --force --review \"…\" --exempt \"…\" --port " + port + " --why \"为什么改\"",
  ];
}

