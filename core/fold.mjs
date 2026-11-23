// fold: the ledger -> the document everything else reasons about.
// Pure: the same lines always produce the same document, and there is no clock
// in here (times come from the events themselves).
//
// Fold is also the gate. An event that would create an impossible state throws
// here first, and the CLI folds before it appends, so a refused action never
// reaches the ledger. Nothing outside this file decides what can be written.

import { UnknownKindError } from "./events.mjs";

const noway = (message) => {
  throw new Error(message);
};

const blank = () => ({ v: 1, sessions: [], changes: [], config: null });

const lastSession = (doc) => doc.sessions[doc.sessions.length - 1] ?? null;

function newSession(doc, at) {
  const session = {
    id: `S${String(doc.sessions.length + 1).padStart(2, "0")}`,
    openedAt: at,
    closedAt: null,
    closeKind: null,
    title: null,
    words: null,
    turns: [],
    goal: null,
    goals: [],
    tasks: [],
    asks: [],
    briefs: [],
    reviews: [],
    segments: [],
  };
  // Ids already taken in this period. Kept off the enumerable shape: it is an
  // index, not a fact about the period, and must not leak into the document.
  Object.defineProperty(session, "ids", { value: new Set(), enumerable: false });
  doc.sessions.push(session);
  return session;
}

const taken = (session, id) => session.ids.has(id);

// Only a turn opens a period. Every other event needs one already open: a task
// cannot invent a session, and a closed period cannot silently come back.
function sessionOf(doc, ev) {
  const bind = (session) => {
    // The ledger records where each event landed, so a later reader can address
    // a period by id. The turn that opens a period is the exception: it is the
    // period's birth, and pointing at a session that does not exist yet would
    // make the line unreadable on its own.
    ev.s = session.id;
    return session;
  };
  if (ev.s === undefined || ev.s === null) {
    const last = lastSession(doc);
    if (ev.k === "turn") {
      if (last && !last.closedAt) return bind(last);
      return newSession(doc, ev.at);
    }
    if (!last) noway("这个工作区还没有会话：先记一轮，会话自己开出来");
    if (last.closedAt) noway(`会话 ${last.id} 已经收口：先记一轮，会话自己开出来`);
    return bind(last);
  }
  const found = doc.sessions.find((one) => one.id === ev.s);
  if (!found) noway(`账本里没有这个会话：${ev.s}`);
  if (found.closedAt)
    noway(`会话 ${found.id} 已经收口（${found.closeKind === "signed" ? "签收" : "归档"}），不能再往里写`);
  return bind(found);
}

// A segment opens itself when something first lands in it: it is a view reset
// after a verdict, not a thing anyone schedules.
function segmentOf(session, at) {
  const open = session.segments.find((one) => one.closedAt === null);
  if (open) return open;
  const segment = {
    id: `${session.id}.${session.segments.length + 1}`,
    openedAt: at,
    closedAt: null,
    verdict: null,
    judgedAt: null,
    reviewAt: null,
    reviewBy: null,
    sealedBy: null,
    sealedWhy: null,
  };
  session.segments.push(segment);
  return segment;
}

const taskOf = (session, id) => {
  const task = session.tasks.find((one) => one.id === id);
  if (!task) noway(`这个会话里没有任务：${id}`);
  return task;
};

const segmentById = (session, id) => {
  const segment = session.segments.find((one) => one.id === id);
  if (!segment) noway(`这个会话里没有段：${id}`);
  return segment;
};

const sealed = (segment) => segment.closedAt !== null;

// A sealed segment is settled history: only a rework reopens it, so a stray
// write cannot leave work stranded inside a segment nobody will judge again.
function editable(session, task) {
  const segment = segmentById(session, task.segment);
  if (sealed(segment))
    noway(`任务 ${task.id} 在已封存的段 ${segment.id} 里：审查者点名退回（--verdict fail --rework）或者人推翻那份结论，才能再改`);
  return segment;
}

