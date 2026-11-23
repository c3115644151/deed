import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/digest.mjs";
import { tasksIn } from "../core/rules.mjs";
import { ensureDirs } from "../lib/store.mjs";
import { fileStamp, stamp0 } from "../lib/format.mjs";

// 审查任务书是唯一落到账本外、又要交给别人的纸：它要先算好文件名与
// sha256（plan），再在账本收下这条事实时才写盘（write）。中间失败，
// 磁盘上什么也不留。

export function planBrief(root, open, segment, at) {
  const p = ensureDirs(root);
  const tasks = tasksIn(open, segment);
  const text = [
    "# 审查任务书 · " + segment.id,
    "",
    "会话 " + open.id + " · 段 " + segment.id + " · " + tasks.length + " 条 · 生成于 " + stamp0(at),
    "",
    "## 要审的承诺",
    "",
    ...tasks.flatMap((task) => [
      "### " + task.id + " · " + task.title,
      "",
      "- 做完的标准：" + task.criteria,
      "- 触及路径：" + (task.files.length === 0 ? "（未声明，按要审算）" : task.files.join("、")),
      "- 状态：" + task.status,
      ...task.evidence.map((proof) => "- 证据：" + (proof.claim ?? "") + "（" + proof.by + " · " + stamp0(proof.at) + "）"),
      "",
    ]),
    "## 怎么审",
    "",
    "1. 对每条标准，看证据够不够证明它达成；没证据就是没达成。",
    "2. 只看这一段的任务，不替它补未来的事。",
    "3. 结论落盘：deed review --segment " + segment.id + " --by \"<你是谁>\" --verdict pass|fail --finding \"<不合格的那几条>\"",
    "",
    "这份文件已经记进账本（review.brief + sha256）：改了它再落结论会被拒。",
    "",
  ].join("\n");
  let file = path.join(p.review, segment.id + "-" + fileStamp(at) + ".md");
  for (let n = 2; fs.existsSync(file); n += 1)
    file = path.join(p.review, segment.id + "-" + fileStamp(at) + "-" + n + ".md");
  return { file, text, digest: digest(text) };
}

export function writeBrief(plan, brief) {
  fs.writeFileSync(plan.file, plan.text, "utf8");
  return brief;
}

