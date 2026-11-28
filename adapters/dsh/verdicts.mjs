import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// 审查者落完结论，得有人把作者叫回来。账本里出现"结论"这一行就是那一刻：
// 适配器盯着它，出现了就开一轮，把结论说成一句人话。不猜、不转述——只说账本上有的事实。
//
// 为什么不用子代理自己的完成通知：审查者是另一个进程里的独立会话，它的结束提示回的是
// 它自己的父会话，主会话这边收不到。盯账本这条路与谁起的审查者无关，因此可靠。
const KINDS = new Set(["review.log", "review.brief", "verdict.pass", "review.overturn", "sign", "segment.seal"]);

// 一条结论的完整模样：结论本身、为什么、逐条判定、发现。作者要照着改，
// 只告诉他"打回了哪几条"不够——他得知道每条为什么没过、还有哪些话没被采纳。
const clip = (text, max) => {
  const one = String(text ?? "").replace(/\s+/gu, " ").trim();
  return one.length > max ? one.slice(0, max) + "…" : one;
};

export function detail(row) {
  const out = [say(row)];
  if (row.k !== "review.log") return out;
  if (row.why) out.push("  为什么：" + clip(row.why, 600));
  const results = row.results ?? [];
  const missed = results.filter((one) => one.verdict !== "met");
  if (results.length > 0) {
    out.push(
      "  逐条 " + results.length + " 条 · 达成 " + (results.length - missed.length) + " · 没过 " + missed.length +
        (row.resultsAll ? "（全部逐条给过）" : ""),
    );
    for (const one of missed) out.push("    " + one.id + " · " + one.verdict + (one.note ? " · " + clip(one.note, 600) : ""));
  }
  for (const one of row.findings ?? []) out.push("  发现 · " + clip(one, 600));
  if (row.brief) out.push("  清单 · " + row.brief);
  return out;
}

// 一句话说清这条结论是什么。
export function say(row, doc) {
  const segment = String(row.segment ?? row.s ?? "");
  const task = doc?.tasks?.find?.((one) => one.id === row.id) ?? null;
  if (row.k === "review.log") {
    const rework = (row.rework ?? []).join(" ");
    const scope = row.scope === "period" || row.scope === "session" ? "整期" : segment;
    return row.verdict === "pass"
      ? "审查结论落好了 · " + scope + " · 通过（等你判决）"
      : "审查结论落好了 · " + scope + " · 不合格" + (rework ? " · 点名 " + rework : "");
  }
  // 审查开始也是执行链上的一步：清单交出去了、有人在读，作者不该靠猜自己现在在等什么。
  if (row.k === "review.brief") {
    const scope = row.scope === "session" ? "整期" : segment;
    return "审查清单发出去了 · " + scope + " · " + String(row.brief ?? "") + "（交给审查者，等结论写进账本）";
  }
  if (row.k === "verdict.pass") return "判决通过 · " + segment + "（这一段关了）";
  if (row.k === "review.overturn") return "结论被推翻 · " + segment + " · " + String(row.why ?? "").slice(0, 80);
  if (row.k === "sign") return "这一期签收了 · " + String(row.s ?? "");
  if (row.k === "segment.seal") return "段封了（免审）· " + segment;
  return "账本上多了一条结论 · " + row.k + (task ? " · " + task.id : "");
}

// 账本最后几百行里，比 after 新的那些结论（按月文件走，月底跨文件也能接上）。
export function newVerdicts(root, after) {
  const dir = path.join(root, ".deed", "log");
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((one) => /^\d{4}-\d{2}\.jsonl$/.test(one)).sort().slice(-2);
  } catch {
    return [];
  }
  const rows = [];
  for (const name of names) {
    let text = "";
    try {
      const full = path.join(dir, name);
      const size = fs.statSync(full).size;
      // 只读尾巴：账本会长到几十 MB，整份读一遍没必要。
      const start = Math.max(0, size - 256 * 1024);
      const fd = fs.openSync(full, "r");
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      text = buf.toString("utf8");
      if (start > 0) text = text.slice(text.indexOf("\n") + 1);
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (!KINDS.has(ev.k)) continue;
      if (after !== null && !(String(ev.at) > after)) continue;
      rows.push(ev);
    }
  }
  return rows.sort((a, b) => (String(a.at) < String(b.at) ? -1 : 1));
}

// 一轮只唤醒一次：同一次落下的好几条（结论 + 判决）合成一句，别连开好几轮。
export function wakeMessage(rows, doc) {
  const lines = rows.flatMap((one) => detail(one).map((line, n) => (n === 0 ? "· " + line : line)));
  return {
    id: randomUUID(),
    role: "user",
    content: [
      {
        type: "text",
        text: [
          "<system-reminder>",
          "deed · 审查那边有结论了（账本上刚落下，不是谁传话）：",
          ...lines,
          "接着做：不合格就按点名的条目改；通过就等人在面板上判。下一步看 deed state。",
          "</system-reminder>",
        ].join("\n"),
      },
    ],
    source: { kind: "deed-verdict" },
  };
}

// 一轮轮地问：第一次只记下水线（重载之后不重播旧结论），之后有新结论就把作者叫回来。
export async function pollVerdicts({ root, agent, state, log }) {
  const canWake = agent && (typeof agent.followup === "function" || typeof agent.send === "function");
  if (!canWake) return [];
  const rows = newVerdicts(root, state.armed ? state.watermark : null);
  // 第一次只记水线（重载之后不把旧结论当新消息再讲一遍）；从第二次起才说话。
  // 没有结论的时候水线停在 null，也要算"已经记过水线"，否则第一条结论会被吞掉。
  if (!state.armed) {
    state.armed = true;
    // 「旧账不重播」指的是盯账之前就有的那些行，不是"重启这一秒刚写的"。起点由起这条线的人
    // 给（state.since）；没给就退回水线，把刚发生的事吞掉——审查刚好在那一刻开始的时候，
    // 作者就一条消息都收不到，看起来像什么都没发生。
    const since = state.since ?? null;
    const fresh = since ? rows.filter((one) => String(one.at) >= String(since)) : [];
    state.watermark = rows.at(-1)?.at ?? null;
    if (fresh.length === 0) return [];
    const first = wakeMessage(fresh, null);
    if (agent.status === "running" && typeof agent.send === "function") agent.send(first, "next-turn", true);
    else agent.followup(first);
    log?.("结论落到账本 · 叫作者回来 · " + fresh.map((one) => one.k).join("+"));
    return fresh;
  }
  if (rows.length === 0) return [];
  state.watermark = rows.at(-1).at;
  const message = wakeMessage(rows, null);
  // 空闲就开新的一轮；正在跑就排到下一轮，不打断手上的活。
  if (agent.status === "running" && typeof agent.send === "function") agent.send(message, "next-turn", true);
  else agent.followup(message);
  log?.("结论落到账本 · 叫作者回来 · " + rows.map((one) => one.k).join("+"));
  return rows;
}
