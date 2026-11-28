// session 域：一期怎么开、怎么结束；项目声明、审查设置、目的的改动也在这一域。
// 纯重放：doc 与 ev 进，改 doc；不读盘、不看时钟。
// 一个 kind 一个函数——加一类事实就是加一个函数，不改别人的分支。
import { meaningOf, MEANING } from "../../events/index.mjs";
import { noway } from "../../facts/errors.mjs";
import { sessionOf, taken } from "../../facts/session.mjs";
import { segmentById, segmentOf, nextSegment, nextOpen, settle, sealed, editable } from "../../facts/segment.mjs";
import { awaitingVerdict } from "../../facts/review.mjs";
import { taskOf, rederive, onTheSheet, lastResultOf, settledSince } from "../../facts/task.mjs";
import { awaitingJudgement } from "../../facts/review.mjs";

export const HANDLERS = {
  "project.declare": (doc, ev) => {        doc.project = {
          at: ev.at,
          by: ev.by ?? null,
          shape: ev.shape,
          background: ev.background ?? "",
          layers: (ev.layers ?? []).map((one) => {
            const dir = String(one.dir).replace(/^\/+|\/+$/gu, "");
            // 角色是"这个目录在范式里算哪一格"：目录名可以跟范式不一样（cli 是 app），
            // 但要说清它是哪一格，否则"结构对不对"就没有可判的东西。
            return {
              role: String(one.role ?? dir).replace(/^\/+|\/+$/gu, ""),
              dir,
              mayImport: Array.isArray(one.mayImport) ? [...one.mayImport] : [],
            };
          }),
          extras: (ev.extras ?? []).map((one) => String(one).replace(/^\/+|\/+$/gu, "")),
        };
        return;
  },
  "config.change": (doc, ev) => {        doc.changes.push({
          at: ev.at,
          key: ev.key,
          from: ev.from ?? null,
          to: ev.to,
          why: ev.why,
          by: ev.by ?? "user",
        });
        // The live threshold is a fact like any other. Judgments read it out of
        // this document, so the config file on disk is a mirror, not a source.
        doc.config = { ...(doc.config ?? {}), [ev.key]: ev.to };
        return;
  },
  "goal.set": (doc, ev) => {        const session = sessionOf(doc, ev);
        if (session.goal) session.goals.push(session.goal);
        session.goal = { text: ev.text, at: ev.at, by: ev.by, why: ev.why ?? null };
        return;
  },
  "sign": (doc, ev) => {        const session = sessionOf(doc, ev);
        if (ev.k === "sign") {
          const left = session.tasks.filter((one) => one.status === "todo" || one.status === "done");
          if (left.length > 0) noway(`还有没结清的：${left.map((one) => `${one.id} ${one.status}`).join("、")}`);
          session.title = ev.title;
          session.words = ev.words;
          session.closeKind = "signed";
          // 谁按的这一下、从哪按的：命令行不给这条路，账本要读得出是人按的。
          session.sign = { words: ev.words, by: ev.by ?? null, via: ev.via ?? null, at: ev.at };
        } else {
          session.closeKind = "shelved";
          session.words = ev.why;
        }
        session.closedAt = ev.at;
        return;
  },
  "shelve": (doc, ev) => {        const session = sessionOf(doc, ev);
        if (ev.k === "sign") {
          const left = session.tasks.filter((one) => one.status === "todo" || one.status === "done");
          if (left.length > 0) noway(`还有没结清的：${left.map((one) => `${one.id} ${one.status}`).join("、")}`);
          session.title = ev.title;
          session.words = ev.words;
          session.closeKind = "signed";
          // 谁按的这一下、从哪按的：命令行不给这条路，账本要读得出是人按的。
          session.sign = { words: ev.words, by: ev.by ?? null, via: ev.via ?? null, at: ev.at };
        } else {
          session.closeKind = "shelved";
          session.words = ev.why;
        }
        session.closedAt = ev.at;
        return;
  },
};
