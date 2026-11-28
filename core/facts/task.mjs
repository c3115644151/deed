// facts/task: 条目（task）的事实——它在哪一段、动过没有、上一次判定是什么。
// 纯函数：session/task 进，值出。
import { awaitingVerdict, awaitingJudgement } from "./review.mjs";

export const taskOf = (session, id) => {
  const task = session.tasks.find((one) => one.id === id);
  if (!task) noway(`这个会话里没有任务：${id}`);
  return task;
};

export const rederive = (task) => {
  const paths = [];
  const sizes = {};
  for (const proof of task.evidence) {
    // 交付自己记下的文件也算碰过：老账本里的单文件交付没有工作区差可量（changed 为空），
    // 只认 changed 就会让审查设置看不见它到底动了哪一份字节。
    const touched = [...(proof.changed ?? []), ...(proof.files ?? []).map((one) => one.path)];
    for (const one of touched) if (!paths.includes(one)) paths.push(one);
    Object.assign(sizes, proof.sizes ?? {});
  }
  task.changed = paths;
  task.sizes = sizes;
  return task;
};

export const onTheSheet = (session, segmentId, taskId) => {
  const segment = session.segments.find((one) => one.id === segmentId);
  if (!segment) return false;
  if (awaitingVerdict(session, segment)) {
    const last = (session.briefs ?? []).filter((one) => one.scope === "segment" && one.segment === segment.id).at(-1);
    if (!last) return false;
    return Array.isArray(last.tasks) ? last.tasks.includes(taskId) : true;
  }
  if (awaitingJudgement(session, segment)) {
    const live = session.reviews.filter((one) => one.voidedAt === null && one.scope === "segment" && one.segment === segment.id);
    const last = live.at(-1);
    if (!last) return false;
    return Array.isArray(last.results) ? last.results.some((one) => one.id === taskId) : true;
  }
  return false;
};

// 下一个段：队列里最后一个还没关闭的段（清单排好的就是它）。


export const lastResultOf = (session, id) => {
  const hits = session.reviews
    // 被后一份结论取代的（voidedBy 换代）：它的逐条判定仍然是对当时那份字节下的，
    // 只要那一条自己没再动过，就该沿用。被推翻的（review.overturn）不一样——那是一句
    // "判错了"，它的判定不能再用，所以 overturned 的仍然排除。
    .filter((one) => one.scope !== "session" && !one.overturned)
    .flatMap((one) => (one.results ?? []).filter((two) => two.id === id).map((two) => ({ ...two, at: one.at, by: one.by })));
  return hits.at(-1) ?? null;
};

// 这条自上次判定以来动过吗：交付、撤回、放弃、改到下一段、改标题、改标准
// 都会把 touchedAt 推到后面。动过就要重判；没动过的，判定照旧算数。

export const settledSince = (session, task) => {
  const last = lastResultOf(session, task.id);
  if (!last) return null;
  if (task.status !== "done" && task.status !== "accepted" && task.status !== "dropped") return null;
  if (task.touchedAt && task.touchedAt > last.at) return null;
  return last;
};
