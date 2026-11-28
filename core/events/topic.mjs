// events/topic: 议题的三种行——创建、确认成立、确认出口。
import { need, MEANING, WHO, contextShape, meaningOf } from "./shape.mjs";

export const KINDS = ["topic.create","topic.establish","topic.release"];

export const VALIDATE = {
  "topic.create": (ev, meaning) => {
      if (meaningOf(ev) < MEANING.discussionTopics)
        throw new Error("topic.create 是含义第 27 版才有的事件：v 要写 " + MEANING.discussionTopics);
      need(ev, "id");
      need(ev, "title");
      if (ev.points !== undefined && !Array.isArray(ev.points))
        throw new Error("topic.create 的 points 要是数组");
      return;
  },
  "topic.establish": (ev, meaning) => {
      if (meaningOf(ev) < MEANING.discussionTopics)
        throw new Error("topic.establish 是含义第 27 版才有的事件：v 要写 " + MEANING.discussionTopics);
      need(ev, "id");
      need(ev, "body");
      need(ev, "by");
      if (ev.via !== "panel") throw new Error('议题成立只在面板上按：via 要写 "panel"');
      if (ev.points !== undefined && !Array.isArray(ev.points))
        throw new Error("topic.establish 的 points 要是数组");
      return;
  },
  "topic.release": (ev, meaning) => {
      if (meaningOf(ev) < MEANING.discussionTopics)
        throw new Error("topic.release 是含义第 27 版才有的事件：v 要写 " + MEANING.discussionTopics);
      need(ev, "id");
      need(ev, "by");
      if (ev.via !== "panel") throw new Error('议题锁定只在面板上按：via 要写 "panel"');
      return;
  },
};
