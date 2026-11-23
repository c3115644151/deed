#!/usr/bin/env node
// rebuild: 从空账本重放示例工作区。
// 只调用真实的 CLI 命令，不手写任何事件；时序与内容随运行变化，事件的种类与顺序不变。
// 用法：node examples/rebuild.mjs（从仓库根跑，或从 examples/contract 跑都行）

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const here = import.meta.dirname;
const root = path.join(here, "contract");
const cli = path.join(here, "..", "cli", "deed.mjs");
const deed = (...args) => {
  const out = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  if (out.status !== 0) {
    console.error("失败：" + ["deed", ...args].join(" ") + "\n" + (out.stderr || out.stdout));
    process.exit(1);
  }
  return out.stdout.trim();
};

// 账本是演示的产物，不是演示的输入：每次重放都从空目录开始。
fs.rmSync(path.join(root, ".deed"), { recursive: true, force: true });

deed("init", "--said", "给这个示例工作区接上 deed", "--review", ".deed/config.json,NOTES.md", "--exempt", "");
deed("tick", "--who", "user", "--said", "先做账本，别急着加门", "--did", "读了 README 与 DESIGN");

// 第一期：两条都交完，审查者放行就是结局，用户签收。
deed("task", "add", "接上这个工作区", "--criteria", "deed state 说得出这一期在做什么", "--files", ".deed/config.json");
deed("task", "done", "T1", "--evidence", "deed state 读出 S01 讨论态与 1 轮", "--digest", ".deed/config.json");
deed("task", "add", "写下这份示例在演示什么", "--criteria", "陌生人读 NOTES.md 就知道怎么照着走", "--files", "NOTES.md");
deed("task", "done", "T2", "--evidence", "照着 NOTES.md 走了一遍：六条命令都成功", "--digest", "NOTES.md");

deed("review", "--segment", "S01.1");
deed("review", "--segment", "S01.1", "--by", "reviewer:independent", "--verdict", "pass");
deed("sign", "--words", "可以，示例就这样", "--title", "示例账本立起来", "--by", "user");

// 第二期第一段：门与面板各一条，交完由审查者放行封段，下一批任务自然开新段。
deed("tick", "--who", "user", "--said", "再补一段：让门、打回、欠账各出现一次");
deed("task", "add", "让门说出失败在哪", "--criteria", "一条命令就能看到是哪条命令、退出码几", "--files", ".deed/config.json");
deed("task", "done", "T3", "--evidence", "deed gate 在空 gates 时说「这个工作区没有门」", "--digest", ".deed/config.json");
deed("task", "add", "让面板跟着账本动", "--criteria", "GET / 与渲染字节一致；SSE 推 change", "--files", ".deed/config.json");
deed("task", "done", "T4", "--evidence", "board 测试 6/6 · curl /state 200 · POST 405", "--digest", ".deed/config.json");
deed("review", "--segment", "S02.1");
deed("review", "--segment", "S02.1", "--by", "reviewer:independent", "--verdict", "pass");

// 第二段：审查者判不合格，点名 T5 退回；补完重新交付、重新出清单，再审。
deed("task", "add", "把说明和账本对上", "--criteria", "README 的六行能走完一整轮", "--files", "NOTES.md");
deed("task", "done", "T5", "--evidence", "按说明跑了一遍：init 到 sign", "--digest", "NOTES.md");
deed("review", "--segment", "S02.2");
deed("review", "--segment", "S02.2", "--by", "reviewer:independent", "--verdict", "fail", "--rework", "T5", "--why", "说明里没写 --digest，这条交付记录没记文件", "--finding", "说明里没写 --digest：那条交付记录没记文件，过期了查不出来");
deed("task", "done", "T5", "--evidence", "重跑：每条交付记录都记在一份文件上", "--digest", "NOTES.md");
deed("review", "--segment", "S02.2");
deed("review", "--segment", "S02.2", "--by", "reviewer:independent", "--verdict", "pass");

deed("ask", "示例账本要不要跟着示例一起提交？", "--reading", "一起提交：它是看得见的事实", "--why", "看不见的账本等于没有");
deed("ask", "resolve", "A1", "--decision", "一起提交，账本随仓库走");

// 第三段：一条延后、一条没交付，段开着——示意「下一步」怎么指人。
deed("task", "add", "给面板加跨会话历史", "--criteria", "能翻看已签收那一期的全部轮次", "--files", ".deed/config.json");
deed("task", "defer", "T6", "--why", "先把账本这件事稳住，页面等下一轮");
deed("task", "add", "让陌生人只读六行就能动手", "--criteria", "照 NOTES.md 从 init 走到 sign", "--files", "NOTES.md");
deed("tick", "--who", "agent", "--said", "打回的那一段补完了，说明也改了", "--did", "判过 S02.1、S02.2，重审后封段");
deed("ask", "这一段要不要现在审？", "--reading", "等 T7 交付再审", "--why", "还差一条没交付");

console.log(deed("state"));
console.log("");
console.log(deed("verify"));
