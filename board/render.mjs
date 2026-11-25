// render: document -> one page of HTML. Pure: same document, same bytes.
// The page is one screen per state: 讨论 shows what was said and what waits on
// you, 执行 shows the tasks and what they delivered, 验收 shows the conclusion
// and the sign. The ledger, the hashes and the thresholds stay behind them --
// they are how the answer is computed, not what the reader came for.

import {
  byOrder,
  groupsOf,
  costOf,
  countIn,
  edges,
  currentSession,
  goalOf,
  needsReview,
  nextAction,
  openSegment,
  pendingAsks,
  periodReviewOf,
  reading,
  reviewOf,
  reviewState,
  signBlockers,
  takingSegment,
  userTurns,
} from "../core/rules.mjs";

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const FORMATTERS = new Map();

function formatterFor(zone) {
  const key = zone ?? "UTC";
  let formatter = FORMATTERS.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: key,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    FORMATTERS.set(key, formatter);
  }
  return formatter;
}

// The ledger keeps UTC. Which zone the page prints is an argument, not the
// machine's setting: the same document and the same zone render the same bytes.
export function when(at, zone = "UTC") {
  if (!at) return "—";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return String(at);
  const parts = {};
  for (const one of formatterFor(zone).formatToParts(date)) parts[one.type] = one.value;
  return parts.month + "/" + parts.day + " " + parts.hour + ":" + parts.minute;
}

const LED = { todo: "todo", done: "done", accepted: "accepted", deferred: "deferred", dropped: "dropped" };
const STATUS_WORD = { todo: "未做", done: "已交付 · 待判", accepted: "已判", deferred: "延后", dropped: "放弃" };
const READING = { idle: "空", discuss: "讨论", execute: "执行", accept: "验收" };
const PLACE = { idle: "没有在推进的会话", discuss: "这一期还在说事", execute: "正在做", accept: "做完了，等一句话" };
const STAMP = { exempt: "免审", missing: "要审", pass: "审过", fail: "审查不合格", stale: "要重审" };

const tag = (kind, text) => '<span class="tag ' + kind + '">' + esc(text) + "</span>";
const cut = (text) => String(text ?? "");

function pinsOf(proof) {
  if (proof.files) return proof.files;
  return proof.digest && proof.path ? [{ path: proof.path, digest: proof.digest }] : [];
}

function chip(digest, className) {
  if (!digest) return "";
  return (
    '<button class="dig ' + (className ?? "") + '" type="button" data-copy="' + esc(digest) +
    '" title="' + esc(digest) + " 点一下复制" + '"><span class="dn">' + esc(digest.slice(0, 8)) +
    '</span><span class="dc">sha</span></button>'
  );
}

function cmd(text, extra) {
  return (
    '<button type="button" class="cmd ' + (extra ?? "") + '" data-copy="' + esc(text) +
    '" title="点一下复制"><span class="sig">$</span>' + esc(text) + "</button>"
  );
}

// ---------------------------------------------------------------- the shell

function hud(doc, open, state, turns, events) {
  const reads =
    (events === null ? '<span class="read">账本 —</span>' : '<span class="read">账本 <b>' + events + "</b> 条</span>") +
    '<span class="read">轮 ' + turns + "</span>";
  return (
    '<header class="hud">' +
    '<div class="brand"><span class="glyph"></span><span class="name">DEED</span>' +
    '<span class="sub">pass protocol</span></div>' +
    '<div class="statebox"><span class="k">state</span><b class="v" data-state="' + esc(state) + '">' + esc(state) + "</b></div>" +
    '<div class="reads">' + reads + "</div>" +
    '<div class="tools"><button type="button" class="tool" data-filter aria-pressed="false">只看未结项</button>' +
    '<button type="button" class="tool" data-theme aria-pressed="false">明</button></div>' +
    "</header>"
  );
}

function stateTabs(doc, session, active) {
  const counts = {
    discuss: session ? userTurns(session).length : 0,
    execute: session ? session.tasks.length : 0,
    accept: session ? session.segments.filter((segment) => segment.closedAt).length : 0,
  };
  const one = (key, name, unit) =>
    '<button type="button" class="tab' + (key === active ? " on" : "") + '" data-screen="' + key +
    '" aria-pressed="' + (key === active) + '"><span class="tmark"></span><span class="tname">' + name +
    '</span><span class="tcount">' + counts[key] + " " + unit + "</span></button>";
  return (
    '<nav class="rail" aria-label="三种状态">' +
    one("discuss", "讨论", "轮") +
    '<span class="arrow"></span>' +
    one("execute", "执行", "条") +
    '<span class="arrow"></span>' +
    one("accept", "验收", "段") +
    "</nav>"
  );
}

function directive(step, open) {
  if (!step) return "";
  const body = String(step.full ?? step.text ?? "");
  const stop = body.search(/[：。；]/);
  const subject = stop > 1 ? body.slice(0, stop) : body.slice(0, 24);
  const note = body.slice(subject.length).replace(/^[：。；，\s]+/, "");
  const owed = open ? open.tasks.filter((task) => task.status === "todo").length : 0;
  const pending = open ? open.tasks.filter((task) => task.status === "done").length : 0;
  return (
    '<section class="directive" data-who="' + esc(step.who) + '">' +
    '<div class="dtop"><span class="dlabel">指令 / directive</span>' +
    '<span class="dwho">下一步 · ' + esc(step.who) + "</span>" +
    '<span class="debt">' + (owed ? "还没结 " + owed : "都结了") + "　" + (pending ? "待判 " + pending : "无待判") + "</span></div>" +
    '<p class="dwhat">' + esc(step.what) + (subject ? " · " + esc(subject) : "") + "</p>" +
    (note ? '<p class="dnote">' + esc(note) + "</p>" : "") +
    '<div class="dline">' + cmd(step.command) + "</div>" +
    "</section>"
  );
}

// ------------------------------------------------------------------ screens

function screenHead(index, name, note, meter) {
  return (
    '<header class="shd"><span class="sidx">' + index + '</span><h2 class="sname">' + name +
    '</h2><span class="snote">' + esc(note) + '</span><span class="smeter">' + esc(meter) + "</span></header>"
  );
}

