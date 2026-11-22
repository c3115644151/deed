// render: document -> one page of HTML. Pure: same document, same bytes.
// The page is a contract sheet: sessions as bound periods, turns on a ruled
// spine, segments stamped when judged, tasks as pinned lines with their proofs.

import {
  countIn,
  currentSession,
  needsReview,
  nextAction,
  openSegment,
  pendingAsks,
  pressure,
  reading,
  reviewOf,
  reviewState,
  signBlockers,
  tasksIn,
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

// The ledger keeps UTC. Which zone the sheet prints is an argument, not the
// machine's setting: the same document and the same zone render the same bytes.
export function when(at, zone = "UTC") {
  if (!at) return "—";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return String(at);
  const parts = {};
  for (const one of formatterFor(zone).formatToParts(date)) parts[one.type] = one.value;
  return parts.month + "/" + parts.day + " " + parts.hour + ":" + parts.minute;
}

const MARK = { todo: "○", done: "◐", accepted: "●", deferred: "…", dropped: "×" };
const STATUS_WORD = { todo: "未做", done: "已交付 · 待判", accepted: "已判", deferred: "延后", dropped: "放弃" };
const READING = { idle: "空", discuss: "讨论", execute: "执行", accept: "验收" };
const PLACE = { idle: "没有在推进的会话", discuss: "这一期还在说事", execute: "正在做", accept: "做完了，等一句话" };

const stamp = (kind, text, extra = "") => '<span class="stamp ' + kind + " " + extra + '">' + esc(text) + "</span>";

function turnLine(turn, zone) {
  return (
    '<li class="turn ' + turn.who + '">' +
    '<span class="clock">' + when(turn.at, zone) + "</span>" +
    '<span class="who">' + (turn.who === "user" ? "人" : "agent") + "</span>" +
    '<span class="said">' + esc(turn.said) + "</span>" +
    (turn.did ? '<span class="did">' + esc(turn.did) + "</span>" : "") +
    "</li>"
  );
}

function taskLine(task, zone) {
  const proofs = task.evidence
    .map(
      (proof) =>
        '<li><span class="pin"></span><b>' +
        esc(proof.claim) +
        '</b><span class="meta">' +
        esc(proof.by) +
        " · " +
        when(proof.at, zone) +
        (proof.digest ? " · 指纹 " + esc(proof.digest.slice(0, 8)) : "") +
        "</span></li>",
    )
    .join("");
  return (
    '<details class="task" data-status="' + task.status + '">' +
    "<summary>" +
    '<span class="mark">' + (MARK[task.status] ?? "·") + "</span>" +
    '<span class="tid">' + esc(task.id) + "</span>" +
    '<span class="ttitle">' + esc(task.title) + "</span>" +
    '<span class="tstate">' + (STATUS_WORD[task.status] ?? "") + "</span>" +
    '<span class="tfiles">' + (task.files.length === 0 ? "路径未声明" : esc(task.files.join("  "))) + "</span>" +
    "</summary>" +
    '<div class="detail">' +
    '<p class="criteria"><span class="label">做完的标准</span>' + esc(task.criteria) + "</p>" +
    (proofs ? '<ul class="proofs">' + proofs + "</ul>" : '<p class="none">还没有证据：这条没交付</p>') +
    (task.changed && task.changed.length > 0
      ? '<p class="moved"><span class="label">交付时动过</span>' + esc(task.changed.join("  ")) + "</p>"
      : "") +
    (task.why ? '<p class="none">停在这里：' + esc(task.why) + "</p>" : "") +
    "</div>" +
    "</details>"
  );
}

// Which paths made this segment a reviewed one: what the tasks said they touch
// plus what the deliveries actually moved. The page names them so a person can
// check the threshold instead of trusting a label.
function pathsOf(session, segment) {
  const files = tasksIn(session, segment).flatMap((task) => [...(task.files ?? []), ...(task.changed ?? [])]);
  return [...new Set(files)].sort();
}

function segmentSheet(session, segment, index, config, zone) {
  const count = countIn(session, segment);
  const state = reviewState(config, session, segment);
  const review = reviewOf(session, segment);
  const here = openSegment(session)?.id === segment.id;
  const verdict = segment.verdict === "pass" ? stamp("pass big", "判过") : segment.verdict === "rework" ? stamp("fail big", "打回") : "";
  // One stamp per fact: once the segment has a verdict, the verdict stamp says
  // everything the gate stamp would ("judged" already implies how it got there).
  const gate = segment.verdict ? "" : { exempt: stamp("quiet", "免审"), missing: stamp("grit", "要审"), pass: stamp("ink", "审过"), fail: stamp("fail", "审查不合格"), stale: stamp("grit", "要重审") }[state];
  const tasks = session.tasks.filter((task) => task.segment === segment.id);
  return (
    '<section class="seg' + (here ? " here" : "") + '" id="' + segment.id + '">' +
    '<header class="seghd">' +
    '<span class="num">' + String(index).padStart(2, "0") + "</span>" +
    '<span class="segname">段 ' + esc(segment.id.split(".")[1]) + "</span>" +
    '<span class="census">' + count.total + " 条 · 未做 " + count.todo + " · 已交付 " + (count.done + count.accepted) + "</span>" +
    '<span class="gate">' + gate + "</span>" +
    '<span class="span">' + when(segment.openedAt, zone) + (segment.closedAt ? " — " + when(segment.closedAt, zone) : "") + "</span>" +
    verdict +
    "</header>" +
    (state === "missing" && needsReview(config, session, segment) ? '<p class="why-review">这一段碰了要审的路径：' + esc(pathsOf(session, segment).join("  ")) + "</p>" : "") +
    (state === "stale" ? '<p class="why-review">结论早于最后一次交付：审的是旧内容，要重审一次</p>' : "") +
    (review ? '<p class="reviewed">' + esc(review.by) + " 审 · " + esc(review.brief) + (review.findings.length ? " · 发现 " + review.findings.length + " 条" : "") + "</p>" : "") +
    '<div class="tasks">' + tasks.map((task) => taskLine(task, zone)).join("") + "</div>" +
    "</section>"
  );
}

function periodSheet(doc, session, config, zone) {
  const open = currentSession(doc)?.id === session.id;
  const asks = pendingAsks(session);
  const watch = pressure(session);
  const ordinal = doc.sessions.indexOf(session) + 1;
  const title = session.title ?? "第 " + ordinal + " 期";
  const closed = session.closeKind === "signed" ? "签" : session.closeKind === "shelved" ? "封" : "";
  return (
    '<article class="period' + (open ? " open" : " shut") + '" id="' + session.id + '">' +
    '<div class="pleft">' +
    '<span class="psig">' + esc(session.id) + "</span>" +
    '<span class="pstate">' + (open ? READING[reading(doc)] : closed === "签" ? "签收" : "强制归档") + "</span>" +
    '<span class="pcount">' + session.turns.length + " 轮 · " + session.segments.length + " 段</span>" +
    "</div>" +
    '<div class="psheet">' +
    '<h2 class="ptitle">' + esc(title) + "</h2>" +
    (session.turns.length > 0 ? '<blockquote class="scope">' + esc(session.turns[0].said) + "</blockquote>" : "") +
    (session.sign ? '<p class="signwords">「' + esc(session.sign.words) + "」" + '</p>' : "") +
    (session.shelve ? '<p class="signwords">未结清 · ' + esc(session.shelve.why) + "</p>" : "") +
    '<ol class="turns">' + session.turns.slice(1).map((turn) => turnLine(turn, zone)).join("") + "</ol>" +
    session.segments.map((segment, index) => segmentSheet(session, segment, index + 1, config, zone)).join("") +
    (asks.length
      ? '<aside class="asks"><span class="alabel">待裁</span><ul>' +
        asks.map((ask) => '<li><b>' + esc(ask.id) + "</b><span class=\"atext\">" + esc(ask.text) + '</span><span class="areading">当成：' + esc(ask.reading) + " · 因为 " + esc(ask.why) + "</span></li>").join("") +
        "</ul></aside>"
      : "") +
    (open && watch && watch.tasks > 3 ? '<p class="watch">这一段压着 ' + watch.tasks + " 条、" + watch.undecided + " 条待判</p>" : "") +
    "</div>" +
    "</article>"
  );
}

export function renderBoard(doc, config, options = {}) {
  const zone = options.zone ?? "UTC";
  const events = options.events ?? null;
  const step = nextAction(doc, config);
  const open = currentSession(doc);
  const sign = open ? signBlockers(doc, open, config) : [];
  const ordered = [...doc.sessions].reverse();
  const turns = doc.sessions.reduce((sum, one) => sum + one.turns.length, 0);
  // Counts of the open period, by task status: the footer answers "how much is
  // left here" with numbers instead of a colour legend nobody asked to decode.
  const tally = open
    ? open.tasks.reduce(
        (sum, task) => ({ ...sum, [task.status]: (sum[task.status] ?? 0) + 1 }),
        { todo: 0, done: 0, accepted: 0, deferred: 0, dropped: 0 },
      )
    : null;
  const state = READING[reading(doc)];
  return (
    '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>deed · ' + esc(state) + "</title>\n" +
    STYLE +
    '</head>\n<body>\n<main class="folio">\n' +
    '<header class="masthead">' +
    '<div class="wordmark">deed<span>契约页</span></div>' +
    '<div class="stateword"><span>状态</span><b>' + esc(state) + "</b></div>" +
    '<div class="runs">会话 <b>' + doc.sessions.length + "</b>　轮次 <b>" + turns + "</b>" + (events === null ? "" : "　账本 <b>" + events + "</b> 条") + "</div>" +
    "</header>" +
    '<section class="next">' +
    '<span class="nwho">下一步 · ' + esc(step.who) + "</span>" +
    '<p class="nwhat">' + esc(step.what) + "　" + esc(step.text) + "</p>" +
    '<code class="ncmd">' + esc(step.command) + "</code>" +
    "</section>" +
    '<div class="stack">' + ordered.map((session) => periodSheet(doc, session, config, zone)).join("") + "</div>" +
    '<footer class="colophon">' +
    "<span>账本 .deed/log · 只读</span>" +
    "<span>" + (tally
      ? "已判 " + tally.accepted + "　待判 " + tally.done + "　未做 " + tally.todo + "　延后 " + tally.deferred + "　放弃 " + tally.dropped
      : "○ 未做　◐ 已交付待判　● 已判") + "</span>" +
    "<span>" + (open ? (sign.length === 0 ? "签收可行" : "签收差：" + esc(sign.join("；"))) : PLACE[reading(doc)]) + "</span>" +
    '<span class="live" id="live">—</span>' +
    "</footer>\n</main>\n" +
    SCRIPT +
    "</body>\n</html>\n"
  );
}

const STYLE = `<style>
:root {
  --paper: #f3efe4; --sheet: #faf7ef; --ink: #17160f; --soft: #6d6759;
  --rule: #d6cfbd; --seal: #9d2b1d; --ink2: #2c4a42; --grass: #8a6d20;
  --serif: "Iowan Old Style", "Palatino Linotype", "Source Han Serif SC", "Songti SC", "SimSun", serif;
  --mono: "Cascadia Mono", "Consolas", "SFMono-Regular", monospace;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; color: var(--ink); background: var(--paper);
  font-family: var(--serif); font-size: 16px; line-height: 1.55;
  background-image: radial-gradient(rgba(23,22,15,.03) 1px, transparent 1px);
  background-size: 7px 7px;
}
.folio { max-width: 1000px; margin: 0 auto; padding: 44px 40px 120px; }
.masthead { display: grid; grid-template-columns: auto 1fr auto; align-items: end; gap: 24px; padding-bottom: 14px; border-bottom: 3px double var(--ink); }
.wordmark { font-size: 30px; letter-spacing: .3em; line-height: 1; }
.wordmark span { display: block; font-size: 11px; letter-spacing: .42em; color: var(--soft); margin-top: 8px; }
.stateword { text-align: right; font-size: 11px; letter-spacing: .4em; color: var(--soft); }
.stateword b { display: block; font-size: 26px; letter-spacing: .3em; color: var(--ink); font-weight: 500; }
.runs { font-size: 11.5px; color: var(--soft); letter-spacing: .1em; font-family: var(--mono); }
.runs b { font-size: 15px; color: var(--ink); }

.next { display: grid; grid-template-columns: 130px 1fr; gap: 6px 26px; padding: 26px 0 22px; border-bottom: 1px solid var(--rule); }
.nwho { font-size: 11px; letter-spacing: .34em; color: var(--seal); padding-top: 8px; text-transform: uppercase; }
.nwhat { margin: 0; font-size: 22px; line-height: 1.4; letter-spacing: .02em; }
.ncmd { grid-column: 2; font-family: var(--mono); font-size: 12px; color: var(--seal); background: rgba(157,43,29,.05); border-left: 3px solid var(--seal); padding: 6px 10px; overflow-wrap: anywhere; }

.stack { margin-top: 34px; }
.period { display: grid; grid-template-columns: 116px 1fr; gap: 0 26px; padding: 22px 0 30px; border-bottom: 1px solid var(--rule); }
.period.shut { opacity: .9; }
.pleft { position: sticky; top: 18px; align-self: start; border-right: 1px solid var(--rule); padding-right: 16px; text-align: right; }
.psig { display: block; font-family: var(--mono); font-size: 17px; letter-spacing: .16em; }
.period.open .psig { color: var(--seal); }
.pstate { display: block; font-size: 10.5px; letter-spacing: .3em; color: var(--soft); margin-top: 4px; }
.pcount { display: block; font-family: var(--mono); font-size: 10px; color: var(--soft); margin-top: 2px; }
.ptitle { margin: 0 0 4px; font-size: 25px; font-weight: 500; letter-spacing: .06em; }
.period.shut .ptitle { font-size: 20px; color: var(--soft); }
.signwords { margin: 0 0 14px; font-size: 13px; color: var(--seal); letter-spacing: .04em; }
.scope { margin: 8px 0 16px; padding: 2px 0 2px 14px; border-left: 3px solid var(--ink); font-size: 16.5px; line-height: 1.5; color: #2b2822; }
.tstate { font-size: 10px; letter-spacing: .18em; color: var(--soft); white-space: nowrap; }
.task[data-status="accepted"] .tstate { color: var(--ink2); }

.turns { list-style: none; margin: 6px 0 20px; padding: 0 0 0 2px; border-left: 2px solid var(--rule); }
.turn { display: grid; grid-template-columns: 78px 34px 1fr; gap: 8px; padding: 4px 0 4px 14px; position: relative; }
.turn::before { content: ""; position: absolute; left: -5px; top: 11px; width: 7px; height: 7px; background: var(--paper); border: 1.5px solid var(--soft); }
.turn.user::before { background: var(--ink); border-color: var(--ink); }
.clock { font-family: var(--mono); font-size: 10.5px; color: var(--soft); padding-top: 4px; }
.who { font-size: 10px; letter-spacing: .18em; color: var(--soft); padding-top: 5px; }
.turn.user .who { color: var(--ink); }
.said { font-size: 15px; overflow-wrap: anywhere; }
.turn.agent .said { color: #3b382f; }
.did { grid-column: 3; font-size: 11.5px; color: var(--soft); font-style: italic; }

.seg { margin: 0 0 22px; padding: 0 0 0 14px; border-left: 2px solid var(--rule); position: relative; }
.seg.here { border-left-color: var(--seal); }
.seghd { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 6px 0 8px; border-bottom: 1px solid var(--rule); }
.num { font-family: var(--mono); font-size: 28px; line-height: 1; color: var(--rule); letter-spacing: -.02em; }
.seg.here .num { color: var(--ink); }
.segname { font-size: 13px; letter-spacing: .16em; }
.census { font-family: var(--mono); font-size: 11px; color: var(--soft); }
.gate { margin-left: auto; }
.span { font-family: var(--mono); font-size: 10.5px; color: var(--soft); }
.stamp {
  display: inline-block; font-size: 10px; letter-spacing: .24em; padding: 2px 8px;
  border: 1.5px solid currentColor; color: var(--seal); transform: rotate(-2.4deg);
  background: rgba(157,43,29,.04);
}
.stamp.big { font-size: 15px; padding: 4px 14px; border-width: 3px; border-style: double; letter-spacing: .3em; transform: rotate(-6deg); }
.stamp.ink { color: var(--ink2); background: none; }
.stamp.grit { color: var(--grass); border-style: dashed; background: none; }
.stamp.fail { color: var(--seal); border-style: double; border-width: 3px; }
.stamp.quiet { color: var(--soft); border-color: var(--rule); transform: none; background: none; }
.reviewed { margin: 6px 0 0; font-size: 11px; color: var(--soft); font-family: var(--mono); }

.tasks { border-top: 0; }
.task { border-bottom: 1px dotted var(--rule); }
.task:last-child { border-bottom: 0; }
.task > summary { display: grid; grid-template-columns: 16px 38px minmax(0,1fr) 104px 250px; gap: 10px; align-items: baseline; padding: 10px 4px; cursor: pointer; list-style: none; }
.task > summary::-webkit-details-marker { display: none; }
.task .mark { font-size: 12px; color: var(--seal); }
.task[data-status="done"] .mark, .task[data-status="accepted"] .mark { color: var(--ink2); }
.task .tid { font-family: var(--mono); font-size: 11px; color: var(--soft); letter-spacing: .08em; }
.task .ttitle { font-size: 15px; }
.task[data-status="accepted"] .ttitle { color: #33302a; }
.task .tfiles { font-family: var(--mono); font-size: 10px; color: var(--soft); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task .tstate { text-align: right; }
.task > summary:hover { background: rgba(23,22,15,.03); }
.detail { padding: 0 4px 14px 64px; }
.criteria { margin: 2px 0 8px; font-size: 13px; }
.label { display: block; font-size: 9.5px; letter-spacing: .3em; color: var(--soft); margin-bottom: 2px; }
.proofs { list-style: none; margin: 0; padding: 0; }
.proofs li { display: grid; grid-template-columns: 10px 1fr; gap: 8px; padding: 3px 0; font-size: 12.5px; }
.pin { width: 5px; height: 5px; margin-top: 7px; background: var(--seal); border-radius: 50%; }
.proofs b { font-weight: 400; }
.proofs .meta { grid-column: 2; font-family: var(--mono); font-size: 10px; color: var(--soft); }
.none { margin: 2px 0; font-size: 11.5px; color: var(--soft); }

.asks { margin: 6px 0 0; border: 1px dashed var(--grass); padding: 10px 14px; background: rgba(138,109,32,.05); }
.alabel { font-size: 9.5px; letter-spacing: .34em; color: var(--grass); }
.asks ul { list-style: none; margin: 4px 0 0; padding: 0; }
.asks li { display: grid; grid-template-columns: 34px 1fr; gap: 8px; padding: 3px 0; }
.asks b { font-family: var(--mono); font-size: 11px; color: var(--grass); font-weight: 400; padding-top: 3px; }
.atext { font-size: 15px; }
.areading { grid-column: 2; font-size: 11px; color: var(--soft); }
.watch { margin: 8px 0 0; font-size: 11.5px; color: var(--grass); }

.colophon { margin-top: 46px; padding-top: 12px; border-top: 3px double var(--ink); display: flex; gap: 22px; flex-wrap: wrap; font-size: 10.5px; color: var(--soft); letter-spacing: .1em; }
.colophon .live { margin-left: auto; font-family: var(--mono); }

@media (max-width: 860px) {
  .folio { padding: 28px 18px 80px; }
  .masthead { grid-template-columns: 1fr auto; }
  .runs { grid-column: 1 / -1; }
  .task > summary { grid-template-columns: 16px 38px 1fr; }
  .task .tstate, .task .tfiles { grid-column: 3; text-align: left; }
  .period { grid-template-columns: 1fr; }
  .pleft { position: static; border-right: 0; border-bottom: 1px solid var(--rule); text-align: left; padding: 0 0 6px; display: flex; gap: 14px; align-items: baseline; }
  .next { grid-template-columns: 1fr; }
  .ncmd { grid-column: 1; }
}
@media (prefers-color-scheme: dark) {
  :root { --paper: #14130f; --sheet: #1b1a15; --ink: #eee7d7; --soft: #9a927f; --rule: #3a372c; --seal: #e0766a; --ink2: #7fc0ae; --grass: #d6b269; }
  body { background-image: radial-gradient(rgba(238,231,215,.05) 1px, transparent 1px); }
  .turn.agent .said { color: #cfc8b6; }
  .task[data-status="accepted"] .ttitle { color: #cfc8b6; }
}
</style>`;

const SCRIPT = `<script>
const live = document.getElementById("live");
if (window.EventSource) {
  const source = new EventSource("/events");
  source.addEventListener("change", () => {
    live.textContent = "账本动了 · 重排中";
    setTimeout(() => location.reload(), 220);
  });
  source.addEventListener("hello", () => {
    live.textContent = "跟着账本刷新";
  });
  source.onerror = () => { live.textContent = "离线快照"; };
} else {
  live.textContent = "离线快照";
}
</script>`;
