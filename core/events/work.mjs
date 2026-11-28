// events/work: 条目（task）相关的每一行。校验只查形状：写得对不对由 fold 判。
import { need, MEANING, WHO, contextShape } from "./shape.mjs";

export const KINDS = ["task.add","task.context","task.title","task.criteria","task.order","task.done","task.undo","task.defer","task.drop","task.carry","task.uncarry"];

export const VALIDATE = {
  "task.add": (ev, meaning) => {
      need(ev, "id");
      need(ev, "title");
      need(ev, "criteria");
      if (ev.order !== undefined && (!Number.isInteger(ev.order) || ev.order < 1))
        throw new Error("task.add 的 order 要是不小于 1 的整数：清单上写 先后：1");
      // 从议题里拆出来的条目带着议题号：它是这一条活从哪来的唯一记法。
      if (ev.topic !== undefined && ev.topic !== null && !/^I\d+$/u.test(String(ev.topic)))
        throw new Error("task.add 的 topic 要写成议题号 I1：" + ev.topic);
      contextShape(ev);
      return;
  },
  "task.context": (ev, meaning) => {
      need(ev, "id");
      if (ev.source === undefined) throw new Error("task.context 要写一行 依据：");
      contextShape(ev);
      return;
  },
  "task.title": (ev, meaning) => {
      need(ev, "id");
      need(ev, "title");
      return;
  },
  "task.criteria": (ev, meaning) => {
      need(ev, "id");
      need(ev, "criteria");
      need(ev, "why");
      if (typeof ev.criteria !== "string" || ev.criteria.trim() === "")
        throw new Error("task.criteria 要把标准写成一句话");
      return;
  },
  "task.order": (ev, meaning) => {
      need(ev, "id");
      if (!Number.isInteger(ev.order) || ev.order < 1)
        throw new Error("task.order 的 order 要是不小于 1 的整数：清单上写 先后：1");
      return;
  },
  "task.done": (ev, meaning) => {
      need(ev, "id");
      need(ev, "evidence");
      need(ev, "by");
      if (ev.changed !== undefined && !Array.isArray(ev.changed))
        throw new Error("task.done 的 changed 要是路径数组");
      // 内容指纹：同一路径换成同尺寸的另一份，字节数看不出来，指纹看得出来。
      // 它不作门，只让当场核对与"交付记录过期"有东西可比。
      if (ev.sha !== undefined) {
        if (typeof ev.sha !== "object" || ev.sha === null || Array.isArray(ev.sha))
          throw new Error("task.done 的 sha 要是 {路径: 指纹}");
        for (const [file, one] of Object.entries(ev.sha))
          if (typeof one !== "string" || one.length < 8) throw new Error("task.done 的 sha 里 " + file + " 不是指纹");
      }
      if (ev.bytes !== undefined) {
        if (typeof ev.bytes !== "object" || ev.bytes === null || Array.isArray(ev.bytes))
          throw new Error("task.done 的 bytes 要是 {路径: 字节数}");
        for (const [file, size] of Object.entries(ev.bytes))
          if (!Number.isFinite(size) || size < 0) throw new Error("task.done 的 bytes 里 " + file + " 不是字节数");
      }
      // 一批交付记的是这一批的时刻与几条：条数写进账本，撤回同批的一条之后
      // 清单仍说得出原本几条，而不是拿剩下的数现算。
      if (ev.batch !== undefined) {
        const one = ev.batch;
        if (!one || typeof one !== "object" || Array.isArray(one))
          throw new Error("task.done 的 batch 要是 {at, size}");
        if (typeof one.at !== "string" || !Number.isInteger(one.size) || one.size < 2)
          throw new Error("task.done 的 batch 要有 at 与不少于 2 的 size");
      }
      // 数由工具采：交付时跑过的那条命令、它的退出码与它自己报的条数。
      // 账本里有这一格，清单与面板上的数才有出处，不是从我抄来的。
      if (ev.run !== undefined) {
        const one = ev.run;
        if (!one || typeof one !== "object" || Array.isArray(one))
          throw new Error("task.done 的 run 要是 {command, exit, tests, pass, fail}");
        if (typeof one.command !== "string" || one.command === "")
          throw new Error("task.done 的 run.command 要是那条命令的原文");
        if (!Number.isInteger(one.exit)) throw new Error("task.done 的 run.exit 要是退出码");
        for (const key of ["tests", "pass", "fail"])
          if (one[key] !== null && !Number.isInteger(one[key]))
            throw new Error("task.done 的 run." + key + " 要是条数或 null");
        // 数站在哪一份字节上：指纹与时刻。没有它们就没法判断下一次能不能复用，
        // 也就分不出"同一份字节上的真跑"与"抄来的一句话"。
        if (one.fingerprint !== undefined && typeof one.fingerprint !== "string")
          throw new Error("task.done 的 run.fingerprint 要是那段字节的指纹");
        if (one.at !== undefined && !/^\d{4}-\d{2}-\d{2}T/.test(String(one.at)))
          throw new Error("task.done 的 run.at 要是 ISO 时刻");
        if (one.reused !== undefined && typeof one.reused !== "boolean")
          throw new Error("task.done 的 run.reused 要是 true/false");
      }
      if (ev.files !== undefined) {
        if (!Array.isArray(ev.files)) throw new Error("task.done 的 files 要是 [{ path }] 数组");
        for (const one of ev.files) {
          if (!one || typeof one.path !== "string") throw new Error("task.done 的 files 每一项都要有 path");
        }
      }
      // 说得出会看到什么的那几条，真跑过才算数：账本记下命令与它必须印出的那段话。
      if (ev.expects !== undefined) {
        if (!Array.isArray(ev.expects) || ev.expects.length === 0)
          throw new Error("task.done 的 expects 要是 [{command, want}]");
        for (const one of ev.expects) {
          if (!one || typeof one !== "object" || Array.isArray(one))
            throw new Error("task.done 的 expects 一条要写成 {command, want}");
          if (typeof one.command !== "string" || one.command === "")
            throw new Error("task.done 的 expects 里那条命令要是原文");
          if (typeof one.want !== "string" || one.want === "")
            throw new Error("task.done 的 expects 里那条期望要是原文");
        }
      }
      return;
  },
  "task.undo": (ev, meaning) => {
      need(ev, "id");
      need(ev, "why");
      // 撤的是哪份字节，撤的那一刻就得写下来：重放再去推，等于让后来的形状改口。
      if (ev.undoes !== undefined) {
        if (!Array.isArray(ev.undoes)) throw new Error("task.undo 的 undoes 要是数组");
        for (const one of ev.undoes) {
          if (!one || typeof one.path !== "string") throw new Error("task.undo 的 undoes 每一项都要有 path");
        }
      }
      return;
  },
  "task.defer": (ev, meaning) => {
  },
  "task.drop": (ev, meaning) => {
      need(ev, "id");
      need(ev, "why");
      return;
  },
  "task.carry": (ev, meaning) => {
      need(ev, "id");
      return;
  },
  "task.uncarry": (ev, meaning) => {
      need(ev, "id");
      need(ev, "why");
      return;
  },
};
