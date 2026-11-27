// rules: the questions a projection asks about the document. No clock, no IO.
import { MEANING } from "./events.mjs";
import { awaitingJudgement } from "./fold.mjs";
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

function matchesAny(files, globs) {
  const patterns = (globs ?? []).map(globToRegExp);
  return (files ?? []).some((file) => patterns.some((one) => one.test(clean(file))));
}

export const currentSession = (doc) => {
  const last = doc.sessions[doc.sessions.length - 1] ?? null;
  return last && !last.closedAt ? last : null;
};

export const sessionById = (doc, id) => doc.sessions.find((one) => one.id === id) ?? null;

export const openSegment = (session) => session?.segments.find((one) => one.closedAt === null) ?? null;
// 收活的那一段就是队列里第一个还没关闭的段；排在它后面的段已经在账本里，
// 但它们此刻不收活——前一段判过、关闭了，它才轮到。
// 只有清单预排的段才排队：等结论/等判决时由新活开出来的段照样收活（它不是在排队，
// 它是手上那批活停着、下一条活自然落进去）。
export const takingSegment = (session) => {
  const open = (session?.segments ?? []).filter((one) => one.closedAt === null);
  return open.find((one) => one.plannedAt === null) ?? open[0] ?? null;
};
export const queuedSegments = (session) => {
  const take = takingSegment(session);
  return (session?.segments ?? []).filter((one) => one !== take && one.closedAt === null && one.plannedAt !== null);
};

// 清单、状态与面板印的顺序是同一件事：先按条目自己写的「先后」，没写的排在后面，
// 其余的按写下的次序。顺序只是读起来的样子，它不进门、也不进结论。
export const byOrder = (tasks) =>
  [...tasks].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

export const tasksIn = (session, segment) =>
  byOrder(session.tasks.filter((one) => (segment ? one.segment === segment.id : true)));

export function countIn(session, segment) {
  const tasks = tasksIn(session, segment);
  const count = { total: tasks.length, todo: 0, done: 0, accepted: 0, deferred: 0, dropped: 0 };
  for (const task of tasks) count[task.status] += 1;
  return count;
}

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

// 规模的三条审查设置是内核给的默认值，不由工作区声明：改名换目录的项目照样数得清
// 这次改了几个文件、多少字节、跨了几个顶层目录。工作区若要在自己这一份里改，
// 写 review.size（{ files, bytes, dirs }），审查设置仍要经 config.change 进账本。
const SIZE_DEFAULTS = { files: 5, bytes: 20000, dirs: 2 };

const topDir = (file) => {
  const one = clean(file);
  return one.includes("/") ? one.slice(0, one.indexOf("/")) : one;
};

// 一条路径在交付那一刻有多重。称不出来的（老账本里没称、或者已经删掉的）在求和时按 0 算，
// 但那不是放行：`needsReview` 会先把"说不清多大"的挑出来按要审算，0 只用来把几个顶层目录
// 与文件数数下去，不然一句"不知道"会让整个加法没有结果。
const task_size = (sizes, file) => {
  const value = sizes?.[file];
  return Number.isFinite(value) ? value : 0;
};

function sizeOf(tasks, sizes = {}) {
  const files = [...new Set(tasks.flatMap((task) => [...(task.files ?? []), ...(task.changed ?? [])]))];
  const bytes = files.reduce((sum, file) => sum + (task_size(sizes, file) ?? 0), 0);
  const unknown = files.filter((file) => !Number.isFinite(sizes?.[file])).length;
  const dirs = new Set(files.map(topDir));
  return { files: files.length, bytes, unknown, dirs: dirs.size, list: files };
}

