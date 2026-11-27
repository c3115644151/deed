import { parse, transact, nextId, fail, guard, load } from "../session.mjs";

const one = (id) => {
  const { doc } = load();
  const session = doc.sessions.at(-1);
  const topic = (session?.topics ?? []).find((one) => one.id === id);
  if (!topic) fail("账本里没有议题 " + id);
  return topic;
};

export default function topic(argv) {
  const [head, ...rest] = argv;
  const { flags, words } = parse(rest, "topic");
  guard(() => {
    if (head && /^I\d+$/u.test(head) && flags.body) {
      const t = one(head);
      if (t.state !== "draft") fail("议题 " + t.id + " 已经" + (t.state === "established" ? "成立" : "锁定") + "：正文不往回改");
      const points = String(flags.points ?? "").split(/[，,]/u).map((one) => one.trim()).filter(Boolean);
      const { ev } = transact(flags, (doc0) => {
        const session = doc0.sessions.at(-1);
        const topic = (session?.topics ?? []).find((one) => one.id === head);
        if (!topic) fail("账本里没有议题 " + head);
        const named = points.length ? points : topic.points;
        for (const id of named) {
          const p = (session.points ?? []).find((one) => one.id === id);
          if (!p) fail("账本里没有要点 " + id);
          if (p.absorbedBy && p.absorbedBy !== topic.id) fail("要点 " + id + " 已经被 " + p.absorbedBy + " 收编");
        }
        return {
          k: "topic.create", s: session.id, id: topic.id,
          title: flags.title ?? topic.title, body: String(flags.body),
          points: [...new Set([...topic.points, ...named])],
          by: "agent",
          replaces: topic.id,
        };
      });
      console.log("议题草稿 · " + ev.id + " · 正文已更新 · " + ev.points.length + " 条要点");
      return;
    }
    if (head && /^I\d+$/u.test(head) && !flags.body && !flags.title) {
      const t = one(head);
      console.log(
        "议题 · " + t.id + " · " + t.title + " · " +
          ({ draft: "等你确认成立", established: "等你确认出口", released: "已锁定，可以出口为任务" })[t.state],
      );
      console.log("  要点 " + t.points.length + " 条 · " + (t.body || "还没有正文"));
      if (t.state === "draft") console.log("  成立与出口都在面板上按：deed panel");
      if (t.state === "released")
        console.log(
          (t.exported ?? []).length
            ? "  已经出口的条目：" + t.exported.join("、")
            : "  可以出口成清单里的任务：在清单里写一行 来自：" + t.id,
        );
      return;
    }
    // 「release」「establish」是人的动作，只在面板上按：它们出现在第一个词的位置上时，
    // 不能降级成"新建一个叫 release 的议题"——那句话会静默建出一个谁也没要的议题。
    if (head === "release" || head === "establish")
      fail("议题的成立与出口在面板上按：命令行没有这条路（deed topic \"标题\" --points … 才是新建议题）");
    const title = flags.title ?? (head && !/^I\d+$/u.test(head) ? head : words.join(" ").trim());
    if (!title) fail('议题要有标题：deed topic "标题" --points P1,P2 --body "统合后的正文"');
    if (!flags.body) fail('议题要把要点统合成正文：--body "…"');
    const points = String(flags.points ?? "").split(/[，,]/u).map((one) => one.trim()).filter(Boolean);
    if (points.length === 0) fail("议题要写清统合了哪几条要点：--points P1,P2；散着的想法先 deed point 记下来");
    const { ev } = transact(flags, (doc0) => {
      const session = doc0.sessions.at(-1);
      if (!session) fail("这个工作区还没有会话：先 deed say 记一轮");
      if (session.closeKind) fail("这一期已经结束：先记一轮，会话自己开新一期");
      for (const id of points) {
        const p = (session.points ?? []).find((one) => one.id === id);
        if (!p) fail("账本里没有要点 " + id + "：议题不能统合不存在的句子");
        if (p.absorbedBy) fail("要点 " + id + " 已经被 " + p.absorbedBy + " 收编：同一句不能统合两次");
      }
      return {
        k: "topic.create", s: session.id, id: flags.id ?? nextId(doc0, "I"),
        title, body: String(flags.body), points,
        by: "agent",
      };
    });
    console.log("议题草稿 · " + ev.id + " · " + ev.title + " · 统合 " + points.length + " 条要点");
    console.log("  成立与出口都在面板上按：deed panel");
  });
}
