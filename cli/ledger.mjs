import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fold } from "../core/fold.mjs";
import { UnknownKindError, validateEvent } from "../core/events.mjs";
import { currentVersion, unknownKindNotice } from "../lib/version.mjs";
import { paths } from "../lib/store.mjs";
import { stamp0 } from "../lib/format.mjs";
import { wordsNotice } from "../lib/words.mjs";
import { hookNotice, silenceNotice } from "../lib/heartbeat.mjs";
import { load, fail } from "./session.mjs";

// 账本校验：逐行读、逐行重放。账本比程序新不是坏账（那样的话动作是升级）；
// 坏账只有一种修法：把那一行移到 .deed/log/rejected/ 下，记下为什么。
export function checkLedger(ROOT) {
  const p = paths(ROOT);
  if (!fs.existsSync(p.log)) {
    console.log("没有账本：deed init 之后才有");
    return 0;
  }
  const files = fs.readdirSync(p.log).filter((name) => /^\d{4}-\d{2}\.jsonl$/.test(name)).sort();
  const events = [];
  let bad = null;
  for (const name of files) {
    const lines = fs.readFileSync(path.join(p.log, name), "utf8").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].trim()) continue;
      let ev;
      try {
        ev = JSON.parse(lines[i]);
      } catch {
        bad = { file: name, line: i + 1, why: "这一行不是合法 JSON" };
        break;
      }
      try {
        validateEvent(ev, ev.at);
        fold([...events, ev]);
      } catch (err) {
        const notice = err instanceof UnknownKindError ? unknownKindNotice(err.kind, err.writer, currentVersion(), err.meaning) : null;
        bad = { file: name, line: i + 1, why: notice ? notice.headline : err.message, advice: notice?.advice ?? null, newer: notice?.newer ?? false };
        break;
      }
      events.push(ev);
    }
    if (bad) break;
  }
  if (!bad) {
    console.log("账本干净 · " + events.length + " 条事件都能重放");
    const { doc } = load();
    const words = wordsNotice(ROOT);
    if (words) console.log("  接入 · " + words);
    const last = events[events.length - 1];
    const silence = silenceNotice(last?.at, stamp0);
    console.log("  心跳 · " + hookNotice(ROOT) + (silence ? " · " + silence : ""));
    return 0;
  }
  if (bad.newer) {
    console.log("账本比 deed 新 · " + bad.file + " 第 " + bad.line + " 行");
    console.log("  " + bad.why);
    console.log("  " + bad.advice);
    fail("先升级 deed 再读这本账：当前版本读不动的类型只在更新的账本里才有");
  }
  console.log("账本坏了 · " + bad.file + " 第 " + bad.line + " 行 · " + bad.why);
  if (bad.advice) console.log("  " + bad.advice);
  else {
    console.log("  账本只追加，唯一允许的人工修法是把这一行整行移到 .deed/log/rejected/ 下并记下为什么；");
    console.log("  不要改动其它行，也不要手写补账：缺的那件事，用正常命令重新做一次。");
  }
  fail("坏账需要人处理：" + bad.file + " 第 " + bad.line + " 行");
}

// 门归宿主：deed 知道名单与顺序，不知道"过"是什么意思。跑门是这里唯一做的事。
export function checkGates(ROOT, words, config) {
  const declared = Object.entries(config?.gates ?? {}).filter(([, commands]) => Array.isArray(commands) && commands.length > 0);
  const wanted = words.length > 0 ? words.map((name) => [name, config?.gates?.[name]]) : declared;
  if (wanted.length === 0)
    fail("这个工作区没有门：先在 .deed/config.json 的 gates 里写上命令（例如 { \"gates\": { \"commit\": [\"npm test\"] } }），再用 deed init --force --why \"加门\" 把它记进账本");
  for (const [name, commands] of wanted) {
    if (!Array.isArray(commands) || commands.length === 0)
      fail("门 " + name + " 没写命令：账本里的 gates." + name + " 是空数组（改文件后用 deed init --force --why 收进账本）");
    for (const command of commands) {
      console.log("门 " + name + " · " + command);
      const done = spawnSync(command, { cwd: ROOT, shell: true, stdio: "inherit" });
      if (done.status !== 0) fail("门 " + name + " 没过：" + command + "（退出码 " + (done.status ?? ("信号 " + done.signal)) + "）");
    }
    console.log("门 " + name + " 过 · " + commands.length + " 条命令");
  }
  return 0;
}
