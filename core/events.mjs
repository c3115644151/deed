// Event shape and validation. The ledger is the only authority; everything else
// is a projection of these lines.

export const EVENT_KINDS = [
  "turn",
  "task.add",
  "task.done",
  "task.undo",
  "task.defer",
  "task.drop",
  "ask.raise",
  "ask.resolve",
  "ask.withdraw",
  "review.brief",
  "review.log",
  "judge.pass",
  "judge.rework",
  "sign",
  "shelve",
  "config.change",
];

export const WHO = ["user", "agent"];

// 事件含义的版本。每一行都记着写它的那一套含义（v 字段）；加一个事件类型、
// 或者改变已有字段的含义，就把这个数 +1（同时升 package.json 的 minor）。
// 这样"账本比程序新"能被证明，而不是靠猜：读不动的行带着一个比自己更新的 v，
// 就是账本新；v 不超前才可能是这一行被手写或被改过。
export const EVENT_VERSION = 2;

// 读到不认得的事件类型，和"这一行坏了"是两件事：账本可能只是比程序新。
// core 不知道当前版本（也不许读文件），所以这里只把事实带出去——类型名、
// 写者版本、这一行自己的含义版本，由 CLI 层去比大小、去说人话。
export class UnknownKindError extends Error {
  constructor(kind, writer, meaning) {
    super(`未知事件：${kind}`);
    this.name = "UnknownKindError";
    this.kind = kind;
    this.writer = writer ?? null;
    this.meaning = meaning ?? null;
  }
}

const need = (ev, field) => {
  const value = ev[field];
  if (value === undefined || value === null || String(value).trim() === "")
    throw new Error(`事件 ${ev.k} 缺少 ${field}`);
  return value;
};

// Validation is deliberately shallow: it rejects malformed events, not wrong
// ones. Rules (can this segment be judged?) live in rules.mjs, never here.
export function validateEvent(ev, at) {
  need(ev, "k");
  if (!EVENT_KINDS.includes(ev.k)) throw new UnknownKindError(ev.k, ev.w, ev.v);
  if (ev.at && !/^\d{4}-\d{2}-\d{2}T/.test(String(ev.at)))
    throw new Error(`时间不是 ISO 时刻：${ev.at}`);
  // v 放在最后，调用方改不了：一行说的是哪一套含义，由写它的程序决定。
  const stamped = { at: ev.at ?? at, ...ev, v: EVENT_VERSION };
  switch (ev.k) {
    case "turn":
      need(ev, "who");
      if (!WHO.includes(ev.who)) throw new Error(`轮次的 who 只能是 user 或 agent：${ev.who}`);
      need(ev, "said");
      // 空参数会被有些 shell 吞掉（PowerShell 5.1 会把 --did "" 变成裸开关），
      // 于是 did 落成 true，账本读起来像"这轮做过事"。类型也要查：这不是记轮的人
      // 说错了，是一行会被误读的事实。
      if (ev.did !== undefined && typeof ev.did !== "boolean" && typeof ev.did !== "string")
        throw new Error("turn 的 did 要写成一句话，或者 true/false");
      break;
    case "task.add":
      need(ev, "id");
      need(ev, "title");
      need(ev, "criteria");
      break;
    case "task.done":
      need(ev, "id");
      need(ev, "evidence");
      need(ev, "by");
      if (ev.changed !== undefined && !Array.isArray(ev.changed))
        throw new Error("task.done 的 changed 要是路径数组");
      if (ev.files !== undefined) {
        if (!Array.isArray(ev.files)) throw new Error("task.done 的 files 要是 {path, digest} 数组");
        for (const one of ev.files) {
          if (!one || typeof one.path !== "string" || typeof one.digest !== "string")
            throw new Error("task.done 的 files 每一项都要有 path 与 digest");
        }
      }
      break;
    case "task.undo":
      need(ev, "id");
      need(ev, "why");
      break;
    case "task.defer":
    case "task.drop":
      need(ev, "id");
      need(ev, "why");
      break;
    case "ask.raise":
      need(ev, "id");
      need(ev, "text");
      need(ev, "reading");
      need(ev, "why");
      break;
    case "ask.resolve":
      need(ev, "id");
      need(ev, "decision");
      break;
    case "ask.withdraw":
      need(ev, "id");
      need(ev, "why");
      break;
    // Handing the brief out is a fact, not a side effect: without it the
    // ledger cannot say which document a verdict answered.
    case "review.brief":
      need(ev, "segment");
      need(ev, "brief");
      if (!/^[0-9a-f]{64}$/.test(String(need(ev, "briefDigest"))))
        throw new Error("review.brief 的 briefDigest 要是任务书的 sha256（64 位小写 hex）：" + ev.briefDigest);
      break;
    case "review.log":
      need(ev, "segment");
      need(ev, "by");
      need(ev, "verdict");
      if (!["pass", "fail"].includes(ev.verdict))
        throw new Error(`审查结论只能是 pass 或 fail：${ev.verdict}`);
      need(ev, "brief");
      // The brief is outside the ledger, so the only way a verdict can be held
      // to the words the reviewer read is its sha256. A line without one is a
      // conclusion nobody can check.
      if (!/^[0-9a-f]{64}$/.test(String(need(ev, "briefDigest"))))
        throw new Error("review.log 的 briefDigest 要是任务书的 sha256（64 位小写 hex）：" + ev.briefDigest);
      break;
    case "judge.pass":
      need(ev, "segment");
      need(ev, "by");
      break;
    case "judge.rework":
      need(ev, "segment");
      need(ev, "why");
      // Tearing up a verdict is a decision about someone else's work: it needs
      // the same signature as handing one out, or the record shows who judged
      // and never who overruled.
      need(ev, "by");
      break;
    case "sign":
      need(ev, "words");
      need(ev, "title");
      break;
    case "shelve":
      need(ev, "why");
      break;
    case "config.change":
      need(ev, "key");
      if (ev.to === undefined) throw new Error("事件 config.change 缺少 to");
      need(ev, "why");
      break;
    default:
      break;
  }
  return stamped;
}
