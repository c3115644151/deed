import fs from "node:fs";
import { parse, transact, fail, guard, load } from "../session.mjs";

// 我这一侧说的话也是原文：宿主把 assistant 消息交来，记成一条 reply。
// 它不数轮次、不开会话、不进下一步——轮次只记人开口的那一轮，这里记的是"我当时说了什么"。
// 没有位置参数时读 stdin：中文、引号、换行、代码块走 argv 会被拆坏。
// 同一个消息号交来两次，按 mid 认出第一次，不再记第二遍。
const fromFlag = (raw) => {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const at = text.lastIndexOf(":");
  if (at <= 0 || at === text.length - 1) fail("--from 的写法是 <谁交来的>:<会话>:<消息号>，例如 --from dsh:session-abc:msg-1");
  const origin = text.slice(0, at).split(":")[0];
  const mid = text.slice(at + 1);
  if (!origin) fail("--from 要写清是谁交来的：--from dsh:<会话>:<消息号>");
  return { origin, mid };
};

export default function reply(argv) {
  const { flags, words } = parse(argv, "reply");
  const from = fromFlag(flags.from);
  const piped = words.length === 0 && !process.stdin.isTTY ? (() => {
    try {
      return fs.readFileSync(0, "utf8");
    } catch {
      return "";
    }
  })() : "";
  const text = (words.length > 0 ? words.join(" ") : piped).trim();
  if (!text) fail('说了什么要写下来：deed reply "…"（没有位置参数时读 stdin）');
  guard(() => {
    if (from) {
      const { events } = load();
      if (events.some((one) => one.k === "reply" && one.mid === from.mid)) {
        console.log("这一句已经记过 · " + from.origin + " · " + from.mid);
        return;
      }
    }
    transact(flags, () => ({
      k: "reply",
      s: flags.session ?? null,
      text,
      ...(from ? { via: "hook", origin: from.origin, mid: from.mid } : {}),
    }));
    console.log("已记下我这一句 · " + text.length + " 字" + (from ? " · " + from.origin : ""));
  });
}
