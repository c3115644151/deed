// replay: 把账本里的一行变成"文档现在是什么"。
//
// 这里只做一件事：查表、调用。业务不在这个文件里——一个域一个 reducers/<域>.mjs，
// 一个 kind 一个函数。加一类事实＝在它的域文件里加一个函数，到这里加一行 import。
// 没有处理处的 kind 不是坏行：账本可能比程序新（见 lib/version.mjs 的说法）。

import * as talk from "./reducers/talk.mjs";
import * as topic from "./reducers/topic.mjs";
import * as work from "./reducers/work.mjs";
import * as review from "./reducers/review.mjs";
import * as segment from "./reducers/segment.mjs";
import * as session from "./reducers/session.mjs";
import * as legacy from "./reducers/legacy.mjs";

const REGISTRY = new Map(
  Object.entries({ ...talk.HANDLERS, ...topic.HANDLERS, ...work.HANDLERS, ...review.HANDLERS, ...segment.HANDLERS, ...session.HANDLERS, ...legacy.HANDLERS }),
);

export const kinds = () => [...REGISTRY.keys()];

// 处理过就返回 true；没处理过的由调用方决定那意味着什么（fold 会抛 UnknownKindError）。
export function reduce(kind, doc, ev) {
  const handle = REGISTRY.get(kind);
  if (!handle) return false;
  handle(doc, ev);
  return true;
}
