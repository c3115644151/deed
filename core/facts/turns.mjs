// facts/turns: 轮次——只有人开口的那一轮数进去；编号是给讨论里的引用一个锚点。


// 轮次是你和用户之间的一轮对话：数出来的只有人开口的那些。两道关，位置不同：
// 重放按事件含义第 12 版把 agent 自记的轮次丢掉（新账本里根本进不来），
// 这里挡的是那之前的旧行——它们照原样读得出来，计数时不算。
export const userTurns = (session) => session.turns.filter((one) => one.who === "user");


// 议题卡上的"第 N 轮"指的是人开口的那一轮（user turn），按发生顺序数。
// 面板用它把号翻回那句话的锚点；账本里一条轮次原文都不用复制进议题。
// 同一会话的 turns 与 replies 共用时间轴，这里只数 user，与我说的那半分开。
export const turnNumbers = (session) => {
  const numbers = new Map();
  let n = 0;
  for (const one of [...(session.turns ?? [])].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)))
    if (one.who === "user") numbers.set(one.at, ++n);
  return numbers;
};
