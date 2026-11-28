// review 域（二）：结论落下与被推翻。清单的发出与撤回在 brief.mjs。
// 纯重放：doc 与 ev 进，改 doc；不读盘、不看时钟。
import { meaningOf, MEANING } from "../../events/index.mjs";
import { noway } from "../../facts/errors.mjs";
import { sessionOf, taken } from "../../facts/session.mjs";
import { segmentById, segmentOf, nextSegment, nextOpen, settle, sealed, editable } from "../../facts/segment.mjs";
import { awaitingVerdict } from "../../facts/review.mjs";
import { taskOf, rederive, onTheSheet, lastResultOf, settledSince } from "../../facts/task.mjs";
import { awaitingJudgement } from "../../facts/review.mjs";

export const HANDLERS = {
  "review.log": (doc, ev) => {        const session = sessionOf(doc, ev);
        // 两种对象：一段（整体审）或整期（签收核对）。整期没有"段"这一格，
        // 它看的是这一期全部任务；它通过时所有还没封的段一起封。
        const scope = ev.scope === "session" ? "session" : "segment";
        const segment = scope === "session" ? null : segmentById(session, ev.segment);
        if (segment && sealed(segment)) noway(`段 ${segment.id} 已经封存，结论不能再落`);
        const subject = segment ? `段 ${segment.id}` : `这一期 ${session.id}`;
        const inScope = segment ? session.tasks.filter((one) => one.segment === segment.id) : session.tasks;
        // 结论回答的是它那份清单："卷子上列出的条目都交完了"就够。
        // 清单记了它要判哪几条（含义第 36 版起）；没记的老清单照旧当整段。
        // 卷子外新加的条目不在这一问里：以前它们会把结论直接挡死，于是作者每加一条就得换一份
        // 清单，审查者手上那份永远判不完。
        const sheet = (() => {
          const handed = ev.brief ? session.briefs.find((one) => one.brief === ev.brief && one.segment === (segment ? segment.id : null)) : null;
          const listed = handed?.tasks;
          return Array.isArray(listed) && segment ? new Set(listed) : null;
        })();
        const missing = inScope.filter((one) => one.status === "todo" && (sheet === null || sheet.has(one.id)));
        if (missing.length > 0)
          noway(`${subject} 还有没交付的（${missing.map((one) => one.id).join("、")}）：结论只能落在交付之后`);
        // 两种对象各有一份"在案结论"：整体审的互斥只看本段，签收核对的只看整期。
        const live = session.reviews.filter(
          (one) => one.voidedAt === null && (segment ? one.scope === "segment" && one.segment === segment.id : one.scope === "session"),
        );
        const latest = live[live.length - 1] ?? null;
        // A fail is a decision about this delivery. It is not a draft that a
        // later pass may quietly overwrite: the work it named has to be
        // delivered again first.
        // 判没判过看的是**在案那条**记录说了什么，不看任何一条记录带的版本号：
        // 账本只追加，谁写的、哪一版写的，都不该让一条落过的结论变得可以被覆盖。
        // 旧账本里的 fail 没点名任何条目，也就没有可结清的东西——那种结论只能由人推翻。
        if (latest && latest.verdict === "fail" && ev.verdict === "pass") {
          const named = latest.rework ?? [];
          // 签收核对的结论点的是段：那一段还开着（或还没重新判过）就是没结清。
          const stuck = latest.scope === "session" && (latest.v ?? 1) >= 9
            ? named.filter((id) => session.segments.some((one) => one.id === id && one.closedAt === null))
            : named
                .map((id) => taskOf(session, id))
                // 放弃也是一条落过的决定（它自己带着原因）：被点名的活改主意不做了，
                // 就没有交付等着结清。剩下的判断交给下一次审查者——他要看得见这条被放弃了，
                // 落结论时 review 会把它们逐个印出来。
                .filter((task) => task.status !== "done" && task.status !== "accepted" && task.status !== "dropped")
                .map((task) => task.id);
          if (named.length === 0)
            noway(
              `${subject} 在案的结论是不合格（${latest.by}）：它没点名要重做的条目，没有可结清的东西——这一期到此为止，要补的开新一期`,
            );
          if (stuck.length > 0)
            noway(
              `${subject} 在案的不合格（${latest.by}）还没结清：${stuck.join("、")} 得先重新交付，交付不了就放弃并写理由`,
            );
        }
        // 这条新记录自己带的是哪一版的含义：第 3 版起 pass 自己关闭这一段、fail 必须点名。
        const meaning = meaningOf(ev);
        // 点名要重做的条目：记录落盘之前先确认它们都在这一段里，否则一条
        // 打回会写到别的段的任务上，而账本只说"已打回"。
        const rework = ev.rework ?? [];
        if (ev.verdict === "fail" && meaning >= 3 && rework.length === 0)
          noway(`${subject} 判不合格要点名重做的条目（--rework T1,T2）：不点名的结论没人能接`);
        const sessionRework = meaning >= MEANING.segmentRework;
        for (const id of rework) {
          // 整体审点的是段里的条目；签收核对点的是段本身——它看的就是各段的结论，
          // 所以它能退回的也只有"这一段要重做"，段里哪一条不行由那一段自己判。
          // 第 9 版之前签收核对点的是条目：那种行按当时的写法读，不拿今天的口径重判历史。
          if (!segment && !sessionRework) continue;
          if (segment) {
            const task = taskOf(session, id);
            if (task.segment !== segment.id)
              noway(`任务 ${task.id} 不在段 ${segment.id} 里（它在 ${task.segment}），打回不能跨段`);
          } else if (!session.segments.some((one) => one.id === id)) {
            noway(`签收核对点名的是段（${id} 不是段）：段里的条目由那一段的审查者点名`);
          }
        }
        // 按条落下：判了几条、每条的判定与它判的那几份字节。缺了哪条 pass 就不成立。
        const results = (ev.results ?? []).map((one) => ({
          id: one.id,
          verdict: one.verdict,
          note: one.note ?? null,
          files: (one.files ?? []).map((file) => ({ path: file.path })),
        }));
        // 按条判定说的是段：期审判的是这一期做成的样子，没有"每条标准"这回事。
        if (meaning >= MEANING.perItem && ev.verdict === "pass" && segment) {
          // 通过：每条都要有判定（或者沿用一个没动过的那一判）。
          const judged = new Set(results.map((one) => one.id));
          // 沿用的判定也算数：这一条自上次判定以来没动过，那一判还是对它下的。
          const bare = inScope
            .filter((one) => one.status !== "dropped" && one.status !== "deferred")
            // 只问卷子上那几条：清单外新加的条目是下一份的事。
            .filter((one) => sheet === null || sheet.has(one.id))
            .filter((one) => !judged.has(one.id))
            .filter((one) => settledSince(session, one) === null)
            .map((one) => one.id);
          if (bare.length > 0)
            noway(`pass 要每条都判过：${bare.join("、")} 还没有判定（--result T1=met 这样逐条写）`);
        }
        // 不合格：退回的那几条要点名，其余每条也要有判定——它们在这一判里是"过"。
        // 没有这份判定，下一次重审没有可沿用的东西，只能把整段重判一遍。
        if (meaning >= MEANING.resultsOnFail && ev.verdict === "fail" && segment) {
          const judged = new Map(results.map((one) => [one.id, one.verdict]));
          const bare = inScope
            // 只问卷子上那几条：清单外新加的条目是下一份的事。
            .filter((one) => sheet === null || sheet.has(one.id))
            .filter((one) => one.status !== "dropped" && one.status !== "deferred")
            .filter((one) => !judged.has(one.id))
            .filter((one) => settledSince(session, one) === null)
            .map((one) => one.id);
          if (bare.length > 0)
            noway(
              `不合格也要逐条给判定：${bare.join("、")} 还没有（--result T1=met --result T2=unmet 这样写；` +
                "这一判没退回的那些写 met，重判时它们就沿用，不必再判一遍）",
            );
          const missing = (ev.rework ?? []).filter((one) => judged.get(one) !== "unmet");
          if (missing.length > 0)
            noway(`退回的条目要判成 unmet：${missing.join("、")} 的判定不是 unmet`);
        }
        const id = `R${session.reviews.length + 1}`;
        // Every live verdict is replaced explicitly, so two conclusions never
        // both claim to be the current one.
        for (const one of live) {
          one.voidedAt = ev.at;
          one.supersededBy = id;
          // 不是被推翻：它的逐条判定留给 settledSince 沿用（那一条自己再动就失效）。
          one.overturned = false;
        }
        session.reviews.push({
          id,
          scope,
          segment: segment ? segment.id : null,
          goal: ev.goal ?? null,
          by: ev.by,
          verdict: ev.verdict,
          brief: ev.brief,

          findings: ev.findings ?? [],
          results,
          rework,
          gaveUp: ev.gaveUp ?? [],
          v: meaningOf(ev),
          at: ev.at,
          voidedAt: null,
          voidedBy: null,
          supersededBy: null,
        });
        // Keep the pair traceable: which handed-out document this verdict answers.
        const handed = session.briefs.find((one) => one.brief === ev.brief && one.scope === scope);
        if (handed) handed.answeredBy = id;
        // 整体审要在段头上留下"谁、什么时候、什么结论"；签收核对没有段头，它落在整期。
        if (segment) {
          segment.reviewAt = ev.at;
          segment.reviewBy = ev.by;
          segment.reviewVerdict = ev.verdict;
        }
        // 含义第 23 版起，审查通过不是结局：它把这一段交回给用户判决，段还在手上。
        // 第 22 版及以前的行按当时的样子读——那时审查者的放行就是这一段关闭的时刻，
        // 拿今天的规矩重放旧账本，等于把已经发生过的事判成没发生。
        if (ev.verdict === "pass" && meaning >= MEANING.judgement) {
          if (segment) {
            segment.verdict = "pass";
            segment.reviewedAt = ev.at;
            segment.reviewedBy = ev.by;
          }
        } else if (segment && meaning >= MEANING.judgement) {
          // 不合格把这一段交回执行：它不再"等你判决"。少了这一步，先判 pass 再判 fail，
          // 段头上会一直挂着 pass——冻结、判决按钮、签收差三处全说错话。
          if (segment) {
            segment.verdict = null;
            segment.reviewedAt = null;
            segment.reviewedBy = null;
          }
        } else if (ev.verdict === "pass" && meaning >= 3) {
          const shut = segment ? [segment] : session.segments.filter((one) => one.closedAt === null);
          for (const one of shut) {
            for (const task of session.tasks)
              if (task.segment === one.id && task.status === "done") task.status = "accepted";
            one.verdict = "pass";
            one.judgedAt = ev.at;
            one.closedAt = ev.at;
            if (!segment) {
              one.reviewAt = ev.at;
              one.reviewBy = ev.by;
              one.reviewVerdict = "pass";
            }
          }
        }
        // 不合格不关闭这一段：被点名的条目回到未做，其余保持交付；接到活的人读结论，
        // 不必再回来问"到底哪几条要重做"。
        if (ev.verdict === "fail" && !segment && sessionRework) {
          // 签收核对退回的是段：整段重开，段里的条目保持交付——重新看的是这一段的
          // 结论，不是让每个人再交一遍。段内哪一条不行，由那一段的审查者点名。
          for (const named of rework) {
            const home = session.segments.find((one) => one.id === named);
            // 这一段原先的结论回答的是它自己那份清单；签收核对说这一期不对，
            // 那条结论就不再是在案的：留史（voidedAt），段回到没人判过的样子。
            for (const older of session.reviews)
              if (older.scope === "segment" && older.segment === home.id && older.voidedAt === null) {
                older.voidedAt = ev.at;
                older.voidedBy = ev.by;
                older.supersededBy = id;
              }
            for (const other of session.tasks)
              if (other.segment === home.id && other.status === "accepted") other.status = "done";
            home.verdict = null;
            home.judgedAt = null;
            home.closedAt = null;
            home.reviewAt = ev.at;
            home.reviewBy = ev.by;
            home.reviewVerdict = "fail";
            home.sealedByReview = null;
            home.touchedAt = ev.at;
          }
        }
        if (ev.verdict === "fail" && (segment || !sessionRework)) {
          for (const taskId of rework) {
            const task = taskOf(session, taskId);
            const home = session.segments.find((one) => one.id === task.segment);
            // 签收核对可以点回已经封存的段：那一段得跟着打开，否则被点名的条目
            // 连重新交付都做不了（已封存的段不收新交付）。
            if (home && home.closedAt !== null) {
              for (const other of session.tasks)
                if (other.segment === home.id && other.status === "accepted") other.status = "done";
              home.verdict = null;
              home.judgedAt = null;
              home.closedAt = null;
              home.reviewAt = ev.at;
              home.reviewBy = ev.by;
              home.reviewVerdict = "fail";
              home.sealedByReview = null;
            }
            task.status = "todo";
            task.evidence = [];
            task.deferredWhy = null;
            task.touchedAt = ev.at;
            // 退回的交付连同它碰过的路径一起退：审查设置判的是这一段现在的字节，
            // 不是那条没人认账的旧交付留下的痕迹。
            rederive(task);
          }
        }
        return;
  },
  "verdict.pass": (doc, ev) => {        const session = sessionOf(doc, ev);
        const home = session.segments.find((one) => one.id === ev.segment);
        if (!home) noway(`这个会话里没有段 ${ev.segment}`);
        if (home.closedAt !== null) noway(`${home.id} 已经判过了（${home.closedAt}）：账本不往回改`);
        if (home.verdict !== "pass") noway(`${home.id} 还没有审查通过：判决在审查通过之后才按得下去`);
        for (const task of session.tasks)
          if (task.segment === home.id && task.status === "done") task.status = "accepted";
        home.judgedAt = ev.at;
        home.judgedBy = ev.by;
        home.closedAt = ev.at;
        return;
  },
  "review.overturn": (doc, ev) => {        const session = sessionOf(doc, ev);
        const review = session.reviews.find((one) => one.id === ev.review);
        if (!review) noway(`这个会话里没有结论 ${ev.review}`);
        if (review.voidedAt !== null) noway(`结论 ${review.id} 已经作废过（${review.voidedBy}）`);
        review.voidedAt = ev.at;
        review.voidedBy = ev.by;
        review.voidedWhy = ev.why;
        // 推翻是一句「判错了」：它的逐条判定不能再被沿用。被后一份结论取代不是这个意思。
        review.overturned = true;
        // 被推翻的是签收核对：它封过的段一起打开，活回到桌面上。
        if (review.scope === "session") {
          for (const one of session.segments) {
            if (one.sealedByReview !== review.id) continue;
            for (const task of session.tasks)
              if (task.segment === one.id && task.status === "accepted") task.status = "done";
            one.verdict = null;
            one.judgedAt = null;
            one.closedAt = null;
            one.sealedByReview = null;
            one.reviewVerdict = null;
            one.reviewAt = null;
            one.reviewBy = null;
          }
          return;
        }
        const segment = segmentById(session, review.segment);
        segment.reviewVerdict = null;
        segment.reviewAt = null;
        segment.reviewBy = null;
        segment.reviewedAt = null;
        segment.reviewedBy = null;
        // 含义第 23 版起"审查通过"与"段落已关闭"分开了：旧行被推翻时两样都要撤回，
        // 否则重放出来的段既是"判过"又是"要审"，下一步与签收差各说一套。
        if (segment.closedAt !== null || segment.verdict === "pass") {
          for (const task of session.tasks)
            if (task.segment === segment.id && task.status === "accepted") task.status = "done";
          segment.verdict = null;
          segment.judgedAt = null;
          segment.closedAt = null;
        }
        return;
  },
};
