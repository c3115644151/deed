#!/usr/bin/env node
// 命令面只做一件事：认出动词，把参数交给它。每个动词在自己的文件里，规则在 core/。
//
// 一个动作的顺序在动词里：先重放，再落盘。会被拒的动作一个字也不进账本，
// 所以一次手滑（交付两遍、判一个已封的段）不会把工作区写死。
import { currentVersion } from "../lib/version.mjs";
import { ensurePanel, panelOff } from "./panel.mjs";
import { ROOT, guard, reject } from "./session.mjs";
import { trace, takeRefusal, refused } from "./trace.mjs";
import { GROUPS, HEAD, ORDER, SPEC } from "./spec.mjs";
import init from "./verbs/init.mjs";
import say from "./verbs/say.mjs";
import reply from "./verbs/reply.mjs";
import point from "./verbs/point.mjs";
import topic from "./verbs/topic.mjs";
import project from "./verbs/project.mjs";
import plan from "./verbs/plan.mjs";
import submit from "./verbs/submit.mjs";
import review from "./verbs/review.mjs";
import sign from "./verbs/sign.mjs";
import state from "./verbs/state.mjs";
import check from "./verbs/check.mjs";
import debug from "./verbs/debug.mjs";
import serve from "./verbs/serve.mjs";
import panel from "./verbs/panel.mjs";

// 帮助按三种状态分组：讨论、执行、验收，后面是管理面。组是 SPEC 里的一处数据，
// 帮助不再手抄一遍清单。
const HELP = [
  ...HEAD,
  "",
  ...GROUPS.flatMap((group) => ["", "── " + group.title + " ──", ...group.verbs.flatMap((one) => SPEC[one].usage)]),
  "",
  "所有写操作都先重放后落盘：会被拒的动作一个字也不会进账本。",
].join("\n");

const commands = { init, say, reply, point, topic, project, check, debug, plan, submit, review, sign, state, serve, panel };
const began = performance.now();
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
    if (one && one.started) console.log("面板 · http://127.0.0.1:" + one.port);
    // 一个工作区只有一个面板：这一格被谁占着就说谁，绝不另开第二条页面。
    if (one && one.blocked && one.blocked.quiet !== true)
      console.log("deed: 面板没起来 —— " + one.blocked.why + "（端口 " + one.blocked.port + "）");
  } catch {
    // 面板起不来不该让命令失败：账本的事比页面重要。
  }
}
// An unknown verb is refused, not thrown: fail() raises, and the raise would
// reach the terminal as a stack trace with nobody left to swallow it.
// 改过名的动作：拒绝，并把新写法写在拒绝里。留着旧名比删掉更糟——
// 两条路通向同一件事，读账本的人就分不清哪条是真入口。
const MOVED = {
  tick: 'deed say "…"',
  goal: '把目的写在清单第一行（# 这一期要做成什么 下面那一句），deed submit 记账',
  seal: 'deed review --segment S01.1 --skip --why "…"',
  shelve: 'deed sign --shelve --why "…"',
  doctor: 'deed check --ledger',
  gate: 'deed check --gates',
  ask: '待裁这个概念不用了：讨论里的要点用 deed point "…"，要人确认的用议题两次按钮（deed topic + 面板）',
  // 条目不再是动词：加一条就是往 .deed/plan.md 里写一行，deed submit 一次记账；
  // 撤回与放弃也写在清单里（取消勾选 = 撤回，划掉并写理由 = 放弃）。
  task: "写清单：deed plan 编辑 .deed/plan.md，deed submit 一次记账；撤回就是把勾去掉，放弃就是划掉并写理由",
};
// 一处记账：动词、成没成、花了多久、用过的开关名（不含值）、被拒时的那一句。
// 只有这一个地方写：加一个动词不需要在别处补统计。
const stamp = (ok) =>
  trace(ROOT, {
    at: new Date().toISOString(),
    verb: verb ?? "",
    ok,
    ms: Math.round(performance.now() - began),
    switches: rest.filter((one) => one.startsWith("--")).map((one) => one.split("=")[0]),
    why: ok ? undefined : (takeRefusal() ?? null),
    v: currentVersion(),
  });
const command = commands[verb];
if (!command && MOVED[verb]) {
  const why = verb + " 已经改成 " + MOVED[verb] + "（deed help 看全部）";
  reject(why);
  refused(why);
  stamp(false);
  process.exit(1);
}
if (!command) {
  const why = "没有这个动作：" + verb + "（deed help 看全部）";
  reject(why);
  refused(why);
  stamp(false);
  process.exit(1);
}
try {
  guard(() => command(rest));
  stamp(process.exitCode !== 1);
} catch (err) {
  stamp(false);
  throw err;
}