function discussScreen(session, zone, on) {
  const turns = session ? session.turns : [];
  const asks = session ? (session.asks ?? []) : [];
  const open = asks.filter((one) => one.state === "pending");
  const settled = asks.filter((one) => one.state !== "pending");
  const row = (turn) =>
    '<li class="turn ' + turn.who + '">' +
    '<span class="tclock">' + when(turn.at, zone) + "</span>" +
    '<span class="twho">' + (turn.who === "user" ? "你" : "agent") + "</span>" +
    '<p class="tsaid">' + esc(turn.said) + "</p>" +
    "</li>";
  // 这一屏的主轴是轮次：谁在什么时候说了什么。题在右边，是还没发出去的档案——
  // 它不占主轴，只在窗口里自己攒你说的线索，攒到你说清为止。
  const clues = (ask) => {
    const from = Date.parse(ask.at);
    const to = ask.closedAt ? Date.parse(ask.closedAt) : Infinity;
    return turns.filter((turn) => {
      const at = Date.parse(turn.at);
      return turn.who === "user" && at >= from && at <= to;
    });
  };
  const WORD = { pending: "等你定", resolved: "已裁", withdrawn: "已撤" };
  const card = (ask) => {
    const got = clues(ask);
    return (
      '<li class="qa" data-state="' + esc(ask.state) + '">' +
      '<div class="qhead"><span class="aid">' + esc(ask.id) + "</span>" +
      '<span class="qstate">' + (WORD[ask.state] ?? ask.state) + "</span>" +
      '<span class="qmeta">' + when(ask.at, zone) + (got.length ? " · 攒到 " + got.length + " 句" : "") + "</span></div>" +
      '<p class="atext">' + esc(ask.text) + "</p>" +
      (got.length
        ? '<ol class="clues">' + [...got].reverse().map((turn) =>
            '<li class="clue"><span class="cclock">' + when(turn.at, zone) + "</span>" + esc(turn.said) + "</li>",
          ).join("") + "</ol>"
        : "") +
      (ask.state === "resolved"
        ? '<p class="qdone">' + esc((ask.decision ?? "").split("\n").filter((one) => one.trim() && !/^(边界|弃)\s*[:：]/u.test(one))[0] ?? "") + "</p>"
        : ask.state === "withdrawn"
          ? '<p class="qdone quiet">撤 · ' + esc(ask.why2 ?? "") + "</p>"
          : '<p class="areading"><span class="k">当成</span>' + esc(ask.reading) + "</p>" + cmd('deed ask resolve ' + ask.id + ' --decision "…"')) +
      '<p class="qfoot">' + esc(ask.by ?? "") + (ask.closedAt ? " · " + when(ask.closedAt, zone) : "") + "</p>" +
      "</li>"
    );
  };
  return (
    '<section class="screen' + (on ? " on" : "") + '" data-screen="discuss" id="screen-discuss">' +
    screenHead("01", "讨论", "你说的每一句，和还没定下的那些", turns.filter((one) => one.who === "user").length + " 轮 · " + open.length + " 条等你定") +
    '<div class="cols">' +
    '<div class="col logs">' +
    // 最新的在最上面：往下翻只会离现在更远。轮次、题、段、卡片都按这一条印。
    (turns.length ? '<ol class="turns">' + [...turns].reverse().map(row).join("") + "</ol>" : '<p class="quiet">还没有轮次</p>') +
    "</div>" +
    '<aside class="side">' +
    '<h3 class="colh">等你定</h3>' +
    (open.length ? '<ol class="qlist">' + [...open].reverse().map(card).join("") + "</ol>" : '<p class="quiet">没有等你的题</p>') +
    (settled.length
      ? '<h3 class="colh">已经定下的</h3><ul class="qlist">' + [...settled].reverse().map((ask) =>
          '<li class="qa quiet" data-state="' + esc(ask.state) + '">' +
          '<div class="qhead"><span class="aid">' + esc(ask.id) + "</span>" +
          '<span class="qstate">' + (WORD[ask.state] ?? ask.state) + "</span></div>" +
          '<p class="qdone">' + esc((ask.decision ?? ask.text ?? "").split("\n")[0]) + "</p></li>",
        ).join("") + "</ul>"
      : "") +
    "</aside>" +
    "</div></section>"
  );
}
function taskRow(task, zone) {
  const pins = task.evidence.length === 0 ? 0 : pinsOf(task.evidence[task.evidence.length - 1]).length;
  const proofs = task.evidence
    .map(
      (proof) =>
        '<li class="proof"><span class="dot"></span><span class="pclaim">' + esc(proof.claim) + "</span>" +
        '<span class="pmeta">' + esc(proof.by) + " · " + when(proof.at, zone) + "</span>" +
        '<span class="pins">' +
        pinsOf(proof)
          .map((one) => '<span class="ppin"><span class="ppath">' + esc(one.path) + "</span>" + chip(one.digest) + "</span>")
          .join("") +
        "</span></li>",
    )
    .join("");
  const undone = (task.undone ?? [])
    .map((one) => '<li class="undone">撤回了：' + esc(one.why) + "（" + esc(one.by) + " · " + when(one.at, zone) + "）</li>")
    .join("");
  // 「未声明路径」说的是清单上没写，不是这条交付什么也没碰：submit 建的条目没有声明，
  // 但它记账时量过工作区差，路径在交付记录里。两件事分开说，别让人以为交付是空的。
  const files =
    task.files.length > 0
      ? task.files.join("  ")
      : pins > 0
        ? "没声明路径 · 交付记下 " + pins + " 个"
        : "未声明路径";
  const last = task.evidence[task.evidence.length - 1];
  const batched = Boolean(last && last.batch);
  return (
    '<details class="task" data-status="' + task.status + '">' +
    "<summary>" +
    '<span class="led ' + (LED[task.status] ?? "") + '"></span>' +
    '<span class="tid">' + esc(task.id) + "</span>" +
    '<span class="ttitle">' + esc(task.title) + "</span>" +
    '<span class="tmeta"><span class="tstate">' + (STATUS_WORD[task.status] ?? "") + "</span>" +
    (pins === 0 ? "" : '<span class="tpins">' + pins + " 份" + "</span>") +
    (batched ? '<span class="tbatch">同批</span>' : "") +
    ((task.undone && task.undone.length > 0) ? '<span class="tundone">撤 ' + task.undone.length + "</span>" : "") +
    ((task.revived && task.revived.length > 0) ? '<span class="trevived">撤回过放弃</span>' : "") +
    (task.order === null || task.order === undefined ? "" : '<span class="torder">先 ' + task.order + "</span>") +
    "</span>" +
    '<span class="tfiles">' + esc(files) + "</span>" +
    "</summary>" +
    '<div class="tbody">' +
    '<p class="k">做完的标准</p><p class="crit">' + esc(task.criteria) + "</p>" +
    '<p class="k">交付记录</p>' +
    (proofs ? '<ul class="proofs">' + proofs + "</ul>" : '<p class="quiet">还没有交付</p>') +
    (undone ? '<ul class="undones">' + undone + "</ul>" : "") +
    (task.changed && task.changed.length > 0 ? '<p class="k">交付时真动过</p><p class="moved">' + esc(task.changed.join("  ")) + "</p>" : "") +
    (task.why ? '<p class="k">停在这里</p><p class="quiet">' + esc(task.why) + "</p>" : "") +
    "</div></details>"
  );
}

function findingList(findings) {
  return findings
    .map((one, index) => {
      const hard = one.slice(0, 70).search(/[：。；]/);
      const soft = hard > 4 ? -1 : one.slice(0, 70).search(/[，,]/);
      const stop = hard > 4 ? hard : soft;
      const split = stop > 4;
      const head = split ? one.slice(0, stop) : one.slice(0, 34);
      const rest = split ? one.slice(stop + 1) : one.slice(34);
      const named = head.match(/^(T\d+)\s*·\s*([\s\S]*)$/);
      const id = named ? named[1] : null;
      const title = named ? named[2] : head;
      return (
        '<details class="fd"><summary>' +
        (id ? '<span class="fid">' + esc(id) + "</span>" : "") +
        '<span class="ftitle">' + esc(title) + "</span>" +
        '<span class="fx">' + String(index + 1).padStart(2, "0") + "</span></summary>" +
        '<p class="fbody">' + esc(rest) + "</p></details>"
      );
    })
    .join("");
}

function pathsOf(session, segment) {
  const files = session.tasks.filter((task) => task.segment === segment.id).flatMap((task) => [...(task.files ?? []), ...(task.changed ?? [])]);
  return [...new Set(files)].sort();
}

