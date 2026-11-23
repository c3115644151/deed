// render: document -> one page of HTML. Pure: same document, same bytes.
// The page answers one question first -- can this be released? -- and then
// shows where the answer comes from: five gates, the tasks that hold them,
// the proofs pinned to the work. Text is the evidence, not the layout.

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

const stamp = (kind, text) => '<span class="stamp ' + kind + '">' + esc(text) + "</span>";

// The five gates answer "why can't this be released yet" in order. A gate is
// done when the ledger says so -- never because a counter reached a number.
function gatesOf(doc, session, config, segment) {
  const tasks = session.tasks;
  const todo = tasks.filter((task) => task.status === "todo").length;
  const state = segment ? reviewState(config, session, segment) : "pass";
  const signLeft = signBlockers(doc, session, config);
  return [
    {
      key: "scope",
      name: "范围",
      done: session.turns.length > 0,
      why: "还没有第一句话：这一期没说清要交付什么",
      command: "deed tick \"" + "…" + "\"",
    },
    {
      key: "task",
      name: "任务",
      done: tasks.length > 0,
      why: "清单是空的：没有任务就没有交付，也没有可判的东西",
      command: "deed task add \"" + "…" + "\" --criteria \"" + "…" + "\"",
    },
    {
      key: "deliver",
      name: "交付",
      done: tasks.length > 0 && todo === 0,
      why: "欠 " + todo + " 条没交付",
      command: "deed task done " + (tasks.find((task) => task.status === "todo")?.id ?? "T1") + " --evidence \"" + "…" + "\"",
    },
    {
      key: "verdict",
      name: state === "exempt" && segment && segment.closedAt === null ? "封存" : "判决",
      // 一段的结局只有两种：审查者的结论（pass 当场封段），或者门槛说不用审时
      // 有人写清凭什么不审。后者没人看过，所以这一格叫"封存"，不叫"判过"。
      done: segment ? segment.closedAt !== null : true,
      why:
        state === "stale"
          ? "结论早于最后一次交付：审的是旧内容，要重审一次"
          : state === "exempt"
            ? "门槛说这一段不用审：还没有人封存"
            : state === "pass"
              ? "审查通过"
              : "这一段要审，结论还没落盘",
      command:
        state === "exempt" && segment && segment.closedAt === null
          ? "deed seal --segment " + segment.id + ' --why "…"'
          : segment && segment.closedAt === null
            ? "deed review --segment " + segment.id
            : 'deed task add "…" --criteria "…"',
    },
    {
      key: "sign",
      name: "签收",
      done: Boolean(session.sign),
      why: signLeft.length > 0 ? signLeft.join("；") : "签收要用户原话：deed sign \"…\"",
      command: 'deed sign "…"',
    },
  ];
}

function gateRail(gates) {
  const now = gates.findIndex((gate) => !gate.done);
  return (
    '<ol class="gates">' +
    gates
      .map((gate, index) => {
        const state = gate.done ? "done" : index === now ? "now" : index < now ? "done" : "wait";
        return (
          '<li class="gate ' + state + '" data-gate="' + gate.key + '">' +
          '<span class="gd"><span class="gn">' + (index + 1) + "</span></span>" +
          '<span class="gl">' + esc(gate.name) + "</span>" +
          "</li>"
        );
      })
      .join("") +
    "</ol>"
  );
}

function gateNow(gates) {
  const now = gates.find((gate) => !gate.done);
  if (!now) return "";
  return (
    '<p class="gatewhy"><span class="gw">卡在 · ' + esc(now.name) + "</span>" + esc(now.why) +
    '<code class="gwcmd">' + esc(now.command) + "</code></p>"
  );
}

function digestChip(digest) {
  if (!digest) return "";
  return (
    '<button class="dig" type="button" data-copy="' + esc(digest) + '" title="' + esc(digest) + ' 点一下复制">' +
    '<span class="dn">' + esc(digest.slice(0, 8)) + "</span><span class=\"dc\">钉</span></button>"
  );
}

// A delivery can pin several files; an older line pinned one.
function pinsOf(proof) {
  if (proof.files) return proof.files;
  return proof.digest && proof.path ? [{ path: proof.path, digest: proof.digest }] : [];
}

