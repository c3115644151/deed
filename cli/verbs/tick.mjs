import { sessionById } from "../../core/rules.mjs";
import { parse, transact, session, fail, guard } from "../session.mjs";

export default function tick(argv) {
    const { flags, words } = parse(argv, "tick");
    const said = flags.said ?? words.join(" ");
    if (!said) fail("tick 要说清这一轮说了什么：deed tick --who user --said \"…\"");
    guard(() => {
      const { doc, ev } = transact(flags, (doc0) => {
        const who = flags.who ?? "agent";
        // 一轮记的是「这一轮这个人说了什么」。agent 把用户原话抄进 --said，
        // 账本上就成了同一句由两个人说过——那句话只属于说它的人，抄一遍
        // 会让读的人以为重复了一轮。
        if (who === "agent") {
          const one = flags.session ? doc0.sessions.find((s) => s.id === flags.session) : doc0.sessions[doc0.sessions.length - 1];
          const lastUser = one?.turns.filter((turn) => turn.who === "user").at(-1);
          if (lastUser && lastUser.said.trim() === said.trim())
            fail("这句是用户说的（" + lastUser.at + " 那一轮已经记下）：--said 写你自己这一轮说的话");
        }
        return { k: "turn", s: flags.session ?? null, who, said, did: flags.did };
      });
      const one = sessionById(doc, ev.s ?? doc.sessions[doc.sessions.length - 1].id);
      console.log("已记一轮 · 会话 " + one.id + " · 第 " + one.turns.length + " 轮" + (ev.did ? " · 做了：" + ev.did : ""));
    });
};
