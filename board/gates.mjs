// 人只在面板上出手：签收（议题那一层还没做，闸先占位）。命令行那条路关掉了，
// 命令行那条路关掉了，因为「人按的」与「程序跑的」必须在账本上分得开：
// 面板只收本机、只收同源，落下的行写着 by 与 via:"panel"。
import path from "node:path";
import { spawnSync } from "node:child_process";
import { awaitingJudgement } from "../core/fold.mjs";
import {
  signBlockers, exemptSegments, debt, openSegment, needsReview, needsPeriodReview, reviewable, lastBrief, lastPeriodBrief,
} from "../core/rules.mjs";

// 面板按下「开始审查」之后，出清单这件事由命令自己做完（写两份文件、记一条 review.brief）。
// 它是同一套逻辑的第二个入口：命令行那条默认关着，--panel 只在面板按下时带上。
const CLI = path.join(import.meta.dirname, "..", "cli", "deed.mjs");
import { fold } from "../core/fold.mjs";
import { readEvents } from "../lib/store.mjs";
const foldEvents = (root) => fold(readEvents(root));

const runReview = (root, args) => {
  const run = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DEED_NO_PANEL: "1" },
  });
  if (run.status !== 0) demand(String(run.stderr ?? run.stdout ?? "").replace(/^deed:\s*/u, "").trim());
  // 回执要带上"记下了哪一种账"：面板照这一行说按下去发生了什么。
  return { ok: true, said: String(run.stdout ?? "").trim(), ev: { k: "review.brief", by: "user", via: "panel" } };
};

// 手里那一份交出去、还没人回答：这一段此刻在判，按钮不该亮。
const handOut = (session, segmentId) => {
  const last = lastBrief(session, segmentId);
  return Boolean(last) && last.answeredBy === null && last.withdrawnAt === undefined;
};

// 这一期叫什么：第几期。它只是一个标题，从账本里数得出来。
const periodOf = (doc, session) => "第 " + (doc.sessions.indexOf(session) + 1) + " 期";
import { record } from "../lib/record.mjs";

const sessionOf = (doc, id) =>
  id ? doc.sessions.find((one) => one.id === id) ?? null : (doc.sessions.at(-1) ?? null);

// 现在这一页上有哪几个闸是开着的，以及为什么关着——面板只画开着的那些。
export function gatesOf(doc, config = doc.config) {
  const session = sessionOf(doc, null);
  const sign = (() => {
    if (!session) return { open: false, why: "还没有在推进的一期" };
    if (session.closeKind) return { open: false, why: "这一期已经" + (session.closeKind === "signed" ? "签收" : "搁下") };
    const blockers = signBlockers(doc, session, config);
    if (blockers.length > 0) return { open: false, why: blockers.join("；"), blockers };
    return { open: true, why: "", words: "", title: periodOf(doc, session) };
  })();
  // 判决：审查通过之后由人按的那一下。它一次只对一段——就是手上那一段。
  const shut = session ? openSegment(session) : null;
  const judgement = awaitingJudgement(session, shut)
    ? {
        open: true,
        why: "",
        segment: shut.id,
        at: shut.reviewedAt ?? null,
      }
    : { open: false, why: "没有等你判决的段" };
  // 讨论域的两下：成立（统合要点成正文后由人认）与锁定（允许出口为任务）。
  const topics = session ? (session.topics ?? []) : [];
  const establish = topics.find((one) => one.state === "draft" && String(one.body ?? "").trim());
  const release = topics.find((one) => one.state === "established");
  const topicEstablish = establish
    ? { open: true, why: "", topic: establish.id, title: establish.title, body: establish.body }
    : { open: false, why: topics.some((one) => one.state === "draft") ? "议题还没有正文：先统合要点" : "没有等你确认成立的议题" };
  const topicRelease = release
    ? { open: true, why: "", topic: release.id, title: release.title }
    : { open: false, why: "没有等你确认出口的议题" };
  // 开始审查：段审与期审都由人按下才开始。agent 与系统不擅自启动——这是用户定下的规矩
  // （审查必须经过人同意），所以出清单那条命令在命令行那头是关着的。
  const review = (() => {
    if (!session) return { open: false, why: "还没有在推进的一期" };
    if (session.closeKind) return { open: false, why: "这一期已经结束" };
    const seg = shut;
    if (!seg) return { open: false, why: "没有正在做的段" };
    if (!reviewable(session, seg)) return { open: false, why: seg.id + " 没有交付，也没有在案结论：这一段不用审，直接封" };
    if (handOut(session, seg.id)) return { open: false, why: seg.id + " 的清单交出去了，正在判" };
    if (!needsReview(doc.config, session, seg)) return { open: false, why: seg.id + " 没有新改动要审" };
    return { open: true, why: "", segment: seg.id, title: seg.id };
  })();
  const periodReview = (() => {
    if (!session) return { open: false, why: "还没有在推进的一期" };
    if (session.closeKind) return { open: false, why: "这一期已经结束" };
    if (!needsPeriodReview(session)) return { open: false, why: "这一期还不到期审的时候：段都关了、没有未做与未判之后才有这一层" };
    const handed = lastPeriodBrief(session);
    if (handed && handed.answeredBy === null && handed.withdrawnAt === undefined)
      return { open: false, why: "期审清单交出去了，正在判" };
    return { open: true, why: "", title: periodOf(doc, session) };
  })();
  return { review, periodReview, sign, judgement, topicEstablish, topicRelease };
}

