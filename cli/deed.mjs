#!/usr/bin/env node
// 命令面只做一件事：认出动词，把参数交给它。每个动词在自己的文件里，规则在 core/。
//
// 一个动作的顺序在动词里：先重放，再落盘。会被拒的动作一个字也不进账本，
// 所以一次手滑（交付两遍、判一个已封的段）不会把工作区写死。
import { currentVersion } from "../lib/version.mjs";
import { ensurePanel, panelOff } from "./panel.mjs";
import { ROOT, guard, reject } from "./session.mjs";
import { HEAD, ORDER, SPEC } from "./spec.mjs";
import init from "./verbs/init.mjs";
import tick from "./verbs/tick.mjs";
import task from "./verbs/task.mjs";
import ask from "./verbs/ask.mjs";
import goal from "./verbs/goal.mjs";
import plan from "./verbs/plan.mjs";
import submit from "./verbs/submit.mjs";
import review from "./verbs/review.mjs";
import seal from "./verbs/seal.mjs";
import sign from "./verbs/sign.mjs";
import shelve from "./verbs/shelve.mjs";
import state from "./verbs/state.mjs";
import doctor from "./verbs/doctor.mjs";
import gate from "./verbs/gate.mjs";
import serve from "./verbs/serve.mjs";
import panel from "./verbs/panel.mjs";

const HELP = [...HEAD, ...ORDER.flatMap((one) => SPEC[one].usage), "", "所有写操作都先重放后落盘：会被拒的动作一个字也不会进账本。"].join("\n");

const commands = { init, tick, task, ask, goal, plan, submit, review, seal, sign, shelve, state, doctor, gate, serve, panel };
const [verb, ...rest] = process.argv.slice(2);
// HELP 里有的动词不带参数（state、doctor），那一行没有尾空格；
// 要求尾空格会把它们漏掉，再回落成整本帮助。
const usageOf = (one) => SPEC[one]?.usage ?? [];
// `deed review --help` used to hand out a brief: asking what a verb takes is
// not asking it to do the thing.
if (rest.some((one) => one === "--help" || one === "-h")) {
  const lines = usageOf(verb);
  console.log(lines.length > 0 ? [lines[0], ...lines.slice(1)].join("\n") : HELP);
  process.exit(0);
}
if (!verb || verb === "help" || verb === "--help") {
  console.log(HELP);
  process.exit(0);
}
// Asked before the verb table: this is the program talking about itself, and a
// missing answer is the first thing a fresh install trips over.
if (verb === "--version" || verb === "-v" || verb === "version") {
  console.log(currentVersion());
  process.exit(0);
}
// 面板跟着命令走，不跟着开机走：你要用它的那一下，页面应该在；没人用它的时候
// 它没有理由占着一格端口。serve 与 panel 自己不算（它们就是在做这件事）；
// 还没接 deed 的目录由 ensurePanel 自己放过（没账本就没页面），不在这里另立一条。
if (!panelOff() && verb !== "serve" && verb !== "panel") {
  try {
    const one = await ensurePanel(ROOT);
    if (one && one.started) {
      if (one.fellBack) console.log("deed: 端口 " + one.asked + " 被占着；面板改开在 " + one.port);
      console.log("面板 · http://127.0.0.1:" + one.port);
    }
  } catch {
    // 面板起不来不该让命令失败：账本的事比页面重要。
  }
}
// An unknown verb is refused, not thrown: fail() raises, and the raise would
// reach the terminal as a stack trace with nobody left to swallow it.
const command = commands[verb];
if (!command) reject("没有这个动作：" + verb + "（deed help 看全部）");
else guard(() => command(rest));

