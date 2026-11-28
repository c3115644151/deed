// policy/review: 该不该审、清单过没过期、结论立不立得住。
// 审查能不能开始也只有这一处说得算（面板、命令行、钩子都问它）。
import { tasksIn } from "./task.mjs";
import { settledSince } from "../facts/task.mjs";
import { lastSegmentChange, openSegment } from "./segment.mjs";
import { currentSession } from "./session.mjs";
import { lastPeriodBrief, needsPeriodReview, periodFresh, periodState } from "./period.mjs";

export const voidedReview = (session, segment) => {
  const ever = session.reviews.filter((one) => one.segment === segment?.id);
  return ever.length > 0 && ever.every((one) => one.voidedAt !== null);
};


import { clean, escapes, globToRegExp, matchesAny } from "../facts/paths.mjs";


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


// 这一段此刻有没有可判的东西：一条交付都没有、也没有在案结论时，出清单只是让审查者
// 去读"这一段什么也没做"。以前这里只数条目数，于是三条放弃的段也起了一次审查。
// 已经有结论在案的段不算：打回之后条目被放弃，那一份结论仍要落回来（它要记下"点名的那条
// 改主意不做了"）——没有结论，这一段关不掉。
export const reviewable = (session, segment) => {
  if (!segment) return false;
  const tasks = tasksIn(session, segment);
  const judged = (session.reviews ?? []).some((one) => one.segment === segment.id && one.voidedAt === null);
  return judged || tasks.some((one) => one.status === "done" || one.status === "accepted");
};


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
  // 一个段走过几轮之后，大部分条目早就判过、之后也没动过——它们不会再进下一份清单。
  // 判断"这一段要不要审"要按**这一份清单真要判的**来算：沿用的一律不算，否则一段
  // 只要有过一次要审的交付，它永远都要审，"判过的不再判"这件事就白写了。
  // 沿用只在"这一段还有一份在案结论"时成立：结论被后一份顶掉、或者被期审点名重开，
  // 这一段的每一条都要重新过一遍——那时沿用就是拿一份不存在的结论放行。
  const standing = reviewOf(session, segment);
  const kept = standing && standing.verdict === "pass";
  const fresh = kept ? tasks.filter((task) => settledSince(session, task) === null) : tasks;
  if (fresh.length === 0) return false;
  return fresh.some((task) => {
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


// The document the reviewer is holding for this segment: the last one handed
// out. A verdict answers this one or it is answering something nobody read.
export const lastBrief = (session, segmentId) =>
  session.briefs.filter((one) => one.segment === segmentId).at(-1) ?? null;

// 手上那份清单还新鲜吗：发出去之后这一段没有再动过，也还没有人回答。
// 新鲜的、没人回答的那份，下一步是落结论——再发一份只会让审查者去读旧纸。
// 清单是一份固定的卷子：它写的是"这几条、这几份交付"。段里新加的条目不在卷子上，
// 它们进的是下一份——以前任何一次交付都让整份清单作废，于是作者每交一条就换一份，
// 审查者手上的活被反复作废，一份也判不完。
const movedSince = (session, segment, at, only = null) => {
  const times = tasksIn(session, segment)
    .filter((one) => only === null || only.includes(one.id))
    .flatMap((one) => [one.touchedAt, ...one.evidence.map((proof) => proof.at), ...(one.undone ?? []).map((gone) => gone.at)])
    .filter(Boolean)
    .sort();
  const last = times[times.length - 1] ?? null;
  return last !== null && last > at;
};

const sheetOf = (brief) => (Array.isArray(brief?.tasks) ? brief.tasks : null);


export const sheetHolds = (session, segment) => {
  const handed = lastBrief(session, segment.id);
  if (!handed || handed.withdrawnAt !== undefined) return false;
  if (session.reviews.some((one) => one.scope !== "session" && one.brief === handed.brief)) return false;
  return !movedSince(session, segment, handed.at, sheetOf(handed));
};


export const freshBrief = (session, segment) => {
  const handed = lastBrief(session, segment.id);
  if (!handed) return null;
  // 撤回过的清单不再是"手上这一份"：它作废了，下一步是重新发一份。
  if (handed.withdrawnAt !== undefined) return null;
  if (session.reviews.some((one) => one.scope !== "session" && one.brief === handed.brief)) return null;
  return sheetHolds(session, segment) ? handed : null;
};


// 一句结论算不算数，看它判的那份内容还是不是现在这份。三处（下一步、该谁审、签收）
// 各自判一遍"pass 还成不成立"，就会各说各话：本该重审的段，一处说等判决、一处说没due。
export const verdictStands = (session, segment) => {
  if (!segment || segment.verdict !== "pass") return false;
  const review = reviewOf(session, segment);
  if (!review) return false;
  // 还有没交付的条目：这一段还没做完，判决不该落（pass 说的是"这一段做成这样就够了"）。
  if (tasksIn(session, segment).some((one) => one.status === "todo")) return false;
  const delivered = tasksIn(session, segment).filter((one) => one.status === "done" || one.status === "accepted");
  // 老账本里的结论没有逐条判定：那时"判过"就是整段，只能按时间算。
  if (!Array.isArray(review.results) || review.results.length === 0) {
    const moved = lastSegmentChange(session, segment);
    return !(moved !== null && moved > review.at);
  }
  return delivered.every((one) => {
    // 沿用的判定也算：清单只展开要重判的那几条，判过又没动过的不在 results 里。
    const verdict = review.results.find((r) => r.id === one.id) ?? settledSince(session, one);
    if (!verdict) return false;
    // 判过之后这一条又动过：那句判定说的是旧内容。
    const moved = [one.touchedAt, ...one.evidence.map((proof) => proof.at), ...(one.undone ?? []).map((gone) => gone.at)]
      .filter(Boolean)
      .some((at) => at > review.at);
    return !moved;
  });
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
  if (review?.verdict === "pass" && !verdictStands(session, segment)) return "stale";
  if (!needsReview(config, session, segment)) return review?.verdict === "pass" ? "pass" : "exempt";
  return review?.verdict === "pass" ? "pass" : "missing";
}


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
  // 审查通过、而且那份结论判的还是现在这份内容：那一刻轮到人判，没有审查者的活。
  // 结论过期（之后又交了活）就得重新出清单——否则这一段永远停在"等判决"，
  // 该审的那一步谁都不动，作者在那边干等。
  if (verdictStands(session, segment)) return null;
  // 审查设置说这一段不用审：它的结局是 agent 封存，不是一份没人答的卷子。
  if (config && !needsReview(config, session, segment)) return null;
  // 一条交付都没有（全是没做、或全是放弃）：没有可判的东西，不出清单。
  if (!reviewable(session, segment)) return null;
  // 还有没交的条目：清单上写的东西还没成形，出了也是旧的。
  if (tasksIn(session, segment).some((one) => one.status === "todo")) return null;
  const hand = handOf(segment.id);
  const handed = freshBrief(session, segment);
  if (handed)
    return { kind: "segment", segment: segment.id, needs: "verdict", hand, brief: handed.brief, guide: handed.guide ?? null };
  // 出清单要有理由：**自上一份结论以来，这一段真的变过**。
  // 少了这一条，一次不合格之后会立刻再出一份清单——判的是同一批字节、同一个问题，
  // 于是"判 → 不合格 → 再判"自己转起来：审查者一个接一个起，作者被一次次叫醒，
  // 而中间没有任何人改过东西。回不合格之后该动手的是作者，不是审查者。
  const judged = reviewOf(session, segment);
  if (judged) {
    const moved = lastSegmentChange(session, segment);
    if (moved === null || moved <= judged.at) return null;
  }
  return { kind: "segment", segment: segment.id, needs: "brief", hand };
}
