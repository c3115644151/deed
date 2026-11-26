import { sessionById, userTurns } from "../../core/rules.mjs";
import { parse, transact, fail, guard } from "../session.mjs";

// 一轮 = 你和用户之间的一轮对话。said 是位置参数：这个动作只说一件事，
// 给它一个开关只会让"到底说了什么"分成两处。who 也不再开放——我自己的进展
// 记在交付记录（submit）与结论（review）里，记成轮次是把自言自语装成对话。
export default function say(argv) {
  const { flags, words } = parse(argv, "say");
  const said = words.join(" ").trim();
  if (!said) fail('这一轮说了什么要写成一句话：deed say "…"');
  guard(() => {
    const { doc, ev } = transact(flags, () => ({ k: "turn", s: flags.session ?? null, who: "user", said }));
    const one = sessionById(doc, ev.s ?? doc.sessions[doc.sessions.length - 1].id);
    console.log("已记一轮 · 会话 " + one.id + " · 第 " + userTurns(one).length + " 轮");
  });
}
