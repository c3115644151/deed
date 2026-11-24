import { nextAction, openSegment, sealBlockers } from "../../core/rules.mjs";
import { parse, load, transact, targetSession, fail, guard, signer, auditSegment } from "../session.mjs";

export default function seal(argv) {

  // 免审段的结局。审查设置说这一段不用审，于是没有审查结论可落——但段仍然要封，
  // 不然它永远开在 state 里，谁也签不了收。封存要写清凭什么不用审，因为
  // "没人看过"必须留在账本上，不能变成默认的沉默。
    const { flags } = parse(argv, "seal");
    guard(() => {
      const { doc } = load();
      const one = targetSession(doc, flags);
      const seg = flags.segment
        ? one.segments.find((s) => s.id === flags.segment)
        : openSegment(one);
      if (!seg)
        fail(
          (flags.segment ? "会话 " + one.id + " 里没有段 " + flags.segment : "现在没有开着的段") +
            "：账本里的段是 " +
            (one.segments.map((s) => s.id + (s.closedAt ? "（已封存）" : "")).join("、") || "（一个都没有）"),
        );
      auditSegment(doc, one, seg);
      const blockers = sealBlockers(doc.config, one, seg);
      if (blockers.length > 0) fail("这一段不能封存：" + blockers.join("；"));
      if (!flags.why) fail('封存要写清凭什么不用审：--why "…"');
      const after = transact(flags, () => ({
        k: "segment.seal",
        s: one.id,
        segment: seg.id,
        why: flags.why,
        by: signer(flags, "封存"),
      })).doc;
      console.log("封存 · " + seg.id + " · 免审 · " + flags.by + " · " + flags.why);
      console.log("  没人审过这一段：签收时它会列出来");
      const step = nextAction(after, after.config);
      console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
      console.log("  " + step.command);
    });
};
