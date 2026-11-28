// events/talk: 谁说了什么。turn 是人开口的那一轮，reply 是我这一侧的原话，point 是从原文里挑出来的要点。
import { need, MEANING, WHO, contextShape, meaningOf } from "./shape.mjs";

export const KINDS = ["reply","turn","point.add"];

export const VALIDATE = {
  "reply": (ev, meaning) => {
      need(ev, "text");
      if (typeof ev.text !== "string" || ev.text.trim() === "")
        throw new Error("reply 的 text 要写成一句话：空的那一句不是话");
      if (ev.via !== undefined && typeof ev.via !== "string") throw new Error("reply 的 via 要写成一句话（例如 hook）");
      if (ev.via === "hook" && typeof ev.mid !== "string")
        throw new Error("钩子交来的回复要带 mid：没有消息号，重复交来的一句没法认出来");
      return;
  },
  "turn": (ev, meaning) => {
      need(ev, "who");
      // 第 12 版起轮次只记人开口的那一轮。旧行里的 agent 轮照读：
      // 拿新规矩去核旧行，会把当时合法的历史全判成坏账（doctor 会逐行核）。
      if (meaning >= MEANING.userOnlyRounds && !WHO.includes(ev.who))
        throw new Error(`轮次只记你和用户之间的一轮：你自己的进展写进交付记录或结论，不记成轮次（deed say 只写人开口的那一轮）`);
      need(ev, "said");
      // 空参数会被有些 shell 吞掉（PowerShell 5.1 会把 --did "" 变成裸开关），
      // 于是 did 落成 true，账本读起来像"这轮做过事"。类型也要查：这不是记轮的人
      // 说错了，是一行会被误读的事实。
      if (ev.did !== undefined && typeof ev.did !== "boolean" && typeof ev.did !== "string")
        throw new Error("turn 的 did 要写成一句话，或者 true/false");
      // 第 29 版起原文可以由宿主交来：通道（via）、谁交的（origin）、它的消息号（mid）。
      // mid 是重复交来的同一句的认据——没有它，钩子重启一次就会把同一句记两遍。
      if (meaning >= MEANING.turnOrigin) {
        if (ev.via !== undefined && typeof ev.via !== "string")
          throw new Error("turn 的 via 要写成一句话（例如 hook）");
        if (ev.origin !== undefined && typeof ev.origin !== "string")
          throw new Error("turn 的 origin 要写成一句话（例如 dsh）");
        if (ev.mid !== undefined && typeof ev.mid !== "string")
          throw new Error("turn 的 mid 要写成一句话：它是宿主给这条消息的号");
        if (ev.via === "hook" && typeof ev.mid !== "string")
          throw new Error("钩子交来的原文要带 mid：没有消息号，重复交来的一句没法认出来");
      }
      return;
  },
  "point.add": (ev, meaning) => {
      if (meaningOf(ev) < MEANING.discussionTopics)
        throw new Error("point.add 是含义第 27 版才有的事件：v 要写 " + MEANING.discussionTopics);
      need(ev, "id");
      need(ev, "text");
      if (ev.by !== undefined)
        throw new Error("要点不记名字：它是从这一轮里留下的判断，不是谁交的活");
      return;
  },
};
