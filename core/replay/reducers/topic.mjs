// topic 域：要点聚成议题；议题由人两次确认（成立、出口），出口之后才能变成条目。
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
  "topic.create": (doc, ev) => {        const session = sessionOf(doc, ev);
        const source = ev.replaces ? session.topics.find((one) => one.id === ev.replaces) : null;
        if (ev.replaces && !source) noway(`账本里没有议题 ${ev.replaces}：改正文要点名已有的议题`);
        if (source && source.state === "released") noway(`议题 ${source.id} 已经锁定出口：正文不往回改`);
        if (!source && taken(session, ev.id)) noway(`这个会话里已经有 ${ev.id} 了`);
        if (!/^I\d+$/u.test(String(ev.id))) noway(`议题号要写成 I1：${ev.id}`);
        session.ids.add(ev.id);
        if (source) session.topics = session.topics.filter((one) => one !== source);
        const listed = ev.points ?? [];
        for (const id of listed) {
          const point = session.points.find((one) => one.id === id);
          if (!point) noway(`账本里没有要点 ${id}：议题不能统合不存在的句子`);
          if (point.absorbedBy && point.absorbedBy !== ev.id) noway(`要点 ${id} 已经被 ${point.absorbedBy} 收编：同一句不能统合两次`);
        }
        // 成立到出口之间仍在讨论：改正文保留已成立的状态，不把它打回草稿。
        session.topics.push({
          id: ev.id, title: ev.title, body: ev.body ?? "", at: ev.at, by: ev.by ?? null,
          state: source?.state ?? "draft", points: [...listed],
          establishedAt: source?.establishedAt ?? null, establishedBy: source?.establishedBy ?? null,
          releasedAt: source?.releasedAt ?? null, releasedBy: source?.releasedBy ?? null,
          exportedAt: source?.exportedAt ?? null, exported: source?.exported ?? [],
        });
        // 已成立的议题：新收编进来的要点直接算它的历史来源，不再散在活跃清单。
        if (source?.state === "established")
          for (const id of listed) {
            const point = session.points.find((one) => one.id === id);
            if (point) point.absorbedBy = ev.id;
          }
        return;
  },
  "topic.establish": (doc, ev) => {        const session = sessionOf(doc, ev);
        const topic = session.topics.find((one) => one.id === ev.id);
        if (!topic) noway(`账本里没有议题 ${ev.id}`);
        if (topic.state !== "draft") noway(`议题 ${topic.id} 已经${topic.state === "established" ? "成立" : "锁定"}：账本不往回改`);
        const named = ev.points ?? topic.points;
        for (const id of named) {
          const point = session.points.find((one) => one.id === id);
          if (!point) noway(`账本里没有要点 ${id}`);
          if (point.absorbedBy && point.absorbedBy !== topic.id)
            noway(`要点 ${id} 已经被 ${point.absorbedBy} 收编：不能重复收编`);
        }
        // 正文从账本里带过来：面板按的是同一份草稿，不能让页面上另写一份成文。
        if (!String(ev.body ?? topic.body).trim()) noway(`议题 ${topic.id} 还没有正文：统合后的正文要先写下来`);
        topic.body = String(ev.body ?? topic.body);
        topic.state = "established";
        topic.establishedAt = ev.at;
        topic.establishedBy = ev.by ?? null;
        topic.points = [...new Set([...topic.points, ...named])];
        for (const id of topic.points) {
          const point = session.points.find((one) => one.id === id);
          if (point) { point.absorbedBy = topic.id; point.topic = topic.id; }
        }
        return;
  },
  "topic.release": (doc, ev) => {        const session = sessionOf(doc, ev);
        const topic = session.topics.find((one) => one.id === ev.id);
        if (!topic) noway(`账本里没有议题 ${ev.id}`);
        if (topic.state !== "established") noway(`议题 ${topic.id} 还没成立：先按成立那一下`);
        topic.state = "released";
        topic.releasedAt = ev.at;
        topic.releasedBy = ev.by ?? null;
        return;
  },
};
