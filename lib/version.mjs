// 版本：账本可能比手上的程序新。这不是猜想——每一行都记着两样东西：
// 写它的 deed 版本（w）和写它的那一套含义（v）。读到不认得的类型时先比 v：
// 行比程序新→账本新，升级即可；v 也不超前，才可能是这一行被手写或被改过。
//
// 这条比较只发生在 CLI 层：core 不认识 package.json，fold 也不许读文件。
import fs from "node:fs";
import path from "node:path";
import { EVENT_VERSION } from "../core/events/index.mjs";

let cached = null;

export function currentVersion() {
  if (cached !== null) return cached;
  cached = "";
  try {
    const file = path.join(import.meta.dirname, "..", "package.json");
    const text = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof text.version === "string") cached = text.version.trim();
  } catch {
    // 读不出来就说读不出来：比"假装 0.0.0"诚实，也比悄悄当成坏账安全。
    cached = "";
  }
  return cached;
}

const PARTS = /^(\d+)\.(\d+)\.(\d+)$/;

// 只比三段数字。预发布标记（-rc.1）不参与排序：解析不了就是解析不了，
// 返回 null，调用方据此只说事实、不做判定。
export function compareVersions(left, right) {
  const a = PARTS.exec(String(left ?? ""));
  const b = PARTS.exec(String(right ?? ""));
  if (!a || !b) return null;
  for (let i = 1; i <= 3; i += 1) {
    const one = Number(a[i]);
    const two = Number(b[i]);
    if (one !== two) return one > two ? 1 : -1;
  }
  return 0;
}

// 读到不认得的事件类型时，只回答一件事：这是账本比程序新，还是这一行有问题。
// 两种走法恰好相反——前者不能删，后者只能挪走。
//
// 先比含义版本：那是行自己说的话，比"写者版本恰好相同"更硬。旧程序（同一个
// 版本号、更少的事件类型）遇到新类型时说"删掉"，就是这里漏了这一步。
export function unknownKindNotice(kind, writer, current = currentVersion(), meaning = null, mine = EVENT_VERSION) {
  const line = Number(meaning);
  if (Number.isInteger(line) && line > mine) {
    return {
      newer: true,
      headline: `账本比 deed 新：${kind} 是事件含义第 ${line} 版写的，当前只认得第 ${mine} 版`,
      advice: "这不是坏账，别删也别挪——升级 deed（认到这一版或更新）就能读出这一行。",
    };
  }
  const order = compareVersions(writer, current);
  if (order === 1) {
    return {
      newer: true,
      headline: `账本比 deed 新：${kind} 是 deed ${writer} 写的，当前 ${current} 还不认得`,
      advice: `这不是坏账，别删也别挪——升级 deed（${writer} 或更高）就能读出这一行。`,
    };
  }
  const named = writer ? `写者版本 ${writer}` : "没有写者版本";
  const stamp = current || "读不出当前版本";
  const said = Number.isInteger(line) ? `含义第 ${line} 版，当前第 ${mine} 版` : "没写含义版本";
  return {
    newer: false,
    headline: `读不懂的一行：事件类型 ${kind}（${named}，${stamp}；${said}）`,
    advice:
      "事件类型只增不减，含义版本也不超前：写者不比当前新却出现陌生类型，只可能是手写或被改过——把这一行整行移到 .deed/log/rejected/ 并记下为什么。",
  };
}
