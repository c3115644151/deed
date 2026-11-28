// policy/task: 条目的查询与排序——这一期有哪些、各在什么状态、上一次交给了什么。


// 清单、状态与面板印的顺序是同一件事：先按条目自己写的「先后」，没写的排在后面，
// 其余的按写下的次序。顺序只是读起来的样子，它不进门、也不进结论。
export const byOrder = (tasks) =>
  [...tasks].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));


export const tasksIn = (session, segment) =>
  byOrder(session.tasks.filter((one) => (segment ? one.segment === segment.id : true)));


export function countIn(session, segment) {
  const tasks = tasksIn(session, segment);
  const count = { total: tasks.length, todo: 0, done: 0, accepted: 0, deferred: 0, dropped: 0 };
  for (const task of tasks) count[task.status] += 1;
  return count;
}


// The last delivery inside a segment. A conclusion older than this answered an
// earlier version of the work, so it stops counting as a conclusion.
export const lastDelivery = (session, segment) => {
  const times = tasksIn(session, segment)
    .flatMap((one) => [
      ...one.evidence.map((proof) => proof.at),
      ...(one.undone ?? []).map((gone) => gone.at),
    ])
    .sort();
  return times[times.length - 1] ?? null;
};


// 一条交付什么也没指着，有两种样子：既没记下文件，也没动过任何路径。
// 删掉一个文件也算动了——路径走了，没有字节可记，那不是"没指着"，是它指的那条路径本来就没有字节。
// 这个判断只在这里写一遍：签收、下一步、verify 报的空交付都从它出。
export const pointsAtNothing = (proof) =>
  !proof ||
  ((proof.files ?? []).length === 0 &&
    !proof.path &&
    (proof.changed ?? []).length === 0 &&
    // 交付也可以指着一条当场跑得出来的现象（submit 收的就是这个）：那不是"没指着"。
    (proof.expects ?? []).length === 0);


// 复核得靠内容：要审的段里，每条现行交付都得指着点什么。
export const unpinned = (session, segment) =>
  tasksIn(session, segment)
    .filter((one) => one.status === "done" || one.status === "accepted")
    .filter((one) => {
      const claim = one.evidence[one.evidence.length - 1];
      return Boolean(claim) && pointsAtNothing(claim);
    });
