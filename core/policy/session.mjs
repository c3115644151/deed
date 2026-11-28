// policy/session: 谁在推进、这一期是什么形态、目的与压力数。
// 只回答一个问题：现在这一期长什么样。下一步是谁不在这里（见 policy/step.mjs）。
import { openSegment } from "./segment.mjs";
import { byOrder, countIn } from "./task.mjs";


export const currentSession = (doc) => {
  const last = doc.sessions[doc.sessions.length - 1] ?? null;
  return last && !last.closedAt ? last : null;
};


export const sessionById = (doc, id) => doc.sessions.find((one) => one.id === id) ?? null;


// 一期要做成什么：签收拿它当尺子。可以改，账本留每一次。
export const goalOf = (session) => session?.goal?.text ?? null;


// A period reads as: nothing said yet (idle), scope being talked through
// (discuss, no segment yet), work in flight (execute), everything judged and
// only the word missing (accept).
export function reading(doc) {
  const session = currentSession(doc);
  if (!session) return "idle";
  if (session.segments.length === 0) return "discuss";
  return openSegment(session) ? "execute" : "accept";
}

// A verdict that was voided by a rework is not a missing verdict: somebody
// looked and the work came back. Saying "no verdict yet" would invite a judge
// who has not seen anything to seal the segment.
const voidedReview = (session, segment) => {
  const ever = session.reviews.filter((one) => one.segment === segment?.id);
  return ever.length > 0 && ever.every((one) => one.voidedAt !== null);
};


export const pressure = (session) => {
  const segment = openSegment(session);
  if (!segment) return null;
  const count = countIn(session, segment);
  return { segment: segment.id, tasks: count.total, undecided: count.done };
};


// 一次只做一件事：这一段的条目按状态分四组，正在做的最多一条，其余都在等。
// 已经了结的排在新待办之后（做完的在前、撤回与放弃的在最后）——清单往下读，
// 越往下越是过去的事；新活永远在看得见的那一段里。
export const groupsOf = (tasks) => {
  const ordered = byOrder(tasks);
  const newestFirst = (list) =>
    [...list].sort((a, b) => String(b.touchedAt ?? "").localeCompare(String(a.touchedAt ?? "")));
  const todo = ordered.filter((one) => one.status === "todo");
  const settled = newestFirst(ordered.filter((one) => one.status === "done" || one.status === "accepted"));
  const closed = newestFirst(ordered.filter((one) => one.status === "dropped" || one.status === "deferred"));
  return [
    { key: "doing", label: "在做", tasks: todo.slice(0, 1) },
    { key: "waiting", label: "等着", tasks: todo.slice(1) },
    { key: "settled", label: "已完成", tasks: settled },
    { key: "closed", label: "撤回或放弃", tasks: closed },
  ].filter((one) => one.tasks.length > 0);
};


// 这一刻在做的是哪一条：下一步与清单说的是同一条。
export const doingOf = (tasks) => groupsOf(tasks).find((one) => one.key === "doing")?.tasks[0] ?? null;
