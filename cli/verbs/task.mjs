import { currentSession, sessionById } from "../../core/rules.mjs";
import { changedPaths, writeSnapshot } from "../../lib/store.mjs";
import { weigh } from "../pins.mjs";
import { ROOT, parse, transact, nextId, fail, guard, undoesOf, split, list } from "../session.mjs";

export default function task(argv) {
    const [verb, ...rest] = argv;
    // 开关写在子命令的位置上（task --digset a.md）也先让开关表认一遍：
    // 那时报"子命令不存在"是答非所问，错的是那个开关的字，不是这个动词的语法。
    if (verb && verb.startsWith("-") && verb !== "--help" && verb !== "-h") parse(argv, "task");
    const { flags, words } = parse(rest, "task");
    const id = words[0] ?? flags.id;
    guard(() => {
      if (verb === "add") {
        const title = flags.title ?? words.join(" ");
        if (!title) fail("task add 要写清这件事：deed task add \"…\" --criteria \"…\"");
        if (!flags.criteria) fail("task add 要写清做完的标准：--criteria \"…\"");
        const { doc, ev } = transact(flags, (doc0) => ({
          k: "task.add",
          s: flags.session ?? null,
          id: flags.id ?? nextId(doc0, "T"),
          title,
          criteria: flags.criteria,
          files: split(flags.files),
        }));
        const one = sessionById(doc, ev.s ?? doc.sessions[doc.sessions.length - 1].id);
        const task = one.tasks.find((t) => t.id === ev.id);
        console.log("写进清单 · " + ev.id + " · 段 " + task.segment + " · 做完的标准：" + flags.criteria);
        return;
      }
      if (verb === "done") {
        if (!id) fail("task done 要点名任务");
        if (!flags.evidence) fail("task done 必须带一条交付记录：--evidence \"命令与结果\"");
        // 一条交付记下两件事：它碰过哪些路径（工作区差算出来）、每份多大。
        // 内容不记：审查期间不许改这件事由冻结管，别处不拿指纹去追旧账。
        const scanned = changedPaths(ROOT);
        const moved = scanned.changed;
        const snapshotFiles = scanned.now;
        const sizes = weigh(ROOT, moved);
        transact(
          flags,
          () => ({
            k: "task.done",
            s: flags.session ?? null,
            id,
            evidence: flags.evidence,
            by: "agent",
            files: moved.map((one) => ({ path: one })),
            changed: moved,
            bytes: sizes,
          }),
          () => {
            writeSnapshot(ROOT, snapshotFiles);
          },
        );
        console.log("交付 · " + id + " · 交付记录：" + flags.evidence + (moved.length === 0 ? "" : " · 动了 " + moved.length + " 个路径"));
        if (moved.length > 0) console.log("  这一交付动了 " + moved.length + " 个路径（审查设置按它判，不只按声明的 --files）");
        return;
      }
      // A delivery that said the wrong thing is taken back, not rewritten: the
      // ledger keeps both facts, and the brief stops counting it as proof.
      if (verb === "undo") {
        if (!id) fail("task undo 要点名任务");
        if (!flags.why) fail("task undo 要说清为什么收回：--why \"…\"");
        transact(flags, (doc) => {
          const one = currentSession(doc);
          const task = one ? one.tasks.find((t) => t.id === id) : null;
          if (!task) fail("这个会话里没有任务 " + id);
          const undoes = undoesOf(task);
          return {
            k: "task.undo", s: flags.session ?? null, id, why: flags.why, by: "agent",
            ...(undoes === null ? {} : { undoes }),
          };
        });
        console.log("撤回交付 · " + id + " · " + flags.why);
        return;
      }
      if (verb === "defer" || verb === "drop") {
        if (!id) fail("task " + verb + " 要点名任务");
        if (!flags.why) fail("task " + verb + " 要说清为什么：--why \"…\"");
        transact(flags, () => ({ k: verb === "defer" ? "task.defer" : "task.drop", s: flags.session ?? null, id, why: flags.why }));
        console.log((verb === "defer" ? "延后" : "放弃") + " · " + id + " · " + flags.why);
        return;
      }
      fail("task 只认 add / done / undo / defer / drop");
    });
};
