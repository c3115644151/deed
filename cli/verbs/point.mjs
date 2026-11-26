import { parse, transact, nextId, fail, guard } from "../session.mjs";

export default function point(argv) {
  const [head, ...rest] = argv;
  const { flags, words } = parse(rest, "point");
  guard(() => {
    const update = head && /^P\d+$/u.test(head) ? head : null;
    const text = (update ? words : [head, ...words]).join(" ").trim();
    if (!text) fail('要点要写清这一轮留下了什么：deed point "…"；改已有的用 deed point P1 "新内容"');
    const { ev } = transact(flags, (doc0) => {
      const session = doc0.sessions.at(-1);
      if (!session) fail("这个工作区还没有会话：先 deed say 记一轮，会话自己开出来");
      if (session.closeKind) fail("这一期已经结束：先记一轮，会话自己开新一期");
      const id = update ?? nextId(doc0, "P");
      const existing = update ? (session.points ?? []).find((one) => one.id === update) : null;
      if (update && !existing) fail("账本里没有要点 " + update + "：改要点要点名已有的那一条");
      if (existing?.absorbedBy) fail("要点 " + update + " 已经被 " + existing.absorbedBy + " 收编：它是议题的历史来源，改要开新议题");
      const topic = flags.topic ?? existing?.topic ?? null;
      if (topic) {
        const home = (session.topics ?? []).find((one) => one.id === topic);
        if (!home) fail("账本里没有议题 " + topic + "：要点挂不上");
        if (home.state !== "draft") fail("议题 " + topic + " 已经成立：要点挂不上，要补就开新议题");
      }
      return {
        k: "point.add", s: session.id, id, text,
        topic: topic ?? null, ...(update ? { replaces: update } : {}),
      };
    });
    console.log("要点 · " + ev.id + " · " + text + (update ? "（已更新）" : "") + (ev.topic ? " · 挂在 " + ev.topic : ""));
  });
}
