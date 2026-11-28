// facts/session: 一期（session）里的事实——谁开了它、它的原文、它手上有什么。
// 纯函数：doc/session 进，值出；不读盘、不看时钟。
import { noway } from "./errors.mjs";

export const blank = () => ({ v: 1, sessions: [], changes: [], config: null, project: null });

export const lastSession = (doc) => doc.sessions[doc.sessions.length - 1] ?? null;

export function newSession(doc, at) {
  const session = {
    id: `S${String(doc.sessions.length + 1).padStart(2, "0")}`,
    openedAt: at,
    closedAt: null,
    closeKind: null,
    title: null,
    words: null,
    // 原文的两半：turns 是人说的，replies 是我说的。两边都不参与规则。
    turns: [],
    replies: [],
    goal: null,
    goals: [],
    tasks: [],
    asks: [],
    // 讨论域的三层：原文在 turns，要点是 agent 记下的句子，议题由要点统合而来。
    points: [],
    topics: [],
    briefs: [],
    reviews: [],
    segments: [],
  };
  // Ids already taken in this period. Kept off the enumerable shape: it is an
  // index, not a fact about the period, and must not leak into the document.
  Object.defineProperty(session, "ids", { value: new Set(), enumerable: false });
  doc.sessions.push(session);
  return session;
}

export const taken = (session, id) => session.ids.has(id);

// Only a turn opens a period. Every other event needs one already open: a task
// cannot invent a session, and a closed period cannot silently come back.

export function sessionOf(doc, ev) {
  const bind = (session) => {
    // The ledger records where each event landed, so a later reader can address
    // a period by id. The turn that opens a period is the exception: it is the
    // period's birth, and pointing at a session that does not exist yet would
    // make the line unreadable on its own.
    ev.s = session.id;
    return session;
  };
  if (ev.s === undefined || ev.s === null) {
    const last = lastSession(doc);
    if (ev.k === "turn") {
      if (last && !last.closedAt) return bind(last);
      return newSession(doc, ev.at);
    }
    if (!last) noway("这个工作区还没有会话：先记一轮，会话自己开出来");
    if (last.closedAt) noway(`会话 ${last.id} 已经结束：先记一轮，会话自己开出来`);
    return bind(last);
  }
  const found = doc.sessions.find((one) => one.id === ev.s);
  if (!found) noway(`账本里没有这个会话：${ev.s}`);
  if (found.closedAt)
    noway(`会话 ${found.id} 已经结束（${found.closeKind === "signed" ? "签收" : "归档"}），不能再往里写`);
  return bind(found);
}

// A segment opens itself when something first lands in it: it is a view reset
// after a verdict, not a thing anyone schedules. 新活落进最新那个开段：一段送审之后
// 还在等结论，它不再收东西，改到下一段的条目和新写的条目都往下走。
