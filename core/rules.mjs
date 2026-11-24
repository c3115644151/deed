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

export const pendingAsks = (session) => session.asks.filter((one) => one.state === "pending");

// 结论块：一句裁定里能带两种行——边界（以后不许这么干）与弃（这件事不做了）。
// 它们是从那句话算出来的，不另立事件、不加字段：账本里那句原话就是唯一的记录。
const EDGE_LINE = /^(边界|弃)\s*[:：]\s*(.*)$/u;
export const edges = (session) => {
  const out = [];
  for (const ask of session.asks ?? []) {
    if (ask.state !== "resolved") continue;
    for (const raw of (ask.decision ?? "").split("\n")) {
      const hit = raw.trim().match(EDGE_LINE);
      if (!hit) continue;
      out.push({
        kind: hit[1] === "边界" ? "border" : "abandon",
        text: hit[2].trim(),
        id: ask.id,
        at: ask.closedAt,
        by: ask.by,
      });
    }
  }
  return out;
};

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
    // 交付那一刻会替它称（工作区差里的与 --digest 指的都称），所以这条只堵老账本和漏称。
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
const freshBrief = (session, segment) => {
  const handed = lastBrief(session, segment.id);
  if (!handed) return null;
  if (session.reviews.some((one) => one.scope !== "session" && one.brief === handed.brief)) return null;
  const moved = lastSegmentChange(session, segment);
  if (moved !== null && moved > handed.at) return null;
  return handed;
};

// 整期清单同理：整期的结论早于最后一次改动，但清单是改动之后发的，那就落结论。
export const freshWholeBrief = (session) => {
  const handed = session.briefs.filter((one) => one.scope === "session").at(-1) ?? null;
  if (!handed) return null;
  if (session.reviews.some((one) => one.scope === "session" && one.brief === handed.brief)) return null;
  const moved = periodChange(session);
  if (moved !== null && moved > handed.at) return null;
  return handed;
};

// 一期要做成什么：签收和整体审都拿它当尺子。可以改，账本留每一次。
export const goalOf = (session) => session?.goal?.text ?? null;

// 整期的在案结论（整体审）。段审的结论不算：它回答的是一批任务。
export const sessionReview = (session) => {
  if (!session) return null;
  const live = session.reviews.filter((one) => one.scope === "session" && !one.voidedAt);
  return live[live.length - 1] ?? null;
};

// 整期最后一次改动：任何一条任务的交付、撤回、增改。
// 整体审的结论早于它，回答的就是旧的一期。
// 那句目的只在多段的一期算改动：一段的一期没有整期清单，目的不进任何人的尺子，
// 拿它去让段结论过期等于凭空要一次重审。
export const periodChange = (session) => {
  if (!session) return null;
  const times = [
    ...session.tasks.flatMap((one) => [
      one.touchedAt,
      ...one.evidence.map((proof) => proof.at),
      ...(one.undone ?? []).map((gone) => gone.at),
    ]),
    session.segments.length > 1 ? (session.goal?.at ?? null) : null,
  ]
    .filter(Boolean)
    .sort();
  return times[times.length - 1] ?? null;
};

// 整期审的状态：没写目的 / 没审过 / 结论过期 / pass / fail。
// 一段的一期先读那一段的结论：同一批活不审两遍，也就不拿目的当尺子。
export function wholeState(session) {
  const changed = periodChange(session);
  if (session && session.segments.length === 1) {
    const only = reviewOf(session, session.segments[0]);
    if (!only) return "missing";
    return changed && only.at < changed ? "stale" : only.verdict;
  }
  if (!goalOf(session)) return "nogoal";
  const review = sessionReview(session);
  if (!review) return "missing";
  return changed && review.at < changed ? "stale" : review.verdict;
}

