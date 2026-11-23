import { currentSession, sessionById } from "../../core/rules.mjs";
import { changedPaths, writeSnapshot } from "../../lib/store.mjs";
import { namedPins, weigh } from "../pins.mjs";
import { ROOT, parse, transact, nextId, fail, guard, undoesOf, split, list } from "../session.mjs";

export default function task(argv) {
    const [verb, ...rest] = argv;
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
        // 一次交付常常动了不止一个文件，而"记下的那个文件"才是事后能核的唯一凭据：
        // 只收一枚，剩下的只能靠人挑，挑漏的那几份就成了没人担保的字节。
        // --digest 可以写多遍，每一遍指一个文件。
        let named;
        try {
          named = namedPins(ROOT, list(flags.digest));
        } catch (problem) {
          fail(String(problem.message).replace(/^Error: /, ""));
        }
        const pins = named.map((one) => ({ path: one.path, digest: one.digest }));
        const pinSizes = {};
        for (const one of named) pinSizes[one.path] = one.size;
        // Snapshot before taking the lock: hashing the tree is the slow part of a
        // delivery, and holding the lock across it would make every other writer
        // wait for a scan. The snapshot is derived data; the ledger line is not.
        const scanned = changedPaths(ROOT);
        let moved = scanned.changed;
        let snapshotFiles = scanned.now;
        const sizes = weigh(ROOT, moved);
        // 手工 --digest 常常指一份这次没动过、但这条任务得担着的文件：它不在工作区差里，
        // 于是没人称过它，门槛只好按要审处理。称它一下，规模这一半才说得清。
        for (const [file, size] of Object.entries(pinSizes)) if (sizes[file] === undefined) sizes[file] = size;
        transact(
          flags,
          () => {
            const taken = scanned;
            return {
              k: "task.done",
              s: flags.session ?? null,
              id,
              evidence: flags.evidence,
              by: flags.by ?? "agent",
              digest: pins[0]?.digest ?? null,
              digestPath: pins[0]?.path ?? null,
              files: pins,
              changed: taken.changed,
              bytes: sizes,
            };
          },
          () => writeSnapshot(ROOT, snapshotFiles),
        );
        console.log(
          "交付 · " + id + " · 交付记录：" + flags.evidence +
            (pins.length === 0 ? "" : " · 记下 " + pins.map((one) => one.path + " " + one.digest.slice(0, 12)).join("、")),
        );
        if (moved.length > 0) console.log("  这一交付动了 " + moved.length + " 个路径（门槛按它判，不只按声明的 --files）");
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
            k: "task.undo", s: flags.session ?? null, id, why: flags.why, by: flags.by ?? "agent",
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
