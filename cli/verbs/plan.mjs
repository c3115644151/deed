import fs from "node:fs";
import path from "node:path";
import { ensureDirs, rel } from "../../lib/store.mjs";
import { draft as planDraft } from "../plan.mjs";
import { ROOT, parse, load, targetSession, fail, guard } from "../session.mjs";

// 清单：人和 agent 改同一份文件，submit 一次记账。命令面因此只剩一个入口，
// 而「改了什么」由工作区快照自己称——清单上不写路径，也不写 sha256。
//
// 这个动词只做一件事：这一期还没有清单时写一份。语法写在那份文件的头部注释里，
// 不另设打印命令；要再出一份按账本画过的，submit 记账之后自己会重画。
export default function plan(argv) {
  const { flags } = parse(argv, "plan");
  guard(() => {
    const { doc } = load();
    const one = targetSession(doc, flags);
    const file = path.join(ROOT, ".deed", "plan.md");
    if (fs.existsSync(file)) fail("清单已经在 " + rel(ROOT, file) + "：直接改它，改完 deed submit（记账之后这份会按账本重画一遍）");
    ensureDirs(ROOT);
    fs.writeFileSync(file, planDraft(one) + "\n", "utf8");
    console.log("清单 · " + rel(ROOT, file) + " · " + one.id + " · " + one.tasks.length + " 条");
    console.log("  改它，再 deed submit。写法印在文件头部。");
  });
}
