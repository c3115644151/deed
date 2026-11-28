// events: 账本里的一行能长什么样。定义、校验与含义版本在这里汇总；
// 每一种事件住在它那个域的文件里（一个域一个文件，加一类事实不改别人的分支）。

import { UnknownKindError, EVENT_VERSION, MEANING, meaningOf, WHO, need, contextShape } from "./shape.mjs";
import * as talk from "./talk.mjs";
import * as topic from "./topic.mjs";
import * as work from "./work.mjs";
import * as review from "./review.mjs";
import * as segment from "./segment.mjs";
import * as session from "./session.mjs";
import * as legacy from "./legacy.mjs";

export { EVENT_VERSION, MEANING, meaningOf, WHO, UnknownKindError, need, contextShape };

const DOMAINS = [talk, topic, work, review, segment, session, legacy];
const VALIDATE = Object.assign({}, ...DOMAINS.map((one) => one.VALIDATE));

// 顺序是账本里第一次见到它们的顺序：清单与帮助按它排，别随手改。
export const EVENT_KINDS = DOMAINS.flatMap((one) => one.KINDS);

export function validateEvent(ev, at) {
  need(ev, "k");
  if (!EVENT_KINDS.includes(ev.k)) throw new UnknownKindError(ev.k, ev.w, ev.v);
  if (ev.at && !/^\d{4}-\d{2}-\d{2}T/.test(String(ev.at)))
    throw new Error(`时间不是 ISO 时刻：${ev.at}`);
  // v 放在最后，调用方改不了：一行说的是哪一套含义，由写它的程序决定。
  const stamped = { at: ev.at ?? at, ...ev, v: EVENT_VERSION };
  // 校验按"这一行自己说的那一版"来：拿今天的版本去核旧行，补一个字段就把历史里合法的行全判成坏账。
  const meaning = ev.v ?? 1;
  const check = VALIDATE[ev.k];
  if (!check) throw new UnknownKindError(ev.k, ev.w, ev.v);
  check(ev, meaning);
  return stamped;
}
