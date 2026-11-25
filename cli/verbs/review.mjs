import fs from "node:fs";
import path from "node:path";
import { digest } from "../../core/digest.mjs";
import { lastBrief, lastSegmentChange, needsReview, nextAction, openSegment, reading, tasksIn } from "../../core/rules.mjs";
import { rel } from "../../lib/store.mjs";
import { planBrief, writeBrief } from "../brief.mjs";
import { ROOT, stamp, parse, load, transact, session, targetSession, fail, guard, split, list, auditSegment } from "../session.mjs";

export default function review(argv) {

  // Two verbs in one, on purpose: handing out the brief and landing a verdict
  // are different people at different times.
    const { flags } = parse(argv, "review");
    guard(() => {
      const { doc } = load();
      const one = targetSession(doc, flags);
      const seg = flags.segment ? one.segments.find((s) => s.id === flags.segment) : openSegment(one);
      if (!seg)
        fail(
          flags.segment
            ? "会话 " + one.id + " 里没有段 " + flags.segment + "：账本里的段是 " + (one.segments.map((s) => s.id).join("、") || "（一个都没有）")
            : "现在没有待审的段",
        );
      if (seg.closedAt) fail("段 " + seg.id + " 已经封存，结论不能再落");
      if (!flags.verdict) {
        // 审查设置说这一段不用审（改动全落在免审路径）：不出清单。出了一份没人需要的卷子，
        // 账本上就多一条「等着人回答的清单」，而这一段正确的结局是关闭。
        if (!needsReview(doc.config, one, seg)) {
          console.log("审查设置说这一段不用审（改动都落在免审路径）：不出清单与角色包，账本也不记一条等人回答的清单");
          console.log('  关闭这一段：deed seal --segment ' + seg.id + ' --why "凭什么不审" --by "…"');
          return;
        }
        // 清单写的是"这些条目、这些交付记录"。还有条目没交，清单就是一份没人能答的卷子：
        // 交完再出，否则它一出生就是旧的。
        const pending = tasksIn(one, seg).filter((task) => task.status === "todo");
        if (pending.length > 0)
          fail("段 " + seg.id + " 还有没交付的（" + pending.map((task) => task.id).join("、") + "）：清单等交付完再出");
        const handed = lastBrief(one, seg.id);
        const answered = handed && one.reviews.some((rv) => rv.brief === handed.brief);
        if (handed && !answered) {
          // 交出去的那份只要没被动过，就在等结论；被改过或删了就另出一份——
          // 手上那份已经不是账本里记的那一份，谁读它都不算数。
          const file = path.resolve(ROOT, handed.brief);
          const pack = handed.guide ? path.resolve(ROOT, handed.guide) : null;
          // 清单与角色包是一起交出去的：任何一份被动过，手上就不是审查者读过的那一份。
          const intact =
            fs.existsSync(file) &&
            digest(fs.readFileSync(file)) === handed.briefDigest &&
            (!pack || (fs.existsSync(pack) && digest(fs.readFileSync(pack)) === handed.guideDigest));
          // 清单写的是它发出那一刻的条目与交付记录。之后这一段又动了（加任务、
          // 交付、收回），这份清单就不再说这一段现在的事——换一份，别让人审旧内容。
          const moved = lastSegmentChange(one, seg);
          const stale = moved !== null && moved > handed.at;
          if (intact && stale) console.log("上一份清单(" + handed.brief + ")出在这一段最近一次改动之前：另出一份");
          else if (intact) {
            console.log("审查清单 · " + handed.brief + "（这一段已经出过，等结论落盘）");
            console.log("  结论用 deed review --segment " + seg.id + " --by \"…\" --verdict pass|fail");
            return;
          } else console.log("上一份清单(" + handed.brief + " 与角色包)改过或丢了：另出一份，旧的那条账本记录留着（verify 会报）");
        }
        const plan = planBrief(ROOT, one, seg, stamp());
        const brief = rel(ROOT, plan.file);
        const guide = rel(ROOT, plan.guideFile);
        transact(
          flags,
          () => ({ k: "review.brief", s: one.id, segment: seg.id, brief, briefDigest: plan.digest, guide, guideDigest: plan.guideDigest }),
          () => writeBrief(plan, brief),
        );
        // 账本里已有几份，加上手上这份：一次审只回答一份清单。
        const nth = one.briefs.filter((b) => (b.segment ?? null) === seg.id).length + 1;
        console.log("审查清单 · " + brief + "（审什么）· " + seg.id + " 的第 " + nth + " 份");
        // 第三份起提一句：同一段反复出清单，通常是上一份没看清哪里不够，而不是这一段真的又变了。
        // 只提示不拦——拦下来会让人去编理由，而不是去读上一份。
        if (nth >= 3) console.log("  提示 · 这一段已经出过 " + (nth - 1) + " 份清单：先看上一份的审查者点了哪几条，别从头再写一份");
        console.log("  角色包 · " + guide + "（怎么审）· 两份一起交给审查者");
        console.log("  结论用 deed review --segment " + seg.id + " --by \"…\" --verdict pass|fail");
        return;
      }
      if (!flags.by) fail("review 要给结论就要写清谁审的：--by \"…\"");
      auditSegment(doc, one, seg);
      const waiting = tasksIn(one, seg).filter((task) => task.status === "todo");
      if (waiting.length > 0)
        fail("段 " + seg.id + " 还有没交付的（" + waiting.map((task) => task.id).join("、") + "）：结论只能落在交付之后");
      // A verdict answers the document that was handed out. Writing a fresh one
      // here would pin bytes produced after the reading -- a brief nobody read.
      const handed = lastBrief(one, seg.id);
      if (!handed) fail("这一段还没有清单：先 deed review --segment " + seg.id + " 出清单，再把结论落回来");
      const file = path.resolve(ROOT, handed.brief);
      if (!fs.existsSync(file)) fail("清单不在了（" + handed.brief + "）：先 deed review --segment " + seg.id + " 重出一份");
      if (digest(fs.readFileSync(file)) !== handed.briefDigest)
        fail("清单被改过（" + handed.brief + "）：它不是审查者读到的那一份；重新出一次再审（deed review --segment " + seg.id + "）");
      // 角色包和清单成对交出去，结论回答的是两份一起。换掉角色包（"怎么审"
      // 被改成"随便过"）同样是一份没人读过的清单。
      if (handed.guide) {
        const pack = path.resolve(ROOT, handed.guide);
        if (!fs.existsSync(pack)) fail("角色包不在了（" + handed.guide + "）：先 deed review --segment " + seg.id + " 重出一份");
        if (digest(fs.readFileSync(pack)) !== handed.guideDigest)
          fail("角色包被改过（" + handed.guide + "）：它不是审查者读到的那一份；重新出一次再审（deed review --segment " + seg.id + "）");
      }
      // 清单变了，结论就没法回答它：那一份写的不是现在这一段。
      const moved = lastSegmentChange(one, seg);
      if (moved !== null && moved > handed.at)
        fail("这一段在清单出过之后又动过（" + handed.brief + "）：结论只能回答清单上那几条，deed review --segment " + seg.id + " 另出一份再审");
      const findings = list(flags.finding);
      // 一条结论要么放行，要么说清哪几条要重做。不合格而不点名，接到结论的人
      // 只能回来猜——那是把判断留给没看过活的人。
      const rework = split(flags.rework).filter(Boolean);
      if (flags.verdict === "fail") {
        if (rework.length === 0) fail("不合格要点名要重做的条目：--rework T1,T2（不点名的结论没人能接）");
        if (!flags.why) fail("不合格要说清为什么：--why \"一句话总结\"（具体问题写在 --finding 里）");
      } else if (rework.length > 0) {
        fail("--rework 只跟 --verdict fail 一起用：pass 的意思是这一段过了，没有要退回的条目");
      }
      // 上一份不合格点名的条目里，被放弃的那些没有交付可结清：结论不是"改好了"，
      // 而是"这件事改主意不做了"。在落结论的地方说出来，下一个读账本的人才知道。
      const standing = one.reviews.filter(
        (one2) => one2.voidedAt === null && one2.scope === "segment" && one2.segment === seg.id,
      ).slice(-1)[0];
      const gaveUp = flags.verdict === "pass" && standing && standing.verdict === "fail"
        ? (standing.rework ?? [])
            .map((id) => one.tasks.find((one3) => one3.id === id))
            .filter((one3) => one3 && one3.status === "dropped")
        : [];
      const after = transact(flags, () => ({
        k: "review.log",
        s: one.id,
        segment: seg.id,
        by: flags.by,
        verdict: flags.verdict,
        brief: handed.brief,
        briefDigest: handed.briefDigest,
        findings,
        ...(flags.verdict === "fail" ? { rework, why: flags.why } : {}),
        ...(gaveUp.length > 0
          ? { gaveUp: gaveUp.map((one2) => ({ id: one2.id, why: one2.deferredWhy ?? null })) }
          : {}),
      })).doc;
      if (flags.verdict === "pass") {
        console.log("审查通过 · " + seg.id + " · " + flags.by + " · 段已封存");
        console.log("  清单 " + handed.brief);
        for (const one2 of gaveUp)
          console.log("  被点名但已放弃 · " + one2.id + " · " + (one2.deferredWhy ?? "没写理由") + "（这条不合格没有交付可结清，结论落在它被放弃这件事上）");
        for (const one2 of findings) console.log("  发现 · " + one2);
        const step = nextAction(after, after.config);
        console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
        console.log("  " + step.command);
        return;
      }
      console.log("审查不合格 · " + seg.id + " · " + flags.by + " · 退回 " + rework.join("、") + " · " + flags.why);
      console.log("  清单 " + handed.brief);
      for (const one2 of findings) console.log("  发现 · " + one2);
      console.log("  被点名的条目回到未做；补完再交，deed review --segment " + seg.id + " 另出清单再审");
    });
};
