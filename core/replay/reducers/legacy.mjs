// legacy 域：只读。旧账本里还有这几种行，命令面已经不再产生它们。
// 纯重放：doc 与 ev 进，改 doc；不读盘、不看时钟。
// 一个 kind 一个函数——加一类事实就是加一个函数，不改别人的分支。
import { meaningOf, MEANING } from "../../events/index.mjs";
import { noway } from "../../facts/errors.mjs";
import { sessionOf, taken } from "../../facts/session.mjs";
import { segmentById, segmentOf, nextSegment, nextOpen, settle, sealed, editable } from "../../facts/segment.mjs";
import { awaitingVerdict } from "../../facts/review.mjs";
import { taskOf, rederive, onTheSheet, lastResultOf, settledSince } from "../../facts/task.mjs";
import { awaitingJudgement } from "../../facts/review.mjs";

export const HANDLERS = {
  "ask.raise": (doc, ev) => {        const session = sessionOf(doc, ev);
        if (taken(session, ev.id)) noway(`这个会话里已经有 ${ev.id} 了`);
        session.ids.add(ev.id);
        session.asks.push({ id: ev.id, text: ev.text, reading: ev.reading, why: ev.why, at: ev.at, state: "pending", decision: null, by: null });
        return;
  },
  "ask.resolve": (doc, ev) => {        const session = sessionOf(doc, ev);
        const ask = session.asks.find((one) => one.id === ev.id);
        if (!ask) noway(`这个会话里没有待裁项：${ev.id}`);
        if (ask.state !== "pending") noway(`待裁项 ${ask.id} 已经处置过：${ask.state}`);
        ask.state = ev.k === "ask.resolve" ? "resolved" : "withdrawn";
        ask.decision = ev.decision ?? null;
        ask.why2 = ev.why ?? null;
        ask.by = ev.by ?? null;
        ask.closedAt = ev.at;
        return;
  },
  "ask.withdraw": (doc, ev) => {        const session = sessionOf(doc, ev);
        const ask = session.asks.find((one) => one.id === ev.id);
        if (!ask) noway(`这个会话里没有待裁项：${ev.id}`);
        if (ask.state !== "pending") noway(`待裁项 ${ask.id} 已经处置过：${ask.state}`);
        ask.state = ev.k === "ask.resolve" ? "resolved" : "withdrawn";
        ask.decision = ev.decision ?? null;
        ask.why2 = ev.why ?? null;
        ask.by = ev.by ?? null;
        ask.closedAt = ev.at;
        return;
  },
};
