import { sessionById, userTurns } from "../../core/rules.mjs";
import { parse, transact, session, fail, guard } from "../session.mjs";

export default function tick(argv) {
    const { flags, words } = parse(argv, "tick");
    const said = flags.said ?? words.join(" ");
    if (!said) fail("tick 要说清这一轮说了什么：deed tick --said \"…\"");
    guard(() => {
      const { doc, ev } = transact(flags, (doc0) => {
        // 轮次是你和用户之间的一轮对话，这一点由 core/events.mjs 的 WHO 管：
        // 我自己的进展记在交付记录（deed submit）、结论（deed review）与裁定里，
        // 记成轮次会让账本读起来像两个人一直在谈，而其中一半是我在自言自语。
        return { k: "turn", s: flags.session ?? null, who: flags.who ?? "user", said, did: flags.did };
      });
      const one = sessionById(doc, ev.s ?? doc.sessions[doc.sessions.length - 1].id);
      console.log("已记一轮 · 会话 " + one.id + " · 第 " + userTurns(one).length + " 轮" + (ev.did ? " · 做了：" + ev.did : ""));
    });
};
