import { debt, exemptSegments, signBlockers } from "../../core/rules.mjs";
import { parse, load, transact, targetSession, fail, guard, period, show, signer } from "../session.mjs";

export default function sign(argv) {
    const { flags } = parse(argv, "sign");
    guard(() => {
      const { doc } = load();
      const one = targetSession(doc, flags);
      const blockers = signBlockers(doc, one, doc.config);
      if (blockers.length > 0) fail("还不能签收：" + blockers.join("；"));
      if (!flags.words) fail("签收要留用户原话：--words \"…\"");
      const title = flags.title ?? period(doc);
      transact(flags, () => ({ k: "sign", s: one.id, words: flags.words, title, by: signer(flags, "签收") }));
      console.log("签收 · " + one.id + " · " + title + " · 「" + flags.words + "」");
      // 没人审过的段不能被静默放过：签收这一刻把它们摆出来。
      const unread = exemptSegments(one);
      if (unread.length > 0)
        console.log("  没经过审查 · " + unread.map((s) => s.id + "（" + s.sealedWhy + "）").join("、"));
      const owed = debt(one);
      if (owed.deferred.length + owed.dropped.length > 0)
        console.log("  带着走的未结项 · 延后 " + show(owed.deferred) + " · 放弃 " + show(owed.dropped));
      console.log("  会话封存，下一轮对话会自己开新期");
    });
};
