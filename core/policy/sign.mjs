// policy/sign: 能不能签收、能不能封存、签收时还欠着什么。
import { openSegment } from "./segment.mjs";
import { lastBrief, needsReview, reviewable, verdictStands } from "./review.mjs";
import { awaitingJudgement } from "../facts/review.mjs";
import { needsPeriodReview, periodReviewOf, periodState } from "./period.mjs";
import { countIn, unpinned } from "./task.mjs";


export function signBlockers(doc, session, config = null) {
  if (!session) return ["现在没有在推进的会话"];
  const blockers = [];
  if (session.segments.length === 0) blockers.push("还没有交付过任何东西");
  const shut = openSegment(session);
  if (shut) {
    // 要审的段等审查者的 pass；免审的段等交付的人写清凭什么不审。同一句「还没有审查通过」
    // 放在免审段上是假话——没人会来审它。
    const owed = config ? needsReview(config, session, shut) && reviewable(session, shut) : true;
    if (awaitingJudgement(session, shut) && verdictStands(session, shut))
      blockers.push(shut.id + " 审查通过了，等你判决（这一段过不过，不是审查者说了算）");
    else
      blockers.push(
        owed
          ? shut.id + " 还没有审查通过（审查者判的是这一段通不通过）"
          : shut.id + ' 还没有封存（审查设置说这一段不用审：deed review --segment ' + shut.id + ' --skip --why "凭什么不审" 记下凭什么）',
      );
  }
  // Work owed outside the open segment is what a segment-level view cannot see;
  // inside it, the segment's own blockers already say it.
  const open = openSegment(session);
  const loose = session.tasks.filter((one) => !open || one.segment !== open.id);
  const todo = loose.filter((one) => one.status === "todo");
  const undelivered = loose.filter((one) => one.status === "done");
  if (todo.length > 0) blockers.push(`还有 ${todo.length} 条没做完（${todo.map((one) => one.id).join("、")}）`);
  if (undelivered.length > 0)
    blockers.push(`还有 ${undelivered.length} 条已交付但没判（${undelivered.map((one) => one.id).join("、")}）`);
  const liveTopics = (session.topics ?? []).filter((one) => one.state !== "released");
  if (liveTopics.length > 0)
    blockers.push(`还有 ${liveTopics.length} 个议题等你确认（${liveTopics.map((one) => one.id + (one.state === "draft" ? "成立" : "出口")).join("、")}）`);
  // 段都关了还不算这一期过完：要有人判「这一期做成的样子」。签收压在期审后面。
  if (needsPeriodReview(session)) {
    const state = periodState(session);
    const live = periodReviewOf(session);
    if (state === "missing")
      blockers.push(session.id + " 还没有期审：各段都关了，但这一期做成的样子还没有人判（deed review --all）");
    if (state === "stale")
      blockers.push(session.id + " 的期审结论早于之后的段变动：那份结论回答的不是这一期现在的事（deed review --all 另出一份）");
    if (state === "fail")
      blockers.push(
        session.id + " 的期审不合格还在案（" + (live?.by ?? "谁") + "）：" +
          ((live?.rework ?? []).length > 0 ? (live.rework).join("、") + " 得先重新判过" : "要改就开新一期把要补的记进去"),
      );
  }
  if (config) {
    const bare = session.segments
      .filter((segment) => needsReview(config, session, segment))
      .flatMap((segment) => unpinned(session, segment));
    if (bare.length > 0)
      blockers.push(
        "这些交付什么也没指着（" +
          bare.map((one) => one.id).join("、") +
          "）：要么记下一个文件，要么在交付里写一条当场能跑出来的 期望：",
      );
  }
  return blockers;
}


// What is owed but not blocking: the point is that a person sees the debt, not
// that the system decides for them what to do with it.
export const debt = (session) => ({
  deferred: session.tasks.filter((one) => one.status === "deferred").map((one) => one.id),
  dropped: session.tasks.filter((one) => one.status === "dropped").map((one) => one.id),
});


// 免审段要人封一次，理由写在账本里；但它不能顶替审查结论：要审的段封不了。
export function sealBlockers(config, session, segment = openSegment(session)) {
  if (!session) return ["现在没有在推进的会话"];
  if (!segment) return ["现在没有待封的段"];
  const blockers = [];
  if (segment.closedAt !== null) blockers.push(`段 ${segment.id} 已经封存`);
  const count = countIn(session, segment);
  if (count.todo > 0)
    blockers.push(`还有 ${count.todo} 条没交付（${session.tasks.filter((one) => one.segment === segment.id && one.status === "todo").map((one) => one.id).join("、")}）`);
  const live = session.reviews.filter((one) => one.segment === segment.id && one.voidedAt === null);
  if (live.length > 0)
    blockers.push("这一段已经有审查结论：结局由那份结论定（要改就开新一期）");
  // 手上还挂着一份没人回答的清单：封存会让它成为一件没人结的账（而且它本来也不该在
  // 这段的字节已经不用审之后还存在）。先撤回那一份，再封。
  const handed = lastBrief(session, segment.id);
  if (handed && handed.answeredBy === null && handed.withdrawnAt === undefined)
    blockers.push(
      `这一段还有一份交出去、没人回答的清单（${handed.brief}）：先撤回它（deed review --segment ${segment.id} --withdraw --why "…"）再封存`,
    );
  // 要审，而且此刻确实有可判的东西：一条交付都没有的段，结局是"没有可审的"，封就封。
  if (needsReview(config, session, segment) && reviewable(session, segment))
    blockers.push(`这一段按审查设置要审：结局得由审查者的结论落（deed review --segment ${segment.id}）`);
  return blockers;
}


// 没经过审查就结束的段：签收时要把它们摆出来，别让"免审"变成没人知道。
export function exemptSegments(session) {
  if (!session) return [];
  return session.segments.filter((one) => one.verdict === "exempt");
}
