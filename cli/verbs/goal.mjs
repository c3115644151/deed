import { nextAction } from "../../core/rules.mjs";
import { parse, load, transact, targetSession, fail, guard, signer } from "../session.mjs";

export default function goal(argv) {

  // 一期要做成什么。它不是一个备注：签收签的是它，签收核对拿它当尺子。
  // 可以改，改一次一条记录——"当初说要什么"活着，才谈得上"做到了没有"。
    const { flags, words } = parse(argv, "goal");
    guard(() => {
      const { doc } = load();
      const one = targetSession(doc, flags);
      const text = flags.text ?? words.join(" ").trim();
      if (!text) fail('目的要写成一句话：deed goal "这一期要做成什么"');
      const after = transact(flags, () => ({ k: "goal.set", s: one.id, text, why: flags.why ?? null, by: signer(flags, "记目的") })).doc;
      console.log("目的 · " + one.id + " · " + text);
      if (flags.why) console.log("  为什么改 · " + flags.why);
      const step = nextAction(after, after.config);
      console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
      console.log("  " + step.command);
    });
};