function segmentBlock(session, segment, index, config, zone) {
  const count = countIn(session, segment);
  const spent = costOf(session, segment);
  const state = reviewState(config, session, segment);
  const review = reviewOf(session, segment);
  // 收活的那一段才叫"手上这一段"；清单排在后头的段在这儿是"等前面"。
  const take = takingSegment(session);
  const here = take?.id === segment.id;
  const stamp =
    segment.closedAt === null && !here ? tag("quiet", "等前面") :
    segment.verdict === "pass" ? tag("pass", "判过") :
    segment.verdict === "exempt" ? tag("quiet", "免审") :
    segment.verdict === "rework" ? tag("fail", "打回") : tag(state === "pass" ? "quiet" : "grit", STAMP[state] ?? "要审");
  const tasks = byOrder(session.tasks.filter((task) => task.segment === segment.id));
  return (
    '<article class="seg' + (here ? " here" : "") + '" id="' + esc(segment.id) + '">' +
    '<div class="segbar">' +
    '<span class="sidx">' + String(index).padStart(2, "0") + "</span>" +
    '<span class="sid">' + esc(segment.id) + "</span>" +
    '<span class="scount">' + count.total + " 条 · 未做 " + count.todo + " · 已交付 " + (count.done + count.accepted) + "</span>" +
    '<span class="scost" title="这一段花了多少：清单出过几份、重交了几次、开了多久">' +
    [
      spent.briefs > 1 ? "清单 " + spent.briefs : "",
      spent.undos > 0 ? "重交 " + spent.undos : "",
      spent.minutes !== null ? "开了 " + spent.minutes + " 分钟" : "",
    ].filter(Boolean).join(" · ") +
    "</span>" +
    '<span class="smeter2" title="' + (count.done + count.accepted) + " / " + count.total + '">' +
    '<span class="sfill" style="width:' + Math.round(((count.done + count.accepted) / Math.max(1, count.total)) * 100) + '%"></span></span>' +
    '<span class="swhen">' + when(segment.openedAt, zone) + (segment.closedAt ? " → " + when(segment.closedAt, zone) : "") + "</span>" +
    '<span class="stamp">' + stamp + "</span>" +
    "</div>" +
    (state === "missing" && needsReview(config, session, segment)
      ? '<p class="why">这一段碰了要审的路径：' + esc(pathsOf(session, segment).join("  ")) + "</p>"
      : "") +
    (state === "stale" ? '<p class="why">结论早于最后一次交付：审的是旧内容，要重审一次</p>' : "") +
    (review
      ? '<p class="revline"><span class="k">审查</span>' + esc(review.by) + " · " + when(review.at, zone) +
        " · " + esc(String(review.brief).split(/[\\/]/).pop()) + (review.findings.length ? " · 发现 " + review.findings.length + " 条" : " · 无发现") +
        (review.rework && review.rework.length ? " · 退回 " + esc(review.rework.join("、")) : "") + "</p>"
      : "") +
    (review && review.findings.length
      ? '<div class="fds"><p class="fdshead"><span class="k">审查者点了 ' + review.findings.length +
        ' 条</span><span class="fx">点开看依据</span></p>' + findingList(review.findings) + "</div>"
      : "") +
    // 段里的条目与清单同一个次序：在做（一条）→ 等着 → 已完成 → 撤回或放弃。
    '<div class="tasks">' +
      groupsOf(tasks)
        .map((group) =>
          '<p class="tgroup" data-group="' + group.key + '">' + group.label + " · " + group.tasks.length + " 条</p>" +
          group.tasks.map((task) => taskRow(task, zone)).join(""),
        )
        .join("") +
      "</div>" +
    "</article>"
  );
}

function executeScreen(session, config, zone, on) {
  const segments = session ? session.segments : [];
  const open = session ? openSegment(session) : null;
  const tasks = session ? session.tasks : [];
  const todo = tasks.filter((task) => task.status === "todo").length;
  return (
    '<section class="screen' + (on ? " on" : "") + '" data-screen="execute" id="screen-execute">' +
    screenHead("02", "执行", open ? "这一段开着 · " + open.id : "没有开着的段", (tasks.length - todo) + " / " + tasks.length + " 已交付") +
    '<div class="segs">' +
    (segments.length
      ? [...segments].reverse().map((segment, index) => segmentBlock(session, segment, segments.length - index, config, zone)).join("")
      : '<p class="quiet">清单是空的：还没有一条任务</p>') +
    "</div></section>"
  );
}

function check(ok, label, why) {
  return (
    '<li class="chk' + (ok ? " ok" : "") + '"><span class="cbox">' + (ok ? "✓" : "✕") + "</span>" +
    '<span class="clabel">' + esc(label) + "</span>" +
    (why ? '<span class="cwhy">' + esc(why) + "</span>" : "") + "</li>"
  );
}

