// events/segment: 段的开与关，以及旧账本里 judge.* 那两种结局。
import { need, MEANING, WHO, contextShape, meaningOf } from "./shape.mjs";

export const KINDS = ["segment.plan","segment.seal","judge.pass","judge.rework"];

export const VALIDATE = {
  "segment.plan": (ev, meaning) => {
      need(ev, "segment");
      if (!/^S\d+\.\d+$/u.test(String(ev.segment))) throw new Error("segment.plan 的段号要写成 S01.1：" + ev.segment);
      if (meaningOf(ev) < MEANING.segmentsPlanned)
        throw new Error("segment.plan 是含义第 24 版才有的事件：v 要写 " + MEANING.segmentsPlanned);
      return;
  },
  "segment.seal": (ev, meaning) => {
      need(ev, "segment");
      need(ev, "why");
      need(ev, "by");
      return;
  },
  "judge.pass": (ev, meaning) => {
      need(ev, "segment");
      need(ev, "by");
      return;
  },
  "judge.rework": (ev, meaning) => {
      need(ev, "segment");
      need(ev, "why");
      // Tearing up a verdict is a decision about someone else's work: it needs
      // the same signature as handing one out, or the record shows who judged
      // and never who overruled.
      need(ev, "by");
      return;
  },
};
