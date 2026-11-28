// replay: 把账本里的一行变成"文档现在是什么"。
//
// 这里只做遍历与分发：查表、调用、没有处理处就交回旧的 switch（过渡期的兜底，
// P2 每移完一个域就删掉对应那段，见 docs/PLAN-ARCH.md §8）。
// 业务不写在这里——一个域一个 reducers/<域>.mjs，一个 kind 一个函数。

import * as work from "./reducers/work.mjs";

// 注册表：kind → 处理它的函数。加一类事实＝在这里加一行，不改别人的分支。
const REGISTRY = new Map(Object.entries({ ...work.HANDLERS }));

export const kinds = () => [...REGISTRY.keys()];

export function reduce(kind, ctx) {
  const handle = REGISTRY.get(kind);
  if (!handle) return false;
  handle(ctx);
  return true;
}
