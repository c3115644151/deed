// fold: the ledger -> the document everything else reasons about.
// Pure: the same lines always produce the same document, and there is no clock
// in here (times come from the events themselves).
//
// Fold is also the gate. An event that would create an impossible state throws
// here first, and the CLI folds before it appends, so a refused action never
// reaches the ledger. Nothing outside this file decides what can be written.

import { MEANING, UnknownKindError, meaningOf } from "./events.mjs";

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
    if (last.closedAt) noway(`会话 ${last.id} 已经结束：先记一轮，会话自己开出来`);
    return bind(last);
  }
  const found = doc.sessions.find((one) => one.id === ev.s);
  if (!found) noway(`账本里没有这个会话：${ev.s}`);
  if (found.closedAt)
    noway(`会话 ${found.id} 已经结束（${found.closeKind === "signed" ? "签收" : "归档"}），不能再往里写`);
  return bind(found);
}

// A segment opens itself when something first lands in it: it is a view reset
// after a verdict, not a thing anyone schedules. 新活落进最新那个开段：一段送审之后
// 还在等结论，它不再收东西，改到下一段的条目和新写的条目都往下走。
function nextSegment(session, at, carried = false) {
  const segment = {
    // 这一段是改到下一段的条目开的：它就是预备段，别为每一条开一个新段。
    carried,
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

// 这一段手上那份清单还没人回答，它就是"{等结论}"的状态：新活不再往里放，自己开下一段。
// 决定收不收活的地方必须在这一层——只在 submit 里挡，重放出来的段仍会多出一条任务。
// 这一段手上那份清单还没人回答：它就是等结论的样子。清单里写新条目时也要问同一句
// ——新条目落不落进这一段，只由这里说得算。
export const awaitingVerdict = (session, segment) => {
  // 只有手上最后那一份算数：再出一份清单，前一份没人回答也不再是这一段的"等结论"。
  // 按"有哪一份没被回答"去判，一段只要发过两回就永远解不开——第二份被回答，第一份还挂着 null。
  const last = (session.briefs ?? [])
    .filter((one) => one.scope === "segment" && one.segment === segment.id)
    .at(-1);
  return Boolean(last) && last.answeredBy === null && last.withdrawnAt === undefined;
};

// 含义第 23 版起，审查通过只是把这一段交回给人：判别的是用户，段在手那一刻还没关闭。
export const awaitingJudgement = (session, segment) =>
  Boolean(segment) && segment.closedAt === null && segment.verdict === "pass";

// 清单没被回答之前，这一段是冻结的：要么审，要么先把清单撤回再改。从账本含义第 19 版
// 起这么读；旧行按当时的样子重放——那时边审边改是允许的，拿今天的话去判它们是坏账。
// 第 23 版起多一格：审查通过了、等你判决的这段时间同样不收交付——审查者判的是那份字节，
// 人在判之前又换掉了它，判决落在一份没人看过的内容上。
export const frozenFor = (session, segmentId, meaning) => {
  if (meaning < MEANING.freeze) return false;
  const segment = session.segments.find((one) => one.id === segmentId);
  if (awaitingVerdict(session, segment)) return true;
  return meaning >= MEANING.judgement && awaitingJudgement(session, segment);
};

// 预备段只有一个：已经接着活的那个就是它，后来改到下一段的、新写的都往里放。
// 「改到下一段的条目」若每次都开一个新段，一次讨论改三批就成了三段，等结论期间谁也说不清
// 下一批活算哪一段的。
const livePrep = (session) =>
  session.segments
    .filter(
      (one) =>
        one.closedAt === null &&
        one.carried &&
        // 预备段一旦自己也送了审，它就不再是预备段：它是又一批在等结论的活。
        !awaitingVerdict(session, one) &&
        session.tasks.some((task) => task.segment === one.id),
    )
    // 接着往里放的是最后一个：从预备段里再改出去时，新开的那个才是"下一段"。
    .at(-1) ?? null;

// 空着的预备段不是一个段：它是某次改段开出来又没接住活的格子，留着会让下一条新活落进
// 一个谁也没打算做的段。
const settle = (session) => {
  session.segments = session.segments.filter(
    (one) =>
      !(one.carried && one.closedAt === null && one.verdict === null) ||
      session.tasks.some((task) => task.segment === one.id) ||
      session.briefs.some((brief) => brief.segment === one.id),
  );
};

// 这条判断从账本含义第 11 版起生效，之前的行按当时的样子重放：
// 老账本里没有这个规矩，拿今天的规矩重排，会把这些行里写死的段号（比如一次打回说
// 「T8 退回 S01.1」）判成坏账——整本账再也重放不动，而那并不是当初写错。
function segmentOf(session, at, v = 1) {
  settle(session);
  const last = session.segments.filter((one) => one.closedAt === null).at(-1);
  if (!last) return nextSegment(session, at);
  const waiting = awaitingVerdict(session, last) || (v >= MEANING.judgement && awaitingJudgement(session, last));
  if (v < 11 || !waiting) return last;
  // 等结论时新写的活自己开一段，并记成预备段：它是最末那个开段，所以再没有第二处预备
  // 可去——预备段一旦也送了审，它就只是又一批等结论的活，同样的判断在这里也成立。
  return nextSegment(session, at, true);
}

// 任务碰过哪些路径、各多大，只由还在的交付说得算。交付退回（撤回，或者审查者点名
// 重做把那条交付清掉）之后，它碰过的字节就不再是这段工作的性质；所以每动一次交付
// 就重算一遍，不靠逐条加减——加减漏一处，审查设置就会拿一批已经不存在的工作去判要不要审。
const rederive = (task) => {
  const paths = [];
  const sizes = {};
  for (const proof of task.evidence) {
    // 交付自己记下的文件也算碰过：手工 --digest 交付没有工作区差可量（changed 为空），
    // 只认 changed 就会让审查设置看不见它到底动了哪一份字节。
    const touched = [...(proof.changed ?? []), ...(proof.files ?? []).map((one) => one.path)];
    for (const one of touched) if (!paths.includes(one)) paths.push(one);
    Object.assign(sizes, proof.sizes ?? {});
  }
  task.changed = paths;
  task.sizes = sizes;
  return task;
};

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
        session.turns.push({ at: ev.at, who: ev.who, said: ev.said, did: ev.did ?? null });
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
        const segment = segmentOf(session, ev.at, ev.v ?? 1);
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
          // 撤回过的放弃：放弃错了撤回来，这条任务要能说清它走过那一遭。
          revived: [],
          // 同段里谁先做。它不进门也不进结论，只决定印出来的顺序。
          order: ev.order ?? null,
          changed: [],
          sizes: {},
          deferredWhy: null,
        });
        break;
      }
      case "task.done": {
        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        // 冻结不在这里拦：账本里的行是已经发生的事实，重放不因为「这一段后来送了审」
        // 就把它判成坏账——读的一侧只读，拦在写的一侧（cli/session.mjs 的 refuseFrozen）。
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
          // 交付那一刻称的各路径大小，随这条交付走：交付退回，它称过的数也一起退。
          sizes: ev.bytes ?? {},
          // 交付时跑的那条命令与它报的条数：清单上的数从这一格读，不从文本读。
          run: ev.run ?? null,
          expects: ev.expects ?? [],
          // 一批 submit 落了好几条交付时，工作区只量了一次差：改动的归属是整批，
          // 不是其中某一条。账本把这件事写下来，读的人就不会以为每条各记了各的。
          batch: ev.batch
            ? typeof ev.batch === "string"
              ? { at: ev.batch, size: null }
              : { at: ev.batch.at ?? null, size: ev.batch.size ?? null }
            : null,
        });
        // What the delivery actually moved in the workspace, computed before the
        // event landed. The review threshold reads this, not the task's own story
        // about which paths it touched.
        // 每个路径多大，是交付那一刻称的；规则拿它判"这次改动小到不用审"。
        rederive(task);
        break;
      }
      // 交付说错了话，只能收回，不能改写：撤回是一条新事实，最后那条交付
      // 退回未做，理由留在任务上——审查清单要能说清哪一条不算数。
      case "task.undo": {
        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        // 撤回放弃、撤回一条改到下一段不改这里的字节，是记录层面的事；撤回一条交付会换掉
        // 审查者手上的文件——那一半拦在写的一侧。
        task.touchedAt = ev.at;
        // 撤回也可以是撤回一条放弃/延后：账本只追加，撤的是它此刻的效力，不是那一行
        // 记录。放弃错了却只能新开一条，等于让账本里的错口径一直挂着，而新开的那条
        // 与旧的说的又是同一件事（事件含义第 15 版）。
        if (task.status === "dropped" || task.status === "deferred") {
          task.revived.push({ from: task.status, why: ev.why, by: ev.by ?? "agent", at: ev.at });
          task.status = "todo";
          task.deferredWhy = null;
          break;
        }
        // 撤回也可以是撤回一条「改到下一段」：段不是排期工具，把活挪进下一段只该发生在
        // 「这一段要送审了」那一刻。挪错了得能挪回来，否则账本里会留下一个只为计划而生
        // 的段，而计划不是事实（事件含义第 16 版）。
        if (task.status === "todo" && task.evidence.length === 0 && (task.undone ?? []).length === 0) {
          const where = session.segments.findIndex((one) => one.id === task.segment);
          const before = where > 0 ? session.segments[where - 1] : null;
          const left = session.segments[where] ?? null;
          if (before && left === session.segments[session.segments.length - 1]) {
            task.segment = before.id;
            before.carried = true;
            task.touchedAt = ev.at;
            // 它走空的那一段就是个只剩计划的地方：段由条目生出来，条目回来了，段也就不该在。
            if (!session.tasks.some((one) => one.segment === left.id))
              session.segments = session.segments.filter((one) => one !== left);
            break;
          }
        }
        const last = task.evidence[task.evidence.length - 1];
        if (!last) noway("任务 " + task.id + " 没有可撤回的交付");
        task.evidence.pop();
        // 撤回的那条还带着它的批号：剩下同批的那条，数目不能因为撤回而变小。
        // 也带着它记下的内容：撤回之后账本里再没有那句话，而"它当时指着哪份字节"
        // 是别人复核这条撤回的唯一依据——不留，撤回就成了没法核对的一句话。
        task.undone.push({
          claim: last.claim,
          why: ev.why,
          by: ev.by ?? "agent",
          at: ev.at,
          batch: last.batch ?? null,
          undoes: ev.undoes ?? last.files ?? (last.digest && last.path ? [{ path: last.path, digest: last.digest }] : []),
          changed: last.changed ?? [],
        });
        // 撤回的交付不再替这些字节说话：这一段碰过的路径与大小重新由还在的交付算。
        rederive(task);
        task.status = task.evidence.length > 0 ? "done" : "todo";
        break;
      }
      // 这一段送审之后就不再收新活：没做的条目改到下一段，等一下段开出来。
      // 开路只有这一条——放弃（drop）说的是「不做了」，写不成「换个时候做」。
      case "task.carry": {
        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);

        if (task.status !== "todo")
          noway(`${task.id} 不是还没动手的条目（${task.status}）：只有没做的能改到下一段`);
        // 一批改到下一段会连着写好几十行：预备段接过活就接着往里放，
        // 不然十三条未做的条目会开出十三个各含一条的段；第二批又开一个新的，就成了两个预备段。
        const prep = livePrep(session);
        // 旧行按它写的时候那套含义读：那时从预备段里改出去是原地不动（v14 之前）。
        if (prep && prep.id === task.segment && meaningOf(ev) >= MEANING.carryOut) {
          // 「改到下一段」说的是别处的段。已经站在预备段里再往里改就是原地不动：那一段
          // 既有没做的、又永远出不了清单（清单要等交付完），于是它一路堆到收不了尾。
          // 所以只在一种情况下这么写有意义：这一段已经有交过的活、正要送审。那时把没做的
          // 挪进新开的预备段，而这一段从此不再接新活（它不是预备段了）。
          const delivered = session.tasks.some(
            (one) => one.segment === task.segment && (one.status === "done" || one.status === "accepted" || one.status === "dropped"),
          );
          if (!delivered)
            noway(
              `${task.id} 已经在预备段 ${task.segment} 里，而这一段还没有交过的活：改到下一段说的是「这一段要送审了，没做的先挪开」——先在这一段做完，或者先交一条`,
            );
          prep.carried = false;
          task.segment = nextSegment(session, ev.at, true).id;
        } else if (prep) task.segment = prep.id;
        else task.segment = nextSegment(session, ev.at, true).id;
        task.touchedAt = ev.at;
        settle(session);
        break;
      }
      // 清单上给一条已经写下的活排个先后：乱序不是错，但读的人得看得见顺序。
      case "task.order": {
        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        task.order = ev.order;
        task.touchedAt = ev.at;
        break;
      }
      case "task.defer":
      case "task.drop": {
        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        editable(session, task);
        // 延后与放弃是记录层面的决定，换不掉审查者手上的字节：冻结不禁它们。
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
      // 一期要做成什么：签收和签收核对都比着它。可以改，改一次记一条，
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
        // 签收核对的清单覆盖整期：它没有段这一格，也不该被某一段的封存挡在外面。
        const segment = scope === "session" ? null : segmentById(session, ev.segment);
        if (segment && sealed(segment))
          noway(`段 ${segment.id} 已经封存：账本不往回改，要补的开新一期`);
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
      // 撤回一份还没被回答的清单：它不是"过期"，是一个人在账本上签了"这一份不作数"。
      // 撤回之后这一段回到执行态，可以继续改；清单本身留着（谁、为什么撤回都在这一行）。
      case "review.withdraw": {
        const session = sessionOf(doc, ev);
        const segment = segmentById(session, ev.segment);
        if (segment.closedAt !== null) noway(`段 ${segment.id} 已经关闭：没有正在等结论的清单可撤回`);
        const handed = session.briefs.find(
          (one) => one.scope === "segment" && one.segment === segment.id && one.brief === ev.brief,
        );
        if (!handed) noway(`这一段的清单里没有 ${ev.brief}：撤回的是发出去过的那一份`);
        if (handed.answeredBy !== null) noway(`${ev.brief} 已经被回答过了：撤回答不了的旧话，账本只往后加`);
        if (handed.withdrawnAt !== undefined) noway(`${ev.brief} 已经撤回过了`);
        handed.withdrawnAt = ev.at;
        handed.withdrawnBy = ev.by;
        handed.withdrawnWhy = ev.why;
        break;
      }
      case "review.log": {
        const session = sessionOf(doc, ev);
        // 两种对象：一段（整体审）或整期（签收核对）。整期没有"段"这一格，
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
          // 整体审说的是这一段的活，签收核对说的是这一期的活：同一句话，两种说法。
          const hand = segment ? "段" : "活";
          noway(
            `${subject} 的 ${ownWork.join("、")} 是 ${ev.by} 交付的：同一个人不能判自己交付的${hand}（换一个 --by，或让用户判）`,
          );
        }
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
          files: (one.files ?? []).map((file) => ({ path: file.path, digest: file.digest })),
        }));
        // 按条判定说的是段：期审判的是这一期做成的样子，没有"每条标准"这回事。
        if (meaning >= MEANING.perItem && ev.verdict === "pass" && segment) {
          const judged = new Set(results.map((one) => one.id));
          const bare = inScope
            .filter((one) => one.status !== "dropped" && one.status !== "deferred")
            .filter((one) => !judged.has(one.id))
            .map((one) => one.id);
          if (bare.length > 0)
            noway(`pass 要每条都判过：${bare.join("、")} 还没有判定（--result T1=met 这样逐条写）`);
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
        break;
      }
      // 判决：审查通过之后由人按的那一下，它才是这一段的结局。段里已交付的条目转成
      // 「已收下」，段头记下判决时刻与是谁判的。判之前它必须已经在审查里过过一遍。
      case "verdict.pass": {
        const session = sessionOf(doc, ev);
        const home = session.segments.find((one) => one.id === ev.segment);
        if (!home) noway(`这个会话里没有段 ${ev.segment}`);
        if (home.closedAt !== null) noway(`${home.id} 已经判过了（${home.closedAt}）：账本不往回改`);
        if (home.verdict !== "pass") noway(`${home.id} 还没有审查通过：判决在审查通过之后才按得下去`);
        for (const task of session.tasks)
          if (task.segment === home.id && task.status === "done") task.status = "accepted";
        home.judgedAt = ev.at;
        home.judgedBy = ev.by;
        home.closedAt = ev.at;
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
          break;
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
          noway(`段 ${segment.id} 后面还有 ${newest.id}：先把它结束，再回打这一段`);
        for (const id of ev.tasks) {
          const task = taskOf(session, id);
          if (task.segment !== segment.id)
            noway(`任务 ${task.id} 不在段 ${segment.id} 里（它在 ${task.segment}），打回不能跨段`);
          task.status = "todo";
          task.evidence = [];
          task.deferredWhy = null;
          rederive(task);
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
          // 谁按的这一下、从哪按的：命令行不给这条路，账本要读得出是人按的。
          session.sign = { words: ev.words, by: ev.by ?? null, via: ev.via ?? null, at: ev.at };
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
