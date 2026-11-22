// fold: the ledger -> the document everything else reasons about.
// Pure: the same lines always produce the same document, and there is no clock
// in here (times come from the events themselves).
//
// Fold is also the gate. An event that would create an impossible state throws
// here first, and the CLI folds before it appends, so a refused action never
// reaches the ledger. Nothing outside this file decides what can be written.

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
    noway(`任务 ${task.id} 在已封存的段 ${segment.id} 里：要用 judge --rework 打回才能再改`);
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
          status: "todo",
          evidence: [],
          changed: [],
          deferredWhy: null,
        });
        break;
      }
      case "task.done": {
        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        if (task.status !== "todo" && task.status !== "done")
          noway(`任务 ${task.id} 不在未做状态：${task.status}`);
        task.status = "done";
        task.evidence.push({
          claim: ev.evidence,
          by: ev.by,
          at: ev.at,
          digest: ev.digest ?? null,
          path: ev.digestPath ?? null,
        });
        // What the delivery actually moved in the workspace, computed before the
        // event landed. The review threshold reads this, not the task's own story
        // about which paths it touched.
        task.changed.push(...(ev.changed ?? []));
        break;
      }
      case "task.defer":
      case "task.drop": {
        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        task.status = ev.k === "task.defer" ? "deferred" : "dropped";
        task.deferredWhy = ev.why;
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
      // The brief a reviewer reads has to be a ledger fact, otherwise the verdict
      // below can only pin bytes generated after the reading -- a document
      // nobody answered. Handing out and answering are two lines, one reader.
      case "review.brief": {
        const session = sessionOf(doc, ev);
        const segment = segmentById(session, ev.segment);
        if (sealed(segment))
          noway(`段 ${segment.id} 已经封存：要再审先打回（judge --rework --why "…"）`);
        session.briefs.push({
          segment: segment.id,
          brief: ev.brief,
          briefDigest: ev.briefDigest,
          at: ev.at,
          by: ev.by ?? null,
          answeredBy: null,
        });
        break;
      }
      case "review.log": {
        const session = sessionOf(doc, ev);
        const segment = segmentById(session, ev.segment);
        if (sealed(segment)) noway(`段 ${segment.id} 已经封存，结论不能再落`);
        const missing = session.tasks.filter((one) => one.segment === segment.id && one.status === "todo");
        if (missing.length > 0)
          noway(`段 ${segment.id} 还有没交付的（${missing.map((one) => one.id).join("、")}）：结论只能落在交付之后`);
        // 谁做的活不能由谁自己清账：那样结论就是交付自己的说法。身份是自述，
        // 所以这里堵的是默认路径（同一个标签两头都用），不是刻意换名字的人。
        const ownWork = session.tasks
          .filter((one) => one.segment === segment.id)
          .filter((one) => one.evidence.some((proof) => proof.by === ev.by))
          .map((one) => one.id);
        if (ownWork.length > 0)
          noway(
            `段 ${segment.id} 的 ${ownWork.join("、")} 是 ${ev.by} 交付的：同一个人不能判自己交付的段（换一个 --by，或让用户判）`,
          );
        const live = session.reviews.filter((one) => one.segment === segment.id && one.voidedAt === null);
        const latest = live[live.length - 1] ?? null;
        // A fail is a decision about this delivery. It is not a draft that a
        // later pass may quietly overwrite: overturning it is a rework, which
        // puts the work back on the table first.
        if (latest && latest.verdict === "fail" && ev.verdict === "pass")
          noway(`段 ${segment.id} 在案的结论是不合格（${latest.by}）：要改判先打回（judge --rework），再重新审`);
        const id = `R${session.reviews.length + 1}`;
        // Every live verdict is replaced explicitly, so two conclusions never
        // both claim to be the current one.
        for (const one of live) {
          one.voidedAt = ev.at;
          one.voidedBy = id;
        }
        session.reviews.push({
          id,
          segment: segment.id,
          by: ev.by,
          verdict: ev.verdict,
          brief: ev.brief,
          briefDigest: ev.briefDigest ?? null,
          findings: ev.findings ?? [],
          at: ev.at,
          voidedAt: null,
        });
        // Keep the pair traceable: which handed-out document this verdict answers.
        const handed = session.briefs.find((one) => one.brief === ev.brief && one.segment === segment.id);
        if (handed) handed.answeredBy = id;
        segment.reviewAt = ev.at;
        segment.reviewBy = ev.by;
        segment.reviewVerdict = ev.verdict;
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
        for (const review of session.reviews) if (review.segment === segment.id) review.voidedAt = ev.at;
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
        noway(`未知事件：${ev.k}`);
    }
  }
  return doc;
}
