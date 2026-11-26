import { debt, nextAction } from "../../core/rules.mjs";
import { parse, load, transact, targetSession, fail, guard, show } from "../session.mjs";

// 签收与归档是同一支笔的两种落法：都不用推演规则，都是"人把这一期放下"。
export default function sign(argv) {
  const { flags } = parse(argv, "sign");
  guard(() => {
    // 签收是三个闸之一：它只在面板上按。命令行这条路关掉，是因为账本上必须读得出
    // 「人按的」——程序跑的命令与人在页面上按的那一下，落款要分得开。
    if (!flags.shelve)
      fail(
        "签收不在命令行做：打开面板（deed panel）在验收屏写下那句原话、按下「签收这一期」。\n" +
          "  账本上会记下谁、什么时候、说了什么；这一行只有一个来源。\n" +
          '  （只想把这一期放下、不等结清：deed sign --shelve --why "…"）',
      );
    const { doc } = load();
    const one = targetSession(doc, flags);
    if (!flags.why) fail('强制归档要说清为什么：--why "…"');
    const after = transact(flags, () => ({ k: "shelve", s: one.id, why: flags.why, by: "agent" })).doc;
    const owed = debt(one);
    console.log("强制归档 · " + one.id + " · 未结清 · " + flags.why);
    console.log("  （异常结束会一直带着这个标记；未结项 延后 " + show(owed.deferred) + " · 放弃 " + show(owed.dropped) + "）");
    const step = nextAction(after, after.config);
    if (step && step.command) console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
  });
}
