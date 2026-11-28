// work 域的重放：条目（task）的一生——立、改标题、改标准、交付、撤回、延后、放弃、改到下一段、写回。
// 从 core/fold.mjs 的 switch 里原样移出来；ctx 里是那几样共用的事实与判错方式。
// 过渡期里 ctx 还带着 fold 的助手（sessionOf/taskOf/editable）；helpers 移进 core/facts 之后，
// 这里只留 doc 与 ev（docs/PLAN-ARCH.md §8-P2）。

export const HANDLERS = {
  "task.uncarry": ({ sessionOf, taskOf, editable, noway, doc, ev }) => {
    const session = sessionOf(doc, ev);
    const task = taskOf(session, ev.id);
    editable(session, task);
    if (task.status !== "todo")
      noway(`${task.id} 不是还没动手的条目（${task.status}）：只有没做的能从下一段拿回来`);
    const take = session.segments.find((one) => one.closedAt === null && one.plannedAt === null) ?? null;
    const to = ev.to ? session.segments.find((one) => one.id === ev.to) : take;
    if (!to) noway(`${task.id} 要回到哪一段？现在没有收活的段`);
    if (to.closedAt !== null) noway(`${to.id} 已经封闭：条目回不去`);
    if (to.id === task.segment) noway(`${task.id} 已经在这一段（${to.id}）：没有可撤回的`);
    const from = task.segment;
    task.segment = to.id;
    // 走了空的段跟着消失：一个只剩格子的"下一段"会让下一条新活落进谁也没打算做的段。
    const left = session.segments.find((one) => one.id === from);
    const used =
      session.tasks.some((one) => one.segment === from) ||
      (session.briefs ?? []).some((one) => (one.segment ?? null) === from) ||
      session.reviews.some((one) => one.segment === from);
    if (left && !used) session.segments = session.segments.filter((one) => one.id !== from);
  },
};