function taskCard(task, zone) {
  const proofs = task.evidence
    .map(
      (proof) =>
        '<li class="proof"><span class="pin"></span><span class="pclaim">' + esc(proof.claim) + "</span>" +
        '<span class="pmeta">' + esc(proof.by) + " · " + when(proof.at, zone) + "</span>" +
        '<span class="pins">' + pinsOf(proof)
          .map((one) => '<span class="ppin"><span class="ppath">' + esc(one.path) + "</span>" + digestChip(one.digest) + "</span>")
          .join("") + "</span>" +
        "</li>",
    )
    .join("");
  const files = task.files.length === 0 ? "路径未声明" : task.files.join("  ");
  return (
    '<details class="card" data-status="' + task.status + '">' +
    "<summary>" +
    '<span class="mark">' + (MARK[task.status] ?? "·") + "</span>" +
    '<span class="cid">' + esc(task.id) + "</span>" +
    '<span class="ctitle">' + esc(task.title) + "</span>" +
    '<span class="cmeta"><span class="tstate">' + (STATUS_WORD[task.status] ?? "") + "</span>" +
    '<span class="cnail">' + (task.evidence.length === 0 ? "未钉" : pinsOf(task.evidence[task.evidence.length - 1]).length + " 份内容") + "</span>" +
    ((task.undone && task.undone.length > 0) ? '<span class="cundone">撤 ' + task.undone.length + "</span>" : "") +
    "</span>" +
    '<span class="cfiles">' + esc(files) + "</span>" +
    "</summary>" +
    '<div class="cdetail">' +
    '<p class="label">做完的标准</p><p class="criteria">' + esc(task.criteria) + "</p>" +
    '<p class="label">凭什么算做到</p>' +
    (proofs ? '<ul class="proofs">' + proofs + "</ul>" : '<p class="none">还没交付</p>') +
    (task.changed && task.changed.length > 0
      ? '<p class="label">交付时真动过</p><p class="moved">' + esc(task.changed.join("  ")) + "</p>"
      : "") +
    (task.why ? '<p class="none">停在这里：' + esc(task.why) + "</p>" : "") +
    "</div>" +
    "</details>"
  );
}

function segmentBlock(session, segment, index, config, zone) {
  const count = countIn(session, segment);
  const state = reviewState(config, session, segment);
  const review = reviewOf(session, segment);
  const here = openSegment(session)?.id === segment.id;
  const verdict = segment.verdict === "pass" ? stamp("pass big", "判过") : segment.verdict === "rework" ? stamp("fail big", "打回") : "";
  const gate = segment.verdict
    ? ""
    : { exempt: stamp("quiet", "免审"), missing: stamp("grit", "要审"), pass: stamp("ink", "审过"), fail: stamp("fail", "审查不合格"), stale: stamp("grit", "要重审") }[state];
  const tasks = session.tasks.filter((task) => task.segment === segment.id);
  return (
    '<section class="seg' + (here ? " here" : "") + '" id="' + esc(segment.id) + '">' +
    '<header class="seghd">' +
    '<span class="num">' + String(index).padStart(2, "0") + "</span>" +
    '<span class="segname">第 ' + esc(segment.id.split(".")[1]) + " 段</span>" +
    '<span class="census">' + count.total + " 条 · 未做 " + count.todo + " · 已交付 " + (count.done + count.accepted) + "</span>" +
    '<span class="span">' + when(segment.openedAt, zone) + (segment.closedAt ? " — " + when(segment.closedAt, zone) : "") + "</span>" +
    '<span class="seals">' + (state === "pass" && !segment.verdict ? stamp("quiet", "等判决") : "") + gate + verdict + "</span>" +
    "</header>" +
    (state === "missing" && needsReview(config, session, segment)
      ? '<p class="why-review">这一段碰了要审的路径：' + esc(pathsOf(session, segment).join("  ")) + "</p>"
      : "") +
    (state === "stale" ? '<p class="why-review">结论早于最后一次交付：审的是旧内容，要重审一次</p>' : "") +
    (review
      ? '<p class="reviewed">' + esc(review.by) + " 审 · " + esc(review.brief) +
        (review.findings.length ? " · 发现 " + review.findings.length + " 条" : "") + "</p>" +
        (review.findings.length
          ? '<details class="findings"><summary>审查者留下的 ' + review.findings.length + " 条</summary><ul>" +
            review.findings.map((one) => "<li>" + esc(one) + "</li>").join("") + "</ul></details>"
          : "")
      : "") +
    '<div class="cards">' + tasks.map((task) => taskCard(task, zone)).join("") + "</div>" +
    "</section>"
  );
}

