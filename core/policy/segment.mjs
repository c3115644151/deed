// policy/segment: 段的推进——哪一段收活、哪一段在等、还能不能再收新条目。
import { tasksIn } from "./task.mjs";


export const openSegment = (session) => session?.segments.find((one) => one.closedAt === null) ?? null;

// 收活的那一段就是队列里第一个还没关闭的段；排在它后面的段已经在账本里，
// 但它们此刻不收活——前一段判过、关闭了，它才轮到。
// 只有清单预排的段才排队：等结论/等判决时由新活开出来的段照样收活（它不是在排队，
// 它是手上那批活停着、下一条活自然落进去）。
export const takingSegment = (session) => {
  const open = (session?.segments ?? []).filter((one) => one.closedAt === null);
  return open.find((one) => one.plannedAt === null) ?? open[0] ?? null;
};

export const queuedSegments = (session) => {
  const take = takingSegment(session);
  return (session?.segments ?? []).filter((one) => one !== take && one.closedAt === null && one.plannedAt !== null);
};


// 一段最多放这么多条——说的只是**第一次**：最初担心的是第一份清单就被塞进几十条，
// 审查者一次读不完，判就成了走过场。所以这个数只在"这一段还没进过审查"时算数；
// 一旦出过清单，后来的活照收不误（它们进的是下一份清单，而下一份只展开要重判的）。
export const SEGMENT_MAX = 20;

export const segmentRoom = (session, segment) =>
  !(session.briefs ?? []).some((one) => one.scope === "segment" && one.segment === segment.id);


// 这一段最后一次被改动是什么时候。加一条任务也算——清单写的是一份清单，
// 清单变了，发出去那份就不再是这一段的事，结论也就回答不了它。
export const lastSegmentChange = (session, segment) => {
  const times = tasksIn(session, segment)
    .flatMap((one) => [
      one.touchedAt,
      ...one.evidence.map((proof) => proof.at),
      ...(one.undone ?? []).map((gone) => gone.at),
    ])
    .filter(Boolean)
    .sort();
  return times[times.length - 1] ?? null;
};
