// 版本：账本可能比手上的程序新。这不是猜想——每一行都记着写它的 deed 版本
// （w 字段），读到不认得的类型时，比一比就能说清是"账本新"还是"这一行坏了"。
//
// 这条比较只发生在 CLI 层：core 不认识 package.json，fold 也不许读文件。
import fs from "node:fs";
import path from "node:path";

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
export function unknownKindNotice(kind, writer, current = currentVersion()) {
  const order = compareVersions(writer, current);
  if (order === 1) {
    return {
      newer: true,
      headline: `账本比 deed 新：${kind} 是 deed ${writer} 写的，当前 ${current} 还不认得`,
      advice: `这不是坏账，别删也别挪——升级 deed（${writer} 或更高）就能读出这一行。`,
    };
  }
  const named = writer ? `写者版本 ${writer}` : "没有写者版本";
  const mine = current || "读不出当前版本";
  return {
    newer: false,
    headline: `读不懂的一行：事件类型 ${kind}（${named}，${mine}）`,
    advice:
      "事件类型只增不减：写者不比当前新却出现陌生类型，只可能是手写或被改过——把这一行整行移到 .deed/log/rejected/ 并记下为什么。",
  };
}