function pathsOf(session, segment) {
  const files = tasksIn(session, segment).flatMap((task) => [...(task.files ?? []), ...(task.changed ?? [])]);
  return [...new Set(files)].sort();
}

function sessionBlock(doc, session, config, zone) {
  const open = currentSession(doc)?.id === session.id;
  const asks = pendingAsks(session);
  const watch = pressure(session);
  const ordinal = doc.sessions.indexOf(session) + 1;
  const title = session.title ?? "第 " + ordinal + " 期";
  const closed = session.closeKind === "signed" ? "签" : session.closeKind === "shelved" ? "封" : "";
  const gates = gatesOf(doc, session, config, openSegment(session));
  const turns = session.turns.slice(1);
  return (
    '<article class="session' + (open ? " open" : " shut") + '" id="' + esc(session.id) + '">' +
    '<header class="shd">' +
    '<span class="sig">' + esc(session.id) + "</span>" +
    '<span class="sstate">' + (open ? READING[reading(doc)] : closed === "签" ? "签收" : "强制归档") + "</span>" +
    '<h2 class="stitle">' + esc(title) + "</h2>" +
    '<span class="scount">' + session.turns.length + " 轮 · " + session.segments.length + " 段" +
    (session.tasks.length ? " · " + session.tasks.length + " 条" : "") + "</span>" +
    "</header>" +
    (session.turns.length > 0 ? '<blockquote class="scope">' + esc(session.turns[0].said) + "</blockquote>" : "") +
    (session.sign ? '<p class="signwords">签收 · 「' + esc(session.sign.words) + "」</p>" : "") +
    (session.shelve ? '<p class="signwords">未结清 · ' + esc(session.shelve.why) + "</p>" : "") +
    gateRail(gates) +
    gateNow(gates) +
    (turns.length
      ? '<details class="turns"><summary>说过什么 · ' + turns.length + " 轮</summary><ol>" +
        turns
          .map(
            (turn) =>
              '<li class="turn ' + turn.who + '"><span class="clock">' + when(turn.at, zone) + "</span>" +
              '<span class="who">' + (turn.who === "user" ? "人" : "agent") + "</span>" +
              '<span class="said">' + esc(turn.said) + "</span>" +
              (turn.did ? '<span class="did">' + esc(turn.did) + "</span>" : "") + "</li>",
          )
          .join("") + "</ol></details>"
      : "") +
    session.segments.map((segment, index) => segmentBlock(session, segment, index + 1, config, zone)).join("") +
    (asks.length
      ? '<aside class="asks"><span class="alabel">待裁 ' + asks.length + "</span><ul>" +
        asks
          .map(
            (ask) =>
              "<li><b>" + esc(ask.id) + '</b><span class="atext">' + esc(ask.text) + "</span>" +
              '<span class="areading">当成：' + esc(ask.reading) + " · 因为 " + esc(ask.why) + "</span></li>",
          )
          .join("") + "</ul></aside>"
      : "") +
    (open && watch && watch.tasks > 3
      ? '<p class="watch">这一期压着 ' + watch.tasks + " 条、" + watch.undecided + " 条待判</p>"
      : "") +
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
  const tally = open
    ? open.tasks.reduce(
        (sum, task) => ({ ...sum, [task.status]: (sum[task.status] ?? 0) + 1 }),
        { todo: 0, done: 0, accepted: 0, deferred: 0, dropped: 0 },
      )
    : null;
  const state = READING[reading(doc)];
  const owed = open ? open.tasks.filter((task) => task.status === "todo").length : 0;
  const pending = open ? open.tasks.filter((task) => task.status === "done").length : 0;
  return (
    '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>deed · ' + esc(state) + "</title>\n" +
    STYLE +
    '</head>\n<body>\n<main class="folio">\n' +
    '<header class="masthead">' +
    '<div class="wordmark">deed<span>契约页</span></div>' +
    '<div class="stateword"><span>状态</span><b>' + esc(state) + "</b></div>" +
    '<div class="runs">会话 <b>' + doc.sessions.length + "</b>　轮次 <b>" + turns + "</b>" + (events === null ? "" : "　账本 <b>" + events + "</b> 条") + "</div>" +
    '<div class="tools"><button type="button" class="tool" data-filter>只看欠账</button><button type="button" class="tool" data-theme>明 / 暗</button></div>' +
    "</header>" +
    '<section class="hero">' +
    '<span class="hwho">下一步 · ' + esc(step.who) + "</span>" +
    '<p class="hwhat">' + esc(step.what) + "　" + esc(step.text) + "</p>" +
    '<button type="button" class="hcmd" data-copy="' + esc(step.command) + '" title="点一下复制"><span class="cmark">$</span>' + esc(step.command) + "</button>" +
    (owed || pending
      ? '<span class="hdebt">' + (owed ? "未做 " + owed : "") + (owed && pending ? "　" : "") + (pending ? "已交付 · 待判 " + pending : "") + "</span>"
      : "") +
    "</section>" +
    (options.notice ? '<p class="notice">' + esc(options.notice) + "</p>" : "") +
    '<div class="stack">' + ordered.map((session) => sessionBlock(doc, session, config, zone)).join("") + "</div>" +
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
  --paper: #f1ede0; --sheet: #fbf8ef; --ink: #14130d; --soft: #6c6555;
  --rule: #d7cfba; --seal: #a2291b; --ink2: #24453b; --grass: #8a6b1f;
  --serif: "Iowan Old Style", "Palatino Linotype", "Source Han Serif SC", "Songti SC", "SimSun", serif;
  --mono: "Cascadia Mono", "Consolas", "SFMono-Regular", monospace;
  --shade: rgba(20,19,13,.045);
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; color: var(--ink); background: var(--paper);
  font-family: var(--serif); font-size: 16px; line-height: 1.55;
  background-image: radial-gradient(rgba(20,19,13,.035) 1px, transparent 1px);
  background-size: 7px 7px;
}
body { border-top: 9px solid var(--ink); }
.folio { max-width: 1120px; margin: 0 auto; padding: 34px 40px 120px; }

.masthead { display: grid; grid-template-columns: auto auto 1fr auto; align-items: baseline; gap: 26px; padding-bottom: 12px; border-bottom: 3px double var(--ink); }
.wordmark { font-size: 30px; letter-spacing: .32em; line-height: 1; }
.wordmark span { display: block; font-size: 10.5px; letter-spacing: .44em; color: var(--soft); margin-top: 7px; }
.stateword { text-align: left; font-size: 10.5px; letter-spacing: .4em; color: var(--soft); border-left: 1px solid var(--rule); padding-left: 18px; }
.stateword b { display: block; font-size: 25px; letter-spacing: .3em; color: var(--ink); font-weight: 500; margin-top: 2px; }
.runs { font-size: 11px; color: var(--soft); letter-spacing: .1em; font-family: var(--mono); align-self: end; padding-bottom: 8px; }
.runs b { font-size: 14px; color: var(--ink); }
.tools { display: flex; gap: 6px; justify-self: end; align-self: end; padding-bottom: 4px; }
.tool { font-family: var(--mono); font-size: 10px; letter-spacing: .12em; color: var(--soft); background: none; border: 1px solid var(--rule); padding: 4px 8px; cursor: pointer; }
.tool:hover { color: var(--ink); border-color: var(--ink); }
.tool[aria-pressed="true"] { color: var(--paper); background: var(--ink); border-color: var(--ink); }

.hero { padding: 30px 0 26px; border-bottom: 1px solid var(--rule); }
.hwho { display: block; font-family: var(--mono); font-size: 10.5px; letter-spacing: .34em; color: var(--seal); text-transform: uppercase; }
.hwhat { margin: 8px 0 14px; font-size: 30px; line-height: 1.34; letter-spacing: .01em; max-width: 30em; }
.hcmd { display: inline-flex; align-items: baseline; gap: 10px; font-family: var(--mono); font-size: 12.5px; color: var(--paper); background: var(--ink); border: 0; padding: 9px 14px; cursor: pointer; max-width: 100%; text-align: left; overflow-wrap: anywhere; }
.hcmd .cmark { color: var(--paper); opacity: .55; }
.hcmd:hover { background: var(--seal); }
.hdebt { display: inline-block; margin-left: 14px; font-family: var(--mono); font-size: 11px; color: var(--grass); }
.notice { margin: 14px 0 0; font-family: var(--mono); font-size: 11.5px; line-height: 1.5; color: var(--grass); border-left: 3px solid var(--grass); padding: 2px 0 2px 12px; }

.stack { margin-top: 30px; }
.session { padding: 24px 0 34px; border-bottom: 1px solid var(--rule); }
.session.shut { opacity: .88; }
.shd { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.sig { font-family: var(--mono); font-size: 16px; letter-spacing: .16em; color: var(--soft); }
.session.open .sig { color: var(--seal); }
.sstate { font-size: 10px; letter-spacing: .3em; color: var(--soft); }
.stitle { margin: 0; font-size: 23px; font-weight: 500; letter-spacing: .05em; }
.session.shut .stitle { font-size: 19px; color: var(--soft); }
.scount { margin-left: auto; font-family: var(--mono); font-size: 10.5px; color: var(--soft); }
.scope { margin: 10px 0 18px; padding: 2px 0 2px 14px; border-left: 3px solid var(--ink); font-size: 16.5px; line-height: 1.5; color: #2b2822; max-width: 46em; }
.signwords { margin: 0 0 14px; font-size: 13px; color: var(--seal); letter-spacing: .04em; }

.gates { list-style: none; display: flex; align-items: flex-start; gap: 0; margin: 6px 0 0; padding: 0; }
.gate { flex: 1 1 0; position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 0 4px; }
.gate::before { content: ""; position: absolute; top: 17px; right: 50%; width: 100%; height: 1px; background: var(--rule); z-index: 0; }
.gate:first-child::before { content: none; }
.gd { position: relative; z-index: 1; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--paper); border: 1.5px solid var(--rule); }
.gn { font-family: var(--mono); font-size: 12px; color: var(--soft); }
.gl { font-size: 12px; letter-spacing: .22em; color: var(--soft); }
.gate.done .gd { background: var(--ink); border-color: var(--ink); }
.gate.done .gn { color: var(--paper); }
.gate.done .gl { color: var(--ink); }
.gate.now .gd { border: 3px double var(--seal); background: var(--paper); }
.gate.now .gn { color: var(--seal); font-weight: 700; }
.gate.now .gl { color: var(--seal); letter-spacing: .26em; }
.gate.wait .gd { border-style: dashed; }
.gate.wait .gl { opacity: .6; }
.gate.done::before { background: var(--ink); }
.gatewhy { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: 10px 0 0; font-size: 13px; color: var(--ink); }
.gw { font-family: var(--mono); font-size: 10px; letter-spacing: .22em; color: var(--seal); text-transform: uppercase; }
.gwcmd { font-family: var(--mono); font-size: 11px; color: var(--seal); background: var(--shade); padding: 3px 8px; overflow-wrap: anywhere; }

.turns { margin: 16px 0 22px; border-left: 2px solid var(--rule); padding-left: 12px; }
.turns > summary { font-family: var(--mono); font-size: 10.5px; letter-spacing: .16em; color: var(--soft); cursor: pointer; list-style: none; }
.turns > summary::-webkit-details-marker { display: none; }
.turns > summary::before { content: "＋ "; }
.turns[open] > summary::before { content: "－ "; }
.turns ol { list-style: none; margin: 8px 0 0; padding: 0; }
.turn { display: grid; grid-template-columns: 74px 34px 1fr; gap: 8px; padding: 4px 0; }
.clock { font-family: var(--mono); font-size: 10.5px; color: var(--soft); padding-top: 5px; }
.who { font-size: 10px; letter-spacing: .18em; color: var(--soft); padding-top: 6px; }
.turn.user .who { color: var(--ink); }
.said { font-size: 14.5px; overflow-wrap: anywhere; }
.turn.agent .said { color: #3b382f; }
.did { grid-column: 3; font-size: 11.5px; color: var(--soft); font-style: italic; }

.seg { margin: 0 0 20px; padding: 0 0 4px 14px; border-left: 2px solid var(--rule); }
.seg.here { border-left-color: var(--seal); }
.seghd { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; padding: 4px 0 10px; border-bottom: 1px solid var(--rule); }
.num { font-family: var(--mono); font-size: 26px; line-height: 1; color: var(--rule); letter-spacing: -.02em; }
.seg.here .num { color: var(--seal); }
.segname { font-size: 12.5px; letter-spacing: .16em; }
.census { font-family: var(--mono); font-size: 11px; color: var(--soft); }
.span { font-family: var(--mono); font-size: 10.5px; color: var(--soft); }
.seghd .seals { display: flex; gap: 8px; margin-left: auto; align-items: center; }
.stamp { display: inline-block; font-size: 10px; letter-spacing: .24em; padding: 2px 8px; border: 1.5px solid currentColor; color: var(--seal); transform: rotate(-2.4deg); background: rgba(162,41,27,.04); }
.stamp.big { font-size: 15px; padding: 4px 14px; border-width: 3px; border-style: double; letter-spacing: .3em; transform: rotate(-6deg); }
.stamp.ink { color: var(--ink2); background: none; }
.stamp.grit { color: var(--grass); border-style: dashed; background: none; }
.stamp.fail { color: var(--seal); border-style: double; border-width: 3px; }
.stamp.quiet { color: var(--soft); border-color: var(--rule); transform: none; background: none; }
.why-review { margin: 8px 0 0; font-size: 12px; color: var(--grass); }
.reviewed { margin: 6px 0 0; font-size: 11px; color: var(--soft); font-family: var(--mono); }
.findings { margin: 6px 0 0; }
.findings > summary { font-family: var(--mono); font-size: 10.5px; color: var(--soft); cursor: pointer; }
.findings ul { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; color: #3b382f; }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; margin-top: 12px; }
.card { background: var(--sheet); border: 1px solid var(--rule); border-top: 2px solid var(--ink); }
.card[data-status="todo"] { border-top-style: dashed; border-top-color: var(--soft); }
.card[data-status="done"] { border-top-color: var(--ink2); }
.card[data-status="accepted"] { border-top-color: var(--ink2); background: var(--paper); }
.card > summary { display: grid; grid-template-columns: 16px 40px minmax(0,1fr); gap: 2px 8px; align-items: baseline; padding: 10px 12px; cursor: pointer; list-style: none; }
.card > summary::-webkit-details-marker { display: none; }
.card > summary:hover { background: var(--shade); }
.mark { font-size: 12px; color: var(--seal); }
.card[data-status="done"] .mark, .card[data-status="accepted"] .mark { color: var(--ink2); }
.cid { font-family: var(--mono); font-size: 10.5px; color: var(--soft); letter-spacing: .08em; }
.ctitle { font-size: 15px; line-height: 1.4; }
.cmeta { display: flex; gap: 8px; align-items: baseline; justify-content: flex-end; white-space: nowrap; }
.tstate { font-size: 9.5px; letter-spacing: .18em; color: var(--soft); }
.cnail { font-family: var(--mono); font-size: 10px; color: var(--soft); border: 1px solid var(--rule); padding: 0 5px; }
.cundone { font-family: var(--mono); font-size: 10px; color: var(--red); border: 1px dashed currentColor; padding: 0 5px; margin-left: 6px; }
.cfiles { grid-column: 3; font-family: var(--mono); font-size: 10px; color: var(--soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmeta { grid-column: 2 / -1; grid-row: 3; justify-content: flex-start; gap: 10px; margin-top: 2px; }
.cdetail { padding: 0 12px 12px; border-top: 1px dotted var(--rule); margin-top: 4px; padding-top: 10px; }
.label { display: block; font-size: 9px; letter-spacing: .3em; color: var(--soft); margin: 8px 0 2px; }
.criteria { margin: 0; font-size: 13px; line-height: 1.5; }
.proofs { list-style: none; margin: 0; padding: 0; }
.proof { display: grid; grid-template-columns: 10px 1fr auto; gap: 2px 8px; padding: 6px 0; border-bottom: 1px dotted var(--rule); }
.proof:last-child { border-bottom: 0; }
.pin { width: 5px; height: 5px; margin-top: 7px; background: var(--seal); border-radius: 50%; }
.pclaim { font-size: 12.5px; line-height: 1.45; }
.pmeta { grid-column: 2; font-family: var(--mono); font-size: 10px; color: var(--soft); }
.pins { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 3px 12px; margin-top: 2px; }
.ppin { display: inline-flex; align-items: center; gap: 4px; }
.ppath { font-family: var(--mono); font-size: 10px; color: var(--soft); }
.dig { align-self: center; display: inline-flex; align-items: center; gap: 4px; font-family: var(--mono); font-size: 10px; color: var(--ink2); background: var(--shade); border: 1px solid var(--rule); padding: 2px 5px; cursor: pointer; }
.dig:hover { border-color: var(--ink2); }
.dig .dc { font-size: 9px; letter-spacing: .1em; color: var(--soft); }
.moved { margin: 0; font-family: var(--mono); font-size: 10.5px; color: var(--soft); }
.none { margin: 2px 0; font-size: 11.5px; color: var(--soft); }

.asks { margin: 6px 0 0; border: 1px dashed var(--grass); padding: 10px 14px; background: rgba(138,107,31,.05); }
.alabel { font-size: 9.5px; letter-spacing: .34em; color: var(--grass); }
.asks ul { list-style: none; margin: 4px 0 0; padding: 0; }
.asks li { display: grid; grid-template-columns: 34px 1fr; gap: 8px; padding: 3px 0; }
.asks b { font-family: var(--mono); font-size: 11px; color: var(--grass); font-weight: 400; padding-top: 3px; }
.atext { font-size: 15px; }
.areading { grid-column: 2; font-size: 11px; color: var(--soft); }
.watch { margin: 8px 0 0; font-size: 11.5px; color: var(--grass); }

.colophon { margin-top: 40px; padding-top: 12px; border-top: 3px double var(--ink); display: flex; gap: 22px; flex-wrap: wrap; font-size: 10.5px; color: var(--soft); letter-spacing: .1em; }
.colophon .live { margin-left: auto; font-family: var(--mono); }

body.only-debt .card[data-status="accepted"], body.only-debt .card[data-status="dropped"] { display: none; }
body.only-debt .segment-done { display: none; }

@media (max-width: 860px) {
  .folio { padding: 22px 16px 80px; }
  .masthead { grid-template-columns: 1fr auto; gap: 14px; }
  .runs { grid-column: 1 / -1; order: 2; }
  .tools { grid-column: 1 / -1; order: 3; justify-self: start; }
  .hwhat { font-size: 23px; }
  .gates { overflow-x: auto; }
  .gate { min-width: 68px; }
  .cards { grid-template-columns: 1fr; }
  .card > summary { grid-template-columns: 16px 34px 1fr; }
  .cmeta { grid-column: 3; justify-content: flex-start; }
  .cfiles { grid-column: 2 / -1; }
  .turn { grid-template-columns: 62px 30px 1fr; }
}
@media (prefers-color-scheme: dark) {
  :root { --paper: #12110d; --sheet: #1a1913; --ink: #efe8d6; --soft: #9a9280; --rule: #3a372c; --seal: #e2766a; --ink2: #82c3b0; --grass: #d6b269; --shade: rgba(239,232,214,.07); }
  body { background-image: radial-gradient(rgba(239,232,214,.05) 1px, transparent 1px); }
  .turn.agent .said, .findings ul { color: #cfc8b6; }
  .card[data-status="accepted"] .ctitle { color: #cfc8b6; }
  .scope { color: #d9d2bf; }
}
html[data-theme="dark"] { --paper: #12110d; --sheet: #1a1913; --ink: #efe8d6; --soft: #9a9280; --rule: #3a372c; --seal: #e2766a; --ink2: #82c3b0; --grass: #d6b269; --shade: rgba(239,232,214,.07); }
html[data-theme="dark"] body { background-image: radial-gradient(rgba(239,232,214,.05) 1px, transparent 1px); }
html[data-theme="light"] { --paper: #f1ede0; --sheet: #fbf8ef; --ink: #14130d; --soft: #6c6555; --rule: #d7cfba; --seal: #a2291b; --ink2: #24453b; --grass: #8a6b1f; --shade: rgba(20,19,13,.045); }
html[data-theme="light"] body { background-image: radial-gradient(rgba(20,19,13,.035) 1px, transparent 1px); }
</style>`;

const SCRIPT = `<script>
const live = document.getElementById("live");
const flash = (text) => { live.textContent = text; setTimeout(() => { live.textContent = "跟着账本刷新"; }, 1400); };
document.addEventListener("click", (event) => {
  const copy = event.target.closest("[data-copy]");
  if (copy) {
    const text = copy.getAttribute("data-copy");
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => flash("已复制 · " + text.slice(0, 40)), () => flash("复制不了 · 手动选"));
    return;
  }
  const tool = event.target.closest(".tool");
  if (tool && tool.hasAttribute("data-filter")) {
    const on = document.body.classList.toggle("only-debt");
    tool.setAttribute("aria-pressed", on ? "true" : "false");
    flash(on ? "只看欠账：已判的收起" : "全部显示");
    return;
  }
  if (tool && tool.hasAttribute("data-theme")) {
    const dark = getComputedStyle(document.documentElement).backgroundColor !== "rgb(18, 17, 13)";
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }
});
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
