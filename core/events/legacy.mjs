// events/legacy: 只读。旧账本里还有这几种行，命令面已经不再产生它们。
import { need, MEANING, WHO, contextShape, meaningOf } from "./shape.mjs";

export const KINDS = ["ask.raise","ask.resolve","ask.withdraw"];

export const VALIDATE = {
  "ask.raise": (ev, meaning) => {
      if (meaningOf(ev) >= MEANING.askRetired)
        throw new Error("ask.raise 已经不存在：待裁只是用户两次确认议题时的交流，不再是账本里的对象");
      need(ev, "id");
      need(ev, "text");
      need(ev, "reading");
      // 第 26 版起题不再收 --why：说不确定的那句话就在 reading 里，再多一处只会两边对不上。
      if (meaningOf(ev) < MEANING.askNoWhy) need(ev, "why");
      return;
  },
  "ask.resolve": (ev, meaning) => {
      if (meaningOf(ev) >= MEANING.askRetired)
        throw new Error("ask.resolve 已经不存在：待裁只是用户两次确认议题时的交流，不再是账本里的对象");
      need(ev, "id");
      need(ev, "decision");
      return;
  },
  "ask.withdraw": (ev, meaning) => {
      if (meaningOf(ev) >= MEANING.askRetired)
        throw new Error("ask.withdraw 已经不存在：待裁只是用户两次确认议题时的交流，不再是账本里的对象");
      need(ev, "id");
      need(ev, "why");
      return;
  },
};
