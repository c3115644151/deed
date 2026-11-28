// policy/period: 期审——这一期做成的样子该不该判、判过之后还成不成立。
import { MEANING } from "../events.mjs";
import { sealed } from "../facts/segment.mjs";



// ---- 期审：段全关之后，这一期做成的样子还要有人判 --------------------------------------
// 段审判「这一段对不对」，期审判「这一期做成的样子对不对、各段之间说不说得通」。
// 两者不是同一件事的两次：期审不重判段里的条目，它判的是目的与跨段的一致性。
export const lastPeriodBrief = (session) =>
  session.briefs.filter((one) => one.scope === "session").at(-1) ?? null;


// 只有第 20 版起的整期结论算期审：更早那些行回答的是当年那道"签收核对"，
// 一个已经不是今天这层问题的问题。它们照读成历史，不给签收添门，也不当成期审。
export const periodReviewOf = (session) =>
  session.reviews
    .filter((one) => one.scope === "session" && one.voidedAt === null && (one.v ?? 1) >= MEANING.periodReview)
    .at(-1) ?? null;


// 什么时候该期审：段都关了，没有未做、没有已交付未判。没开过段的一期不需要。
export const needsPeriodReview = (session) => {
  if (!session || session.segments.length === 0) return false;
  if (session.tasks.some((one) => one.status === "todo" || one.status === "done")) return false;
  return session.segments.every((one) => one.closedAt !== null);
};

// 期审的清单旧了没有：只看它发出那一刻**已经存在**的段。之后另开的段（预备段）里
// 又加活、又交付，那是下一期的事，不能让这一份结论作废；已经存在的段又落了结论、
// 或被点名退回后重判，才算这一期变了。段的出生时刻是 plannedAt（预排）或 openedAt。
const existedAt = (segment, at) => String(segment.plannedAt ?? segment.openedAt ?? "") <= at;


export const stalePeriod = (session) => {
  const brief = lastPeriodBrief(session);
  if (!brief) return false;
  if (brief.withdrawnAt !== undefined) return false;
  const known = new Set(session.segments.filter((one) => existedAt(one, brief.at)).map((one) => one.id));
  const touched = session.reviews.some((one) => one.scope === "segment" && one.at > brief.at && known.has(one.segment));
  const sealed = session.segments.some(
    (one) => one.sealedByReview !== undefined && one.closedAt !== null && one.closedAt > brief.at && known.has(one.id),
  );
  return touched || sealed;
};


export function periodState(session) {
  if (!needsPeriodReview(session)) return "missing";
  const review = periodReviewOf(session);
  if (review?.verdict === "fail") return "fail";
  if (review?.verdict === "pass") return stalePeriod(session) ? "stale" : "pass";
  return "missing";
}


// 期审清单发出去了、还没人回答。
export const periodFresh = (session) => {
  const brief = lastPeriodBrief(session);
  return Boolean(brief) && brief.answeredBy === null && brief.withdrawnAt === undefined;
};
