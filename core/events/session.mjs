// events/session: 一期怎么开、怎么结束；项目声明与审查设置的改动也在这里。
import { need, MEANING, WHO, contextShape, meaningOf } from "./shape.mjs";

export const KINDS = ["project.declare","config.change","sign","shelve","goal.set"];

export const VALIDATE = {
  "project.declare": (ev, meaning) => {
      if (meaningOf(ev) < MEANING.projectDeclared)
        throw new Error("project.declare 是含义第 25 版才有的事件：v 要写 " + MEANING.projectDeclared);
      need(ev, "shape");
      if (typeof ev.shape !== "string" || ev.shape.trim() === "") throw new Error("project.declare 缺少 shape");
      for (const layer of ev.layers ?? []) {
        if (!layer || typeof layer.dir !== "string" || layer.dir.trim() === "")
          throw new Error("project.declare 的每一层都要写 dir：收到 " + JSON.stringify(layer));
        if (layer.role !== undefined && typeof layer.role !== "string")
          throw new Error("project.declare 的 role 要是一个名字：" + JSON.stringify(layer.role));
        if (layer.mayImport !== undefined && !Array.isArray(layer.mayImport))
          throw new Error("project.declare 的 mayImport 要是数组：" + JSON.stringify(layer.mayImport));
      }
      if (ev.extras !== undefined && !Array.isArray(ev.extras))
        throw new Error("project.declare 的 extras 要是数组：" + JSON.stringify(ev.extras));
      if (ev.background !== undefined && typeof ev.background !== "string")
        throw new Error("project.declare 的 background 要是一段文字");
      return;
  },
  "config.change": (ev, meaning) => {
      need(ev, "key");
      if (ev.to === undefined) throw new Error("事件 config.change 缺少 to");
      need(ev, "why");
      return;
  },
  "sign": (ev, meaning) => {
      if (meaningOf(ev) >= MEANING.gates) {
        need(ev, "by");
        if (ev.via !== "panel") throw new Error('sign 只在面板上按：via 要写 "panel"');
      }
      need(ev, "words");
      need(ev, "title");
      return;
  },
  "shelve": (ev, meaning) => {
      need(ev, "why");
      return;
  },
  "goal.set": (ev, meaning) => {
      need(ev, "text");
      need(ev, "by");
      return;
  },
};
