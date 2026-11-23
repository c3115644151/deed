// rules: the questions a projection asks about the document. No clock, no IO.
// If a rule here disagrees with what fold allows, fold wins and this file is
// wrong -- these functions explain a state, they never permit one.

// Paths arrive from people and from Windows shells: normalise before matching,
// and treat anything that escapes or is absolute as something to look at.
const clean = (file) =>
  String(file)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();

const escapes = (file) => {
  const one = clean(file);
  return one.startsWith("/") || one.split("/").includes("..") || /^[a-zA-Z]:/.test(one);
};

const globToRegExp = (glob) => {
  const one = clean(glob);
  let out = "";
  for (let i = 0; i < one.length; i += 1) {
    const ch = one[i];
    if (ch === "*" && one[i + 1] === "*") {
      out += ".*";
      i += 1;
    } else if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // a/**/b also covers a/b: the directory in the middle may be absent
  out = out.replace(/\.\*\//g, "(?:.*/)?");
  // A pattern with no separator matches a file name at any depth: "*.md" means
  // every markdown file, not only the ones at the top of the workspace.
  const anchored = one.includes("/") ? out : `(?:.*/)?${out}`;
  return new RegExp(`^${anchored}$`);
};

export function matchesAny(files, globs) {
  const patterns = (globs ?? []).map(globToRegExp);
  return (files ?? []).some((file) => patterns.some((one) => one.test(clean(file))));
}

export const currentSession = (doc) => {
  const last = doc.sessions[doc.sessions.length - 1] ?? null;
  return last && !last.closedAt ? last : null;
};

export const sessionById = (doc, id) => doc.sessions.find((one) => one.id === id) ?? null;

export const openSegment = (session) => session?.segments.find((one) => one.closedAt === null) ?? null;

export const tasksIn = (session, segment) =>
  session.tasks.filter((one) => (segment ? one.segment === segment.id : true));

export function countIn(session, segment) {
  const tasks = tasksIn(session, segment);
  const count = { total: tasks.length, todo: 0, done: 0, accepted: 0, deferred: 0, dropped: 0 };
  for (const task of tasks) count[task.status] += 1;
  return count;
}

export const pendingAsks = (session) => session.asks.filter((one) => one.state === "pending");

// The newest conclusion about a segment that still stands. A reworked delivery
// voids the old verdict, so reviews are filtered rather than overwritten.
export const reviewOf = (session, segment) => {
  if (!segment) return null;
  const live = session.reviews.filter((one) => one.segment === segment.id && !one.voidedAt);
  return live[live.length - 1] ?? null;
};

const CONFIG_KEYS = ["review", "gates", "board"];
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// The threshold lives in the ledger; the file on disk is what someone typed.
// Where the two disagree, the difference is the fact worth reporting: a gate
// that was loosened by editing a file never became a decision.
export function configDrift(ledger, disk) {
  const found = [];
  for (const key of CONFIG_KEYS) {
    const left = ledger?.[key] ?? null;
    const right = disk?.[key] ?? null;
    if (!sameValue(left, right)) found.push({ key, ledger: left, disk: right });
  }
  return found;
}

export function needsReview(config, session, segment) {
  const required = config?.review?.required ?? [];
  const exempt = config?.review?.exempt ?? [];
  const tasks = tasksIn(session, segment);
  if (tasks.length === 0) return false;
  return tasks.some((task) => {
    // What the work touched counts as much as what it declared: a task may not
    // step out of review by describing itself as documentation.
    const files = [...new Set([...(task.files ?? []), ...(task.changed ?? [])])];
    if (files.length === 0) return true;
    if (files.some(escapes)) return true;
    if (matchesAny(files, required)) return true;
    return !files.every((file) => matchesAny([file], exempt));
  });
}

// The last delivery inside a segment. A conclusion older than this answered an
// earlier version of the work, so it stops counting as a conclusion.
export const lastDelivery = (session, segment) => {
  const times = tasksIn(session, segment)
    .flatMap((one) => [
      ...one.evidence.map((proof) => proof.at),
      ...(one.undone ?? []).map((gone) => gone.at),
    ])
    .sort();
  return times[times.length - 1] ?? null;
};

// 这一段最后一次被改动是什么时候。加一条任务也算——清单写的是一份清单，
// 清单变了，发出去那份就不再是这一段的事，结论也就回答不了它。
export const lastSegmentChange = (session, segment) => {
  const times = tasksIn(session, segment)
    .flatMap((one) => [
      one.touchedAt,
      ...one.evidence.map((proof) => proof.at),
      ...(one.undone ?? []).map((gone) => gone.at),
    ])
    .filter(Boolean)
    .sort();
  return times[times.length - 1] ?? null;
};

// The document the reviewer is holding for this segment: the last one handed
// out. A verdict answers this one or it is answering something nobody read.
export const lastBrief = (session, segmentId) =>
  session.briefs.filter((one) => one.segment === segmentId).at(-1) ?? null;

export const staleReview = (session, segment) => {
  const review = reviewOf(session, segment);
  const last = lastSegmentChange(session, segment);
  return Boolean(review && last && review.at < last);
};

// A conclusion already on disk outranks the question of whether one was needed:
// a reviewer who found something is never ignored because of a glob.
export function reviewState(config, session, segment) {
  const review = reviewOf(session, segment);
  if (review?.verdict === "fail") return "fail";
  if (review?.verdict === "pass" && staleReview(session, segment)) return "stale";
  if (!needsReview(config, session, segment)) return review?.verdict === "pass" ? "pass" : "exempt";
  return review?.verdict === "pass" ? "pass" : "missing";
}

// Proof that is only text proves nothing later: a pinned proof names a file and
// the digest it had. Inside a reviewed segment, every delivery needs one.
export const unpinned = (session, segment) =>
  tasksIn(session, segment)
    .filter((one) => one.status === "done" || one.status === "accepted")
    .filter((one) => !one.evidence.some((proof) => proof.digest && proof.path));

// A period reads as: nothing said yet (idle), scope being talked through
// (discuss, no segment yet), work in flight (execute), everything judged and
// only the word missing (accept).
export function reading(doc) {
  const session = currentSession(doc);
  if (!session) return "idle";
  if (session.segments.length === 0) return "discuss";
  return openSegment(session) ? "execute" : "accept";
}

// A verdict that was voided by a rework is not a missing verdict: somebody
// looked and the work came back. Saying "no verdict yet" would invite a judge
// who has not seen anything to seal the segment.
export const voidedReview = (session, segment) => {
  const ever = session.reviews.filter((one) => one.segment === segment?.id);
  return ever.length > 0 && ever.every((one) => one.voidedAt !== null);
};

// Signing is a session-level judgement, so it looks at the whole session, not
// just the segment that happens to be open.
export function signBlockers(doc, session, config = null) {
  if (!session) return ["现在没有在推进的会话"];
  const blockers = [];
  if (session.segments.length === 0) blockers.push("还没有交付过任何东西");
  const shut = openSegment(session);
  if (shut) blockers.push(shut.id + " 还没有审查通过（审查者的 pass 就封段）");
  // Work owed outside the open segment is what a segment-level view cannot see;
  // inside it, the segment's own blockers already say it.
  const open = openSegment(session);
  const loose = session.tasks.filter((one) => !open || one.segment !== open.id);
  const todo = loose.filter((one) => one.status === "todo");
  const undelivered = loose.filter((one) => one.status === "done");
  if (todo.length > 0) blockers.push(`还有 ${todo.length} 条没做完（${todo.map((one) => one.id).join("、")}）`);
  if (undelivered.length > 0)
    blockers.push(`还有 ${undelivered.length} 条已交付但没判（${undelivered.map((one) => one.id).join("、")}）`);
  const asks = pendingAsks(session);
  if (asks.length > 0) blockers.push(`还有 ${asks.length} 条待裁（${asks.map((one) => one.id).join("、")}）`);
  if (config) {
    const bare = session.segments
      .filter((segment) => needsReview(config, session, segment))
      .flatMap((segment) => unpinned(session, segment));
    if (bare.length > 0)
      blockers.push("这些交付没记下任何文件（" + bare.map((one) => one.id).join("、") + "）：签收前记下一个文件");
  }
  return blockers;
}

// What is owed but not blocking: the point is that a person sees the debt, not
// that the system decides for them what to do with it.
export const debt = (session) => ({
  deferred: session.tasks.filter((one) => one.status === "deferred").map((one) => one.id),
  dropped: session.tasks.filter((one) => one.status === "dropped").map((one) => one.id),
});

export const pressure = (session) => {
  const segment = openSegment(session);
  if (!segment) return null;
  const count = countIn(session, segment);
  return { segment: segment.id, tasks: count.total, undecided: count.done };
};

export function nextAction(doc, config) {
  const session = currentSession(doc);
  if (!session) {
    return {
      who: "agent",
      what: "记一轮",
      text: "这个工作区还没有在推进的会话；把这一轮谁说了什么写进账本（--who 写开口的人），会话自己开出来",
      command: `deed tick --who user --said "…"`,
    };
  }
  const asks = pendingAsks(session);
  if (asks.length > 0) {
    const ask = asks[0];
    return {
      who: "user",
      what: "裁定",
      text: `${ask.id} · ${ask.text}（我理解成：${ask.reading}）`,
      command: `deed ask resolve ${ask.id} --decision "…"`,
    };
  }
  if (session.segments.length === 0) {
    return {
      who: "agent",
      what: "开段",
      text: "范围说完就写第一条任务，段跟着开出来",
      command: `deed task add "…" --criteria "…"`,
    };
  }
  const segment = openSegment(session) ?? session.segments[session.segments.length - 1];
  const count = countIn(session, segment);
  if (segment.closedAt !== null) {
    const blockers = signBlockers(doc, session, config);
    return {
      who: "user",
      what: "签收",
      text: blockers.length === 0 ? `${session.id} 的任务都判过了，等你一句话收口` : blockers.join("；"),
      command: `deed sign --words "<你的原话>" --title "第 ${doc.sessions.length} 期"`,
    };
  }
  if (count.todo > 0) {
    const task = tasksIn(session, segment).find((one) => one.status === "todo");
    return {
      who: "agent",
      what: "交付",
      text: `${task.id} · ${task.title}（标准：${task.criteria}）`,
      command: `deed task done ${task.id} --evidence "…"`,
    };
  }
  const state = reviewState(config, session, segment);
  if (state === "stale") {
    return {
      who: "reviewer",
      what: "重审",
      text: `${segment.id} 的结论早于最后一次交付：它回答的是旧内容`,
      command: `deed review --segment ${segment.id}`,
    };
  }
  if (state !== "fail" && needsReview(config, session, segment)) {
    const bare = unpinned(session, segment);
    if (bare.length > 0) {
      return {
        who: "agent",
        what: "记下文件",
        text: `${bare.map((one) => one.id).join("、")} 的交付没记下文件：记上工作区里的文件`,
        command: `deed task done ${bare[0].id} --evidence "…" --digest <工作区里的文件>`,
      };
    }
  }
  if (state === "missing") {
    // A handed-out brief that nobody answered decides what the next step is:
    // the reviewer's job is the verdict, not another piece of paper.
    const handed = lastBrief(session, segment.id);
    const waiting = handed && !session.reviews.some((one) => one.brief === handed.brief);
    if (waiting) {
      return {
        who: "reviewer",
        what: "落结论",
        text: `${segment.id} 的清单与角色包已经交出去了：${handed.brief}（${count.total} 条都交付了）`,
        command: `deed review --segment ${segment.id} --by "你是谁" --verdict pass`,
      };
    }
    return {
      who: "reviewer",
      what: voidedReview(session, segment) ? "重审" : "审这一段",
      text: `${segment.id} 的 ${count.total} 条都交付了，要一份独立结论`,
      command: `deed review --segment ${segment.id}`,
    };
  }
  if (state === "fail") {
    // 走到这里说明这一段没有被点名的未做条目：要么点名的被放弃了，要么已经重新交付。
    // 前者只能由人推翻那条结论（命令面不再产生 judge --rework），后者另出一份清单再审。
    const review = reviewOf(session, segment);
    const findings = review?.findings?.length ?? 0;
    const named = (review?.rework ?? [])
      .map((id) => session.tasks.find((one) => one.id === id))
      .filter(Boolean);
    const stuck = named.filter((one) => one.status !== "done" && one.status !== "accepted");
    if (stuck.length > 0) {
      // 被点名的条目要么还能重新交付，要么已经被放弃——后者在这份账本里没有回头路，
      // 说了"重新交付"只会让人白跑一趟。
      const gone = stuck.filter((one) => one.status === "dropped" || one.status === "deferred");
      const text =
        gone.length > 0
          ? `${segment.id} 的不合格（${review.by}）压着已经${gone[0].status === "deferred" ? "延后" : "放弃"}的 ${gone.map((one) => one.id).join("、")}：这条结论只能由人推翻，或者开新一期重做`
          : `${segment.id} 的不合格（${review.by}）还压着：${stuck.map((one) => one.id).join("、")} 没有重新交付${findings > 0 ? `（${findings} 条发现）` : ""}——重新交付，或者由人推翻那条结论`;
      return {
        who: "agent",
        what: "清结论",
        text,
        command: `deed judge --overturn ${review.id} --why "…"`,
      };
    }
    return {
      who: "reviewer",
      what: "重审",
      text: `${segment.id} 的不合格（${review.by}）还在案，被点名的已经重新交付：另出一份清单再审`,
      command: `deed review --segment ${segment.id}`,
    };
  }
  // 走到这里只剩一种：门槛说这一段不用审，而它还没封。免审就是不用审，所以不再
  // 叫一个人去签发假结论——由交付的人写清凭什么不审，签收时这一段会被列出来。
  return {
    who: "agent",
    what: "封存",
    text: `${segment.id} · ${count.total} 条都交付了，门槛说这一段不用审（改动只落在免审路径，没人需要审）`,
    command: `deed seal --segment ${segment.id} --why "门槛说这一段不用审：改动只落在免审路径"`,
  };
}

// 免审段要人封一次，理由写在账本里；但它不能顶替审查结论：要审的段封不了。
export function sealBlockers(config, session, segment = openSegment(session)) {
  if (!session) return ["现在没有在推进的会话"];
  if (!segment) return ["现在没有待封的段"];
  const blockers = [];
  if (segment.closedAt !== null) blockers.push(`段 ${segment.id} 已经封存`);
  const count = countIn(session, segment);
  if (count.todo > 0)
    blockers.push(`还有 ${count.todo} 条没交付（${session.tasks.filter((one) => one.segment === segment.id && one.status === "todo").map((one) => one.id).join("、")}）`);
  const live = session.reviews.filter((one) => one.segment === segment.id && one.voidedAt === null);
  if (live.length > 0)
    blockers.push("这一段已经有审查结论：结局由那份结论定（deed judge --overturn 只用来推翻它）");
  if (needsReview(config, session, segment))
    blockers.push(`这一段按门槛要审：结局得由审查者的结论落（deed review --segment ${segment.id}）`);
  return blockers;
}

// 没经过审查就收口的段：签收时要把它们摆出来，别让"免审"变成没人知道。
export function exemptSegments(session) {
  if (!session) return [];
  return session.segments.filter((one) => one.verdict === "exempt");
}
