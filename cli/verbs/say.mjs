import { sessionById } from "../../core/rules.mjs";
import { parse, transact, fail, guard } from "../session.mjs";

// 一轮记一件事：这个人这一轮说了什么。做过的事不在这里记——交付在清单的
// 交付记录里，结论在 review.log 里，裁定在题里；再抄一遍只会多一份对不上的账。
export default function say(argv) {
  const { flags, words } = parse(argv, "say");
  const said = words.join(" ").trim();
  if (!said) fail('say 要说一句：deed say "…" [--who user]');
  guard(() => {
    const { doc, ev } = transact(flags, (doc0) => {
      const who = flags.who ?? "agent";
      // 同一句话由两个人各说一遍，读账本的人会以为重复了一轮。
      if (who === "agent") {
        const one = flags.session
          ? doc0.sessions.find((s) => s.id === flags.session)
          : doc0.sessions[doc0.sessions.length - 1];
        const lastUser = one?.turns.filter((turn) => turn.who === "user").at(-1);
        if (lastUser && lastUser.said.trim() === said)
          fail("这句是用户说的（" + lastUser.at + " 那一轮已经记下）：写你自己这一轮说的话");
      }
      return { k: "turn", s: flags.session ?? null, who, said };
    });
    const one = sessionById(doc, ev.s ?? doc.sessions[doc.sessions.length - 1].id);
    console.log("已记一轮 · 会话 " + one.id + " · 第 " + one.turns.length + " 轮");
  });
}
