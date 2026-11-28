// segment 域：段的开与关，以及旧账本里那两种结局（judge.pass / judge.rework）的读法。
// 纯重放：doc 与 ev 进，改 doc；不读盘、不看时钟。
// 一个 kind 一个函数——加一类事实就是加一个函数，不改别人的分支。
import { meaningOf, MEANING } from "../../events.mjs";
import { noway } from "../../facts/errors.mjs";
import { sessionOf, taken } from "../../facts/session.mjs";
import { segmentById, segmentOf, nextSegment, nextOpen, settle, sealed, editable } from "../../facts/segment.mjs";
import { awaitingVerdict } from "../../facts/review.mjs";
import { taskOf, rederive, onTheSheet, lastResultOf, settledSince } from "../../facts/task.mjs";
import { awaitingJudgement } from "../../facts/review.mjs";

export const HANDLERS = {
  "segment.plan": (doc, ev) => {        const session = sessionOf(doc, ev);
        if (session.segments.some((one) => one.id === ev.segment)) noway(`这个会话里已经有段 ${ev.segment}`);
        const segment = nextSegment(session, ev.at);
        segment.id = ev.segment;
        segment.plannedAt = ev.at;
        return;
  },
  "segment.seal": (doc, ev) => {        const session = sessionOf(doc, ev);
        const segment = segmentById(session, ev.segment);
        if (sealed(segment)) noway(`段 ${segment.id} 已经封存`);
        const todo = session.tasks.filter((one) => one.segment === segment.id && one.status === "todo");
        if (todo.length > 0)
          noway(`段 ${segment.id} 还有没交付的：${todo.map((one) => one.id).join("、")}`);
        const ever = session.reviews.filter((one) => one.segment === segment.id && one.voidedAt === null);
        if (ever.length > 0) noway(`段 ${segment.id} 已经有审查结论：结局由那份结论落，封存只给免审段`);
        for (const task of session.tasks)
          if (task.segment === segment.id && task.status === "done") task.status = "accepted";
        segment.verdict = "exempt";
        segment.judgedAt = ev.at;
        segment.closedAt = ev.at;
        segment.sealedBy = ev.by;
        segment.sealedWhy = ev.why;
        return;
  },
  "judge.pass": (doc, ev) => {        const session = sessionOf(doc, ev);
        const segment = segmentById(session, ev.segment);
        if (sealed(segment)) noway(`段 ${segment.id} 已经封存，判过了`);
        const todo = session.tasks.filter((one) => one.segment === segment.id && one.status === "todo");
        if (todo.length > 0) noway(`段 ${segment.id} 还有没做完的：${todo.map((one) => one.id).join("、")}`);
        const ever = session.reviews.filter((one) => one.segment === segment.id);
        const live = ever.filter((one) => one.voidedAt === null);
        const review = live[live.length - 1] ?? null;
        if (ever.length > 0 && !review)
          noway(`段 ${segment.id} 的审查结论已经被打回作废：重新审一次再判`);
        if (review && review.verdict !== "pass")
          noway(`段 ${segment.id} 的在案结论是不合格（${review.by}）：补完再判`);
        const delivered = session.tasks
          .filter((one) => one.segment === segment.id)
          .flatMap((one) => one.evidence.map((proof) => proof.at))
          .sort();
        const lastDelivery = delivered[delivered.length - 1] ?? null;
        if (review && lastDelivery && review.at < lastDelivery)
          noway(`段 ${segment.id} 的结论早于最后一次交付（${lastDelivery}）：它回答的是旧内容，重新审一次`);
        if (segment.reviewVerdict === "fail") noway(`段 ${segment.id} 的审查结论是不合格，先补再判`);
        for (const task of session.tasks)
          if (task.segment === segment.id && task.status === "done") task.status = "accepted";
        segment.verdict = "pass";
        segment.judgedAt = ev.at;
        segment.closedAt = ev.at;
        return;
  },
  "judge.rework": (doc, ev) => {        const session = sessionOf(doc, ev);
        const segment = segmentById(session, ev.segment);
        // A rework is the one way back into settled work, so it may reopen the
        // segment a verdict just closed -- but only the newest one: reopening an
        // older segment would leave two open at once.
        const newest = session.segments[session.segments.length - 1];
        if (sealed(segment) && segment.id !== newest.id)
          noway(`段 ${segment.id} 后面还有 ${newest.id}：先把它结束，再回打这一段`);
        for (const id of ev.tasks) {
          const task = taskOf(session, id);
          if (task.segment !== segment.id)
            noway(`任务 ${task.id} 不在段 ${segment.id} 里（它在 ${task.segment}），打回不能跨段`);
          task.status = "todo";
          task.evidence = [];
          task.deferredWhy = null;
          rederive(task);
        }
        // The verdict answered the old delivery; after a rework it is not a
        // fact about the new one, so it stays in the ledger but stops counting.
        for (const review of session.reviews)
          if (review.segment === segment.id) {
            review.voidedAt = ev.at;
            review.voidedBy = ev.by;
          }
        segment.reviewVerdict = null;
        segment.reviewAt = null;
        segment.reviewBy = null;
        segment.verdict = null;
        segment.judgedAt = null;
        segment.closedAt = null;
        return;
  },
};