const demand = (text) => {
  const error = new Error(text);
  error.isGateRefusal = true;
  throw error;
};

// 按下其中一个：写一行、返回写完的文档。条件不满足就抛（消息就是面板上那句话）。
// 签下的这一刻要把两件事摆出来：没人审过的段、带着走的未结项。页面和回执说同一句话。
const notesAfterSign = (doc, sessionId) => {
  const session = doc.sessions.find((one) => one.id === sessionId);
  const notes = [];
  const unread = exemptSegments(session);
  if (unread.length > 0)
    notes.push("没经过审查 · " + unread.map((one) => (one.sealedWhy ? one.id + "（" + one.sealedWhy + "）" : one.id)).join("、"));
  const owed = debt(session);
  const list = (tasks) => tasks.map((one) => one.id).join("、");
  if (owed.deferred.length + owed.dropped.length > 0)
    notes.push("带着走的未结项 · 延后 " + (list(owed.deferred) || "（没有）") + " · 放弃 " + (list(owed.dropped) || "（没有）"));
  return notes;
};

export function applyGate(root, action = {}) {
  const kind = String(action.action ?? "");
  if (kind === "review-start") {
    // 面板上那一格本来就长在收活的那一段上：不写段号就是它。
    const asked = String(action.segment ?? "").trim();
    const doc0 = foldEvents(root);
    const id = asked || (openSegment(sessionOf(doc0, action.session ?? null))?.id ?? "");
    if (!id) demand("现在没有正在做的段：没有可审的东西");
    const { doc } = { doc: foldEvents(root) };
    const session = sessionOf(doc, action.session ?? null);
    if (!session) demand("还没有在推进的一期");
    const seg = session.segments.find((one) => one.id === id);
    if (!seg) demand("账本里没有段 " + id);
    if (seg.closedAt !== null) demand(id + " 已经判过了");
    // 已经有一份在手上：按第二次只是把路径再报一遍，不是再写一份。
    if (handOut(session, id))
      return {
        ok: true,
        said: id + " 已经出过清单，正在判：" + String(lastBrief(session, id).brief),
        ev: { k: "review.brief", by: "user", via: "panel" },
      };
    if (!needsReview(doc.config, session, seg)) demand(id + " 没有新改动要审");
    return runReview(root, ["review", "--segment", id, "--panel"]);
  }
  if (kind === "period-review") {
    const { doc } = { doc: foldEvents(root) };
    const session = sessionOf(doc, action.session ?? null);
    if (!session) demand("还没有在推进的一期");
    if (!needsPeriodReview(session)) demand("这一期还不到期审的时候");
    const handed = lastPeriodBrief(session);
    if (handed && handed.answeredBy === null && handed.withdrawnAt === undefined)
      return { ok: true, said: "期审清单已经出过，正在判：" + String(handed.brief), ev: { k: "review.brief", by: "user", via: "panel" } };
    return runReview(root, ["review", "--all", "--panel"]);
  }
  if (kind === "sign") {
    if (!String(action.words ?? "").trim()) demand("签收要写一句原话：这就是你为这一期签下的那句话");
    const written = record(
      root,
      (doc, at) => {
        const session = sessionOf(doc, action.session ?? null);
        if (action.session && !session) demand("账本里没有会话 " + action.session);
        if (!session) demand("还没有在推进的一期");
        if (session.closeKind) demand("这一期已经" + (session.closeKind === "signed" ? "签收" : "搁下"));
        const blockers = signBlockers(doc, session, doc.config);
        if (blockers.length > 0) demand("还不能签收：" + blockers.join("；"));
        return {
          k: "sign",
          s: session.id,
          words: String(action.words).trim(),
          title: action.title ?? periodOf(doc, session),
          by: "user",
          via: "panel",
        };
      },
      { at: action.at ?? null },
    );
    return { ...written, notes: notesAfterSign(written.doc, written.ev.s) };
  }
  if (kind === "judgement") {
    const id = String(action.segment ?? "").trim();
    if (!id) demand("判决要说是哪一段");
    const written = record(
      root,
      (doc) => {
        const session = sessionOf(doc, action.session ?? null);
        if (!session) demand("还没有在推进的一期");
        if (session.closeKind) demand("这一期已经结束");
        const home = session.segments.find((one) => one.id === id);
        if (!home) demand("账本里没有段 " + id);
        if (home.closedAt !== null) demand(home.id + " 已经判过了");
        if (home.verdict !== "pass") demand(home.id + " 还没有审查通过：判决在审查通过之后才按得下去");
        return { k: "verdict.pass", s: session.id, segment: id, by: "user", via: "panel" };
      },
      { at: action.at ?? null },
    );
    return written;
  }
  if (kind === "topic-establish") {
    const id = String(action.topic ?? "").trim();
    if (!id) demand("议题成立要说是哪一个");
    const written = record(
      root,
      (doc) => {
        const session = sessionOf(doc, action.session ?? null);
        if (!session) demand("还没有在推进的一期");
        if (session.closeKind) demand("这一期已经结束");
        const topic = (session.topics ?? []).find((one) => one.id === id);
        if (!topic) demand("账本里没有议题 " + id);
        if (topic.state !== "draft") demand(topic.id + " 已经" + (topic.state === "established" ? "成立" : "锁定"));
        if (!String(topic.body ?? "").trim()) demand(topic.id + " 还没有正文：先把要点统合成正文");
        return {
          k: "topic.establish", s: session.id, id: topic.id,
          body: topic.body, points: [...topic.points],
          by: "user", via: "panel",
        };
      },
      { at: action.at ?? null },
    );
    return written;
  }
  if (kind === "topic-release") {
    const id = String(action.topic ?? "").trim();
    if (!id) demand("议题锁定要说是哪一个");
    const written = record(
      root,
      (doc) => {
        const session = sessionOf(doc, action.session ?? null);
        if (!session) demand("还没有在推进的一期");
        if (session.closeKind) demand("这一期已经结束");
        const topic = (session.topics ?? []).find((one) => one.id === id);
        if (!topic) demand("账本里没有议题 " + id);
        if (topic.state !== "established") demand(topic.id + " 还没成立：先按成立那一下");
        return { k: "topic.release", s: session.id, id: topic.id, by: "user", via: "panel" };
      },
      { at: action.at ?? null },
    );
    return written;
  }
  demand("面板不认这个闸：" + (kind || "（空）"));
}

