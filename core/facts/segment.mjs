// facts/segment: 段的事实——哪一段在收活、哪一段在等判决、这一段还收不收新条目。
// 纯函数：doc/session/segment 进，值出。
import { MEANING } from "../events/index.mjs";
import { noway } from "./errors.mjs";
import { awaitingVerdict } from "./review.mjs";
import { awaitingJudgement } from "./review.mjs";

export const segmentById = (session, id) => {
  const segment = session.segments.find((one) => one.id === id);
  if (!segment) noway(`这个会话里没有段：${id}`);
  return segment;
};

export function segmentOf(session, at, v = 1) {
  settle(session);
  const open = session.segments.filter((one) => one.closedAt === null);
  // 清单排过段以后，新活落在收活的那一段（排队中的段只由清单往里放）；
  // 没排过段时按旧读法：落在最末那个未关闭段。
  const planned = open.some((one) => one.plannedAt !== null);
  const last = planned ? open.find((one) => one.plannedAt === null) ?? open[0] : open.at(-1);
  if (!last) return nextSegment(session, at);
  const waiting = awaitingVerdict(session, last) || (v >= MEANING.judgement && awaitingJudgement(session, last));
  if (v < 11 || !waiting) return last;
  // 等结论/等判决时新写的活自己开一段。
  return nextSegment(session, at, true);
}

// 任务碰过哪些路径、各多大，只由还在的交付说得算。交付退回（撤回，或者审查者点名
// 重做把那条交付清掉）之后，它碰过的字节就不再是这段工作的性质；所以每动一次交付
// 就重算一遍，不靠逐条加减——加减漏一处，审查设置就会拿一批已经不存在的工作去判要不要审。

export function nextSegment(session, at, carried = false) {
  // 号由已有的段推出来（最大号 +1）：旧账本里段号就是按这个走的，重放才落到同一段。
  const top = session.segments.reduce((max, one) => Math.max(max, Number(one.id.split(".").pop()) || 0), 0);
  const segment = {
    carried,
    id: `${session.id}.${top + 1}`,
    openedAt: at,
    closedAt: null,
    plannedAt: null,
    verdict: null,
    judgedAt: null,
    reviewAt: null,
    reviewBy: null,
    sealedBy: null,
    sealedWhy: null,
  };
  session.segments.push(segment);
  return segment;
}

// 这一段手上那份清单还没人回答，它就是"{等结论}"的状态：新活不再往里放，自己开下一段。
// 决定收不收活的地方必须在这一层——只在 submit 里挡，重放出来的段仍会多出一条任务。
// 这一段手上那份清单还没人回答：它就是等结论的样子。清单里写新条目时也要问同一句
// ——新条目落不落进这一段，只由这里说得算。

export const nextOpen = (session) => session.segments.filter((one) => one.closedAt === null).at(-1) ?? null;

// 空着的"下一段"不是一个段：它是某次改段开出来又没接住活的格子，留着会让下一条新活
// 落进一个谁也没打算做的段。

export const settle = (session) => {
  session.segments = session.segments.filter(
    (one) =>
      // 清单排过的那一段即使还空着也算数；自己开出来的空格子不算——它会让下一条活
      // 落进一个谁也没打算做的段。
      !(one.plannedAt === null && one.closedAt === null && one.verdict === null) ||
      session.tasks.some((task) => task.segment === one.id) ||
      session.briefs.some((brief) => brief.segment === one.id),
  );
};

// 这条判断从账本含义第 11 版起生效，之前的行按当时的样子重放：
// 老账本里没有这个规矩，拿今天的规矩重排，会把这些行里写死的段号（比如一次打回说
// 「T8 退回 S01.1」）判成坏账——整本账再也重放不动，而那并不是当初写错。

export const sealed = (segment) => segment.closedAt !== null;

// A sealed segment is settled history: only a rework reopens it, so a stray
// write cannot leave work stranded inside a segment nobody will judge again.

export function editable(session, task) {
  const segment = segmentById(session, task.segment);
  if (sealed(segment))
    noway(`任务 ${task.id} 在已封存的段 ${segment.id} 里：审查者点名退回（--verdict fail --rework）或者人推翻那份结论，才能再改`);
  return segment;
}

// 审查是一条条落的：review.log 里的 results 记着每条被判成什么。
// 重审时"已经判过、之后没动过"的条目不该再判一遍——那是把别人的工作重做，
// 也让同一条标准在两处留下两个可以改的说法。

