// work 域（一）：条目怎么立、怎么改说法、怎么在段之间挪。
// 第二件事（交付、撤回、延后、放弃）在 delivery.mjs——那是状态的转向，不是记账。
// 纯重放：doc 与 ev 进，改 doc；不读盘、不看时钟。
import { meaningOf, MEANING } from "../../events/index.mjs";
import { noway } from "../../facts/errors.mjs";
import { sessionOf, taken } from "../../facts/session.mjs";
import { segmentById, segmentOf, nextSegment, nextOpen, settle, sealed, editable } from "../../facts/segment.mjs";
import { awaitingVerdict } from "../../facts/review.mjs";
import { taskOf, rederive, onTheSheet, lastResultOf, settledSince } from "../../facts/task.mjs";
import { awaitingJudgement } from "../../facts/review.mjs";

export const HANDLERS = {
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
  "task.order": (doc, ev) => {        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        task.order = ev.order;
        task.touchedAt = ev.at;
        return;
  },
};