function acceptScreen(doc, session, config, zone, on) {
  const segments = session ? session.segments : [];
  const tasks = session ? session.tasks : [];
  const asks = session ? pendingAsks(session) : [];
  const blocks = signBlockers(doc, session, config);
  const taking = segments.find((one) => one.closedAt === null) ?? null;
  const unreviewed = segments.filter((segment) => segment.verdict === "exempt");
  const sealed = segments.filter((segment) => segment.closedAt !== null);
  const todo = tasks.filter((task) => task.status === "todo").length;
  const cards = [...segments]
    .reverse()
    .map((segment) => {
      const review = reviewOf(session, segment);
      const state = reviewState(config, session, segment);
      const count = countIn(session, segment);
      const queued = segment.closedAt === null && taking !== segment;
      const waiting = segment.verdict === "pass" && segment.closedAt === null;
      const word = queued
        ? "等前面"
        : waiting
        ? "等判决"
        : review
          ? review.verdict === "pass" ? "审查通过" : "不合格"
          : segment.verdict === "exempt" ? "免审" : STAMP[state] ?? "要审";
      const kind = queued ? "quiet" : waiting ? "grit" : review ? (review.verdict === "pass" ? "pass" : "fail") : segment.verdict === "exempt" ? "quiet" : "grit";
      return (
        '<article class="vcard" data-kind="' + kind + '">' +
        '<div class="vhead"><span class="vid">' + esc(segment.id) + "</span>" +
        '<span class="vword">' + esc(word) + "</span>" +
        '<span class="vmeta">' +
          (review ? esc(review.by) + " · " + when(review.at, zone)
            : segment.verdict === "exempt" ? "免审 · " + (segment.sealedWhy ? esc(segment.sealedWhy) : "当时没写理由")
            : "还没有结论") + "</span>" +
        '<span class="vcount">' + count.total + " 条 · " + (review ? "点了 " + review.findings.length + " 条" : "没有发现") + "</span>" +
        "</div>" +
        (review
          ? '<p class="vbrief"><span class="k">清单</span>' + esc(String(review.brief).split(/[\\/]/).pop()) +
            (review.rework && review.rework.length ? '　<span class="k">退回</span>' + esc(review.rework.join("、")) : "") + "</p>"
          : "") +
        (review && review.findings.length ? '<div class="fds">' + findingList(review.findings) + "</div>" : "") +
        (waiting
          ? '<form class="gate small" data-gate="judgement" data-segment="' + esc(segment.id) + '">' +
            '<span class="gask">这一段过不过？</span>' +
            '<button class="gpress" type="submit">判决通过 ' + esc(segment.id) + "</button></form>"
          : "") +
        "</article>"
      );
    })
    .join("");
  // 期审的结论回答的是这一期，它没有自己那一段卡片：单独摆一张，推翻那一下也在这里。
  const period = session ? periodReviewOf(session) : null;
  const periodCard = period
    ? '<article class="vcard" data-kind="' + (period.verdict === "pass" ? "pass" : "fail") + '">' +
      '<div class="vhead"><span class="vid">' + esc(session.id) + " 期审</span>" +
      '<span class="vword">' + (period.verdict === "pass" ? "放行" : "不合格") + "</span>" +
      '<span class="vmeta">' + esc(period.by) + " · " + when(period.at, zone) + "</span>" +
      '<span class="vcount">' + esc(String(period.brief).split(/[\\/]/).pop()) + "</span></div>" +
      (period.rework && period.rework.length ? '<p class="vbrief"><span class="k">退回</span>' + esc(period.rework.join("、")) + "</p>" : "") +
      (period.findings.length ? '<div class="fds">' + findingList(period.findings) + "</div>" : "") +
      "</article>"
    : "";
  const signed = session && session.sign;
  const goal = session ? goalOf(session) : null;
  const settled = session ? edges(session) : [];
  return (
    '<section class="screen' + (on ? " on" : "") + '" data-screen="accept" id="screen-accept">' +
    screenHead("03", "验收", "判过什么、谁判的、还差谁一句话", sealed.length + " 段判过") +
    (goal ? '<p class="goal"><span class="k">这一期要做成什么</span>' + esc(goal) + "</p>" : "") +
    '<div class="cols">' +
    '<div class="col">' +
    '<h3 class="colh">结论</h3>' + (periodCard || "") + (cards || '<p class="quiet">还没有审查结论</p>') +
    (settled.length
      ? '<h3 class="colh">定过的边界与不做</h3><ul class="edges">' +
        settled.map((one) => '<li class="edge"><span class="ekind">' + (one.kind === "border" ? "边界" : "弃") + "</span>" + esc(one.text) +
          '<span class="ewho">' + esc(one.id) + (one.by ? " · " + esc(one.by) : "") + "</span></li>").join("") +
        "</ul>"
      : "") +
    "</div>" +
    '<aside class="col side">' +
    '<h3 class="colh">签收</h3>' +
    '<ul class="checks">' +
    check(sealed.length === segments.length, "每一段都有结局", segments.length - sealed.length ? "还有 " + (segments.length - sealed.length) + " 段没有结局（等判决或免审封存）" : "") +
    check(todo === 0, "没有未做的条目", todo ? "还有 " + todo + " 条" : "") +
    check(asks.length === 0, "没有等裁定的问题", asks.length ? "还有 " + asks.length + " 条待裁（" + asks.map((one) => one.id).join("、") + "）" : "") +
    check(blocks.length === 0, "没有挡住的项", blocks.length ? blocks.length + " 条，见下" : "") +
    "</ul>" +
    (signed
      ? '<p class="signwords">「' + esc(signed.words) + '」</p><p class="quiet">' + esc(signed.by) + " · " + when(signed.at, zone) + "</p>"
      : blocks.length
        ? '<ul class="blockers">' + blocks.map((one) => "<li>" + esc(one) + "</li>").join("") + "</ul>" +
          '<p class="quiet">先把上面挡路的清掉，再签这一句原话</p>'
        : '<p class="ok">签收可行 · 该结的都结了</p>' +
          '<form class="gate" data-gate="sign">' +
          '<input class="gwords" type="text" placeholder="这一句就是你的原话" aria-label="签收要说的一句话">' +
          '<button class="gpress" type="submit">签收这一期</button></form>' +
          '<p class="quiet">按下去只写一行账：谁、什么时候、说了什么。命令行那条路已经关了。</p>') +
    (unreviewed.length
      ? '<p class="k">没经过审查</p><ul class="exempts">' +
        unreviewed.map((segment) => "<li>" + esc(segment.id) + (segment.sealedWhy ? " · " + esc(segment.sealedWhy) : "") + "</li>").join("") +
        "</ul>"
      : "") +
    "</aside></div></section>"
  );
}

function archiveBlock(doc, zone) {
  const shut = doc.sessions.filter((one) => one.id !== (currentSession(doc)?.id ?? one.id));
  if (!shut.length) return "";
  const rows = shut
    .map((session) => {
      const segments = session.segments
        .map((segment) => {
          const review = reviewOf(session, segment);
          const state = reviewState({}, session, segment);
          const word = segment.verdict === "pass" ? "判过" : segment.verdict === "exempt" ? "免审" : STAMP[state] ?? "要审";
          return '<span class="as">' + esc(segment.id) + " " + word + "</span>";
        })
        .join("");
      return (
        '<li class="arc"><span class="aid">' + esc(session.id) + "</span>" +
        '<span class="atitle">' + esc(session.title ?? "") + "</span>" +
        '<span class="astate">' + (session.closeKind === "signed" ? "签收" : "归档") + "</span>" +
        '<span class="asegs">' + segments + "</span>" +
        '<span class="awhen">' + when(session.sign?.at ?? session.shelve?.at, zone) + "</span></li>"
      );
    })
    .join("");
  return '<section class="archive"><h3 class="colh">档案</h3><ul>' + rows + "</ul></section>";
}

function footer(doc, session, config, sign, state, live) {
  const tally = session
    ? session.tasks.reduce(
        (sum, task) => ({ ...sum, [task.status]: (sum[task.status] ?? 0) + 1 }),
        { todo: 0, done: 0, accepted: 0, deferred: 0, dropped: 0 },
      )
    : null;
  return (
    '<footer class="foot">' +
    '<span class="fk">账本</span><span>.deed/log · 只追加</span>' +
    (tally
      ? '<span class="ft">已判 ' + tally.accepted + "　待判 " + tally.done + "　未做 " + tally.todo + "　延后 " + tally.deferred + "　放弃 " + tally.dropped + "</span>"
      : "") +
    '<span class="fs">' + (session ? (sign.length === 0 ? "签收可行" : "签收差：" + esc(sign.join("；"))) : PLACE[reading(doc)]) + "</span>" +
    '<span class="live" id="live">' + esc(live) + "</span>" +
    "</footer>"
  );
}

export function renderBoard(doc, config, options = {}) {
  const zone = options.zone ?? "UTC";
  const events = options.events ?? null;
  const step = nextAction(doc, config);
  const session = currentSession(doc);
  const sign = session ? signBlockers(doc, session, config) : [];
  const turns = doc.sessions.reduce((sum, one) => sum + userTurns(one).length, 0);
  const stateKey = session ? reading(doc) : "discuss";
  const state = READING[stateKey];
  // 轮到人按的那两下（判决／签收）就在验收屏上：此刻把这一屏打开，别让他自己找。
  const here = step.who === "user" && (step.what === "判决" || step.what === "签收") ? "accept" : stateKey;
  const open = session ? openSegment(session) : null;
  return (
    '<!doctype html>\n<html lang="zh-CN" data-theme="dark">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>deed · ' +
    esc(state) + "</title>\n" + STYLE + "\n</head>\n<body>\n" +
    '<div class="frame">' +
    hud(doc, session, state, turns, events) +
    (options.notice ? '<p class="notice">' + esc(options.notice) + "</p>" : "") +
    stateTabs(doc, session, here) +
    directive(step, session) +
    '<main class="screens">' +
    discussScreen(session, zone, here === "discuss") +
    executeScreen(session, config, zone, here === "execute") +
    acceptScreen(doc, session, config, zone, here === "accept") +
    "</main>" +
    archiveBlock(doc, zone) +
    footer(doc, session, config, sign, state, "跟着账本刷新") +
    "</div>\n" + SCRIPT + "\n</body>\n</html>\n"
  );
}

