// review 域（一）：清单交出去、撤回。这里回答「卷子出门了没有」。
// 结论（判成什么、被推翻）在 verdict.mjs——那是「卷子答完了没有」。
// 纯重放：doc 与 ev 进，改 doc；不读盘、不看时钟。
import { meaningOf, MEANING } from "../../events.mjs";
import { noway } from "../../facts/errors.mjs";
import { sessionOf, taken } from "../../facts/session.mjs";
import { segmentById, segmentOf, nextSegment, nextOpen, settle, sealed, editable } from "../../facts/segment.mjs";
import { awaitingVerdict } from "../../facts/review.mjs";
import { taskOf, rederive, onTheSheet, lastResultOf, settledSince } from "../../facts/task.mjs";
import { awaitingJudgement } from "../../facts/review.mjs";

export const HANDLERS = {
  "review.brief": (doc, ev) => {        const session = sessionOf(doc, ev);
        const scope = ev.scope === "session" ? "session" : "segment";
        // 签收核对的清单覆盖整期：它没有段这一格，也不该被某一段的封存挡在外面。
        const segment = scope === "session" ? null : segmentById(session, ev.segment);
        if (segment && sealed(segment))
          noway(`段 ${segment.id} 已经封存：账本不往回改，要补的开新一期`);
        session.briefs.push({
          scope,
          goal: ev.goal ?? null,
          segment: segment ? segment.id : null,
          brief: ev.brief,
          tasks: ev.tasks ?? null,
    
          guide: ev.guide ?? null,
          guideDigest: ev.guideDigest ?? null,
          at: ev.at,
          by: ev.by ?? null,
          answeredBy: null,
        });
        return;
  },
  "review.withdraw": (doc, ev) => {        const session = sessionOf(doc, ev);
        const segment = segmentById(session, ev.segment);
        if (segment.closedAt !== null) noway(`段 ${segment.id} 已经关闭：没有正在等结论的清单可撤回`);
        const handed = session.briefs.find(
          (one) => one.scope === "segment" && one.segment === segment.id && one.brief === ev.brief,
        );
        if (!handed) noway(`这一段的清单里没有 ${ev.brief}：撤回的是发出去过的那一份`);
        if (handed.answeredBy !== null) noway(`${ev.brief} 已经被回答过了：撤回答不了的旧话，账本只往后加`);
        if (handed.withdrawnAt !== undefined) noway(`${ev.brief} 已经撤回过了`);
        handed.withdrawnAt = ev.at;
        handed.withdrawnBy = ev.by;
        handed.withdrawnWhy = ev.why;
        return;
  },
};
