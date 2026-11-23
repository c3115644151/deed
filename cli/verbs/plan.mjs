import fs from "node:fs";
import path from "node:path";
import { ensureDirs, rel } from "../../lib/store.mjs";
import { FORMAT as PLAN_FORMAT, draft as planDraft } from "../plan.mjs";
import { ROOT, parse, load, targetSession, fail, guard } from "../session.mjs";

export default function plan(argv) {

  // 清单：人和 agent 改同一份文件，submit 一次落账。命令面因此只剩一个入口，
  // 而「改了什么」由工作区快照自己称——清单上不写路径，也不写 sha256。
    const { flags } = parse(argv, "plan");
    guard(() => {
      if (flags.format) {
        console.log(PLAN_FORMAT);
        return;
      }
      const { doc } = load();
      const one = targetSession(doc, flags);
      const text = planDraft(one);
      if (flags.print) {
        console.log(text);
        return;
      }
      const file = path.join(ROOT, ".deed", "plan.md");
      if (fs.existsSync(file) && !flags.force)
        fail("清单已经在 " + rel(ROOT, file) + "：改它，改完 deed submit（要按账本重出一份，加 --force）");
      ensureDirs(ROOT);
      fs.writeFileSync(file, text + "\n", "utf8");
      console.log("清单 · " + rel(ROOT, file) + " · " + one.id + " · " + one.tasks.length + " 条");
      console.log("  勾上 = 交付（写一行 交付：）；取消勾选 = 撤回（写一行 理由：）；? = 新条目；~~ = 放弃（写一行 理由：）；延后：= 延后");
    });
};