export function needsReview(config, session, segment) {
  // 封存是账本上已经做出的决定：这一段按当时的事实不用审。后来把审查设置写细了，
  // 也不回头改写它——否则一次收紧就能把关闭过的段重新算成"少一份结论"，
  // 而签收只能对着旧账本上那句「没经过审查」自相矛盾。
  if (segment?.sealedBy && segment.closedAt) return false;
  const required = config?.review?.required ?? [];
  const exempt = config?.review?.exempt ?? [];
  const limits = { ...SIZE_DEFAULTS, ...(config?.review?.size ?? {}) };
  const tasks = tasksIn(session, segment);
  if (tasks.length === 0) return false;
  return tasks.some((task) => {
    // What the work touched counts as much as what it declared: a task may not
    // step out of review by describing itself as documentation.
    const files = [...new Set([...(task.files ?? []), ...(task.changed ?? [])])];
    if (files.length === 0) return true;
    if (files.some(escapes)) return true;
    if (matchesAny(files, required)) return true;
    // 小改动才谈得上免审：声明过的路径之外，规模由数得出来的事实说话。
    const size = sizeOf([task], task.sizes ?? {});
    // 称不出规模就不算小：免审是给「数出来确实很小」的改动留的，不是给「说不清多大」的。
    // 交付那一刻会替它称（工作区差里那些文件），所以这条只堵老账本和漏称。
    // 交付自己记下、却没称过的文件，就是说不清多大：按要审算，别按 0 字节放行。
    // 只声明过、这次没交付到的不算——路径本身已经把话说了。
    const pinned = [...new Set((task.evidence ?? []).flatMap((proof) => (proof.files ?? []).map((one) => one.path)))];
    if (pinned.some((file) => !Number.isFinite(task.sizes?.[file]))) return true;
    // 交付真的碰过、却没有重量的路径：删掉的东西原来多大，交付那一刻已经称不出来了。
    // 按 0 字节算等于说"删掉三十 KB 不算大"，所以按要审算。只声明、没碰过的不算——
    // 那类路径审查设置管不着，它连一个字节都没动。
    const unweighed = (task.changed ?? []).filter((file) => !Number.isFinite(task.sizes?.[file]));
    if (unweighed.length > 0) return true;
    if (size.files > limits.files) return true;
    if (size.bytes > limits.bytes) return true;
    if (size.dirs > limits.dirs) return true;
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

// 手上那份清单还新鲜吗：发出去之后这一段没有再动过，也还没有人回答。
// 新鲜的、没人回答的那份，下一步是落结论——再发一份只会让审查者去读旧纸。
export const freshBrief = (session, segment) => {
  const handed = lastBrief(session, segment.id);
  if (!handed) return null;
  // 撤回过的清单不再是"手上这一份"：它作废了，下一步是重新发一份。
  if (handed.withdrawnAt !== undefined) return null;
  if (session.reviews.some((one) => one.scope !== "session" && one.brief === handed.brief)) return null;
  const moved = lastSegmentChange(session, segment);
  if (moved !== null && moved > handed.at) return null;
  return handed;
};

// 一期要做成什么：签收拿它当尺子。可以改，账本留每一次。
export const goalOf = (session) => session?.goal?.text ?? null;

const staleReview = (session, segment) => {
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

// 一条交付什么也没指着，有两种样子：既没记下文件，也没动过任何路径。
// 删掉一个文件也算动了——路径走了，没有字节可记，那不是"没指着"，是它指的那条路径本来就没有字节。
// 这个判断只在这里写一遍：签收、下一步、verify 报的空交付都从它出。
export const pointsAtNothing = (proof) =>
  !proof ||
  ((proof.files ?? []).length === 0 && !proof.path &&

  (proof.changed ?? []).length === 0);

// 复核得靠内容：要审的段里，每条现行交付都得指着点什么。
export const unpinned = (session, segment) =>
  tasksIn(session, segment)
    .filter((one) => one.status === "done" || one.status === "accepted")
    .filter((one) => {
      const claim = one.evidence[one.evidence.length - 1];
      return Boolean(claim) && pointsAtNothing(claim);
    });

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
const voidedReview = (session, segment) => {
  const ever = session.reviews.filter((one) => one.segment === segment?.id);
  return ever.length > 0 && ever.every((one) => one.voidedAt !== null);
};


// ---- 期审：段全关之后，这一期做成的样子还要有人判 --------------------------------------
// 段审判「这一段对不对」，期审判「这一期做成的样子对不对、各段之间说不说得通」。
// 两者不是同一件事的两次：期审不重判段里的条目，它判的是目的与跨段的一致性。
export const lastPeriodBrief = (session) =>
  session.briefs.filter((one) => one.scope === "session").at(-1) ?? null;

// 只有第 20 版起的整期结论算期审：更早那些行回答的是当年那道"签收核对"，
// 一个已经不是今天这层问题的问题。它们照读成历史，不给签收添门，也不当成期审。
export const periodReviewOf = (session) =>
  session.reviews
    .filter((one) => one.scope === "session" && one.voidedAt === null && (one.v ?? 1) >= MEANING.periodReview)
    .at(-1) ?? null;

// 什么时候该期审：段都关了，没有未做、没有已交付未判。没开过段的一期不需要。
export const needsPeriodReview = (session) => {
  if (!session || session.segments.length === 0) return false;
  if (session.tasks.some((one) => one.status === "todo" || one.status === "done")) return false;
  return session.segments.every((one) => one.closedAt !== null);
};

// 期审的清单旧了没有：它发出之后，任何一段又落了结论或又被打开，它就答的不是这一期了。
export const stalePeriod = (session) => {
  const brief = lastPeriodBrief(session);
  if (!brief) return false;
  if (brief.withdrawnAt !== undefined) return false;
  return session.reviews.some((one) => one.scope === "segment" && one.at > brief.at) ||
    session.segments.some((one) => one.closedAt !== null && one.closedAt > brief.at && one.sealedByReview !== undefined);
};

export function periodState(session) {
  if (!needsPeriodReview(session)) return "missing";
  const review = periodReviewOf(session);
  if (review?.verdict === "fail") return "fail";
  if (review?.verdict === "pass") return stalePeriod(session) ? "stale" : "pass";
  return "missing";
}

// 期审清单发出去了、还没人回答。
export const periodFresh = (session) => {
  const brief = lastPeriodBrief(session);
  return Boolean(brief) && brief.answeredBy === null && brief.withdrawnAt === undefined;
};

// 「现在该谁审、清单在哪」：宿主插件拿这一句决定起不起一个审查者，所以它只读、不记账，
// 也不回答"人该按哪一下"——判决与签收是人的手，这里永远不提。
// hand 是复用的名字：同一个段的重审交给同一个审查者（它手上还留着上一份），
// 期审每次一个新名字（它问的是另一个问题，不该带着上一期的结论）。
export function reviewDue(doc, config = null) {
  const session = currentSession(doc);
  if (!session || session.closeKind) return null;
  if (session.segments.length === 0) return null;
  const handOf = (key) => "r-" + String(key).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");

  // 各段都关了才谈期审：那之前插队等于用一份期审清单答一个还没成形的问题。
  if (needsPeriodReview(session)) {
    const state = periodState(session);
    if (state === "pass" || state === "stale") return null;
    const hand = handOf("period-" + session.id);
    const handed = lastPeriodBrief(session);
    if (periodFresh(session))
      return { kind: "period", segment: null, needs: "verdict", hand, brief: handed.brief, guide: handed.guide ?? null };
    return { kind: "period", segment: null, needs: "brief", hand };
  }

  const segment = openSegment(session);
  if (!segment) return null;
  // 审查通过之后这一段在等人判：那一刻没有审查者的活。
  if (segment.verdict === "pass") return null;
  // 审查设置说这一段不用审：它的结局是 agent 封存，不是一份没人答的卷子。
  if (config && !needsReview(config, session, segment)) return null;
  // 还有没交的条目：清单上写的东西还没成形，出了也是旧的。
  if (tasksIn(session, segment).some((one) => one.status === "todo")) return null;
  const hand = handOf(segment.id);
  const handed = freshBrief(session, segment);
  if (handed)
    return { kind: "segment", segment: segment.id, needs: "verdict", hand, brief: handed.brief, guide: handed.guide ?? null };
  return { kind: "segment", segment: segment.id, needs: "brief", hand };
}

export function signBlockers(doc, session, config = null) {
  if (!session) return ["现在没有在推进的会话"];
  const blockers = [];
  if (session.segments.length === 0) blockers.push("还没有交付过任何东西");
  const shut = openSegment(session);
  if (shut) {
    // 要审的段等审查者的 pass；免审的段等交付的人写清凭什么不审。同一句「还没有审查通过」
    // 放在免审段上是假话——没人会来审它。
    const owed = config ? needsReview(config, session, shut) : true;
    if (awaitingJudgement(session, shut))
      blockers.push(shut.id + " 审查通过了，等你判决（这一段过不过，不是审查者说了算）");
    else
      blockers.push(
        owed
          ? shut.id + " 还没有审查通过（审查者判的是这一段通不通过）"
          : shut.id + ' 还没有封存（审查设置说这一段不用审：deed review --segment ' + shut.id + ' --skip --why "凭什么不审" 记下凭什么）',
      );
  }
  // Work owed outside the open segment is what a segment-level view cannot see;
  // inside it, the segment's own blockers already say it.
  const open = openSegment(session);
  const loose = session.tasks.filter((one) => !open || one.segment !== open.id);
  const todo = loose.filter((one) => one.status === "todo");
  const undelivered = loose.filter((one) => one.status === "done");
  if (todo.length > 0) blockers.push(`还有 ${todo.length} 条没做完（${todo.map((one) => one.id).join("、")}）`);
  if (undelivered.length > 0)
    blockers.push(`还有 ${undelivered.length} 条已交付但没判（${undelivered.map((one) => one.id).join("、")}）`);
  const liveTopics = (session.topics ?? []).filter((one) => one.state !== "released");
  if (liveTopics.length > 0)
    blockers.push(`还有 ${liveTopics.length} 个议题等你确认（${liveTopics.map((one) => one.id + (one.state === "draft" ? "成立" : "出口")).join("、")}）`);
  // 段都关了还不算这一期过完：要有人判「这一期做成的样子」。签收压在期审后面。
  if (needsPeriodReview(session)) {
    const state = periodState(session);
    const live = periodReviewOf(session);
    if (state === "missing")
      blockers.push(session.id + " 还没有期审：各段都关了，但这一期做成的样子还没有人判（deed review --all）");
    if (state === "stale")
      blockers.push(session.id + " 的期审结论早于之后的段变动：那份结论回答的不是这一期现在的事（deed review --all 另出一份）");
    if (state === "fail")
      blockers.push(
        session.id + " 的期审不合格还在案（" + (live?.by ?? "谁") + "）：" +
          ((live?.rework ?? []).length > 0 ? (live.rework).join("、") + " 得先重新判过" : "要改就开新一期把要补的记进去"),
      );
  }
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

// 轮次是你和用户之间的一轮对话：数出来的只有人开口的那些。两道关，位置不同：
// 重放按事件含义第 12 版把 agent 自记的轮次丢掉（新账本里根本进不来），
// 这里挡的是那之前的旧行——它们照原样读得出来，计数时不算。
export const userTurns = (session) => session.turns.filter((one) => one.who === "user");

// 议题卡上的"第 N 轮"指的是人开口的那一轮（user turn），按发生顺序数。
// 面板用它把号翻回那句话的锚点；账本里一条轮次原文都不用复制进议题。
// 同一会话的 turns 与 replies 共用时间轴，这里只数 user，与我说的那半分开。
export const turnNumbers = (session) => {
  const numbers = new Map();
  let n = 0;
  for (const one of [...(session.turns ?? [])].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)))
    if (one.who === "user") numbers.set(one.at, ++n);
  return numbers;
};

export const pressure = (session) => {
  const segment = openSegment(session);
  if (!segment) return null;
  const count = countIn(session, segment);
  return { segment: segment.id, tasks: count.total, undecided: count.done };
};

// 一次只做一件事：这一段的条目按状态分四组，正在做的最多一条，其余都在等。
// 已经了结的排在新待办之后（做完的在前、撤回与放弃的在最后）——清单往下读，
// 越往下越是过去的事；新活永远在看得见的那一段里。
export const groupsOf = (tasks) => {
  const ordered = byOrder(tasks);
  const newestFirst = (list) =>
    [...list].sort((a, b) => String(b.touchedAt ?? "").localeCompare(String(a.touchedAt ?? "")));
  const todo = ordered.filter((one) => one.status === "todo");
  const settled = newestFirst(ordered.filter((one) => one.status === "done" || one.status === "accepted"));
  const closed = newestFirst(ordered.filter((one) => one.status === "dropped" || one.status === "deferred"));
  return [
    { key: "doing", label: "在做", tasks: todo.slice(0, 1) },
    { key: "waiting", label: "等着", tasks: todo.slice(1) },
    { key: "settled", label: "已完成", tasks: settled },
    { key: "closed", label: "撤回或放弃", tasks: closed },
  ].filter((one) => one.tasks.length > 0);
};

// 这一刻在做的是哪一条：下一步与清单说的是同一条。
export const doingOf = (tasks) => groupsOf(tasks).find((one) => one.key === "doing")?.tasks[0] ?? null;

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
        who: "reviewer",
        what: "重判这一期",
        text: session.id + " 的期审结论早于之后的段变动：那一次判的不是这一期现在的样子；另出一份重判",
        command: `deed review --all`,
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
      who: "reviewer",
      what: "期审",
      text: session.id + " 的各段都关了（" + session.segments.length + " 段）：这一期做成的样子还没有人判",
      command: `deed review --all`,
    };
  }
  // 审查通过只把这一段交回来：此刻轮到人判，它不是签收，也不是再审。
  if (awaitingJudgement(session, segment))
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
      who: "reviewer",
      what: voidedReview(session, segment) ? "重审" : "审这一段",
      text: `${segment.id} 的 ${count.total} 条都交付了，要一份独立结论`,
      command: `deed review --segment ${segment.id}`,
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
    // 点名的条目改主意不做了：没有活可以重交，放行落下来会把它记为放弃并留下理由。
    const gave = named.filter((one) => one.status === "dropped");
    if (gave.length > 0)
      return {
        who: "reviewer",
        what: "落结论",
        text: `${segment.id} 的不合格（${review.by}）点名了 ${gave.map((one) => one.id).join("、")}，它们改主意不做了：没有活可以重交，放行会把放弃与理由记进账本`,
        command: `deed review --segment ${segment.id} --verdict pass`,
      };
    return {
      who: "reviewer",
      what: "重审",
      text: `${segment.id} 的不合格（${review.by}）还在案，被点名的已经重新交付：另出一份清单再审`,
      command: `deed review --segment ${segment.id}`,
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
    blockers.push("这一段已经有审查结论：结局由那份结论定（要改就开新一期）");
  if (needsReview(config, session, segment))
    blockers.push(`这一段按审查设置要审：结局得由审查者的结论落（deed review --segment ${segment.id}）`);
  return blockers;
}

// 没经过审查就结束的段：签收时要把它们摆出来，别让"免审"变成没人知道。
export function exemptSegments(session) {
  if (!session) return [];
  return session.segments.filter((one) => one.verdict === "exempt");
}