// work 域（二）：交付与撤回。一条活从「没做」变成「做了」，以及延后、放弃这两种收尾。
// 记账与挪动在 work.mjs。
// 纯重放：doc 与 ev 进，改 doc；不读盘、不看时钟。
import { meaningOf, MEANING } from "../../events.mjs";
import { noway } from "../../facts/errors.mjs";
import { sessionOf, taken } from "../../facts/session.mjs";
import { segmentById, segmentOf, nextSegment, nextOpen, settle, sealed, editable } from "../../facts/segment.mjs";
import { awaitingVerdict } from "../../facts/review.mjs";
import { taskOf, rederive, onTheSheet, lastResultOf, settledSince } from "../../facts/task.mjs";
import { awaitingJudgement } from "../../facts/review.mjs";

export const HANDLERS = {
  "task.done": (doc, ev) => {        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        // 冻结不在这里拦：账本里的行是已经发生的事实，重放不因为「这一段后来送了审」
        // 就把它判成坏账——读的一侧只读，拦在写的一侧（cli/session.mjs 的 refuseFrozen）。
        task.touchedAt = ev.at;
        if (task.status !== "todo" && task.status !== "done")
          noway(`任务 ${task.id} 不在未做状态：${task.status}`);
        task.status = "done";
        // A delivery pins the content of every file it says it produced. Old
        // 老账本里的单文件交付记的是 digest + digestPath；新行记一串路径。
        // Both shapes read the same way from here on: one entry per file.
        const files =
          ev.files !== undefined
            ? ev.files.map((one) => ({ path: one.path }))
            : ev.digestPath
              ? [{ path: ev.digestPath }]
              : [];
        task.evidence.push({
          claim: ev.evidence,
          by: ev.by,
          at: ev.at,
    
          path: files[0]?.path ?? null,
          files,
          changed: ev.changed ?? [],
          // 交付那一刻称的各路径大小，随这条交付走：交付退回，它称过的数也一起退。
          sizes: ev.bytes ?? {},
          // 同一路径的内容指纹：字节数一样、内容换过的，靠它看得出来。
          shas: ev.sha ?? {},
          // 交付时跑的那条命令与它报的条数：清单上的数从这一格读，不从文本读。
          run: ev.run ?? null,
          expects: ev.expects ?? [],
          // 一批 submit 落了好几条交付时，工作区只量了一次差：改动的归属是整批，
          // 不是其中某一条。账本把这件事写下来，读的人就不会以为每条各记了各的。
          batch: ev.batch
            ? typeof ev.batch === "string"
              ? { at: ev.batch, size: null }
              : { at: ev.batch.at ?? null, size: ev.batch.size ?? null }
            : null,
        });
        // What the delivery actually moved in the workspace, computed before the
        // event landed. The review threshold reads this, not the task's own story
        // about which paths it touched.
        // 每个路径多大，是交付那一刻称的；规则拿它判"这次改动小到不用审"。
        rederive(task);
        return;
  },
  "task.undo": (doc, ev) => {        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        // 撤回放弃、撤回一条改到下一段不改这里的字节，是记录层面的事；撤回一条交付会换掉
        // 审查者手上的文件——那一半拦在写的一侧。
        task.touchedAt = ev.at;
        // 撤回也可以是撤回一条放弃/延后：账本只追加，撤的是它此刻的效力，不是那一行
        // 记录。放弃错了却只能新开一条，等于让账本里的错口径一直挂着，而新开的那条
        // 与旧的说的又是同一件事（事件含义第 15 版）。
        if (task.status === "dropped" || task.status === "deferred") {
          task.revived.push({ from: task.status, why: ev.why, by: ev.by ?? "agent", at: ev.at });
          task.status = "todo";
          task.deferredWhy = null;
          return;
        }
        // 撤回也可以是撤回一条「改到下一段」：段不是排期工具，把活挪进下一段只该发生在
        // 「这一段要送审了」那一刻。挪错了得能挪回来，否则账本里会留下一个只为计划而生
        // 的段，而计划不是事实（事件含义第 16 版）。
        if (task.status === "todo" && task.evidence.length === 0 && (task.undone ?? []).length === 0) {
          const where = session.segments.findIndex((one) => one.id === task.segment);
          const before = where > 0 ? session.segments[where - 1] : null;
          const left = session.segments[where] ?? null;
          if (before && left === session.segments[session.segments.length - 1]) {
            task.segment = before.id;
            task.touchedAt = ev.at;
            // 它走空的那一段是个只剩计划的地方：自己开出来的段由条目生出来，条目回来了，
            // 段也就不该在（清单里排过的那一段留着，它是账本上写下的计划）。
            if (left.plannedAt === null && !session.tasks.some((one) => one.segment === left.id))
              session.segments = session.segments.filter((one) => one !== left);
            return;
          }
        }
        const last = task.evidence[task.evidence.length - 1];
        if (!last) noway("任务 " + task.id + " 没有可撤回的交付");
        task.evidence.pop();
        // 撤回的那条还带着它的批号：剩下同批的那条，数目不能因为撤回而变小。
        // 也带着它记下的内容：撤回之后账本里再没有那句话，而"它当时指着哪份字节"
        // 是别人复核这条撤回的唯一依据——不留，撤回就成了没法核对的一句话。
        task.undone.push({
          claim: last.claim,
          why: ev.why,
          by: ev.by ?? "agent",
          at: ev.at,
          batch: last.batch ?? null,
          undoes: ev.undoes ?? last.files ?? (last.path ? [{ path: last.path }] : []),
          changed: last.changed ?? [],
        });
        // 撤回的交付不再替这些字节说话：这一段碰过的路径与大小重新由还在的交付算。
        rederive(task);
        task.status = task.evidence.length > 0 ? "done" : "todo";
        return;
  },
  "task.defer": (doc, ev) => {        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        // 延后与放弃是记录层面的决定，换不掉审查者手上的字节：冻结不禁它们。
        task.status = ev.k === "task.defer" ? "deferred" : "dropped";
        task.deferredWhy = ev.why;
        task.touchedAt = ev.at;
        return;
  },
  "task.drop": (doc, ev) => {        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        // 延后与放弃是记录层面的决定，换不掉审查者手上的字节：冻结不禁它们。
        task.status = ev.k === "task.defer" ? "deferred" : "dropped";
        task.deferredWhy = ev.why;
        task.touchedAt = ev.at;
        return;
  },
};
