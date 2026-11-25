import fs from "node:fs";
import path from "node:path";
import { digest } from "../../core/digest.mjs";
import {
  lastBrief,
  lastPeriodBrief,
  lastSegmentChange,
  needsPeriodReview,
  needsReview,
  nextAction,
  openSegment,
  periodFresh,
  periodReviewers,
  periodState,
  segmentReviewers,
  stalePeriod,
  tasksIn,
} from "../../core/rules.mjs";
import { rel } from "../../lib/store.mjs";
import { planBrief, planWhole, writeBrief } from "../brief.mjs";
import { ROOT, stamp, parse, load, transact, session, targetSession, fail, guard, split, list, auditSegment } from "../session.mjs";


// 段审一直用同一双手——除非人推翻过这一段的结论：那一套判断已经被否掉了，
// 接着判的可以是另一双手。这里只认"人推翻"这一条路，不认"我想换个名字"。
const maySwitch = (one, segmentId) =>
  one.reviews.some(
    (rv) => rv.segment === segmentId && rv.voidedAt !== null && rv.voidedBy && !rv.supersededBy,
  );

export default function review(argv) {

  // Two verbs in one, on purpose: handing out the brief and landing a verdict
  // are different people at different times.
    const { flags } = parse(argv, "review");
    guard(() => {
      const { doc } = load();

      const one = targetSession(doc, flags);
    // ---- 期审：deed review --all -------------------------------------------------------
    // 段审判「这一段对不对」；期审判「这一期做成的样子对不对、各段之间说不说得通」。
    // 期审每次换一双手：判过段的人不判这一期。段审反过来，一直用同一双手。
    if (flags.all) {
      if (flags.segment) fail("--all 判的是整期：--all 与 --segment 一次只用一个");
      const session = one;
      const taken = new Set([...segmentReviewers(session), ...periodReviewers(session)]);
      if (!flags.verdict) {
        if (!needsPeriodReview(session))
          fail(
            "这一期还不到期审的时候：段都关了、没有未做与未判之后才有这一层" +
              (openSegment(session) ? "（" + openSegment(session).id + " 还开着）" : "（还有条目没交付或没判）") +
              "；到那时候用 deed review --all 出期审清单",
          );
        if (!flags.by) fail('期审要写清这一期交给谁：--by "你是谁"（期审每次换一双手，判过段的人不判这一期）');
        if (taken.has(flags.by))
          fail(flags.by + " 已经判过这一期的段（或期审过）：期审换一双手——" + (flags.by === undefined ? "" : "另找一个没判过这一段的人"));
        const handed = lastPeriodBrief(session);
        if (handed && handed.withdrawnAt === undefined && handed.answeredBy === null) {
          const file = path.resolve(ROOT, handed.brief);
          const intact = fs.existsSync(file) && digest(fs.readFileSync(file)) === handed.briefDigest;
          if (intact) {
            console.log("期审清单 · " + handed.brief + "（已经出过，等结论落盘）");
            console.log('  结论用 deed review --all --by "' + handed.by + '" --verdict pass|fail');
            return;
          }
        }
        const plan = planWhole(ROOT, session, stamp());
        const brief = rel(ROOT, plan.file);
        const guide = rel(ROOT, plan.guideFile);
        transact(
          flags,
          () => ({
            k: "review.brief",
            s: session.id,
            scope: "session",
            goal: session.goal?.text ?? "这一期没有写下目的",
            by: flags.by,
            brief,
            briefDigest: plan.digest,
            guide,
            guideDigest: plan.guideDigest,
          }),
          () => writeBrief(plan, brief),
        );
        const nth = session.briefs.filter((b) => b.scope === "session").length + 1;
        console.log("期审清单 · " + brief + "（审什么）· " + session.id + " 的第 " + nth + " 份 · 交给 " + flags.by);
        console.log("  角色包 · " + guide + "（怎么审）· 两份一起交给期审的人");
        console.log('  结论用 deed review --all --by "' + flags.by + '" --verdict pass|fail');
        return;
      }
      if (!flags.by) fail('期审要给结论就写清谁判的：--by "…"');
      const handed = lastPeriodBrief(session);
      if (!handed) fail("这一期还没有期审清单：先 deed review --all --by \"你是谁\" 出一份");
      if (handed.withdrawnAt !== undefined) fail("那份期审清单已经撤回（" + handed.brief + "）：另出一份再落结论");
      if (handed.by && handed.by !== flags.by)
        fail("这份期审清单是交给 " + handed.by + " 判的：结论要由这一双手落（期审每次换手，但不在一份清单里换）");
      const file = path.resolve(ROOT, handed.brief);
      if (!fs.existsSync(file)) fail("期审清单不在了（" + handed.brief + "）：先 deed review --all 另出一份");
      if (digest(fs.readFileSync(file)) !== handed.briefDigest)
        fail("期审清单被改过（" + handed.brief + "）：它不是审查者读到的那一份；deed review --all 另出一份");
      if (stalePeriod(session))
        fail("这份期审清单出在最后一次段变动之前：它答的不是这一期现在的事，deed review --all 另出一份");
      const findings = list(flags.finding);
      const rework = split(flags.rework).filter(Boolean);
      if (flags.verdict === "fail") {
        if (rework.length === 0) fail("期审不合格要点名段号：--rework S02.7（那一段的前提不成立了）");
        if (!flags.why) fail('期审不合格要说清为什么：--why "一句话总结"');
        for (const id of rework)
          if (!session.segments.some((one2) => one2.id === id))
            fail(id + " 不是这一期的段（期审点名的是段号）：" + session.segments.map((one2) => one2.id).join("、"));
      } else if (rework.length > 0) {
        fail("--rework 只跟 --verdict fail 一起用");
      }
      const after = transact(flags, () => ({
        k: "review.log",
        s: session.id,
        scope: "session",
        goal: session.goal?.text ?? null,
        by: flags.by,
        verdict: flags.verdict,
        brief: handed.brief,
        briefDigest: handed.briefDigest,
        findings,
        ...(flags.verdict === "fail" ? { rework, why: flags.why } : {}),
      })).doc;
      fs.rmSync(path.join(ROOT, ".deed", "tmp", String(handed.brief).split(/[\\/]/).pop().replace(/\.md$/u, "")), {
        recursive: true,
        force: true,
      });
      if (flags.verdict === "pass") {
        console.log("期审通过 · " + session.id + " · " + flags.by + " · 这一期做成的样子成立，下一步是签收");
        for (const one2 of findings) console.log("  发现 · " + one2);
        const step = nextAction(after, after.config);
        console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
        console.log("  " + step.command);
        return;
      }
      console.log("期审不合格 · " + session.id + " · " + flags.by + " · 退回 " + rework.join("、") + " · " + flags.why);
      for (const one2 of findings) console.log("  发现 · " + one2);
      console.log("  被点名的段重新打开：那一段的条目保持交付，重判的是那一段");
      return;
    }
      const seg = flags.segment ? one.segments.find((s) => s.id === flags.segment) : openSegment(one);
      if (!seg)
        fail(
          flags.segment
            ? "会话 " + one.id + " 里没有段 " + flags.segment + "：账本里的段是 " + (one.segments.map((s) => s.id).join("、") || "（一个都没有）")
            : "现在没有待审的段",
        );
      if (seg.closedAt) fail("段 " + seg.id + " 已经封存，结论不能再落");
      // 撤回一份还没被回答的清单：这一段的冻结到此为止，改完再出下一份。它不是"清单过期"
      // 那种自动判断——是一个人在账本上写下"这一份不作数"，谁写的、为什么都留着。
      if (flags.withdraw) {
        if (flags.verdict) fail("--withdraw 与 --verdict 是两件事：撤回这份清单，或者回答它，一次只做一件");
        if (!flags.by) fail('撤回也要写清谁撤的：--by "…"');
        if (!flags.why) fail('撤回要说清为什么：--why "…"（这条会留在账本上，读的人靠它知道当时怎么回事）');
        const handed = lastBrief(one, seg.id);
        if (!handed) fail("段 " + seg.id + " 还没有发过清单：没有可撤回的那一份");
        if (handed.withdrawnAt !== undefined) fail("这份清单已经撤回过了：" + handed.brief);
        if (one.reviews.some((rv) => rv.brief === handed.brief))
          fail("这份清单已经被回答过（" + handed.brief + "）：结论落过了，撤回它就是把历史改掉");
        transact(flags, () => ({
          k: "review.withdraw",
          s: one.id,
          segment: seg.id,
          brief: handed.brief,
          briefDigest: handed.briefDigest,
          why: flags.why,
          by: flags.by,
        }));
        console.log("撤回清单 · " + seg.id + " · " + handed.brief + " · " + flags.by);
        console.log("  " + flags.why);
        console.log("  这一段回到执行态：可以继续交付；改完再 deed review --segment " + seg.id + " 出下一份清单");
        return;
      }
      if (!flags.verdict) {
        // 段审一直用同一双手：这一段的清单第一次交给谁，之后还是他。换手只发生在人推翻结论时。
        // 这一句要放在「已经出过、等结论」之前：那份清单是谁的，先看它，再看手上这一份。
        const before = lastBrief(one, seg.id);
        const hand = flags.by ?? before?.by ?? null;
        if (!hand)
          fail('这一段要交给谁判：--by "这一段的审查者"（之后这一段的清单都写他——同一段的判断不该每次换个人从头摸一遍）');
        if (before?.by && before.by !== hand && !maySwitch(one, seg.id))
          fail("这一段已经交给 " + before.by + " 判了：段审一直用同一双手（要换手先由人在面板上推翻那条结论）");
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
          () => ({ k: "review.brief", s: one.id, segment: seg.id, brief, briefDigest: plan.digest, guide, guideDigest: plan.guideDigest, by: hand }),
          () => writeBrief(plan, brief),
        );
        // 账本里已有几份，加上手上这份：一次审只回答一份清单。
        const nth = one.briefs.filter((b) => (b.segment ?? null) === seg.id).length + 1;
        console.log("审查清单 · " + brief + "（审什么）· " + seg.id + " 的第 " + nth + " 份 · 交给 " + hand);
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
      // 清单是交给某一双手的：结论要由那一双手落。段审一直用同一个人，换手等于换了一套判断标准。
      if (handed.by && handed.by !== flags.by && !maySwitch(one, seg.id)) {
        // 两种"换手"各说各的：自己交付过的段判不了（规则 10）；不是自己交付的，也换不得手——
        // 这一段的判断归原来那双手。
        const delivered = tasksIn(one, seg).some((task) => task.evidence.some((proof) => proof.by === flags.by));
        fail(
          delivered
            ? "段 " + seg.id + " 的活是 " + flags.by + " 交付的：同一个人不能判自己交付的段（换一个 --by）"
            : "这一段是交给 " + handed.by + " 判的（同一段一直用同一双手）：结论要由他落；要换手先由人推翻那条结论",
        );
      }
      if (handed.withdrawnAt !== undefined)
        fail("这一段的那份清单已经撤回（" + handed.brief + "）：先 deed review --segment " + seg.id + " 重出一份，再落结论");
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
      // 按条落下：每条标准一个判定，判定里带着它判的那几份字节。pass 要求这一段每条都有判定——
      // "通过了"这句话不该盖着一张没人看过的条目。
      const bulk = flags["result-all"];
      if (bulk !== undefined && !["met", "unmet", "unknown"].includes(String(bulk)))
        fail("--result-all 只认 met／unmet／unknown：" + bulk);
      if (bulk !== undefined && list(flags.result).length > 0)
        fail("--result-all 已经是「每一条都这样」：不必再逐条写同样的判定");
      const rawResults =
        bulk !== undefined ? tasksIn(one, seg).map((task) => task.id + "=" + String(bulk)) : list(flags.result);
      const results = rawResults.map((raw) => {
        const matched = /^([A-Za-z0-9]+)=([a-z]+)(?::(.+))?$/u.exec(String(raw).trim());
        if (!matched)
          fail('--result 的写法是 T1=met 或 T2=unmet:为什么（判定只有 met／unmet／unknown）：' + raw);
        const [, id, verdict, note] = matched;
        if (!["met", "unmet", "unknown"].includes(verdict))
          fail("--result 的判定只有 met／unmet／unknown：" + raw);
        const task = one.tasks.find((one2) => one2.id === id);
        if (!task) fail("会话 " + one.id + " 里没有 " + id);
        if (task.segment !== seg.id) fail(id + " 不在段 " + seg.id + " 里（它在 " + task.segment + "），结论只能判这一段的条目");
        const files = (task.evidence.at(-1)?.files ?? []).map((file) => ({ path: file.path, digest: file.digest }));
        return { id, verdict, note: note ?? null, files };
      });
      if (flags.verdict === "pass") {
        const judged = new Set(results.map((one2) => one2.id));
        const bare = tasksIn(one, seg)
          .filter((task) => task.status !== "dropped" && task.status !== "deferred")
          .filter((task) => !judged.has(task.id))
          .map((task) => task.id);
        if (bare.length > 0)
          fail("pass 要每条都判过：" + bare.join("、") + " 还没有判定（--result " + bare[0] + "=met 这样逐条写）");
      }
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
        results,
        findings,
        ...(flags.verdict === "fail" ? { rework, why: flags.why } : {}),
        ...(gaveUp.length > 0
          ? { gaveUp: gaveUp.map((one2) => ({ id: one2.id, why: one2.deferredWhy ?? null })) }
          : {}),
      })).doc;
      // 审查者的临时区随结论落地销毁：里面的调试文件不是这一段的活，留着只会被人当成这一段的真相。
      fs.rmSync(path.join(ROOT, ".deed", "tmp", String(handed.brief).split(/[\\/]/).pop().replace(/\.md$/u, "")), {
        recursive: true,
        force: true,
      });
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
