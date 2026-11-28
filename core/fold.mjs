// fold: 账本 -> 文档。纯的：同样的行永远得到同一份文档；这里没有时钟（时刻来自行本身）。
//
// fold 也是那道闸。会把文档变成不可能状态的行在这里先抛，CLI 记账之前先重放一遍，
// 于是被拒的动作从未落到账本上。重放本身按域住在 core/replay/reducers/<域>.mjs。

import { UnknownKindError } from "./events.mjs";
import { blank } from "./facts/session.mjs";
import { reduce } from "./replay/index.mjs";

export function fold(events) {
  const doc = blank();
  for (const ev of events) {
    // 每一行都交给它自己那个域的处理函数。没有处理处的 kind 有两种可能：
    // 账本比程序新（这一行是别的版本写的），或者这一行根本不是账本事件。
    if (!reduce(ev.k, doc, ev)) throw new UnknownKindError(ev.k, ev.w, ev.v);
  }
  return doc;
}