// 这一期需不需要一次单独的整体审：一段的一期不需要——它的段审就是整期审。
// 多段的一期，只要有一段是审查者看过的（或者还开着、按审查设置要审），签收前就得
// 再有一份落在整期上的结论；全都由 deed seal 封的多段期不要——没人需要看的东西
// 不必再造一份清单。判断只看两件事：这一段有没有结论、还开着的段审查设置怎么判。
// 不拿已封存段的后来字节重量去重算：那会把「审过了」重新变成「该审而没审」，
// 也会让封过的免审段翻回要审（上一轮修的就是这一条）。
export const needsWhole = (config, session) => {
  if (!session || session.segments.length < 2) return false;
  const read = (one) => one.verdict === "pass";
  const owed = (one) => one.verdict !== "exempt" && (config ? needsReview(config, session, one) : true);
  return session.segments.some((one) => read(one) || owed(one));
};

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
  ((proof.files ?? []).length === 0 &&
  !(proof.digest && proof.path) &&
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

// Signing is a session-level judgement, so it looks at the whole session, not
// just the segment that happens to be open.
export function signBlockers(doc, session, config = null) {
  if (!session) return ["现在没有在推进的会话"];
  const blockers = [];
  if (session.segments.length === 0) blockers.push("还没有交付过任何东西");
  const shut = openSegment(session);
  if (shut) {
    // 要审的段等审查者的 pass；免审的段等交付的人写清凭什么不审。同一句「还没有审查通过」
    // 放在免审段上是假话——没人会来审它。
    const owed = config ? needsReview(config, session, shut) : true;
    blockers.push(
      owed
        ? shut.id + " 还没有审查通过（审查者的 pass 就关闭这一段）"
        : shut.id + " 还没有封存（审查设置说这一段不用审：deed seal 记下凭什么不审）",
    );
  }
  // 整期审：签收签的是这一期，最后一句结论该落在它身上。段都封了还没有整体审，
  // 或者整体审的结论早于最后一次改动，都挡签收。一段的一期不走这里——needsWhole
  // 已经把那道门关上：那一段的结论就是整期的结论。
  if (needsWhole(config, session)) {
    const whole = wholeState(session);
    if (whole === "nogoal") blockers.push("还没有写清这一期要做成什么（deed goal \"…\"）");
    else if (whole === "missing") blockers.push(`${session.id} 还没有整体审通过（deed review --all）`);
    else if (whole === "stale") blockers.push(`${session.id} 的整体审结论早于这一期最后一次改动（deed review --all）`);
  }
  // 一整期的结论判了不合格，就是把这一期否掉了：签收前这件事得有人处理。
  // 免审的期上也一样——一份已经记账的不合格，不能因为「审查设置说不用审」就当
  // 它没发生；那样面板上会同时出现一张不合格卡和一句「签收可行」。
  const onWhole = sessionReview(session);
  if (onWhole && onWhole.verdict === "fail")
    blockers.push(
      session.id +
        " 有一次整体审判了不合格（" + onWhole.by + "）：要么重出一份通过的，要么由人推翻（deed judge --overturn " +
        onWhole.id + ' --why "…" --by "…"）',
    );
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

// 轮次是你和用户之间的一轮对话：数出来的只有人开口的那些。两道关，位置不同：
// 重放按事件含义第 12 版把 agent 自记的轮次丢掉（新账本里根本进不来），
// 这里挡的是那之前的旧行——它们照原样读得出来，计数时不算。
export const userTurns = (session) => session.turns.filter((one) => one.who === "user");

// 一段花了多少：几条任务、出过几份清单、重交了几次、开了多久才封。
// 数全在账本里（关闭时刻减开段时刻，不读时钟），只回答「为什么这么慢」，
// 不参与任何门——慢不挡放行，看不见才没法谈省。
export const costOf = (session, segment) => {
  const tasks = session.tasks.filter((one) => one.segment === segment.id);
  const briefs = session.briefs.filter((one) => (one.segment ?? null) === segment.id);
  const undos = tasks.reduce((sum, one) => sum + (one.undone ?? []).length, 0);
  const closed = segment.openedAt && segment.closedAt ? Date.parse(segment.closedAt) - Date.parse(segment.openedAt) : null;
  return { tasks: tasks.length, briefs: briefs.length, undos, minutes: closed === null ? null : Math.round(closed / 60000) };
};

export const pressure = (session) => {
  const segment = openSegment(session);
  if (!segment) return null;
  const count = countIn(session, segment);
  return { segment: segment.id, tasks: count.total, undecided: count.done };
};

// 整期审这一步：缺目的先说目的，清单已交出去就落结论，否则发清单。
function wholeStep(session, whole) {
  const handed = freshWholeBrief(session);
  if (whole === "nogoal")
    return {
      who: "user",
      what: "写目的",
      text: `${session.id} 的活都交付了，账本里还没有「这一期要做成什么」：整体审和签收都拿它当尺子`,
      command: `deed goal "这一期要做成什么" --by "…"`,
    };
  if (handed && whole !== "pass")
    return {
      who: "reviewer",
      what: "落结论",
      text: `整体审的清单已经交出去了：${handed.brief}（这一期 ${session.tasks.length} 条）`,
      command: `deed review --all --by "你是谁" --verdict pass`,
    };
  return {
    who: "reviewer",
    what: whole === "stale" ? "重审整期" : "整体审",
    text:
      whole === "stale"
        ? `${session.id} 的整体审结论早于这一期最后一次改动：它回答的是旧的一期`
        : `${session.id} 的 ${session.tasks.length} 条都交付了，要一份看整期的结论`,
    command: `deed review --all`,
  };
}

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
      text: "范围说完就在清单里写第一条任务：deed plan 出草稿，写清标准，改完 deed submit；段跟着条目开出来",
      command: `deed plan`,
    };
  }
  const segment = openSegment(session) ?? session.segments[session.segments.length - 1];
  const count = countIn(session, segment);
  if (segment.closedAt !== null) {
    if (needsWhole(config, session) && wholeState(session) !== "pass") return wholeStep(session, wholeState(session));
    const blockers = signBlockers(doc, session, config);
    return {
      who: "user",
      what: "签收",
      text: blockers.length === 0 ? `${session.id} 的任务都判过了，等你一句话结束` : blockers.join("；"),
      command: `deed sign --words "<你的原话>" --title "第 ${doc.sessions.length} 期"`,
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
        command: `deed review --segment ${segment.id} --by "你是谁" --verdict pass`,
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
    // 放弃是落过的决定，带着理由：它结清的是"这件事改主意不做了"，不是"还没做"。
    const stuck = named.filter((one) => one.status !== "done" && one.status !== "accepted" && one.status !== "dropped");
    if (stuck.length > 0) {
      // 延后不是放弃：延后的条目还没做完，说了"重新交付"才算说实话。
      const gone = stuck.filter((one) => one.status === "deferred");
      const text =
        gone.length > 0
          ? `${segment.id} 的不合格（${review.by}）压着已经延后的 ${gone.map((one) => one.id).join("、")}：要么重新交付，要么由人推翻那条结论`
          : `${segment.id} 的不合格（${review.by}）还压着：${stuck.map((one) => one.id).join("、")} 没有重新交付${findings > 0 ? `（${findings} 条发现）` : ""}——重新交付，或者由人推翻那条结论`;
      return {
        who: "agent",
        what: "清结论",
        text,
        command: `deed judge --overturn ${review.id} --why "…" --by "…"`,
      };
    }
    // 手上那份清单是审查者的活：清单发出去、还没人回答，下一步是落结论，不是再发一份。
    const handed = freshBrief(session, segment);
    if (handed)
      return {
        who: "reviewer",
        what: "落结论",
        text: `${segment.id} 的不合格（${review.by}）还在案；新的一份清单已经交出去了：${handed.brief}`,
        command: `deed review --segment ${segment.id} --by "你是谁" --verdict pass`,
      };
    // 旧账本里有点名之前写下的不合格：没有可结清的条目，只能由人推翻。
    if (named.length === 0)
      return {
        who: "agent",
        what: "清结论",
        text: `${segment.id} 的不合格（${review.by}）没有点名要重做的条目：没有可结清的东西，只能由人推翻那条结论，或者开新一期`,
        command: `deed judge --overturn ${review.id} --why "…" --by "…"`,
      };
    // 点名的条目改主意不做了：没有活可以重交，放行落下来会把它记为放弃并留下理由。
    const gave = named.filter((one) => one.status === "dropped");
    if (gave.length > 0)
      return {
        who: "reviewer",
        what: "落结论",
        text: `${segment.id} 的不合格（${review.by}）点名了 ${gave.map((one) => one.id).join("、")}，它们改主意不做了：没有活可以重交，放行会把放弃与理由记进账本`,
        command: `deed review --segment ${segment.id} --by "你是谁" --verdict pass`,
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
    command: `deed seal --segment ${segment.id} --why "凭什么不用审" --by "…"`,
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
    blockers.push(`这一段按审查设置要审：结局得由审查者的结论落（deed review --segment ${segment.id}）`);
  return blockers;
}

// 没经过审查就结束的段：签收时要把它们摆出来，别让"免审"变成没人知道。
export function exemptSegments(session) {
  if (!session) return [];
  return session.segments.filter((one) => one.verdict === "exempt");
}