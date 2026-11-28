// policy/step: 下一步是谁、做什么。它把 facts 与 policy 的答案拼成人话，不自己判。
import { currentSession } from "./session.mjs";
import { openSegment } from "./segment.mjs";
import { freshBrief, lastBrief, needsReview, reviewOf, reviewState, verdictStands } from "./review.mjs";
import { countIn, tasksIn, unpinned } from "./task.mjs";
import { lastPeriodBrief, needsPeriodReview, periodFresh, periodState } from "./period.mjs";
import { awaitingJudgement } from "../facts/review.mjs";
import { signBlockers } from "./sign.mjs";
import { voidedReview } from "./review.mjs";


export function nextAction(doc, config) {
  const session = currentSession(doc);
  if (!session) {
    return {
      who: "agent",
      what: "记一轮",
      text: "这个工作区还没有在推进的会话；把这一轮谁说了什么写进账本（deed say 一句，会话自己开出来）",
      command: `deed say "…"`,
    };
  }
  // 讨论域的两下由用户在面板上按：议题先确认成立，再确认出口；都排在段的事前面，
  // 因为没有出口的议题不该变成任务，而等用户按的那一下不能藏在别的屏里。
  const topics = session ? (session.topics ?? []) : [];
  const toEstablish = topics.find((one) => one.state === "draft" && String(one.body ?? "").trim());
  if (toEstablish)
    return {
      who: "user",
      what: "确认议题成立",
      text: `议题 ${toEstablish.id} · ${toEstablish.title} 已经统合成正文，等你确认它成立`,
      command: "deed panel",
    };
  const toRelease = topics.find((one) => one.state === "established");
  if (toRelease)
    return {
      who: "user",
      what: "确认议题出口",
      text: `议题 ${toRelease.id} · ${toRelease.title} 已成立，等你确认它能不能出口为任务`,
      command: "deed panel",
    };
  const released = topics.find((one) => one.state === "released" && !(one.exportedAt ?? null));
  if (released)
    return {
      who: "agent",
      what: "出口议题",
      text: `议题 ${released.id} · ${released.title} 已锁定出口：在清单里写它以哪些条目出口（deed plan），条目下写一行 来自：${released.id}`,
      command: "deed plan",
    };
  // 段里正在等结论时，清单不发出去这一段的活就走不动。
  const frozenStep = (() => {
    const open = openSegment(session);
    if (!open || open.closedAt !== null) return null;
    const handed = lastBrief(session, open.id);
    const open_ = handed && handed.answeredBy === null && handed.withdrawnAt === undefined;
    if (!open_) return null;
    return {
      who: "reviewer",
      what: "落结论",
      text: `${open.id} 的清单交出去了、还没人回答（${countIn(session, open).total} 条）：判完落结论，这一段才动得了；要改这一段就先撤回这份清单`,
      command: `deed review --segment ${open.id} --verdict pass --result T1=met`,
    };
  })();
  if (session.segments.length === 0) {
    return {
      who: "agent",
      what: "开段",
      text: "范围说完就在清单里写第一条任务：deed plan 出草稿，写清标准，改完 deed submit；段跟着条目开出来",
      command: `deed plan`,
    };
  }
  const segment = openSegment(session) ?? session.segments[session.segments.length - 1];
  const count = countIn(session, segment);
  // 段都关了：还没人判这一期做成的样子时，下一步是期审，不是签收。
  if (segment.closedAt !== null && needsPeriodReview(session) && periodState(session) !== "pass") {
    const state = periodState(session);
    if (periodFresh(session)) {
      const handed = lastPeriodBrief(session);
      return {
        who: "reviewer",
        what: "落期审结论",
        text: session.id + " 的期审清单交出去了、还没人回答：" + handed.brief + "（这一期 " + session.segments.length + " 段都关了）",
        command: `deed review --all --verdict pass`,
      };
    }
    if (state === "stale") {
      return {
        who: "user",
        what: "重新开始期审",
        text: session.id + " 的期审结论早于之后的段变动：那一次判的不是这一期现在的样子；面板上「开始期审」按下去才出清单",
        command: "deed panel",
      };
    }
    if (state === "fail") {
      return {
        who: "agent",
        what: "结清期审点名的那几段",
        text: session.id + " 的期审不合格还在案：点名的段判过才能签收；判不了就开新一期把要补的记进去",
        command: `deed state`,
      };
    }
    return {
      who: "user",
      what: "开始期审",
      text: session.id + " 的各段都关了（" + session.segments.length + " 段）：面板上「开始期审」按下去，才出一份期审清单",
      command: "deed panel",
    };
  }
  // 审查通过只把这一段交回来：此刻轮到人判，它不是签收，也不是再审。
  // 但判决只能落在那份被判过的字节上：之后这一段又有了新活，那份结论就旧了，
  // 下一步是把新活做完、再出一份清单，而不是让人去判一份已经不对的内容。
  if (awaitingJudgement(session, segment) && verdictStands(session, segment))
    return {
      who: "user",
      what: "判决",
      text: `${segment.id} 的审查通过了（${segment.reviewedBy ?? "审查者"}）：这一段过不过，等你判`,
      command: "deed panel",
    };
  if (segment.closedAt !== null) {
    const blockers = signBlockers(doc, session, config);
    return {
      who: "user",
      what: "签收",
      text: blockers.length === 0 ? `${session.id} 的任务都判过了，等你一句话结束` : blockers.join("；"),
      command: "deed panel",
    };
  }
  if (count.todo > 0) {
    const task = tasksIn(session, segment).find((one) => one.status === "todo");
    return {
      who: "agent",
      what: "交付",
      text: `${task.id} · ${task.title}（标准：${task.criteria}）在清单里勾上它，写一行 交付：`,
      command: `deed submit`,
    };
  }
  const state = reviewState(config, session, segment);
  if (state === "stale") {
    // 结论旧了要重审，但重审的清单可能已经在手上：那一步是落结论，不是再发一份。
    const fresh = freshBrief(session, segment);
    if (fresh)
      return {
        who: "reviewer",
        what: "落结论",
        text: `${segment.id} 的结论早于最后一次交付，新的一份清单已经交出去了：${fresh.brief}`,
        command: `deed review --segment ${segment.id} --verdict pass`,
      };
    return {
      who: "user",
      what: "重新开始审查",
      text: `${segment.id} 的结论早于最后一次交付（它回答的是旧内容）：面板上「开始审查」按下去才出下一份清单`,
      command: "deed panel",
    };
  }
  if (state !== "fail" && needsReview(config, session, segment)) {
    const bare = unpinned(session, segment);
    if (bare.length > 0) {
      return {
        who: "agent",
        what: "记下文件",
        text: `${bare.map((one) => one.id).join("、")} 的交付没记下文件：在清单里重新勾一次，submit 按工作区自己称`,
        command: `deed submit`,
      };
    }
  }
  if (state === "missing") {
    // A handed-out brief that nobody answered decides what the next step is:
    // the reviewer's job is the verdict, not another piece of paper.
    const handed = freshBrief(session, segment);
    if (handed) {
      return {
        who: "reviewer",
        what: "落结论",
        text: `${segment.id} 的清单与角色包已经交出去了：${handed.brief}（${count.total} 条都交付了）`,
        command: `deed review --segment ${segment.id} --verdict pass`,
      };
    }
    return {
      who: "user",
      what: voidedReview(session, segment) ? "重新开始审查" : "开始审查",
      text: `${segment.id} 的 ${count.total} 条都交付了，要一份独立结论：面板上「开始审查」按下去才出清单`,
      command: "deed panel",
    };
  }
  if (state === "fail") {
    // 走到这里说明这一段没有被点名的未做条目：要么点名的被放弃了，要么已经重新交付。
    // 前者没有出路（账本不往回改），后者另出一份清单再审。
    const review = reviewOf(session, segment);
    const findings = review?.findings?.length ?? 0;
    const named = (review?.rework ?? [])
      .map((id) => session.tasks.find((one) => one.id === id))
      .filter(Boolean);
    // 放弃是落过的决定，带着理由：它结清的是"这件事改主意不做了"，不是"还没做"。
    const stuck = named.filter((one) => one.status !== "done" && one.status !== "accepted" && one.status !== "dropped");
    if (stuck.length > 0) {
      // 延后不是放弃：延后的条目还没做完，说了"重新交付"才算说实话。
      const gone = stuck.filter((one) => one.status === "deferred");
      const text =
        gone.length > 0
          ? `${segment.id} 的不合格（${review.by}）压着已经延后的 ${gone.map((one) => one.id).join("、")}：先重新交付，交付不了就放弃并写理由`
          : `${segment.id} 的不合格（${review.by}）还压着：${stuck.map((one) => one.id).join("、")} 没有重新交付${findings > 0 ? `（${findings} 条发现）` : ""}——重新交付，交付不了就放弃并写理由`;
      return {
        who: "agent",
        what: "清结论",
        text,
        command: "deed plan",
      };
    }
    // 手上那份清单是审查者的活：清单发出去、还没人回答，下一步是落结论，不是再发一份。
    const handed = freshBrief(session, segment);
    if (handed)
      return {
        who: "reviewer",
        what: "落结论",
        text: `${segment.id} 的不合格（${review.by}）还在案；新的一份清单已经交出去了：${handed.brief}`,
        command: `deed review --segment ${segment.id} --verdict pass`,
      };
    // 旧账本里有点名之前写下的不合格：没有可结清的条目，这一段停在这里，账本不往回改。
    if (named.length === 0)
      return {
        who: "user",
        what: "开新一期",
        text: `${segment.id} 的不合格（${review.by}）没有点名要重做的条目：没有可结清的东西，这一期到此为止——开新一期把要补的记进去`,
        command: 'deed say "开新一期，把要补的记进去"',
      };
    // 点名的条目改主意不做了：没有活可以重交——但那也要有一份新清单去判"放弃算不算结清"，
    // 旧的已作废，pass 落不下来。出清单这件事归系统（接了钩子的工作区在下一轮开头出），
    // 没接钩子的人敲同一句命令。
    const gave = named.filter((one) => one.status === "dropped");
    if (gave.length > 0)
      return {
        who: "user",
        what: "开始审查",
        text:
          `${segment.id} 的不合格（${review.by}）点名了 ${gave.map((one) => one.id).join("、")}，它们改主意不做了：` +
          "要一份新清单去判放弃算不算结清——面板上「开始审查」按下去才出",
        command: "deed panel",
      };
    return {
      who: "user",
      what: "开始审查",
      text: `${segment.id} 的不合格（${review.by}）还在案，被点名的已经重新交付或放弃：` +
        "旧清单已作废，要一份新的去判——面板上「开始审查」按下去才出",
      command: "deed panel",
    };
  }
  // 走到这里只剩一种：审查设置说这一段不用审，而它还没封。免审就是不用审，所以不再
  // 叫一个人去签发假结论——由交付的人写清凭什么不审，签收时这一段会被列出来。
  return {
    who: "agent",
    what: "封存",
    text: `${segment.id} · ${count.total} 条都交付了，审查设置说这一段不用审（改动只落在免审路径，没人需要审）`,
    command: `deed review --segment ${segment.id} --skip --why "凭什么不用审" `,
  };
}