const STYLE = `<style>
:root {
  --void: #06080a; --panel: #0e1318; --panel2: #121922; --sunk: #0a0f14;
  --line: #1e2831; --line2: #2c3a46; --ink: #e2e9f0; --dim: #6f8090;
  --signal: #35e0cf; --warn: #f2b455; --fail: #e35d5d; --ghost: rgba(53,224,207,.06);
  --disp: "Bahnschrift SemiCondensed", "Bahnschrift", "Segoe UI Variable Display", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  --mono: "Cascadia Mono", "Consolas", "Microsoft YaHei UI", monospace;
}
html[data-theme="light"] {
  --void: #e9eef2; --panel: #ffffff; --panel2: #f3f7fa; --sunk: #eef2f5;
  --line: #bcc9d5; --line2: #93a6b6; --ink: #0b1218; --dim: #4a5a6a;
  --signal: #0b7f78; --warn: #8f6109; --fail: #b03a3a; --ghost: rgba(11,127,120,.05);
}
* { box-sizing: border-box; }
html { scrollbar-width: thin; scrollbar-color: var(--line2) transparent; }
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-track { background: var(--void); }
::-webkit-scrollbar-thumb { background: var(--line2); border: 2px solid var(--void); }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background-color: var(--void); color: var(--ink);
  font-family: var(--disp); font-size: 15px; line-height: 1.52;
  background-image:
    linear-gradient(rgba(255,255,255,.019) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.019) 1px, transparent 1px),
    radial-gradient(1100px 520px at 12% -12%, var(--ghost), transparent 62%);
  background-size: 100% 27px, 27px 100%, auto;
}
html[data-theme="light"] body {
  background-image:
    linear-gradient(rgba(9,18,26,.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(9,18,26,.035) 1px, transparent 1px),
    radial-gradient(1100px 520px at 12% -12%, var(--ghost), transparent 62%);
}
.frame { max-width: 1240px; margin: 0 auto; padding: 0 34px 96px; }

/* ------------------------------------------------------------------- hud */
.hud {
  position: relative; display: flex; align-items: center; gap: 30px;
  padding: 14px 0 12px; border-bottom: 1px solid var(--line2); overflow: hidden;
}
.hud::after {
  content: ""; position: absolute; left: 0; bottom: 0; width: 190px; height: 1px;
  background: linear-gradient(90deg, transparent, var(--signal), transparent);
  animation: sweep 7s linear infinite; opacity: .85;
}
@keyframes sweep { 0% { transform: translateX(-200px); } 100% { transform: translateX(1240px); } }
.brand { display: flex; align-items: baseline; gap: 10px; position: relative; }
.glyph { width: 9px; height: 9px; border: 1px solid var(--signal); transform: rotate(45deg); align-self: center; box-shadow: 0 0 8px var(--ghost); }
.name { font-family: var(--disp); font-size: 23px; letter-spacing: .34em; line-height: 1; }
.sub { font-family: var(--mono); font-size: 9px; letter-spacing: .3em; text-transform: uppercase; color: var(--dim); }
.statebox { display: flex; align-items: baseline; gap: 9px; padding-left: 18px; border-left: 1px solid var(--line2); }
.statebox .k { font-family: var(--mono); font-size: 9px; letter-spacing: .3em; text-transform: uppercase; color: var(--dim); }
.statebox .v { font-family: var(--disp); font-size: 19px; letter-spacing: .3em; font-weight: 500; }
.reads { display: flex; gap: 18px; margin-left: auto; font-family: var(--mono); font-size: 10px; color: var(--dim); letter-spacing: .12em; }
.read b { color: var(--ink); font-weight: 500; }
.tools { display: flex; gap: 6px; }
.tool {
  font-family: var(--mono); font-size: 9.5px; letter-spacing: .12em; color: var(--dim);
  background: transparent; border: 1px solid var(--line2); padding: 4px 9px; cursor: pointer;
  clip-path: polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 7px 100%, 0 calc(100% - 7px));
}
.tool:hover { color: var(--signal); border-color: var(--signal); }
.tool[aria-pressed="true"] { color: var(--void); background: var(--signal); border-color: var(--signal); }
.notice {
  margin: 12px 0 0; padding: 7px 12px; font-family: var(--mono); font-size: 11px; color: var(--warn);
  border-left: 2px solid var(--warn); background: color-mix(in srgb, var(--warn) 7%, transparent);
}

/* ---------------------------------------------------------------- states */
.rail { display: flex; align-items: stretch; margin-top: 18px; border: 1px solid var(--line2); background: var(--panel); }
.tab {
  flex: 1 1 0; display: grid; grid-template-columns: 12px auto 1fr; align-items: center; gap: 10px;
  padding: 12px 16px; background: transparent; border: 0; border-right: 1px solid var(--line);
  color: var(--dim); font-family: var(--disp); cursor: pointer; text-align: left;
  transition: background .18s ease, color .18s ease;
}
.tab:last-of-type { border-right: 0; }
.tmark { width: 7px; height: 7px; border: 1px solid currentColor; transform: rotate(45deg); justify-self: center; }
.tname { font-size: 15px; letter-spacing: .24em; color: var(--ink); }
.tcount { font-family: var(--mono); font-size: 10px; letter-spacing: .1em; justify-self: end; color: var(--dim); }
.tab:hover { background: var(--panel2); }
.tab.on { background: linear-gradient(180deg, color-mix(in srgb, var(--signal) 9%, transparent), transparent 70%); color: var(--signal); box-shadow: inset 0 -2px 0 var(--signal); }
.tab.on .tname { color: var(--signal); }
.tab.on .tmark { background: var(--signal); border-color: var(--signal); animation: pulse 2.6s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--signal) 55%, transparent); } 50% { box-shadow: 0 0 0 5px transparent; } }
.arrow { width: 0; height: 0; align-self: center; border-left: 5px solid var(--line2); border-top: 4px solid transparent; border-bottom: 4px solid transparent; margin: 0 -3px 0 9px; }

/* ------------------------------------------------------------- directive */
.directive {
  display: flex; flex-direction: column; gap: 0;
  margin-top: 14px; padding: 14px 20px 15px; background: var(--panel);
  border-left: 2px solid var(--signal); border-top: 1px solid var(--line);
  border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);
  position: relative;
}
.directive::before { content: ""; position: absolute; top: 0; right: 0; width: 26px; height: 26px; border-top: 1px solid var(--line2); border-right: 1px solid var(--line2); }
.dlabel { font-family: var(--mono); font-size: 9px; letter-spacing: .3em; text-transform: uppercase; color: var(--dim); }
.dtop { display: flex; gap: 16px; align-items: baseline; }
.dwho { font-family: var(--mono); font-size: 10px; letter-spacing: .26em; text-transform: uppercase; color: var(--signal); }
.directive[data-who="user"] .dwho { color: var(--warn); }
.directive[data-who="user"] { border-left-color: var(--warn); }
.debt { margin-left: auto; font-family: var(--mono); font-size: 9.5px; letter-spacing: .14em; color: var(--warn); }
.dwhat { margin: 8px 0 0; font-family: var(--disp); font-size: 21px; line-height: 1.32; letter-spacing: .01em; max-width: 44em; text-wrap: pretty; }
.dnote {
  margin: 5px 0 0; font-size: 12.5px; line-height: 1.5; max-width: 84ch;
  color: color-mix(in srgb, var(--ink) 66%, var(--dim));
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.dline { margin-top: 11px; display: flex; }
.dline .cmd { flex: 1 1 auto; }
.cmd {
  display: inline-block; max-width: 100%; min-width: 0; text-align: left; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; cursor: pointer;
  font-family: var(--mono); font-size: 11.5px; line-height: 1.45; color: var(--ink);
  background: var(--sunk); border: 1px solid var(--line2); padding: 8px 11px;
  clip-path: polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 0 100%);
}
.cmd .sig { color: var(--signal); margin-right: 7px; }
.cmd:hover { border-color: var(--signal); color: var(--signal); }

/* ------------------------------------------------------------------ main */
.screens { margin-top: 20px; }
.screen { display: none; }
.screen.on { display: block; animation: rise .26s ease-out both; }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.shd { display: flex; align-items: baseline; gap: 14px; padding-bottom: 8px; border-bottom: 1px solid var(--line2); }
.sidx { font-family: var(--mono); font-size: 10px; letter-spacing: .2em; color: var(--signal); border: 1px solid var(--line2); padding: 2px 5px; }
.sname { margin: 0; font-family: var(--disp); font-size: 17px; letter-spacing: .28em; font-weight: 500; }
.snote { font-family: var(--mono); font-size: 10px; color: var(--dim); letter-spacing: .08em; }
.smeter { margin-left: auto; font-family: var(--mono); font-size: 10px; color: var(--signal); letter-spacing: .12em; }
.cols { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, .75fr); gap: 26px; margin-top: 16px; }
.side { border-left: 1px solid var(--line); padding-left: 20px; }
.side .cmd { margin-top: 8px; display: block; }
.colh { margin: 4px 0 10px; font-family: var(--mono); font-size: 9px; letter-spacing: .3em; text-transform: uppercase; color: var(--dim); }
.quiet { margin: 6px 0; font-size: 12.5px; color: var(--dim); }
.k { display: block; margin: 10px 0 3px; font-family: var(--mono); font-size: 8.5px; letter-spacing: .3em; text-transform: uppercase; color: var(--dim); }

/* ----------------------------------------------------------------- turns */
.turns { list-style: none; margin: 0; padding: 0; }
.turn {
  display: grid; grid-template-columns: 64px 40px minmax(0,1fr); gap: 3px 12px;
  padding: 11px 0 11px 13px; border-left: 1px solid var(--line2); border-bottom: 1px solid var(--line);
}
.turn.user { border-left: 2px solid var(--warn); }
.turn.agent { border-left: 2px solid var(--line2); }
.tclock { font-family: var(--mono); font-size: 9.5px; color: var(--dim); padding-top: 4px; }
.twho { font-family: var(--mono); font-size: 9px; letter-spacing: .16em; color: var(--dim); text-align: center; padding-top: 4px; }
.turn.user .twho { color: var(--warn); }
.tsaid { margin: 0; font-size: 14.5px; line-height: 1.55; overflow-wrap: anywhere; }
.turn.first .tsaid { font-size: 15.5px; }

/* ------------------------------------------------------------------ asks */
.ask { border: 1px solid color-mix(in srgb, var(--warn) 32%, var(--line2)); background: color-mix(in srgb, var(--warn) 5%, var(--panel)); padding: 11px 13px; margin-bottom: 12px; }
.ahead { display: flex; align-items: baseline; gap: 10px; }
.aid { font-family: var(--mono); font-size: 11px; color: var(--warn); letter-spacing: .16em; }
.await { font-family: var(--mono); font-size: 8.5px; letter-spacing: .26em; text-transform: uppercase; color: var(--warn); border: 1px solid currentColor; padding: 1px 5px; }
.atext { margin: 8px 0 0; font-size: 14px; }
.areading { margin: 6px 0 0; font-size: 11.5px; color: var(--dim); }
.areading .k { display: inline; margin: 0 8px 0 0; letter-spacing: .2em; }
// 讨论屏：主轴是轮次，题在右边。题是还没发出去的档案，只在自己的窗口里攒你说的话。
.qlist { list-style: none; margin: 0; padding: 0; }
.clues { list-style: none; margin: 8px 0 0; padding: 7px 0 0; border-top: 1px dashed var(--line2); }
.clue { display: grid; grid-template-columns: 46px minmax(0,1fr); gap: 8px; font-size: 11.5px; color: var(--dim); margin: 0 0 4px; overflow-wrap: anywhere; }
.cclock { font-family: var(--mono); font-size: 8.5px; color: var(--dim); padding-top: 2px; }
.qa.quiet { background: none; border-color: var(--line); padding: 8px 10px; }
.side .colh:first-of-type { margin-top: 0; }
.qa { border: 1px solid var(--line2); background: var(--panel2); padding: 11px 12px; margin: 0 0 8px; }
.qa[data-state="pending"] { border-color: color-mix(in srgb, var(--warn) 40%, var(--line2)); background: color-mix(in srgb, var(--warn) 4%, var(--panel2)); }
.qhead { display: flex; align-items: baseline; gap: 9px; }
.qstate { font-family: var(--mono); font-size: 8.5px; letter-spacing: .2em; padding: 0 5px; border: 1px solid currentColor; color: var(--dim); }
.qa[data-state="pending"] .qstate { color: var(--warn); }
.qa[data-state="resolved"] .qstate { color: var(--signal); }
.qmeta { margin-left: auto; font-family: var(--mono); font-size: 9px; color: var(--dim); white-space: nowrap; }
.qa .atext { margin: 7px 0 0; font-size: 13.5px; }
.qa .qdone { margin: 7px 0 0; font-size: 12.5px; color: var(--ink); }
.qa .qdone.quiet { color: var(--dim); }
.qfoot { margin: 7px 0 0; font-family: var(--mono); font-size: 8.5px; color: var(--dim); }
.qfoot:empty { display: none; }
.edges { list-style: none; margin: 8px 0 0; padding: 0; }
.edge { display: grid; grid-template-columns: 34px minmax(0,1fr) auto; gap: 10px; align-items: baseline; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 12.5px; }
.ekind { font-family: var(--mono); font-size: 8.5px; letter-spacing: .12em; color: var(--warn); }
.ewho { font-family: var(--mono); font-size: 8.5px; color: var(--dim); white-space: nowrap; }

/* -------------------------------------------------------------- segments */
.segs { margin-top: 16px; display: flex; flex-direction: column; gap: 14px; }
.seg { border: 1px solid var(--line); background: var(--panel); }
.seg.here { border-color: color-mix(in srgb, var(--signal) 45%, var(--line2)); }
.segbar {
  display: grid; grid-template-columns: 34px 82px auto 92px minmax(0,1fr) auto auto; align-items: center; gap: 14px;
  padding: 8px 13px; background: var(--panel2); border-bottom: 1px solid var(--line);
}
.seg.here .segbar { box-shadow: inset 2px 0 0 var(--signal); }
.sid { font-family: var(--mono); font-size: 11.5px; letter-spacing: .12em; color: var(--signal); }
.scount, .swhen { font-family: var(--mono); font-size: 9.5px; color: var(--dim); letter-spacing: .08em; }
.scost { font-family: var(--mono); font-size: 9px; color: var(--warn); letter-spacing: .04em; white-space: nowrap; }
.scost:empty { display: none; }
.smeter2 { display: block; height: 3px; background: var(--line2); position: relative; }
.sfill { display: block; height: 100%; background: var(--signal); box-shadow: 0 0 7px color-mix(in srgb, var(--signal) 65%, transparent); }
.swhen { justify-self: end; }
.tag { font-family: var(--mono); font-size: 8.5px; letter-spacing: .22em; padding: 2px 7px; border: 1px solid currentColor; text-transform: uppercase; }
.tag.pass { color: var(--signal); }
.tag.fail { color: var(--fail); }
.tag.grit { color: var(--warn); border-style: dashed; }
.tag.quiet { color: var(--dim); }
.why { margin: 9px 13px 0; font-family: var(--mono); font-size: 10px; color: var(--warn); }
.revline { margin: 9px 13px 0; font-family: var(--mono); font-size: 9.5px; color: var(--dim); }
.fds { margin: 10px 13px 4px; display: flex; flex-direction: column; gap: 4px; }
.fdshead { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 2px; }
.fdshead .fx { font-family: var(--mono); font-size: 8.5px; letter-spacing: .18em; color: var(--dim); text-transform: uppercase; }
.fd { border-left: 1px solid color-mix(in srgb, var(--fail) 40%, var(--line2)); background: color-mix(in srgb, var(--fail) 5%, transparent); }
.fd > summary {
  display: grid; grid-template-columns: auto minmax(0,1fr) 18px; gap: 4px 9px; align-items: baseline;
  padding: 6px 10px; cursor: pointer; list-style: none;
}
.fd > summary::-webkit-details-marker { display: none; }
.fd > summary:hover { background: color-mix(in srgb, var(--fail) 9%, transparent); }
.fid { font-family: var(--mono); font-size: 8.5px; letter-spacing: .12em; color: var(--fail); border: 1px solid color-mix(in srgb, var(--fail) 45%, transparent); padding: 0 4px; }
.ftitle { font-size: 12.5px; line-height: 1.4; color: color-mix(in srgb, var(--ink) 88%, var(--dim)); }
.fx { font-family: var(--mono); font-size: 8.5px; color: var(--dim); text-align: right; }
.fd > summary .fx::after { content: "+"; margin-left: 4px; color: var(--warn); }
.fd[open] > summary .fx::after { content: "−"; }
.fbody {
  margin: 0; padding: 2px 12px 11px 12px; font-family: var(--mono); font-size: 11.5px; line-height: 1.62;
  color: color-mix(in srgb, var(--ink) 74%, var(--dim)); max-width: 88ch; white-space: pre-wrap; overflow-wrap: anywhere;
}

/* ----------------------------------------------------------------- tasks */
.tgroup { margin: 14px 0 6px; font-size: 11px; letter-spacing: .08em; color: var(--dim2); text-transform: uppercase; }
.tgroup[data-group="doing"] { color: var(--accent); }
.tasks { display: flex; flex-direction: column; }
.task { border-bottom: 1px solid var(--line); }
.task:last-child { border-bottom: 0; }
.task > summary {
  display: grid; grid-template-columns: 12px 42px minmax(0,1fr) auto; grid-template-rows: auto auto;
  gap: 2px 10px; align-items: baseline; padding: 9px 13px; cursor: pointer; list-style: none;
}
.task > summary::-webkit-details-marker { display: none; }
.task > summary:hover { background: var(--panel2); }
.led { width: 7px; height: 7px; background: var(--line2); justify-self: center; align-self: center; }
.led.todo { background: var(--warn); box-shadow: 0 0 6px color-mix(in srgb, var(--warn) 60%, transparent); }
.led.done { background: var(--signal); box-shadow: 0 0 6px color-mix(in srgb, var(--signal) 55%, transparent); }
.led.accepted { background: var(--signal); opacity: .45; }
.led.deferred { background: transparent; border: 1px dashed var(--dim); }
.led.dropped { background: transparent; border: 1px solid var(--fail); }
.trevived { font-size: 11px; color: var(--warn, #d8a657); }
.torder { font-size: 11px; color: var(--dim); }
.tid { font-family: var(--mono); font-size: 9.5px; color: var(--dim); letter-spacing: .1em; }
.ttitle { font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task[data-status="dropped"] .ttitle { color: var(--dim); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--fail) 60%, transparent); }
.tmeta { display: flex; gap: 8px; align-items: baseline; justify-self: end; }
.tstate { font-family: var(--mono); font-size: 8.5px; letter-spacing: .16em; color: var(--dim); }
.tpins { font-family: var(--mono); font-size: 8.5px; color: var(--dim); border: 1px solid var(--line2); padding: 0 5px; }
.tundone { font-family: var(--mono); font-size: 8.5px; color: var(--fail); border: 1px dashed currentColor; padding: 0 5px; }
.tbatch { font-family: var(--mono); font-size: 8.5px; color: var(--warn); border: 1px dotted currentColor; padding: 0 5px; }
.tfiles { grid-column: 3 / -1; font-family: var(--mono); font-size: 9px; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tbody { padding: 2px 13px 12px 13px; border-top: 1px dashed var(--line2); background: var(--sunk); }
.crit { margin: 0; font-size: 12.5px; line-height: 1.5; }
.proofs { list-style: none; margin: 0; padding: 0; }
.proof { display: grid; grid-template-columns: 8px minmax(0,1fr) auto; gap: 2px 9px; padding: 6px 0; border-bottom: 1px dotted var(--line); }
.proof:last-child { border-bottom: 0; }
.dot { width: 5px; height: 5px; background: var(--signal); align-self: start; margin-top: 6px; }
.pclaim { font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.pmeta { font-family: var(--mono); font-size: 9px; color: var(--dim); }
.pins { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 3px 10px; margin-top: 2px; }
.ppin { display: inline-flex; align-items: center; gap: 4px; }
.ppath { font-family: var(--mono); font-size: 9px; color: var(--dim); }
.dig {
  display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
  font-family: var(--mono); font-size: 9px; color: var(--signal);
  background: transparent; border: 1px solid color-mix(in srgb, var(--signal) 34%, var(--line2)); padding: 1px 5px;
}
.dig .dc { color: var(--dim); }
.dig:hover { background: color-mix(in srgb, var(--signal) 10%, transparent); }
.moved { margin: 0; font-family: var(--mono); font-size: 9.5px; color: var(--dim); }
.undones { list-style: none; margin: 8px 0 0; padding: 0; }
.undone { font-size: 11px; color: var(--fail); padding: 2px 0; }

/* -------------------------------------------------------------- acceptance */
.vcard { border: 1px solid var(--line); background: var(--panel); margin-bottom: 12px; }
.vcard[data-kind="fail"] { border-left-color: var(--fail); border-left-style: solid; border-left-width: 2px; }
.vcard[data-kind="pass"] { border-left: 2px solid var(--signal); }
.vcard[data-kind="grit"] { border-left: 2px dashed var(--warn); }
.vhead { display: flex; gap: 14px; align-items: baseline; padding: 11px 13px 8px; border-bottom: 1px solid var(--line); }
.vid { font-family: var(--mono); font-size: 15px; letter-spacing: .1em; color: var(--signal); }
.vword { font-family: var(--mono); font-size: 10px; letter-spacing: .22em; text-transform: uppercase; }
.vcard[data-kind="fail"] .vword { color: var(--fail); }
.vcard[data-kind="pass"] .vword { color: var(--signal); }
.vcard[data-kind="grit"] .vword { color: var(--warn); }
.vcard[data-kind="quiet"] .vword { color: var(--dim); }
.vmeta { font-family: var(--mono); font-size: 9.5px; color: var(--dim); }
.vcount { margin-left: auto; font-family: var(--mono); font-size: 9.5px; color: var(--dim); letter-spacing: .1em; }
.vbrief { margin: 8px 13px 0; font-family: var(--mono); font-size: 9.5px; color: var(--dim); }
.vcard .fds { margin: 8px 13px 12px; }
.goal { margin: 0 0 14px; padding: 10px 13px; border-left: 2px solid var(--signal); background: var(--sunk); font-size: 13px; line-height: 1.55; }
.goal .k { color: var(--dim); font-family: var(--mono); font-size: 10.5px; letter-spacing: .08em; margin-right: 9px; }
.checks { list-style: none; margin: 0; padding: 0; }
.chk { display: grid; grid-template-columns: 18px minmax(0,1fr); gap: 4px 6px; padding: 5px 0; border-bottom: 1px dotted var(--line); align-items: baseline; }
.cbox { font-family: var(--mono); font-size: 11px; color: var(--warn); }
.chk.ok .cbox { color: var(--signal); }
.clabel { font-size: 12px; }
.cwhy { grid-column: 2; font-family: var(--mono); font-size: 9.5px; color: var(--dim); }
.blockers { list-style: none; margin: 0; padding: 0; }
.blockers li { position: relative; padding: 5px 0 5px 14px; font-size: 12px; color: var(--warn); }
.blockers li::before { content: ""; position: absolute; left: 0; top: 11px; width: 4px; height: 4px; background: currentColor; }
.ok { margin: 4px 0; font-family: var(--mono); font-size: 11px; color: var(--signal); }
.signwords { margin: 6px 0 2px; font-size: 14px; color: var(--ink); border-left: 2px solid var(--signal); padding-left: 10px; }
.gate { display: flex; gap: 6px; margin: 8px 0 4px; }
.gate input { flex: 1; min-width: 0; background: transparent; border: 1px solid var(--line2); color: var(--ink);
  font: inherit; font-size: 12px; padding: 5px 8px; border-radius: 2px; }
.gate input::placeholder { color: var(--dim); }
.gate input:focus { outline: none; border-color: var(--signal); }
.gpress { border: 1px solid var(--signal); background: transparent; color: var(--signal); font: inherit;
  font-family: var(--mono); font-size: 11px; letter-spacing: .04em; padding: 5px 10px; cursor: pointer; border-radius: 2px;
  white-space: nowrap; }
.gpress:hover { background: var(--signal); color: var(--bg); }
.gpress:disabled { opacity: .5; cursor: default; }
.gate.small { margin-top: 8px; align-items: center; }
.gask { font-size: 12px; color: var(--dim); white-space: nowrap; }
.gate.small .gpress { font-size: 10px; padding: 4px 8px; }
.exempts { list-style: none; margin: 0; padding: 0; }
.exempts li { font-size: 11.5px; color: var(--dim); padding: 2px 0; }

/* ---------------------------------------------------------------- archive */
.archive { margin-top: 34px; padding-top: 14px; border-top: 1px solid var(--line2); }
.archive ul { list-style: none; margin: 0; padding: 0; }
.arc { display: grid; grid-template-columns: 52px minmax(0,1fr) 58px minmax(0,1fr) auto; gap: 14px; padding: 7px 0; border-bottom: 1px solid var(--line); font-family: var(--mono); font-size: 9.5px; color: var(--dim); }
.aid { color: var(--signal); }
.atitle { color: var(--ink); font-family: var(--disp); font-size: 12px; }
.asegs { display: flex; gap: 10px; flex-wrap: wrap; }

/* ------------------------------------------------------------------- foot */
.foot { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 30px; padding-top: 11px; border-top: 1px solid var(--line2); font-family: var(--mono); font-size: 9.5px; color: var(--dim); letter-spacing: .08em; }
.fk { color: var(--signal); text-transform: uppercase; letter-spacing: .2em; }
.fs { color: var(--warn); }
.live { margin-left: auto; }

body.only-debt .task[data-status="accepted"], body.only-debt .task[data-status="dropped"] { display: none; }

@media (max-width: 900px) {
  .frame { padding: 0 15px 70px; }
  .hud { flex-wrap: wrap; gap: 10px 18px; }
  .reads { margin-left: 0; order: 4; width: 100%; }
  .tools { margin-left: auto; }
  .cols { grid-template-columns: 1fr; gap: 18px; }
  .side { border-left: 0; padding-left: 0; border-top: 1px solid var(--line); padding-top: 12px; }
  .rail { flex-wrap: wrap; }
  .tab { flex: 1 1 100%; border-right: 0; border-bottom: 1px solid var(--line); }
  .arrow { display: none; }
  .dwhat { font-size: 19px; }
  .smeter2 { display: none; }
  .segbar { grid-template-columns: 30px 70px 1fr; row-gap: 4px; }
  .swhen, .stamp { grid-column: 3; justify-self: start; }
  .task > summary { grid-template-columns: 12px 38px minmax(0,1fr); }
  .tmeta { grid-column: 3; justify-self: start; }
  .tfiles { grid-column: 2 / -1; }
  .proof { grid-template-columns: 8px minmax(0,1fr); }
  .pmeta { grid-column: 2; }
  .arc { grid-template-columns: 44px 1fr; }
  .vhead { flex-wrap: wrap; }
  .vcount { margin-left: 0; width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .hud::after, .tab.on .tmark, .screen.on { animation: none; }
}
</style>`;

