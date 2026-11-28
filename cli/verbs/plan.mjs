import fs from "node:fs";
import path from "node:path";
import { ensureDirs, rel } from "../../lib/store.mjs";
import { draft as planDraft } from "../plan.mjs";
import { ROOT, parse, load, targetSession, fail, guard } from "../session.mjs";

// 清单：人和 agent 改同一份文件，submit 一次记账。命令面因此只剩一个入口，
// 而「改了什么」由工作区快照自己称——清单上不写路径，也不写 sha256。
//
// 两个时候用得上：这一期还没有清单时写一份；清单被手改坏了（解析不了、或者某条的交付行
// 被删掉）时按账本重画一份——没有这一步，坏掉的那份只能靠人记得原本写的是什么。
export default function plan(argv) {
  const { flags } = parse(argv, "plan");
  guard(() => {
    const { doc } = load();
    const one = targetSession(doc, flags);
    const file = path.join(ROOT, ".deed", "plan.md");
    if (fs.existsSync(file) && !flags.redo)
      fail("清单已经在 " + rel(ROOT, file) + "：直接改它，改完 deed submit；要按账本重画一份就加 --redo（手改坏了的时候用）");
    ensureDirs(ROOT);
    fs.writeFileSync(file, planDraft(one) + "\n", "utf8");
    console.log((flags.redo && fs.existsSync(file) ? "重画" : "清单") + " · " + rel(ROOT, file) + " · " + one.id + " · " + one.tasks.length + " 条");
    console.log("  改它，再 deed submit。写法印在文件头部。");
  });
}
