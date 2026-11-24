import { nextAction } from "../../core/rules.mjs";
import { parse, load, transact, session, fail, guard, signer } from "../session.mjs";

export default function judge(argv) {
    const { flags, words } = parse(argv, "judge");
    guard(() => {
      const { doc } = load();
      // 一段的结局由审查者的结论定：pass 当场关闭这一段，fail 点名退回。judge 只剩
      // "推翻一份结论"这一个动作——人替审查者放行，会让"谁判的"变成两处。
      if (!flags.overturn)
        fail('judge 只认 --overturn <R1> --why "…"（推翻一条结论）；一段的结局由审查者的结论落，人不再签字');
      // 推翻一条结论是例外，不是步骤：它点名一条在案的结论，所以按结论找会话，
      // 而不是按"现在开着哪一期"找——签收之后就没有开着的一期了。
      const overturned = doc.sessions
        .flatMap((one2) => one2.reviews.map((rv) => ({ session: one2, review: rv })))
        .find((pair) => pair.review.id === flags.overturn);
      if (!overturned) {
        const known = doc.sessions.flatMap((one2) => one2.reviews.map((rv) => one2.id + "/" + rv.id + "（" + rv.verdict + "）"));
        fail("账本里没有结论 " + flags.overturn + "：账本里的结论是 " + (known.join("、") || "（一条都没有）"));
      }
      const one = overturned.session;
      const review = overturned.review;
      if (review.voidedAt) fail("结论 " + review.id + " 已经作废过（" + review.voidedBy + "）：再推翻它没有意义");
      if (!flags.why) fail('推翻一条结论要说清为什么：--why "…"');
      if (one.closeKind)
        fail(
          "这一期已经" + (one.closeKind === "signed" ? "签收" : "搁下") + "（" + one.words + "）：账本不往回改，" +
            "错在哪就开新一期把要补的记进去；要推翻结论得在签收之前",
        );
      const after = transact(flags, () => ({
        k: "review.overturn",
        s: one.id,
        review: review.id,
        why: flags.why,
        by: signer(flags, "推翻结论"),
      })).doc;
      const where = review.scope === "session" ? "整期 " + one.id : "段 " + review.segment;
      console.log("推翻 · " + where + " · " + review.id + " · " + flags.by + " · " + flags.why);
      console.log("  " + (review.scope === "session" ? "这一期回到没审过的样子：重新出清单、重新审" : "这一段回到没判过的样子：重新出清单、重新审"));
      const step = nextAction(after, after.config);
      console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
      console.log("  " + step.command);
    });
};
