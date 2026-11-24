import { debt } from "../../core/rules.mjs";
import { parse, load, transact, targetSession, fail, guard, show, signer } from "../session.mjs";

export default function shelve(argv) {
    const { flags } = parse(argv, "shelve");
    guard(() => {
      const { doc } = load();
      const one = targetSession(doc, flags);
      if (!flags.why) fail("强制归档要说清为什么：--why \"…\"");
      transact(flags, () => ({ k: "shelve", s: one.id, why: flags.why, by: signer(flags, "强制归档") }));
      console.log("强制归档 · " + one.id + " · 未结清 · " + flags.why);
      const owed = debt(one);
      console.log("  （异常结束会一直带着这个标记；未结项 延后 " + show(owed.deferred) + " · 放弃 " + show(owed.dropped) + "）");
    });
};
