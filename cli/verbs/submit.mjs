import fs from "node:fs";
import path from "node:path";
import { nextAction, sessionById } from "../../core/rules.mjs";
import { changedPaths, rel, writeSnapshot } from "../../lib/store.mjs";
import { pinSet, weigh } from "../pins.mjs";
import { draft as planDraft, parse as parsePlan } from "../plan.mjs";
import { ROOT, parse, transactMany, targetSession, nextId, fail, guard, undoesOf } from "../session.mjs";

export default function submit(argv) {
    const { flags } = parse(argv, "submit");
    guard(() => {
      const file = path.join(ROOT, ".deed", "plan.md");
      if (!fs.existsSync(file)) fail("还没有清单：先 deed plan 出一份草稿，改完再 deed submit");
      const plan = parsePlan(fs.readFileSync(file, "utf8"));
      if (plan.problems.length > 0)
        fail("清单有 " + plan.problems.length + " 处看不懂，一个字都没落：" + "\n" + "  " + plan.problems.join("\n" + "  "));
      // 称重与快照在锁外做：跑一遍工作区是慢的那一半，锁里只做判与落。
      const scanned = changedPaths(ROOT);
      const by = flags.by ?? "agent";
      const sizes = weigh(ROOT, scanned.changed);
      const pins = pinSet(ROOT, scanned.changed, scanned.now);
      const { doc, evs } = transactMany(
        flags,
        (doc0) => {
          const one = targetSession(doc0, flags);
          if (one.closeKind)
            fail("这一期已经" + (one.closeKind === "signed" ? "签收" : "搁下") + "：账本不往回改；要接着做就记一轮，会话自己开新一期");
          const specs = [];
          const said = plan.goal.startsWith("（还没写") ? "" : plan.goal;
          if (said && said !== (one.goal?.text ?? "")) specs.push({ k: "goal.set", s: one.id, text: said, by });
          if (plan.items.length === 0 && one.tasks.length === 0) fail("清单里一条都没有：先写一条再 submit");
          const known = new Map(one.tasks.map((t) => [t.id, t]));
          const mentioned = new Set();
          let seq = Number(nextId(doc0, "T").slice(1));
          for (const item of plan.items) {
            if (item.box === "?") {
              if (!item.criteria) fail("第 " + item.at + " 行是新条目，但没有写一行 标准：——没有标准就不算一件事");
              const id = "T" + seq;
              seq += 1;
              specs.push({ k: "task.add", s: one.id, id, title: item.title, criteria: item.criteria, files: [] });
              mentioned.add(id);
              continue;
            }
            if (item.box === "x" && !item.id)
              fail(
                "第 " + item.at + " 行勾上了却没有编号：一次 submit 不能既新增又交付——先把条目写成任务，做完再勾上交",
              );
            const task = known.get(item.id);
            if (!task) fail("第 " + item.at + " 行的 " + item.id + " 账本里没有：新条目写成 - ? 标题，submit 时领号");
            mentioned.add(item.id);
            if (item.title && item.title !== task.title)
              fail(item.id + " 的标题和账本不一样：清单只做四件事（勾上、撤勾、~~、?），改标题不算其中");
            if (item.criteria && item.criteria !== task.criteria)
              fail(item.id + " 的标准和账本不一样：清单不改已经写下的标准；做法变了就新开一条，把旧的那条说清为什么不做");
            if (item.box === "~") {
              if (task.status === "dropped") continue;
              if (!item.why) fail(item.id + " 要放弃，但没有写一行 理由：——放弃是账本里的一件事实，得说清为什么");
              specs.push({ k: "task.drop", s: one.id, id: item.id, why: item.why });
              continue;
            }
            // 这一段送审之后不再收活：没做的条目写一行 搬： 就落到下一段。
            if (item.carry && item.box !== "x") {
              if (task.status !== "todo")
                fail(item.id + " 不是还没动手的条目（" + task.status + "）：只有没做的能搬到下一段");
              specs.push({ k: "task.carry", s: one.id, id: item.id });
              continue;
            }
            if (item.box === "x") {
              // 判过（accepted）的条目在清单里也是勾着的：它已经交过、也有人判过，
              // 再交一次既没有意义，也会撞上「封了的段不能再改」。
              if (task.status === "done" || task.status === "accepted") continue;
              if (task.status === "dropped") fail(item.id + " 已经放弃过：要接着做就新开一条");
              if (!item.claim) fail(item.id + " 勾上了，但没有写一行 交付：——勾上就是交付，得写清跑了什么、结果几比几");
              // 一条交付总要指着点什么：既没量到改动、也没有文件可指时，写下去就是一条谁也核不了的空话。
              // 只删不改也算动了——那时 pins 是空的，但 changed 里有那条走了的路径，得放行。
              if (pins.length === 0 && scanned.changed.length === 0)
                fail(
                  item.id +
                    " 勾上了，但这一批没有量到任何改动、也没有文件可指：先真的动过再勾，或者用 deed task done " +
                    item.id +
                    " --evidence \"…\" --digest <工作区里的文件> 手工指那份内容",
                );
              specs.push({
                k: "task.done",
                s: one.id,
                id: item.id,
                evidence: item.claim,
                by,
                digest: pins[0]?.digest ?? null,
                digestPath: pins[0]?.path ?? null,
                files: pins,
                changed: scanned.changed,
                bytes: sizes,
              });
              continue;
            }
            if (task.status === "done") {
              if (!item.why) fail(item.id + " 的勾去掉了，但没有写一行 理由：——撤回一条交付得说清为什么");
              const undoes = undoesOf(task);
              specs.push({
                k: "task.undo", s: one.id, id: item.id, why: item.why, by,
                ...(undoes === null ? {} : { undoes }),
              });
              continue;
            }
            if (item.later) {
              if (task.status === "deferred") continue;
              specs.push({ k: "task.defer", s: one.id, id: item.id, why: item.later });
            }
          }
          // 一批交付不止一条时，工作区只量了一次差：谁改了什么分不出来。
          // 给它们同一个批号，账本上写着「这几条共用一份差」，而不是谎称各钉各的。
          const dones = specs.filter((spec) => spec.k === "task.done");
          if (dones.length > 1) for (const spec of dones) spec.batch = true;
          const gone = one.tasks.filter((t) => !mentioned.has(t.id) && t.status !== "dropped");
          if (gone.length > 0)
            fail("清单里少了 " + gone.map((t) => t.id).join("、") + "：账本里有的条目不能自己消失——不做了就写 ~~ " + gone[0].id + " " + gone[0].title + "，再加一行 理由：");
          return specs;
        },
        (stamped) => {
          // 只有真交付过才刷新基线：一次只加条目或只领号的 submit 如果也刷新，
          // 工作区里那些改动就被它吃掉了——下一条交付看起来什么都没动。
          if (stamped.some((ev) => ev.k === "task.done")) writeSnapshot(ROOT, scanned.now);
        },
      );
      // 落过账就把清单按账本重写一遍：新条目领到的号要写回去，不然下一次 submit
      // 会把同一个 ? 再加一条。文件里说过的话都已经在账本上，重写不丢东西。
      const after = sessionById(doc, evs[0].s ?? targetSession(doc, flags).id);
      fs.writeFileSync(file, planDraft(after) + "\n", "utf8");
      for (const ev of evs) {
        if (ev.k === "goal.set") console.log("目的 · " + ev.s + " · " + ev.text);
        if (ev.k === "task.add") console.log("写进清单 · " + ev.id + " · " + ev.title);
        if (ev.k === "task.done") console.log("交付 · " + ev.id + " · " + ev.evidence);
        if (ev.k === "task.undo") console.log("撤回 · " + ev.id + " · " + ev.why);
        if (ev.k === "task.defer") console.log("延后 · " + ev.id + " · " + ev.why);
        if (ev.k === "task.drop") console.log("放弃 · " + ev.id + " · " + ev.why);
        if (ev.k === "task.carry")
          console.log("搬到下一段 · " + ev.id + " · " + (after.tasks.find((t) => t.id === ev.id)?.segment ?? ""));
      }
      console.log("落账 " + evs.length + " 条 · 清单 " + rel(ROOT, file));
      const step = nextAction(doc, doc.config);
      console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
      console.log("  " + step.command);
    });
};
