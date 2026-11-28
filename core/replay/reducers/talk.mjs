// talk 域：谁说了什么。原文两半（人说的 turn / 我说的 reply），以及从原文里挑出来的要点。
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
  "turn": (doc, ev) => {        const session = sessionOf(doc, ev);
        session.turns.push({
          at: ev.at,
          who: ev.who,
          said: ev.said,
          did: ev.did ?? null,
          ...(ev.via === undefined ? {} : { via: ev.via, origin: ev.origin ?? null, mid: ev.mid ?? null }),
        });
        return;
  },
  "reply": (doc, ev) => {        const session = sessionOf(doc, ev);
        session.replies.push({
          at: ev.at,
          text: ev.text,
          ...(ev.via === undefined ? {} : { via: ev.via, origin: ev.origin ?? null, mid: ev.mid ?? null }),
        });
        return;
  },
  "point.add": (doc, ev) => {        const session = sessionOf(doc, ev);
        if (!/^P\d+$/u.test(String(ev.id))) noway(`要点号要写成 P1：${ev.id}`);
        // 更新同一个要点：同一个 id 再落一行，旧行留在账本里，重放只留最新那句。
        const source = ev.replaces ? session.points.find((one) => one.id === ev.replaces) : null;
        if (ev.replaces && !source) noway(`账本里没有要点 ${ev.replaces}：改要点要点名已有的那一条`);
        if (source) {
          if (source.absorbedBy) noway(`要点 ${source.id} 已经被 ${source.absorbedBy} 收编：它是议题的历史来源，改要开新议题`);
          session.points = session.points.filter((one) => one !== source);
          for (const t of session.topics) t.points = t.points.filter((one) => one !== source.id);
        } else if (taken(session, ev.id)) noway(`这个会话里已经有 ${ev.id} 了：改内容用同一个 id 再记一条（deed point ${ev.id} "…"）`);
        session.ids.add(ev.id);
        const wanted = ev.topic ?? source?.topic ?? null;
        let topic = null;
        if (wanted) {
          topic = session.topics.find((one) => one.id === wanted);
          if (!topic) noway(`账本里没有议题 ${wanted}：要点挂不上`);
          if (topic.state === "released") noway(`议题 ${topic.id} 已经锁定出口：新要点挂在它上面要开新议题`);
        }
        const absorbedBy = topic && topic.state === "established" ? topic.id : null;
        // 记下这条要点是「第几轮人话」：面板据此把议题卡上的号链回原文。
        // 只数到这条要点记下那一刻为止的 user 轮，晚来的轮次不倒填；老账本没有这个字段照读。
        const round = session.turns.filter((one) => one.who === "user" && one.at <= ev.at).length || null;
        session.points.push({
          id: ev.id, text: ev.text, at: ev.at,
          topic: topic ? topic.id : null, absorbedBy, round,
        });
        if (topic) topic.points.push(ev.id);
        return;
  },
};
