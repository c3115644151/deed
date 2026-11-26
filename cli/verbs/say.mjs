import fs from "node:fs";
import { sessionById, userTurns } from "../../core/rules.mjs";
import { parse, transact, fail, guard, load } from "../session.mjs";

// 一轮 = 你和用户之间的一轮对话。said 是位置参数：这个动作只说一件事，
// 给它一个开关只会让"到底说了什么"分成两处。who 也不再开放——我自己的进展
// 记在交付记录（submit）与结论（review）里，记成轮次是把自言自语装成对话。
//
// 原文也可以由宿主的钩子交来（--from <origin>:<会话>:<消息号>）：那时话仍是人说的
// （who:"user"），只是通道写着 hook。没有位置参数时读 stdin——中文、引号、换行
// 走 argv 会在 Windows 上被拆坏；同一句话交来两次，按 mid 认出第一次，不再记第二遍。
const fromFlag = (raw) => {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const at = text.lastIndexOf(":");
  if (at <= 0 || at === text.length - 1) fail('--from 的写法是 <谁交来的>:<会话>:<消息号>，例如 --from dsh:session-abc:msg-1');
  const origin = text.slice(0, at).split(":")[0];
  const mid = text.slice(at + 1);
  if (!origin) fail("--from 要写清是谁交来的：--from dsh:<会话>:<消息号>");
  return { origin, mid };
};

export default function say(argv) {
  const { flags, words } = parse(argv, "say");
  const from = fromFlag(flags.from);
  const piped = words.length === 0 && !process.stdin.isTTY ? (() => {
    try {
      return fs.readFileSync(0, "utf8");
    } catch {
      return "";
    }
  })() : "";
  const said = (words.length > 0 ? words.join(" ") : piped).trim();
  if (!said) fail('这一轮说了什么要写成一句话：deed say "…"（没有位置参数时读 stdin）');
  guard(() => {
    if (from) {
      // 同一句话交来两次：账本里已经有这个 mid，就不再记第二遍。
      const { events } = load();
      const seen = events.find((one) => one.k === "turn" && one.mid === from.mid);
      if (seen) {
        console.log("这一轮已经记过 · " + from.origin + " · " + from.mid);
        return;
      }
    }
    const { doc, ev } = transact(flags, () => ({
      k: "turn",
      s: flags.session ?? null,
      who: "user",
      said,
      ...(from ? { via: "hook", origin: from.origin, mid: from.mid } : {}),
    }));
    const one = sessionById(doc, ev.s ?? doc.sessions[doc.sessions.length - 1].id);
    console.log("已记一轮 · 会话 " + one.id + " · 第 " + userTurns(one).length + " 轮" + (from ? " · " + from.origin : ""));
  });
}