const SCRIPT = `<script>
document.addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (tab) {
    const name = tab.getAttribute("data-screen");
    document.querySelectorAll(".tab").forEach((one) => {
      const on = one === tab;
      one.classList.toggle("on", on);
      one.setAttribute("aria-pressed", on ? "true" : "false");
    });
    document.querySelectorAll(".screen").forEach((one) => {
      one.classList.toggle("on", one.getAttribute("data-screen") === name);
    });
    return;
  }
  const copy = event.target.closest("[data-copy]");
  if (copy) {
    const text = copy.getAttribute("data-copy");
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => say("已复制 · " + text.slice(0, 34)), () => say("复制不了 · 手动选"));
    return;
  }
  const tool = event.target.closest(".tool");
  if (tool && tool.hasAttribute("data-filter")) {
    const on = document.body.classList.toggle("only-debt");
    tool.setAttribute("aria-pressed", on ? "true" : "false");
    return;
  }
  if (tool && tool.hasAttribute("data-theme")) {
    const dark = document.documentElement.getAttribute("data-theme") !== "light";
    document.documentElement.setAttribute("data-theme", dark ? "light" : "dark");
    tool.textContent = dark ? "暗" : "明";
    tool.setAttribute("aria-pressed", dark ? "true" : "false");
  }
});
document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-gate]");
  if (!form) return;
  event.preventDefault();
  const action = form.getAttribute("data-gate");
  const body = { action };
  if (action === "sign") body.words = (form.querySelector(".gwords") || {}).value || "";
  if (action === "judgement") body.segment = form.getAttribute("data-segment");
  const button = form.querySelector(".gpress");
  if (button) button.disabled = true;
  fetch("/gate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((response) => response.json().then((answer) => ({ ok: response.ok && answer.ok, why: answer.why })))
    .then((answer) => {
      if (button) button.disabled = false;
      if (answer.ok) { say("已经记下 · 跟着账本刷新"); return; }
      if (form.querySelector(".gwords")) form.querySelector(".gwords").value = "";
      say(answer.why || "按不下去");
    })
    .catch(() => { if (button) button.disabled = false; say("面板没连上"); });
});
document.addEventListener("keydown", (event) => {
  const map = { 1: "discuss", 2: "execute", 3: "accept" };
  const name = map[event.key];
  if (!name || event.metaKey || event.ctrlKey || event.altKey) return;
  const tab = document.querySelector('.tab[data-screen="' + name + '"]');
  if (tab) tab.click();
});
const say = (text) => {
  const live = document.getElementById("live");
  if (!live) return;
  live.textContent = text;
  setTimeout(() => { live.textContent = "跟着账本刷新"; }, 1600);
};
if (window.EventSource) {
  const source = new EventSource("/events");
  source.addEventListener("change", () => {
    say("账本动了 · 重排中");
    setTimeout(() => location.reload(), 220);
  });
  source.addEventListener("hello", () => say("跟着账本刷新"));
  source.onerror = () => say("离线快照");
} else {
  say("离线快照");
}
</script>`;
