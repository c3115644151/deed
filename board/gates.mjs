// 人只在面板上出手：签收（议题那一层还没做，闸先占位）。命令行那条路关掉了，
// 命令行那条路关掉了，因为「人按的」与「程序跑的」必须在账本上分得开：
// 面板只收本机、只收同源，落下的行写着 by 与 via:"panel"。
import { signBlockers, exemptSegments, debt } from "../core/rules.mjs";

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
  // 议题还没进账本（那一层还没做）：闸一直在，只是没有东西可放。
  const topicRelease = { open: false, why: "还没有议题" };
  return { sign, topicRelease };
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
          by: action.by ?? "user",
          via: "panel",
        };
      },
      { at: action.at ?? null },
    );
    return { ...written, notes: notesAfterSign(written.doc, written.ev.s) };
  }
  if (kind === "topic-release") demand("还没有议题：这一层还没做");
  demand("面板不认这个闸：" + (kind || "（空）"));
}