export function fold(events) {
  const doc = blank();
  for (const ev of events) {
    switch (ev.k) {
      case "turn": {
        const session = sessionOf(doc, ev);
        session.turns.push({ at: ev.at, who: ev.who, said: ev.said, did: ev.did ?? null, n: session.turns.length + 1 });
        break;
      }
      // Who changed the review threshold, when, and from what: a config file on
      // disk can be rewritten by anyone, but the ledger keeps the change.
      case "config.change": {
        doc.changes.push({
          at: ev.at,
          key: ev.key,
          from: ev.from ?? null,
          to: ev.to,
          why: ev.why,
          by: ev.by ?? "user",
        });
        // The live threshold is a fact like any other. Judgments read it out of
        // this document, so the config file on disk is a mirror, not a source.
        doc.config = { ...(doc.config ?? {}), [ev.key]: ev.to };
        break;
      }
      case "task.add": {
        const session = sessionOf(doc, ev);
        if (taken(session, ev.id)) noway(`这个会话里已经有 ${ev.id} 了`);
        session.ids.add(ev.id);
        const segment = segmentOf(session, ev.at);
        session.tasks.push({
          id: ev.id,
          title: ev.title,
          criteria: ev.criteria,
          files: ev.files ?? [],
          segment: segment.id,
          createdAt: ev.at,
          // 这一段最后一次"被改动"的时刻，任务自己的生命周期都算：加了、交了、
          // 收回了、延后了、弃掉了。清单与结论都拿它比新旧。
          touchedAt: ev.at,
          status: "todo",
          evidence: [],
          undone: [],
          changed: [],
          deferredWhy: null,
        });
        break;
      }
      case "task.done": {
        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        task.touchedAt = ev.at;
        if (task.status !== "todo" && task.status !== "done")
          noway(`任务 ${task.id} 不在未做状态：${task.status}`);
        task.status = "done";
        // A delivery pins the content of every file it says it produced. Old
        // lines pinned one file (digest + digestPath); new lines pin a list.
        // Both shapes read the same way from here on: one entry per file.
        const files =
          ev.files !== undefined
            ? ev.files.map((one) => ({ path: one.path, digest: one.digest }))
            : ev.digest && ev.digestPath
              ? [{ path: ev.digestPath, digest: ev.digest }]
              : [];
        task.evidence.push({
          claim: ev.evidence,
          by: ev.by,
          at: ev.at,
          digest: files[0]?.digest ?? null,
          path: files[0]?.path ?? null,
          files,
          changed: ev.changed ?? [],
        });
        // What the delivery actually moved in the workspace, computed before the
        // event landed. The review threshold reads this, not the task's own story
        // about which paths it touched.
        task.changed.push(...(ev.changed ?? []));
        break;
      }
      // 交付说错了话，只能收回，不能改写：撤回是一条新事实，最后那条交付
      // 退回未做，理由留在任务上——审查清单要能说清哪一条不算数。
      case "task.undo": {
        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        task.touchedAt = ev.at;
        const last = task.evidence[task.evidence.length - 1];
        if (!last) noway("任务 " + task.id + " 没有可撤回的交付");
        task.evidence.pop();
        task.undone.push({ claim: last.claim, why: ev.why, by: ev.by ?? "agent", at: ev.at });
        for (const one of last.changed ?? []) {
          const spot = task.changed.indexOf(one);
          if (spot >= 0) task.changed.splice(spot, 1);
        }
        task.status = task.evidence.length > 0 ? "done" : "todo";
        break;
      }
      case "task.defer":
      case "task.drop": {
        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        task.status = ev.k === "task.defer" ? "deferred" : "dropped";
        task.deferredWhy = ev.why;
        task.touchedAt = ev.at;
        break;
      }
      case "ask.raise": {
        const session = sessionOf(doc, ev);
        if (taken(session, ev.id)) noway(`这个会话里已经有 ${ev.id} 了`);
        session.ids.add(ev.id);
        session.asks.push({ id: ev.id, text: ev.text, reading: ev.reading, why: ev.why, at: ev.at, state: "pending", decision: null, by: null });
        break;
      }
      case "ask.resolve":
      case "ask.withdraw": {
        const session = sessionOf(doc, ev);
        const ask = session.asks.find((one) => one.id === ev.id);
        if (!ask) noway(`这个会话里没有待裁项：${ev.id}`);
        if (ask.state !== "pending") noway(`待裁项 ${ask.id} 已经处置过：${ask.state}`);
        ask.state = ev.k === "ask.resolve" ? "resolved" : "withdrawn";
        ask.decision = ev.decision ?? null;
        ask.why2 = ev.why ?? null;
        ask.by = ev.by ?? null;
        ask.closedAt = ev.at;
        break;
      }
      // 一期要做成什么：签收和整体审都比着它。可以改，改一次记一条，
      // 旧的留在 goals 里——"当初说要什么"是能查的事实，不是被覆盖的草稿。
      case "goal.set": {
        const session = sessionOf(doc, ev);
        if (session.goal) session.goals.push(session.goal);
        session.goal = { text: ev.text, at: ev.at, by: ev.by, why: ev.why ?? null };
        break;
      }
      // The brief a reviewer reads has to be a ledger fact, otherwise the verdict
      // below can only pin bytes generated after the reading -- a document
      // nobody answered. Handing out and answering are two lines, one reader.
      case "review.brief": {
        const session = sessionOf(doc, ev);
        const scope = ev.scope === "session" ? "session" : "segment";
        // 整体审的材料覆盖整期：它没有段这一格，也不该被某一段的封存挡在外面。
        const segment = scope === "session" ? null : segmentById(session, ev.segment);
        if (segment && sealed(segment))
          noway(`段 ${segment.id} 已经封存：要再审先由人推翻那份结论（deed judge --overturn <R> --why "…"）`);
        session.briefs.push({
          scope,
          goal: ev.goal ?? null,
          segment: segment ? segment.id : null,
          brief: ev.brief,
          briefDigest: ev.briefDigest,
          guide: ev.guide ?? null,
          guideDigest: ev.guideDigest ?? null,
          at: ev.at,
          by: ev.by ?? null,
          answeredBy: null,
        });
        break;
      }
      case "review.log": {
        const session = sessionOf(doc, ev);
        // 两种对象：一段（段审）或整期（整体审）。整期没有"段"这一格，
        // 它看的是这一期全部任务；它通过时所有还没封的段一起封。
        const scope = ev.scope === "session" ? "session" : "segment";
        const segment = scope === "session" ? null : segmentById(session, ev.segment);
        if (segment && sealed(segment)) noway(`段 ${segment.id} 已经封存，结论不能再落`);
        const subject = segment ? `段 ${segment.id}` : `这一期 ${session.id}`;
        const inScope = segment ? session.tasks.filter((one) => one.segment === segment.id) : session.tasks;
        const missing = inScope.filter((one) => one.status === "todo");
        if (missing.length > 0)
          noway(`${subject} 还有没交付的（${missing.map((one) => one.id).join("、")}）：结论只能落在交付之后`);
        // 谁做的活不能由谁自己清账：那样结论就是交付自己的说法。身份是自述，
        // 所以这里堵的是默认路径（同一个标签两头都用），不是刻意换名字的人。
        const ownWork = inScope
          .filter((one) => one.evidence.some((proof) => proof.by === ev.by))
          .map((one) => one.id);
        if (ownWork.length > 0) {
          // 段审说的是这一段的活，整体审说的是这一期的活：同一句话，两种说法。
          const hand = segment ? "段" : "活";
          noway(
            `${subject} 的 ${ownWork.join("、")} 是 ${ev.by} 交付的：同一个人不能判自己交付的${hand}（换一个 --by，或让用户判）`,
          );
        }
        // 两种对象各有一份"在案结论"：段审的互斥只看本段，整体审的只看整期。
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
          const stuck = named
            .map((id) => taskOf(session, id))
            .filter((task) => task.status !== "done" && task.status !== "accepted")
            .map((task) => task.id);
          if (named.length === 0)
            noway(
              `${subject} 在案的结论是不合格（${latest.by}）：它没点名要重做的条目，没有可结清的东西——要改判先由人推翻那条结论（deed judge --overturn ${latest.id} --why "…"），再重新审`,
            );
          if (stuck.length > 0)
            noway(
              `${subject} 在案的不合格（${latest.by}）还没结清：${stuck.join("、")} 得先重新交付，或者由人推翻那条结论（deed judge --overturn ${latest.id} --why "…"）`,
            );
        }
        // 这条新记录自己带的是哪一版的含义：第 3 版起 pass 自己封段、fail 必须点名。
        const meaning = ev.v ?? 1;
        // 点名要重做的条目：记录落盘之前先确认它们都在这一段里，否则一条
        // 打回会写到别的段的任务上，而账本只说"已打回"。
        const rework = ev.rework ?? [];
        if (ev.verdict === "fail" && meaning >= 3 && rework.length === 0)
          noway(`${subject} 判不合格要点名重做的条目（--rework T1,T2）：不点名的结论没人能接`);
        for (const taskId of rework) {
          const task = taskOf(session, taskId);
          // 段审只能点本段的：跨段的打回会把别的段的活退回已交付，
          // 而账本只说"已打回"。整期审可以点这一期里任何一条。
          if (segment && task.segment !== segment.id)
            noway(`任务 ${task.id} 不在段 ${segment.id} 里（它在 ${task.segment}），打回不能跨段`);
        }
        const id = `R${session.reviews.length + 1}`;
        // Every live verdict is replaced explicitly, so two conclusions never
        // both claim to be the current one.
        for (const one of live) {
          one.voidedAt = ev.at;
          one.supersededBy = id;
        }
        session.reviews.push({
          id,
          scope,
          segment: segment ? segment.id : null,
          goal: ev.goal ?? null,
          by: ev.by,
          verdict: ev.verdict,
          brief: ev.brief,
          briefDigest: ev.briefDigest ?? null,
          findings: ev.findings ?? [],
          rework,
          at: ev.at,
          voidedAt: null,
          voidedBy: null,
          supersededBy: null,
        });
        // Keep the pair traceable: which handed-out document this verdict answers.
        const handed = session.briefs.find((one) => one.brief === ev.brief && one.scope === scope);
        if (handed) handed.answeredBy = id;
        // 段审要在段头上留下"谁、什么时候、什么结论"；整体审没有段头，它落在整期。
        if (segment) {
          segment.reviewAt = ev.at;
          segment.reviewBy = ev.by;
          segment.reviewVerdict = ev.verdict;
        }
        // 审查者放行就是结局，不再等第二个人签字：段审封这一段，整体审把还没封的段
        // 一起封（单段的一期就是这种情形——那份材料本来就覆盖了它全部的任务）。
        if (ev.verdict === "pass" && meaning >= 3) {
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
              // 记下是那次整体审封的：人推翻它的时候，要能把这几段一起打开。
              one.sealedByReview = id;
            }
          }
        }
        // 不合格不封段：被点名的条目回到未做，其余保持交付；接到活的人读结论，
        // 不必再回来问"到底哪几条要重做"。（整期审打回时条目可以跨段。）
        if (ev.verdict === "fail") {
          for (const taskId of rework) {
            const task = taskOf(session, taskId);
            const home = session.segments.find((one) => one.id === task.segment);
            // 整期审可以点回已经封存的段：那一段得跟着打开，否则被点名的条目
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
          }
        }
        break;
      }
      // 人推翻结论是例外，不是步骤：它把一条在案的结论作废，并把这一段重新打开，
      // 让活回到桌面上——原先"判过"的那批任务退回已交付。
      case "review.overturn": {
        const session = sessionOf(doc, ev);
        const review = session.reviews.find((one) => one.id === ev.review);
        if (!review) noway(`这个会话里没有结论 ${ev.review}`);
        if (review.voidedAt !== null) noway(`结论 ${review.id} 已经作废过（${review.voidedBy}）`);
        review.voidedAt = ev.at;
        review.voidedBy = ev.by;
        review.voidedWhy = ev.why;
        // 被推翻的是整体审：它封过的段一起打开，活回到桌面上。
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
          break;
        }
        const segment = segmentById(session, review.segment);
        segment.reviewVerdict = null;
        segment.reviewAt = null;
        segment.reviewBy = null;
        if (segment.closedAt !== null) {
          for (const task of session.tasks)
            if (task.segment === segment.id && task.status === "accepted") task.status = "done";
          segment.verdict = null;
          segment.judgedAt = null;
          segment.closedAt = null;
        }
        break;
      }
      // 免审段的结局。它不是审查结论：没人审过，所以只留下谁封的、凭什么说不用审，
      // 签收时这一段会被列出来——"没经过审查"是账本上能看见的事实，不是默认的沉默。
      case "segment.seal": {
        const session = sessionOf(doc, ev);
        const segment = segmentById(session, ev.segment);
        if (sealed(segment)) noway(`段 ${segment.id} 已经封存`);
        const todo = session.tasks.filter((one) => one.segment === segment.id && one.status === "todo");
        if (todo.length > 0)
          noway(`段 ${segment.id} 还有没交付的：${todo.map((one) => one.id).join("、")}`);
        const ever = session.reviews.filter((one) => one.segment === segment.id && one.voidedAt === null);
        if (ever.length > 0) noway(`段 ${segment.id} 已经有审查结论：结局由那份结论落，封存只给免审段`);
        for (const task of session.tasks)
          if (task.segment === segment.id && task.status === "done") task.status = "accepted";
        segment.verdict = "exempt";
        segment.judgedAt = ev.at;
        segment.closedAt = ev.at;
        segment.sealedBy = ev.by;
        segment.sealedWhy = ev.why;
        break;
      }
      case "judge.pass": {
        const session = sessionOf(doc, ev);
        const segment = segmentById(session, ev.segment);
        if (sealed(segment)) noway(`段 ${segment.id} 已经封存，判过了`);
        const todo = session.tasks.filter((one) => one.segment === segment.id && one.status === "todo");
        if (todo.length > 0) noway(`段 ${segment.id} 还有没做完的：${todo.map((one) => one.id).join("、")}`);
        const ever = session.reviews.filter((one) => one.segment === segment.id);
        const live = ever.filter((one) => one.voidedAt === null);
        const review = live[live.length - 1] ?? null;
        if (ever.length > 0 && !review)
          noway(`段 ${segment.id} 的审查结论已经被打回作废：重新审一次再判`);
        if (review && review.verdict !== "pass")
          noway(`段 ${segment.id} 的在案结论是不合格（${review.by}）：补完再判`);
        const delivered = session.tasks
          .filter((one) => one.segment === segment.id)
          .flatMap((one) => one.evidence.map((proof) => proof.at))
          .sort();
        const lastDelivery = delivered[delivered.length - 1] ?? null;
        if (review && lastDelivery && review.at < lastDelivery)
          noway(`段 ${segment.id} 的结论早于最后一次交付（${lastDelivery}）：它回答的是旧内容，重新审一次`);
        if (segment.reviewVerdict === "fail") noway(`段 ${segment.id} 的审查结论是不合格，先补再判`);
        for (const task of session.tasks)
          if (task.segment === segment.id && task.status === "done") task.status = "accepted";
        segment.verdict = "pass";
        segment.judgedAt = ev.at;
        segment.closedAt = ev.at;
        break;
      }
      case "judge.rework": {
        const session = sessionOf(doc, ev);
        const segment = segmentById(session, ev.segment);
        // A rework is the one way back into settled work, so it may reopen the
        // segment a verdict just closed -- but only the newest one: reopening an
        // older segment would leave two open at once.
        const newest = session.segments[session.segments.length - 1];
        if (sealed(segment) && segment.id !== newest.id)
          noway(`段 ${segment.id} 后面还有 ${newest.id}：先把它收口，再回打这一段`);
        for (const id of ev.tasks) {
          const task = taskOf(session, id);
          if (task.segment !== segment.id)
            noway(`任务 ${task.id} 不在段 ${segment.id} 里（它在 ${task.segment}），打回不能跨段`);
          task.status = "todo";
          task.evidence = [];
          task.deferredWhy = null;
        }
        // The verdict answered the old delivery; after a rework it is not a
        // fact about the new one, so it stays in the ledger but stops counting.
        for (const review of session.reviews)
          if (review.segment === segment.id) {
            review.voidedAt = ev.at;
            review.voidedBy = ev.by;
          }
        segment.reviewVerdict = null;
        segment.reviewAt = null;
        segment.reviewBy = null;
        segment.verdict = null;
        segment.judgedAt = null;
        segment.closedAt = null;
        break;
      }
      case "sign":
      case "shelve": {
        const session = sessionOf(doc, ev);
        if (ev.k === "sign") {
          const left = session.tasks.filter((one) => one.status === "todo" || one.status === "done");
          if (left.length > 0) noway(`还有没结清的：${left.map((one) => `${one.id} ${one.status}`).join("、")}`);
          if (session.asks.some((one) => one.state === "pending")) noway("还有没处置的待裁项");
          session.title = ev.title;
          session.words = ev.words;
          session.closeKind = "signed";
        } else {
          session.closeKind = "shelved";
          session.words = ev.why;
        }
        session.closedAt = ev.at;
        break;
      }
      default:
        // 不认得的类型不一定是坏行：账本可能比程序新（w 记着写者版本）。
        throw new UnknownKindError(ev.k, ev.w, ev.v);
    }
  }
  return doc;
}
