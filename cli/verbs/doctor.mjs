import fs from "node:fs";
import path from "node:path";
import { fold } from "../../core/fold.mjs";
import { UnknownKindError, validateEvent } from "../../core/events.mjs";
import { currentVersion, unknownKindNotice } from "../../lib/version.mjs";
import { paths } from "../../lib/store.mjs";
import { stamp0 } from "../../lib/format.mjs";
import { wordsNotice } from "../../lib/words.mjs";
import { hookNotice, silenceNotice } from "../../lib/heartbeat.mjs";
import { ROOT, parse, load, lateWork, fail, guard, split } from "../session.mjs";

export default function doctor(argv) {
    parse(argv, "doctor");
    guard(() => {
      const p = paths(ROOT);
      if (!fs.existsSync(p.log)) {
        console.log("没有账本：deed init 之后才有");
        return;
      }
      const files = fs
        .readdirSync(p.log)
        .filter((name) => /^\d{4}-\d{2}\.jsonl$/.test(name))
        .sort();
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
            bad = {
              file: name,
              line: i + 1,
              why: notice ? notice.headline : err.message,
              advice: notice?.advice ?? null,
              newer: notice?.newer ?? false,
            };
            break;
          }
          events.push(ev);
        }
        if (bad) break;
      }
      if (!bad) {
        console.log("账本干净 · " + events.length + " 条事件都能重放");
        const { doc } = load();
        const late = lateWork(ROOT, doc);
        if (late && late.length > 0)
          console.log(
            "  先做后记 " + late.length + " 条（不算坏账）：" +
              late.map((one) => one.id + " 的 " + one.path + " 最后写于 " + stamp0(one.written) + "，这条任务记于 " + stamp0(one.recorded)).join("；"),
          );
        const words = wordsNotice(ROOT);
        if (words) console.log("  接入 · " + words);
        const last = events[events.length - 1];
        const silence = silenceNotice(last?.at, stamp0);
        console.log("  心跳 · " + hookNotice(ROOT) + (silence ? " · " + silence : ""));
        return;
      }
      // 账本比程序新不是坏账：这一行是别人写下的真事，只是这本程序读不懂。
      // 两种情形的动作相反（升级 vs 挪走），所以不能共用一套话。
      if (bad.newer) {
        console.log("账本比 deed 新 · " + bad.file + " 第 " + bad.line + " 行");
        console.log("  " + bad.why);
        console.log("  " + bad.advice);
        fail("先升级 deed 再读这本账：当前版本读不动的类型只在更新的账本里才有");
        return;
      }
      console.log("账本坏了 · " + bad.file + " 第 " + bad.line + " 行 · " + bad.why);
      if (bad.advice) {
        console.log("  " + bad.advice);
      } else {
        console.log("  账本只追加，唯一允许的人工修法是把这一行整行移到 .deed/log/rejected/ 下并记下为什么；");
        console.log("  不要改动其它行，也不要手写补账：缺的那件事，用正常命令重新做一次。");
      }
      fail("坏账需要人处理：" + bad.file + " 第 " + bad.line + " 行");
    });
};
