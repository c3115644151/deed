// work 域：条目的一生——立、改标题、改标准、交付、撤回、延后、放弃、改到下一段、写回。
// 纯重放：doc 与 ev 进，改 doc；不读盘、不看时钟。
// 一个 kind 一个函数——加一类事实就是加一个函数，不改别人的分支。
import { meaningOf, MEANING } from "../../events.mjs";
import { noway } from "../../facts/errors.mjs";
import { sessionOf, taken } from "../../facts/session.mjs";
import { segmentById, segmentOf, nextSegment, nextOpen, settle, sealed, editable } from "../../facts/segment.mjs";
import { awaitingVerdict } from "../../facts/review.mjs";
import { taskOf, rederive, onTheSheet, lastResultOf, settledSince } from "../../facts/task.mjs";
import { awaitingJudgement } from "../../facts/review.mjs";

export const HANDLERS = {
  "task.uncarry": (doc, ev) => {
    const session = sessionOf(doc, ev);
    const task = taskOf(session, ev.id);
    editable(session, task);
    if (task.status !== "todo")
      noway(`${task.id} 不是还没动手的条目（${task.status}）：只有没做的能从下一段拿回来`);
    const take = session.segments.find((one) => one.closedAt === null && one.plannedAt === null) ?? null;
    const to = ev.to ? session.segments.find((one) => one.id === ev.to) : take;
    if (!to) noway(`${task.id} 要回到哪一段？现在没有收活的段`);
    if (to.closedAt !== null) noway(`${to.id} 已经封闭：条目回不去`);
    if (to.id === task.segment) noway(`${task.id} 已经在这一段（${to.id}）：没有可撤回的`);
    const from = task.segment;
    task.segment = to.id;
    // 走了空的段跟着消失：一个只剩格子的"下一段"会让下一条新活落进谁也没打算做的段。
    const left = session.segments.find((one) => one.id === from);
    const used =
      session.tasks.some((one) => one.segment === from) ||
      (session.briefs ?? []).some((one) => (one.segment ?? null) === from) ||
      session.reviews.some((one) => one.segment === from);
    if (left && !used) session.segments = session.segments.filter((one) => one.id !== from);
  
  },
  "task.add": (doc, ev) => {        const session = sessionOf(doc, ev);
        if (taken(session, ev.id)) noway(`这个会话里已经有 ${ev.id} 了`);
        session.ids.add(ev.id);
        // 清单已经把这条活排进某一段时，就落在那一段：它可能还在排队，
        // 收不收活是规则的事，重放只负责把行读对。
        const planned = ev.segment === undefined ? null : session.segments.find((one) => one.id === ev.segment) ?? null;
        if (ev.segment !== undefined && !planned) noway(`账本里没有段 ${ev.segment}：条目不能落在没声明过的段上`);
        if (planned && planned.closedAt !== null) noway(`段 ${planned.id} 已经关闭：新条目进不去`);
        const segment = planned ?? segmentOf(session, ev.at, ev.v ?? 1);
        // 从议题里拆出来的条目：账本记下议题号，议题那头记下出口了哪几条。
        // 出口不是新事件，是「有一条条目来自它」这件事本身——事实只有一个主人。
        const home = ev.topic === undefined || ev.topic === null ? null : session.topics.find((one) => one.id === ev.topic) ?? null;
        if (ev.topic !== undefined && ev.topic !== null && !home) noway(`账本里没有议题 ${ev.topic}：条目不能来自没立过的议题`);
        if (home) {
          if (home.state !== "released") noway(`议题 ${home.id} 还没锁定出口：它还不能拆成任务`);
          home.exportedAt = home.exportedAt ?? ev.at;
          home.exported = [...(home.exported ?? []), ev.id];
        }
        session.tasks.push({
          id: ev.id,
          title: ev.title,
          criteria: ev.criteria,
          // 任务自带依据：能点回原文的锚点。标题自己说清要解决什么现象。
          source: ev.source ?? null,
          topic: home ? home.id : null,
          files: ev.files ?? [],
          segment: segment.id,
          createdAt: ev.at,
          // 这一段最后一次"被改动"的时刻，任务自己的生命周期都算：加了、交了、
          // 收回了、延后了、弃掉了。清单与结论都拿它比新旧。
          touchedAt: ev.at,
          status: "todo",
          evidence: [],
          undone: [],
          // 撤回过的放弃：放弃错了撤回来，这条任务要能说清它走过那一遭。
          revived: [],
          // 同段里谁先做。它不进门也不进结论，只决定印出来的顺序。
          order: ev.order ?? null,
          changed: [],
          sizes: {},
          deferredWhy: null,
        });
        return;
  },
  "task.context": (doc, ev) => {        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        if (ev.source !== undefined) task.source = ev.source;
        return;
  },
  "task.title": (doc, ev) => {        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        task.title = ev.title;
        // 改标题也算这条被动了：重审时"自上次判定以来动过"要看得见它。
        task.touchedAt = ev.at;
        return;
  },
  "task.criteria": (doc, ev) => {        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        task.criteria = ev.criteria;
        task.changedCriteria = (task.changedCriteria ?? 0) + 1;
        task.touchedAt = ev.at;
        return;
  },
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
  "task.carry": (doc, ev) => {        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);

        if (task.status !== "todo")
          noway(`${task.id} 不是还没动手的条目（${task.status}）：只有没做的能改到下一段`);
        // 新的写法（含义第 24 版起）：目标是下一个还没关闭的段——清单排好的那个就是它。
        if (meaningOf(ev) >= MEANING.segmentsPlanned) {
          const at0 = session.segments.findIndex((one) => one.id === task.segment);
          const after = session.segments.slice(at0 + 1).find((one) => one.closedAt === null) ?? null;
          if (after) task.segment = after.id;
          else
            noway(
              task.id + " 已经在最末那一段 " + task.segment +
                " 里：改到下一段得先有下一段——在清单里加一节 ## 段，submit 时领号",
            );
        } else {
          // 旧行按当时那套读法逐字重放（那时"下一段"是个自己开出来的格子）：
          // 从它里面再改出去时原地不动，否则落进去，没有就开一个。
          const prep =
            session.segments
              .filter(
                (one) =>
                  one.closedAt === null &&
                  one.carried &&
                  !awaitingVerdict(session, one) &&
                  session.tasks.some((other) => other.segment === one.id),
              )
              .at(-1) ?? null;
          if (prep && prep.id === task.segment && meaningOf(ev) >= MEANING.carryOut) {
            const delivered = session.tasks.some(
              (one) => one.segment === task.segment && (one.status === "done" || one.status === "accepted" || one.status === "dropped"),
            );
            if (!delivered)
              noway(
                `${task.id} 已经在下一段 ${task.segment} 里，而这一段还没有交过的活：先在这一段做完，或者先交一条`,
              );
            prep.carried = false;
            task.segment = nextSegment(session, ev.at, true).id;
          } else if (prep) task.segment = prep.id;
          else task.segment = nextSegment(session, ev.at, true).id;
        }
        task.touchedAt = ev.at;
        settle(session);
        return;
  },
  "task.order": (doc, ev) => {        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        task.order = ev.order;
        task.touchedAt = ev.at;
        return;
  },
};
