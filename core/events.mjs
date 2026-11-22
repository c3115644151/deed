// Event shape and validation. The ledger is the only authority; everything else
// is a projection of these lines.

export const EVENT_KINDS = [
  "turn",
  "task.add",
  "task.done",
  "task.defer",
  "task.drop",
  "ask.raise",
  "ask.resolve",
  "ask.withdraw",
  "review.log",
  "judge.pass",
  "judge.rework",
  "sign",
  "shelve",
  "config.change",
];

export const WHO = ["user", "agent"];

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
  if (!EVENT_KINDS.includes(ev.k)) throw new Error(`未知事件：${ev.k}`);
  if (ev.at && !/^\d{4}-\d{2}-\d{2}T/.test(String(ev.at)))
    throw new Error(`时间不是 ISO 时刻：${ev.at}`);
  const stamped = { v: 1, at: ev.at ?? at, ...ev };
  switch (ev.k) {
    case "turn":
      need(ev, "who");
      if (!WHO.includes(ev.who)) throw new Error(`轮次的 who 只能是 user 或 agent：${ev.who}`);
      need(ev, "said");
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
