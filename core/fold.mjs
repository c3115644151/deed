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

const blank = () => ({ v: 1, sessions: [], changes: [], config: null, project: null });

const lastSession = (doc) => doc.sessions[doc.sessions.length - 1] ?? null;

function newSession(doc, at) {
  const session = {
    id: `S${String(doc.sessions.length + 1).padStart(2, "0")}`,
    openedAt: at,
    closedAt: null,
    closeKind: null,
    title: null,
    words: null,
    // 原文的两半：turns 是人说的，replies 是我说的。两边都不参与规则。
    turns: [],
    replies: [],
    goal: null,
    goals: [],
    tasks: [],
    asks: [],
    // 讨论域的三层：原文在 turns，要点是 agent 记下的句子，议题由要点统合而来。
    points: [],
    topics: [],
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
  // 号由已有的段推出来（最大号 +1）：旧账本里段号就是按这个走的，重放才落到同一段。
  const top = session.segments.reduce((max, one) => Math.max(max, Number(one.id.split(".").pop()) || 0), 0);
  const segment = {
    carried,
    id: `${session.id}.${top + 1}`,
    openedAt: at,
    closedAt: null,
    plannedAt: null,
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

// 下一个段：队列里最后一个还没关闭的段（清单排好的就是它）。
const nextOpen = (session) => session.segments.filter((one) => one.closedAt === null).at(-1) ?? null;

// 空着的"下一段"不是一个段：它是某次改段开出来又没接住活的格子，留着会让下一条新活
// 落进一个谁也没打算做的段。
const settle = (session) => {
  session.segments = session.segments.filter(
    (one) =>
      // 清单排过的那一段即使还空着也算数；自己开出来的空格子不算——它会让下一条活
      // 落进一个谁也没打算做的段。
      !(one.plannedAt === null && one.closedAt === null && one.verdict === null) ||
      session.tasks.some((task) => task.segment === one.id) ||
      session.briefs.some((brief) => brief.segment === one.id),
  );
};

// 这条判断从账本含义第 11 版起生效，之前的行按当时的样子重放：
// 老账本里没有这个规矩，拿今天的规矩重排，会把这些行里写死的段号（比如一次打回说
// 「T8 退回 S01.1」）判成坏账——整本账再也重放不动，而那并不是当初写错。
function segmentOf(session, at, v = 1) {
  settle(session);
  const open = session.segments.filter((one) => one.closedAt === null);
  // 清单排过段以后，新活落在收活的那一段（排队中的段只由清单往里放）；
  // 没排过段时按旧读法：落在最末那个未关闭段。
  const planned = open.some((one) => one.plannedAt !== null);
  const last = planned ? open.find((one) => one.plannedAt === null) ?? open[0] : open.at(-1);
  if (!last) return nextSegment(session, at);
  const waiting = awaitingVerdict(session, last) || (v >= MEANING.judgement && awaitingJudgement(session, last));
  if (v < 11 || !waiting) return last;
  // 等结论/等判决时新写的活自己开一段。
  return nextSegment(session, at, true);
}

// 任务碰过哪些路径、各多大，只由还在的交付说得算。交付退回（撤回，或者审查者点名
// 重做把那条交付清掉）之后，它碰过的字节就不再是这段工作的性质；所以每动一次交付
// 就重算一遍，不靠逐条加减——加减漏一处，审查设置就会拿一批已经不存在的工作去判要不要审。
const rederive = (task) => {
  const paths = [];
  const sizes = {};
  for (const proof of task.evidence) {
    // 交付自己记下的文件也算碰过：老账本里的单文件交付没有工作区差可量（changed 为空），
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
        session.turns.push({
          at: ev.at,
          who: ev.who,
          said: ev.said,
          did: ev.did ?? null,
          ...(ev.via === undefined ? {} : { via: ev.via, origin: ev.origin ?? null, mid: ev.mid ?? null }),
        });
        break;
      }
      case "reply": {
        const session = sessionOf(doc, ev);
        session.replies.push({
          at: ev.at,
          text: ev.text,
          ...(ev.via === undefined ? {} : { via: ev.via, origin: ev.origin ?? null, mid: ev.mid ?? null }),
        });
        break;
      }
      // 项目声明：这个工作区是不是一个项目、是哪一类、它自己怎么分层。声明是账本
      // 事实（可改，旧的那份留在历史里），而"认没认出这是本项目"是算出来的，不是记下来的。
      case "project.declare": {
        doc.project = {
          at: ev.at,
          by: ev.by ?? null,
          shape: ev.shape,
          background: ev.background ?? "",
          layers: (ev.layers ?? []).map((one) => {
            const dir = String(one.dir).replace(/^\/+|\/+$/gu, "");
            // 角色是"这个目录在范式里算哪一格"：目录名可以跟范式不一样（cli 是 app），
            // 但要说清它是哪一格，否则"结构对不对"就没有可判的东西。
            return {
              role: String(one.role ?? dir).replace(/^\/+|\/+$/gu, ""),
              dir,
              mayImport: Array.isArray(one.mayImport) ? [...one.mayImport] : [],
            };
          }),
          extras: (ev.extras ?? []).map((one) => String(one).replace(/^\/+|\/+$/gu, "")),
        };
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
        // 清单已经把这条活排进某一段时，就落在那一段：它可能还在排队，
        // 收不收活是规则的事，重放只负责把行读对。
        const planned = ev.segment === undefined ? null : session.segments.find((one) => one.id === ev.segment) ?? null;
        if (ev.segment !== undefined && !planned) noway(`账本里没有段 ${ev.segment}：条目不能落在没声明过的段上`);
        if (planned && planned.closedAt !== null) noway(`段 ${planned.id} 已经关闭：新条目进不去`);
        const segment = planned ?? segmentOf(session, ev.at, ev.v ?? 1);
        // 从议题里拆出来的条目：账本记下议题号，议题那头记下出口了哪几条。
        // 出口不是新事件，是「有一条条目来自它」这件事本身——事实只有一个主人。
        const home = ev.topic === undefined || ev.topic === null ? null : session.topics.find((one) => one.id === ev.topic) ?? null;
        if (ev.topic !== undefined && ev.topic !== null && !home) noway(`账本里没有议题 ${ev.topic}：条目不能来自没立过的议题`);
        if (home) {
          if (home.state !== "released") noway(`议题 ${home.id} 还没锁定出口：它还不能拆成任务`);
          home.exportedAt = home.exportedAt ?? ev.at;
          home.exported = [...(home.exported ?? []), ev.id];
        }
        session.tasks.push({
          id: ev.id,
          title: ev.title,
          criteria: ev.criteria,
          // 任务自带依据：能点回原文的锚点。标题自己说清要解决什么现象。
          source: ev.source ?? null,
          topic: home ? home.id : null,
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
      // 给已有任务补上下文：这是记录层面的事，不改标题、标准、状态，也不换字节。
      // 老任务缺的就是这三条——补上之后陌生 agent 才有出处可读。
      case "task.context": {
        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        if (ev.source !== undefined) task.source = ev.source;
        break;
      }
      // 标题改正：换成人话，旧说法留在账本历史里（这一行本身）。
      case "task.title": {
        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        task.title = ev.title;
        break;
      }
      // 标准改正：标准里写的命令已经不在命令面上时，把它改成今天说得通的那句话。
      // 旧标准留在历史里；做没做完仍由状态回答，这一行不碰状态。
      case "task.criteria": {
        const session = sessionOf(doc, ev);
        const task = taskOf(session, ev.id);
        task.criteria = ev.criteria;
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
        // 老账本里的单文件交付记的是 digest + digestPath；新行记一串路径。
        // Both shapes read the same way from here on: one entry per file.
        const files =
          ev.files !== undefined
            ? ev.files.map((one) => ({ path: one.path }))
            : ev.digestPath
              ? [{ path: ev.digestPath }]
              : [];
        task.evidence.push({
          claim: ev.evidence,
          by: ev.by,
          at: ev.at,
    
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
            task.touchedAt = ev.at;
            // 它走空的那一段是个只剩计划的地方：自己开出来的段由条目生出来，条目回来了，
            // 段也就不该在（清单里排过的那一段留着，它是账本上写下的计划）。
            if (left.plannedAt === null && !session.tasks.some((one) => one.segment === left.id))
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
          undoes: ev.undoes ?? last.files ?? (last.path ? [{ path: last.path }] : []),
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
        // 新的写法（含义第 24 版起）：目标是下一个还没关闭的段——清单排好的那个就是它。
        if (meaningOf(ev) >= MEANING.segmentsPlanned) {
          const at0 = session.segments.findIndex((one) => one.id === task.segment);
          const after = session.segments.slice(at0 + 1).find((one) => one.closedAt === null) ?? null;
          if (after) task.segment = after.id;
          else
            noway(
              task.id + " 已经在最末那一段 " + task.segment +
                " 里：改到下一段得先有下一段——在清单里加一节 ## 段，submit 时领号",
            );
        } else {
          // 旧行按当时那套读法逐字重放（那时"下一段"是个自己开出来的格子）：
          // 从它里面再改出去时原地不动，否则落进去，没有就开一个。
          const prep =
            session.segments
              .filter(
                (one) =>
                  one.closedAt === null &&
                  one.carried &&
                  !awaitingVerdict(session, one) &&
                  session.tasks.some((other) => other.segment === one.id),
              )
              .at(-1) ?? null;
          if (prep && prep.id === task.segment && meaningOf(ev) >= MEANING.carryOut) {
            const delivered = session.tasks.some(
              (one) => one.segment === task.segment && (one.status === "done" || one.status === "accepted" || one.status === "dropped"),
            );
            if (!delivered)
              noway(
                `${task.id} 已经在下一段 ${task.segment} 里，而这一段还没有交过的活：先在这一段做完，或者先交一条`,
              );
            prep.carried = false;
            task.segment = nextSegment(session, ev.at, true).id;
          } else if (prep) task.segment = prep.id;
          else task.segment = nextSegment(session, ev.at, true).id;
        }
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
      // 要点：没有状态，写下来就在。它可以先散着，议题成立时被收编。
      case "point.add": {
        const session = sessionOf(doc, ev);
        if (!/^P\d+$/u.test(String(ev.id))) noway(`要点号要写成 P1：${ev.id}`);
        // 更新同一个要点：同一个 id 再落一行，旧行留在账本里，重放只留最新那句。
        const source = ev.replaces ? session.points.find((one) => one.id === ev.replaces) : null;
        if (ev.replaces && !source) noway(`账本里没有要点 ${ev.replaces}：改要点要点名已有的那一条`);
        if (source) {
          if (source.absorbedBy) noway(`要点 ${source.id} 已经被 ${source.absorbedBy} 收编：它是议题的历史来源，改要开新议题`);
          session.points = session.points.filter((one) => one !== source);
          for (const t of session.topics) t.points = t.points.filter((one) => one !== source.id);
        } else if (taken(session, ev.id)) noway(`这个会话里已经有 ${ev.id} 了：改内容用同一个 id 再记一条（deed point ${ev.id} "…"）`);
        session.ids.add(ev.id);
        const wanted = ev.topic ?? source?.topic ?? null;
        let topic = null;
        if (wanted) {
          topic = session.topics.find((one) => one.id === wanted);
          if (!topic) noway(`账本里没有议题 ${wanted}：要点挂不上`);
          if (topic.state === "released") noway(`议题 ${topic.id} 已经锁定出口：新要点挂在它上面要开新议题`);
        }
        const absorbedBy = topic && topic.state === "established" ? topic.id : null;
        // 记下这条要点是「第几轮人话」：面板据此把议题卡上的号链回原文。
        // 只数到这条要点记下那一刻为止的 user 轮，晚来的轮次不倒填；老账本没有这个字段照读。
        const round = session.turns.filter((one) => one.who === "user" && one.at <= ev.at).length || null;
        session.points.push({
          id: ev.id, text: ev.text, at: ev.at,
          topic: topic ? topic.id : null, absorbedBy, round,
        });
        if (topic) topic.points.push(ev.id);
        break;
      }
      // 议题：先由 agent 统合要点写出草稿，人确认成立，再人确认锁定出口。
      case "topic.create": {
        const session = sessionOf(doc, ev);
        const source = ev.replaces ? session.topics.find((one) => one.id === ev.replaces) : null;
        if (ev.replaces && !source) noway(`账本里没有议题 ${ev.replaces}：改正文要点名已有的议题`);
        if (source && source.state === "released") noway(`议题 ${source.id} 已经锁定出口：正文不往回改`);
        if (!source && taken(session, ev.id)) noway(`这个会话里已经有 ${ev.id} 了`);
        if (!/^I\d+$/u.test(String(ev.id))) noway(`议题号要写成 I1：${ev.id}`);
        session.ids.add(ev.id);
        if (source) session.topics = session.topics.filter((one) => one !== source);
        const listed = ev.points ?? [];
        for (const id of listed) {
          const point = session.points.find((one) => one.id === id);
          if (!point) noway(`账本里没有要点 ${id}：议题不能统合不存在的句子`);
          if (point.absorbedBy && point.absorbedBy !== ev.id) noway(`要点 ${id} 已经被 ${point.absorbedBy} 收编：同一句不能统合两次`);
        }
        // 成立到出口之间仍在讨论：改正文保留已成立的状态，不把它打回草稿。
        session.topics.push({
          id: ev.id, title: ev.title, body: ev.body ?? "", at: ev.at, by: ev.by ?? null,
          state: source?.state ?? "draft", points: [...listed],
          establishedAt: source?.establishedAt ?? null, establishedBy: source?.establishedBy ?? null,
          releasedAt: source?.releasedAt ?? null, releasedBy: source?.releasedBy ?? null,
          exportedAt: source?.exportedAt ?? null, exported: source?.exported ?? [],
        });
        // 已成立的议题：新收编进来的要点直接算它的历史来源，不再散在活跃清单。
        if (source?.state === "established")
          for (const id of listed) {
            const point = session.points.find((one) => one.id === id);
            if (point) point.absorbedBy = ev.id;
          }
        break;
      }
      case "topic.establish": {
        const session = sessionOf(doc, ev);
        const topic = session.topics.find((one) => one.id === ev.id);
        if (!topic) noway(`账本里没有议题 ${ev.id}`);
        if (topic.state !== "draft") noway(`议题 ${topic.id} 已经${topic.state === "established" ? "成立" : "锁定"}：账本不往回改`);
        const named = ev.points ?? topic.points;
        for (const id of named) {
          const point = session.points.find((one) => one.id === id);
          if (!point) noway(`账本里没有要点 ${id}`);
          if (point.absorbedBy && point.absorbedBy !== topic.id)
            noway(`要点 ${id} 已经被 ${point.absorbedBy} 收编：不能重复收编`);
        }
        // 正文从账本里带过来：面板按的是同一份草稿，不能让页面上另写一份成文。
        if (!String(ev.body ?? topic.body).trim()) noway(`议题 ${topic.id} 还没有正文：统合后的正文要先写下来`);
        topic.body = String(ev.body ?? topic.body);
        topic.state = "established";
        topic.establishedAt = ev.at;
        topic.establishedBy = ev.by ?? null;
        topic.points = [...new Set([...topic.points, ...named])];
        for (const id of topic.points) {
          const point = session.points.find((one) => one.id === id);
          if (point) { point.absorbedBy = topic.id; point.topic = topic.id; }
        }
        break;
      }
      case "topic.release": {
        const session = sessionOf(doc, ev);
        const topic = session.topics.find((one) => one.id === ev.id);
        if (!topic) noway(`账本里没有议题 ${ev.id}`);
        if (topic.state !== "established") noway(`议题 ${topic.id} 还没成立：先按成立那一下`);
        topic.state = "released";
        topic.releasedAt = ev.at;
        topic.releasedBy = ev.by ?? null;
        break;
      }
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
      // 清单预排的那一段：先声明，次序就是账本里的次序；它此刻不收活。
      case "segment.plan": {
        const session = sessionOf(doc, ev);
        if (session.segments.some((one) => one.id === ev.segment)) noway(`这个会话里已经有段 ${ev.segment}`);
        const segment = nextSegment(session, ev.at);
        segment.id = ev.segment;
        segment.plannedAt = ev.at;
        break;
      }
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
