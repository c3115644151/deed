// 一条要落进账本的行：先重放、再校验、最后追加一件事，写成一处。
// 命令面与面板都从这条路走——两条路各写一份，就会有一天只校验一边。
import { EVENT_VERSION, validateEvent } from "../core/events/index.mjs";
import { fold } from "../core/fold.mjs";
import { append, appendMany, readEvents, withLock } from "./store.mjs";
import { currentVersion } from "./version.mjs";

// build(doc, at) 给出这一行的内容；before(doc) 是写之前要拦的判断（抛错即不写）。
// 返回写完之后重放出来的文档与这一行本身。
export function record(root, build, { at = null, before = null } = {}) {
  return withLock(root, () => {
    const events = readEvents(root);
    const doc = fold(events);
    if (before) before(doc);
    const stamp = at ?? new Date().toISOString();
    const stamped = validateEvent({ ...build(doc, stamp), v: EVENT_VERSION }, stamp);
    // w 记的是写这一行的程序版本，不是事件含义的版本（那是 v）。
    stamped.w = currentVersion() || undefined;
    const after = fold([...events, stamped]);
    append(root, stamped);
    return { doc: after, ev: stamped };
  });
}
