import { parse, transact, nextId, fail, guard, signer } from "../session.mjs";

export default function point(argv) {
  const { flags, words } = parse(argv, "point");
  guard(() => {
    const text = words.join(" ").trim();
    if (!text) fail('要点要写清这一轮留下了什么：deed point "…"');
    const { ev } = transact(flags, (doc0) => {
      const session = doc0.sessions.at(-1);
      if (!session) fail("这个工作区还没有会话：先 deed say 记一轮，会话自己开出来");
      if (session.closeKind) fail("这一期已经结束：先记一轮，会话自己开新一期");
      const id = flags.id ?? nextId(doc0, "P");
      if (flags.topic && !(session.topics ?? []).some((one) => one.id === flags.topic))
        fail("账本里没有议题 " + flags.topic + "：要点挂不上");
      return { k: "point.add", s: session.id, id, text, topic: flags.topic ?? null, by: signer(flags, "记要点") };
    });
    console.log("要点 · " + ev.id + " · " + text + (ev.topic ? " · 挂在 " + ev.topic : ""));
  });
}
