import test from "node:test";
import assert from "node:assert/strict";
import { fold } from "../core/fold.mjs";
import { onTheSheet, settledSince  } from "../core/facts/task.mjs";
import { awaitingJudgement } from "../core/facts/review.mjs";
import {
  byOrder,
  freshBrief,
  reviewDue,
  sheetHolds,
  verdictStands,
  stalePeriod,
  needsReview,
  nextAction,
  reading,
  reviewOf,
  reviewState,
  pointsAtNothing,
  sealBlockers,
  signBlockers,
  reviewable,
  unpinned,
} from "../core/rules.mjs";

const config = { review: { required: ["src/**", "core/**", "apps/**"], exempt: ["docs/**", "*.md"] } };
// 期审：段都关了之后，这一期做成的样子还要有人判。它记在整期上，判的不是条目。
const periodPass = (n, by = "period-1") => [
  { v: 20, at: T(n), k: "review.brief", s: null, scope: "session", goal: "这一期做成什么", by, brief: "period-1.md", briefDigest: "e".repeat(64) },
  { v: 20, at: T(n + 1), k: "review.log", s: null, scope: "session", by, verdict: "pass", brief: "period-1.md", briefDigest: "e".repeat(64), findings: [] },
];
const PERIOD_OWED = "S01 还没有期审：各段都关了，但这一期做成的样子还没有人判（deed review --all）";

const T = (n) => new Date(Date.UTC(2026, 10, 22, 10, n)).toISOString();
const turn = (n) => ({ v: 1, at: T(n), k: "turn", s: null, who: "user", said: "x" });
const add = (n, id, files = []) => ({ v: 1, at: T(n), k: "task.add", s: null, id, title: id, criteria: "c", files });
// A delivery pins a file: evidence that names no content cannot be checked
// later, so the fixtures pin one the way a real run would.
const done = (n, id, path = "core/fold.mjs") => ({ v: 1, at: T(n), k: "task.done", s: null, id, evidence: "ran", by: "agent", digest: "a".repeat(64), digestPath: path, changed: [], bytes: { [path]: 100 } });
const pass = (n, segment = "S01.1") => ({ v: 1, at: T(n), k: "judge.pass", s: null, segment, by: "user" });
const verdict = (n, v, segment = "S01.1") => ({ v: 1, at: T(n), k: "review.log", s: null, segment, by: "qa", verdict: v, brief: "b.md" });
const goal = (n, text = "把这一期收干净") => ({ v: 1, at: T(n), k: "goal.set", s: null, text, by: "user" });
// 现在的结论自己关闭这一段（事件含义第 3 版起）；老账本里的结论只算一句判断。
const sealed = (n, segment = "S01.1") => ({ v: 5, at: T(n), k: "review.log", s: null, segment, by: "qa", verdict: "pass", brief: "b.md", findings: [] });

test("an empty period reads as discussing, a delivered batch as executing, a judged one as accepting", () => {
  assert.equal(reading(fold([])), "idle");
  assert.equal(reading(fold([turn(1)])), "discuss");
  assert.equal(reading(fold([turn(1), add(2, "T1")])), "execute");
  assert.equal(reading(fold([turn(1), add(2, "T1"), done(3, "T1"), pass(4)])), "accept");
});

test("review is required by where a task touched, and undeclared land is disputed land", () => {
  const of = (files) => {
    const session = fold([turn(1), add(2, "T1", files)]).sessions[0];
    return needsReview(config, session, session.segments[0]);
  };
  assert.equal(of(["docs/a.md"]), false);
  assert.equal(of(["README.md"]), false, "根上的 markdown 也算文档");
  assert.equal(of(["notes/x.md"]), false, "*.md 在任何层级都匹配 markdown");
  assert.equal(of(["core/fold.mjs"]), true);
  assert.equal(of(["notes/x.txt"]), true, "没被 exempt 覆盖过的路径要审");
  assert.equal(of([]), true, "没声明路径，就按要审算");
});

// The path a person types and the path a rule sees must be the same path.
test("paths are normalised before they are matched, and an escaping path is never exempt", () => {
  const of = (files) => {
    const session = fold([turn(1), add(2, "T1", files)]).sessions[0];
    return needsReview(config, session, session.segments[0]);
  };
  assert.equal(of(["src\\a.mjs"]), true, "Windows 反斜杠也认得");
  assert.equal(of(["./docs/a.md"]), false);
  assert.equal(of(["docs/../core/fold.mjs"]), true, "绕过 exempt 的写法按要审算");
  assert.equal(of(["C:/Users/x/core/fold.mjs"]), true);
});

test("a segment that needs review cannot be sealed before the verdict lands", () => {
  const doc = fold([turn(1), add(2, "T1", ["core/fold.mjs"]), done(3, "T1")]);
  const session = doc.sessions[0];
  assert.equal(reviewState(config, session, session.segments[0]), "missing");
  assert.deepEqual(sealBlockers(config, session, session.segments[0]), [
    "这一段按审查设置要审：结局得由审查者的结论落（deed review --segment S01.1）",
  ]);
  // 免审段才封得动；要审的那段被封，就是没人看过它却算过了。
  const exempt = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1", "docs/a.md")]);
  assert.deepEqual(sealBlockers(config, exempt.sessions[0], exempt.sessions[0].segments[0]), []);
});

test("a failing review keeps the segment shut until something changes", () => {
  const doc = fold([turn(1), add(2, "T1", ["core/fold.mjs"]), done(3, "T1"), verdict(4, "fail")]);
  const session = doc.sessions[0];
  assert.equal(reviewState(config, session, session.segments[0]), "fail");
  assert.equal(sealBlockers(config, session, session.segments[0]).includes("这一段已经有审查结论：结局由那份结论定（要改就开新一期）"), true);
});

// A reviewer who looks and says no is not overruled by a glob.
test("a failing verdict counts even where review was not required", () => {
  const doc = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1", "docs/a.md"), verdict(4, "fail")]);
  const session = doc.sessions[0];
  assert.equal(reviewState(config, session, session.segments[0]), "fail");
  assert.equal(sealBlockers(config, session, session.segments[0]).some((one) => one.includes("要改就开新一期")), true);
});

test("a reworked delivery has no standing verdict left", () => {
  const doc = fold([
    turn(1), add(2, "T1", ["core/fold.mjs"]), done(3, "T1"),
    verdict(4, "pass"), pass(5),
    { v: 1, at: T(6), k: "judge.rework", s: null, segment: "S01.1", tasks: ["T1"], why: "交付记录不足", by: "qa" },
    done(7, "T1"),
  ]);
  const session = doc.sessions[0];
  assert.equal(reviewOf(session, session.segments[0]), null);
  assert.equal(reviewState(config, session, session.segments[0]), "missing", "要重新审,不能沿用旧结论");
});

// 免审的段没人会来审，所以它等的是封存，不是"审查通过"——同一句话放在这里就是假话。
test("a segment the gate says not to review waits to be sealed, not to be reviewed", () => {
  const doc = fold([
    turn(1),
    add(2, "T1", ["docs/a.md"]),
    { v: 1, at: T(3), k: "task.done", s: null, id: "T1", evidence: "ran", by: "agent", digest: "a".repeat(64), digestPath: "docs/a.md", changed: [], bytes: { "docs/a.md": 100 } },
  ]);
  assert.deepEqual(signBlockers(doc, doc.sessions[0], config), [
    `S01.1 还没有封存（审查设置说这一段不用审：deed review --segment S01.1 --skip --why "凭什么不审" 记下凭什么）`,
  ]);
});

test("signing waits for the judgement and the period review", () => {
  const delivered = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1", "docs/a.md")]);
  assert.deepEqual(signBlockers(delivered, delivered.sessions[0], config), [
    'S01.1 还没有封存（审查设置说这一段不用审：deed review --segment S01.1 --skip --why "凭什么不审" 记下凭什么）',
  ]);
  const clean = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1", "docs/a.md"), pass(4)]);
  assert.deepEqual(signBlockers(clean, clean.sessions[0], config), [PERIOD_OWED], "段判过了也还差期审");
  const judged = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1", "docs/a.md"), pass(4), ...periodPass(6)]);
  assert.deepEqual(signBlockers(judged, judged.sessions[0], config), [], "期审过了才轮到签收");
});

// 段封了不等于这一期过完了：期审判的是另一件事——这一期做成的样子、各段之间说不说得通。
// 签收压在期审后面。
test("the last segment closed is not the end: the period still needs its own judgement", () => {
  const doc = fold([
    turn(1), goal(2),
    add(3, "T1", ["core/a.mjs"]), done(4, "T1"), sealed(5),
    add(6, "T2", ["core/b.mjs"]), done(7, "T2"), sealed(8, "S01.2"),
  ]);
  assert.deepEqual(signBlockers(doc, doc.sessions[0], config), [PERIOD_OWED]);
  assert.equal(nextAction(doc, config).what, "开始期审");
  const after = fold([
    turn(1), goal(2),
    add(3, "T1", ["core/a.mjs"]), done(4, "T1"), sealed(5),
    add(6, "T2", ["core/b.mjs"]), done(7, "T2"), sealed(8, "S01.2"),
    ...periodPass(10),
  ]);
  assert.deepEqual(signBlockers(after, after.sessions[0], config), []);
  assert.equal(nextAction(after, config).what, "签收");
  // 旧账本里那条整期结论（第 9 版写的）不算期审：它回答的是当年那道签收核对。
  const withOldVerdict = fold([
    turn(1), goal(2),
    add(3, "T1", ["core/a.mjs"]), done(4, "T1"), sealed(5),
    { v: 9, at: T(6), k: "review.log", s: null, scope: "session", by: "qa", verdict: "pass", brief: "all.md", briefDigest: "a".repeat(64), findings: [] },
  ]);
  assert.deepEqual(signBlockers(withOldVerdict, withOldVerdict.sessions[0], config), [PERIOD_OWED], "旧结论不作数");
});

// 清单已经交出去，下一步就是落结论——哪怕在案的结论是旧的。
// 再叫一次「另出一份」会让审查者去读一份没人回答过的旧纸，而新的那份已经在他手上。
test("a brief handed out after the last change is answered, not replaced", () => {
  const base = [
    turn(1), goal(2),
    add(3, "T1", ["core/a.mjs"]), done(4, "T1"),
    { v: 5, at: T(5), k: "review.brief", s: null, segment: "S01.1", brief: "S01.1-1.md", briefDigest: "b".repeat(64) },
    sealed(6),
    add(7, "T2", ["core/b.mjs"]), done(8, "T2"), sealed(9, "S01.2"),
    // 签收核对打回 S01.1：那一段重新打开，它自己那条通过结论留史但作废，条目保持交付
    { v: 9, at: T(10), k: "review.log", s: null, scope: "session", by: "qa", verdict: "fail", rework: ["S01.1"], why: "记录说错了", brief: "all.md", briefDigest: "c".repeat(64) },
    done(11, "T1"),
  ];
  const old = fold(base);
  // 签收核对把它那条结论作废了：这一段回到没人判过的样子，不是「结论旧了」。
  assert.equal(reviewState(config, old.sessions[0], old.sessions[0].segments[0]), "missing");
  assert.equal(nextAction(old, config).what, "重新开始审查", "手上那份早于最后一次交付：等人在面板上另起一份");
  const fresh = fold([...base,
    { v: 6, at: T(12), k: "review.brief", s: null, segment: "S01.1", brief: "S01.1-2.md", briefDigest: "d".repeat(64) },
  ]);
  const step = nextAction(fresh, config);
  assert.equal(step.what, "落结论");
  assert.match(step.text, /S01\.1-2\.md/);
  assert.match(step.command, /--verdict pass/);
});

// 期审不重判条目：段里的每条标准只判一次。期审的清单列的是各段的结局与这一期的目的，
// 它要的是另一个问题，不是把段审再过一遍。
test("the period judgement asks a different question, not a second pass over the items", () => {
  const doc = fold([
    turn(1), goal(2),
    add(3, "T1", ["core/a.mjs"]), done(4, "T1"), sealed(5),
    ...periodPass(6),
  ]);
  const session = doc.sessions[0];
  assert.equal(session.reviews.filter((one) => one.scope === "session").length, 1);
  assert.equal(session.reviews.filter((one) => one.scope === "segment").length, 1);
  const period = session.reviews.find((one) => one.scope === "session");
  assert.deepEqual(period.results ?? [], [], "期审没有按条判定");
  assert.equal(nextAction(doc, config).what, "签收");
});

test("the next step names one actor and one action", () => {
  assert.equal(nextAction(fold([]), config).who, "agent");
  assert.equal(nextAction(fold([turn(1)]), config).what, "开段");
  const todo = fold([turn(1), add(2, "T1", ["docs/a.md"])]);
  assert.equal(nextAction(todo, config).who, "agent");
  assert.match(nextAction(todo, config).text, /T1/);
  const unreviewed = fold([turn(1), add(2, "T1", ["core/x.mjs"]), done(3, "T1")]);
  assert.equal(nextAction(unreviewed, config).who, "user");
  assert.match(nextAction(unreviewed, config).text, /开始审查/, "下一步是人在面板上开审，不是替人出清单");
  assert.match(nextAction(unreviewed, config).command, /deed panel/);
  const judged = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1"), pass(4)]);
  assert.equal(nextAction(judged, config).what, "开始期审", "段判过了，下一步是这一期做成的样子（面板上按）");
  assert.match(nextAction(judged, config).command, /deed panel/u);
  const afterPeriod = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1"), pass(4), ...periodPass(6)]);
  assert.equal(nextAction(afterPeriod, config).what, "签收");
});
// 两段都由 deed review --skip 封的期也一样：没人需要写的东西，不该有人等到它。
test("a period whose segments all sat out review signs without anything else", () => {
  const seal = (n, segment) => ({ v: 5, at: T(n), k: "segment.seal", s: null, segment, why: "只动了文档", by: "agent" });
  const doc = fold([
    turn(1), goal(2),
    add(3, "T1", ["docs/a.md"]),
    { v: 1, at: T(4), k: "task.done", s: null, id: "T1", evidence: "ran", by: "agent", digest: "a".repeat(64), digestPath: "docs/a.md", changed: [], bytes: { "docs/a.md": 100 } },
    seal(5, "S01.1"),
    add(6, "T2", ["docs/b.md"]),
    { v: 1, at: T(7), k: "task.done", s: null, id: "T2", evidence: "ran", by: "agent", digest: "a".repeat(64), digestPath: "docs/b.md", changed: [], bytes: { "docs/b.md": 100 } },
    seal(8, "S01.2"),
  ]);
  const session = doc.sessions[0];
  assert.deepEqual(signBlockers(doc, session, config), [PERIOD_OWED], "免审的段也一样要有人判这一期");
  assert.equal(nextAction(doc, config).what, "开始期审");
});
// 规模由数得出来的事实说话：几个文件、多少字节、跨了几个顶层目录。
// 免审是给"看起来很小"的改动留的口子，不是给"说自己很小"的。
test("a small change may sit out review; one that is not small may not", () => {
  const of = (changed, bytes = {}) => {
    const session = fold([
      turn(1), add(2, "T1"),
      { v: 6, at: T(3), k: "task.done", s: null, id: "T1", evidence: "ran", by: "agent",
        files: [{ path: "docs/a.md", digest: "a".repeat(64) }], changed, bytes },
    ]).sessions[0];
    return needsReview(config, session, session.segments[0]);
  };
  assert.equal(of(["docs/a.md", "docs/b.md"], { "docs/a.md": 100, "docs/b.md": 120 }), false, "两份小文档照旧免审");
  assert.equal(of(["docs/a.md", "docs/b.md", "docs/c.md", "docs/d.md", "docs/e.md", "docs/f.md"]), true, "六个文件不算小");
  assert.equal(of(["docs/a.md"], { "docs/a.md": 30000 }), true, "一份 30KB 的文档不算小");
  assert.equal(of(["docs/a.md", "notes/b.md", "drafts/c.md"]), true, "跨了三个顶层目录不算小");
  assert.equal(of(["docs/a.md", "notes/b.md"], { "docs/a.md": 100, "notes/b.md": 100 }), false, "两个顶层目录还在范围内");
});

// 没称过不等于小：说不清多大的改动，审查设置按要审处理。交付那一刻会替它称（工作区差里的、
// --digest 指的都称），所以这条只堵老账本和漏称。
test("a delivery that never weighed its files is not treated as a small one", () => {
  const session = fold([
    turn(1), add(2, "T1", ["docs/a.md"]),
    { v: 1, at: T(3), k: "task.done", s: null, id: "T1", evidence: "ran", by: "agent", digest: "a".repeat(64), digestPath: "docs/a.md", changed: [] },
  ]).sessions[0];
  assert.equal(needsReview(config, session, session.segments[0]), true, "称不出规模，就别指望它按 0 字节放行");
});
// 审查设置后来写细了，不回头改写已经封过的段：封存那一刻的决定留在账本上。
// 少了这一条，一次收紧就能把「全部免审」的期重新算成要审，
// 而签收清单里同时写着「没经过审查」——两句话互相打脸。
test("a segment sealed before the gate got stricter is not pulled back into review", () => {
  const seal = (n, segment) => ({ v: 5, at: T(n), k: "segment.seal", s: null, segment, why: "只动了文档", by: "agent" });
  // 第一条交付称出来 92160 字节（超过默认的 20000）：没有那道守卫，它就该被审——
  // 这样这条用例守的是守卫本身，不是「没称过字节一律要审」那条路。
  const weighed = (n, id, path, size) => ({ v: 1, at: T(n), k: "task.done", s: null, id, evidence: "ran", by: "agent",
    digest: "a".repeat(64), digestPath: path, changed: [path], bytes: { [path]: size } });
  const doc = fold([
    turn(1), goal(2),
    add(3, "T1", ["docs/a.md"]),
    weighed(4, "T1", "docs/a.md", 92160),
    seal(5, "S01.1"),
    add(6, "T2", ["docs/b.md"]),
    weighed(7, "T2", "docs/b.md", 100),
    seal(8, "S01.2"),
  ]);
  const session = doc.sessions[0];
  const [first, second] = session.segments;
  // 审查设置只把 1000 字节当「大」：用例自己说多大的改动算大，不用内核默认的 20000，
  // 否则哪天默认值调大，这条用例就无声地不再为守卫作证。
  const tight = { ...config, review: { ...config.review, size: { bytes: 1000 } } };
  assert.equal(needsReview(tight, session, first), false, "封过就不重算：账本上那句「不用审」还算数");
  assert.equal(needsReview(tight, session, second), false);
  assert.equal(reviewState(tight, session, first), "exempt");
  // 守卫读的是「真写下过一次封存」，所以两个字段都要当着：sealedBy 有名字、
  // closedAt 是那一刻。少了 closedAt 就不算封过——而且这个形状不是手改账本才有的：
  // 旧账本里那句整期上的不合格把它点回来时，fail 分支就留着 sealedBy、把 closedAt 清成 null。
  assert.equal(first.sealedBy, "agent", "封它的是 deed review --skip");
  assert.notEqual(first.closedAt, null, "账本上真写过一次封存");
  assert.equal(needsReview(tight, session, { ...first, closedAt: undefined }), true, "没有 closedAt 就不是封存");
  assert.deepEqual(signBlockers(doc, session, tight), [PERIOD_OWED], "封过的段不再重算，但这一期仍缺期审");
});

// 守卫的另一半：被 pass 封的段没有 exemptions——它照常按今天的审查设置重算。
// 少了这一条，把守卫写成「只要 closedAt 不是 null 就豁免」也能全绿，而那会把
// 审过的段一并免责，与「pass 封的段照样重算」正好相反。
test("a segment a reviewer passed is still weighed, so the exemption is only for a seal", () => {
  const heavy = (n, id, path) => ({ v: 1, at: T(n), k: "task.done", s: null, id, evidence: "ran", by: "agent",
    digest: "a".repeat(64), digestPath: path, changed: [path], bytes: { [path]: 92160 } });
  const session = fold([turn(1), goal(2), add(3, "T1", ["docs/a.md"]), heavy(4, "T1", "docs/a.md"), sealed(5, "S01.1")]).sessions[0];
  const first = session.segments[0];
  assert.equal(first.sealedBy, null, "关闭这一段的是结论，不是 deed review --skip");
  assert.equal(needsReview(config, session, first), true, "这一份 92160 字节，今天的审查设置会把它送去审");
  assert.equal(reviewState(config, session, first), "pass", "可它已经有人看过：结局不因此改变");
  assert.equal(first.sealedBy, null, "半封存不在这条上");
});

// 半个封存的真实来路：签收核对把一条写在 deed review --skip 封过的段里的任务点回来，段被重新打开——
// 留着 sealedBy（写过封存的人），closedAt 清成 null。这不是手改账本才出现的形状，
// 而是 fail 分支每天都会造出来的；对它按审查设置重算是本意，所以这条用例要跟着它走。
test("an old period verdict that named a segment reopens it, and that half-seal is weighed again", () => {
  const seal = (n, segment) => ({ v: 5, at: T(n), k: "segment.seal", s: null, segment, why: "只动了文档", by: "agent" });
  const whole = (n) => ({ v: 9, at: T(n), k: "review.log", s: null, scope: "session", by: "qa", verdict: "fail",
    brief: "b.md", briefDigest: "a".repeat(64), why: "S01.1 的结论没对上这一期", rework: ["S01.1"] });
  const session = fold([
    turn(1), goal(2),
    add(3, "T1", ["core/a.mjs"]), done(4, "T1", "core/a.mjs"), seal(5, "S01.1"),
    add(6, "T2", ["docs/b.md"]), done(7, "T2", "docs/b.md"),
    whole(8),
  ]).sessions[0];
  const first = session.segments[0];
  assert.equal(first.sealedBy, "agent", "写过封存的人还留在这一格上");
  assert.equal(first.closedAt, null, "可这一段已经被签收核对打回、重新打开");
  assert.equal(needsReview(config, session, first), true, "半个封存不算封过：按今天的审查设置重算");
});

// 守卫的语义要直接写下来：只删东西的交付指着它动过的那条路径，不算「什么也没指着」。
// 不写这条，两条删除用例删掉之后这半条守卫就没有任何用例看着（上一轮 T60 就是这么漏的）。
test("a delivery that points at nothing is told apart from one that points at a path it removed", () => {
  assert.equal(pointsAtNothing({ files: [], changed: [] }), true, "什么都没指");
  assert.equal(pointsAtNothing({}), true, "老形状里什么都没有");
  assert.equal(pointsAtNothing(null), true, "还没有交付：调用点不必先记得判空");
  assert.equal(pointsAtNothing({ changed: ["docs/gone.md"] }), false, "删掉一条路径也算指着它");
  assert.equal(pointsAtNothing({ path: "docs/a.md" }), false, "老账本里记下的那条路径");
  assert.equal(pointsAtNothing({ files: [{ path: "docs/a.md" }] }), false, "记下了一组路径");
});


// 旧账本里那句整期上的不合格照读：它点名的段重新打开，段里的条目保持交付。
// 但它回答的是当年那道"签收核对"，不是今天的期审：它挡不了签收，也不算期审过。
test("an old period verdict is history: the segment it named reopens, nothing else", () => {
  const whole = (n, verdict, rework) => ({ v: 9, at: T(n), k: "review.log", s: null, scope: "session", by: "qa",
    verdict, brief: "all-" + n + ".md", briefDigest: "a".repeat(64),
    ...(verdict === "fail" ? { rework, why: "那一段的结论没对上这一期" } : {}) });
  const doc = fold([turn(1), goal(2),
    add(3, "T1", ["core/a.mjs"]), done(4, "T1", "core/a.mjs"), sealed(5, "S01.1"),
    add(6, "T2", ["core/b.mjs"]), done(7, "T2", "core/b.mjs"), sealed(8, "S01.2"),
    whole(9, "fail", ["S01.1"]),
  ]);
  assert.equal(doc.sessions[0].segments[0].closedAt, null, "被点名的段重开了");
  const reopened = fold([...[turn(1), goal(2),
    add(3, "T1", ["core/a.mjs"]), done(4, "T1", "core/a.mjs"), sealed(5, "S01.1"),
    add(6, "T2", ["core/b.mjs"]), done(7, "T2", "core/b.mjs"), sealed(8, "S01.2"),
    whole(9, "fail", ["S01.1"])],
    { v: 18, at: T(10), k: "review.log", s: null, segment: "S01.1", by: "qa2", verdict: "pass", brief: "b.md", briefDigest: "a".repeat(64), findings: [] },
  ]);
  assert.deepEqual(signBlockers(reopened, reopened.sessions[0], config), [PERIOD_OWED], "段重新判过，这一期还差期审");
  assert.equal(nextAction(reopened, config).what, "开始期审");
});



// 清单、state 与面板印的是同一个顺序：先按 先后，没写的排后面。
test("tasks are read in the order they were given, and the ones without one come after", () => {
  const tasks = [
    { id: "T3", order: 2 },
    { id: "T1", order: null },
    { id: "T2", order: 1 },
  ];
  assert.deepEqual(byOrder(tasks).map((one) => one.id), ["T2", "T3", "T1"]);
});

// T97：期审清单发出那一刻已有的段才算它的范围；之后预备段里新加的活、新的交付不让它过期。
test("a period brief goes stale only for segments that existed when it went out", () => {
  const at = "2026-01-02T01:00:00Z";
  const make = () => ({
    segments: [
      { id: "S01.1", openedAt: "2026-01-01T00:00:00Z", closedAt: "2026-01-01T12:00:00Z" },
      { id: "S01.2", plannedAt: "2026-01-02T02:00:00Z", openedAt: "2026-01-02T02:00:00Z", closedAt: null },
    ],
    briefs: [{ scope: "session", at, answeredBy: null }],
    reviews: [{ scope: "session", at, v: 20, verdict: "pass", voidedAt: null }],
    tasks: [
      { id: "T1", segment: "S01.1", status: "done" },
      { id: "T2", segment: "S01.2", status: "done" },
    ],
  });
  assert.equal(stalePeriod(make()), false, "发出之后什么都没动：结论还是这一期的");

  // 发出之后预备段（S01.2，发出那一刻还不存在）里又加活、又交付：不让这一期作废。
  const later = make();
  later.tasks.push({ id: "T3", segment: "S01.2", status: "done" });
  assert.equal(stalePeriod(later), false, "新段里的新活不算这一期变了");

  // 但那一份结论若是对**当时已有**的段下的（且在这之后），这一期就变了。
  const touched = make();
  touched.reviews.push({ scope: "segment", segment: "S01.1", at: "2026-01-02T03:00:00Z" });
  assert.equal(stalePeriod(touched), true, "已有段在发出之后又落了结论");
});

// 一段走过一轮之后，"要不要再审"按这一份清单真要判的条目算：判过、之后没动过的沿用，
// 不再把这一段的审查设置算作凭据。否则只要段里躺过一条碰过 core/** 的旧交付，
// 这段永远都要审——"判过的不再判"就白写了。
test("whether a segment needs another review is asked of the items still open, not all of them", () => {
  const doc = fold([
    turn(1), goal(2),
    add(3, "T1", ["core/fold.mjs"]), add(4, "T2", ["docs/b.md"]), done(5, "T1"),
    { v: 1, at: T(6), k: "task.done", s: null, id: "T2", evidence: "ran", by: "agent", digest: "b".repeat(64), digestPath: "docs/b.md", changed: ["docs/b.md"], bytes: { "docs/b.md": 100 } },
    { v: 35, at: T(7), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "pass", brief: "b.md", findings: [], results: [{ id: "T1", verdict: "met" }, { id: "T2", verdict: "met" }] },
    { v: 1, at: T(8), k: "task.add", s: null, id: "T3", title: "T3", criteria: "c", files: ["docs/c.md"] },
    { v: 1, at: T(9), k: "task.done", s: null, id: "T3", evidence: "ran", by: "agent", digest: "c".repeat(64), digestPath: "docs/c.md", changed: ["docs/c.md"], bytes: { "docs/c.md": 90 } },
  ]);
  const session = doc.sessions[0];
  // T1（碰过 core/**）已经判过、之后没动过：它不参与下一份清单，也就不再把这段拖进审查。
  assert.equal(needsReview(config, session, session.segments[0]), false, "新的一条只碰 docs/** 的小改动，这段不必再出清单");
});

// 判过之后这一段又有了新活：那份结论判的不是现在的内容，"等你判决"这句话就不成立——
// 下一步是把新活做完、再出一份清单，而不是让一个人去判一份已经不对的东西。
test("a pass that the segment has outgrown asks for the new work, not for a judgement", () => {
  const doc = fold([
    turn(1), goal(2), add(3, "T1", ["core/fold.mjs"]), done(4, "T1"),
    { v: 35, at: T(5), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "pass", brief: "b.md", findings: [], results: [{ id: "T1", verdict: "met" }] },
    { v: 1, at: T(6), k: "task.add", s: null, id: "T2", title: "T2", criteria: "c", files: ["core/rules.mjs"] },
  ]);
  const step = nextAction(doc, config);
  assert.equal(step.who, "agent");
  assert.equal(step.what, "交付", "先做新的一条");
  assert.match(step.text, /T2/u);
});

// 一段审查通过、之后又进了新活：那份结论判的不是现在的内容，"等你判决"就不成立。
// 以前 reviewDue 只看 segment.verdict，回空——该谁审这一步谁都不动，作者在那边干等。
test("a pass the segment has outgrown asks for a new sheet instead of a verdict", () => {
  const ledger = [
    turn(1), goal(2), add(3, "T1", ["core/fold.mjs"]), done(4, "T1"),
    { v: 35, at: T(5), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "pass", brief: "b.md", findings: [], results: [{ id: "T1", verdict: "met" }] },
    { v: 1, at: T(6), k: "task.add", s: null, id: "T2", title: "T2", criteria: "c", files: ["core/rules.mjs"] },
    done(7, "T2"),
  ];
  const doc = fold(ledger);
  const session = doc.sessions[0];
  const due = reviewDue(doc, config);
  assert.equal(due.needs, "brief", "该重新出一份清单");
  assert.equal(due.segment, "S01.1");
  assert.equal(verdictStands(session, session.segments[0]), false, "过期的 pass 不算数");
  assert.deepEqual(signBlockers(doc, session, config), ["S01.1 还没有审查通过（审查者判的是这一段通不通过）"], "不再说等判决");
});

// 清单一变就换，会把审查者手上的活反复作废：一份也判不完，作者每交一条就换一份。
// 清单是一份固定的卷子——不在这份卷子上的条目是下一份的事。
test("a new entry does not invalidate the sheet in the reviewer's hands", () => {
  const ledger = [
    turn(1), goal(2), add(3, "T1", ["core/fold.mjs"]), done(4, "T1"),
    { v: 36, at: T(5), k: "review.brief", s: null, segment: "S01.1", by: "agent", brief: "s1.md", guide: "s1-reviewer.md", tasks: ["T1"] },
    { v: 1, at: T(6), k: "task.add", s: null, id: "T2", title: "T2", criteria: "c", files: ["core/rules.mjs"] },
    { v: 1, at: T(7), k: "task.done", s: null, id: "T2", evidence: "ran", by: "agent", digest: "b".repeat(64), digestPath: "core/rules.mjs", changed: ["core/rules.mjs"], bytes: { "core/rules.mjs": 100 } },
  ];
  const doc = fold(ledger);
  const session = doc.sessions[0];
  assert.equal(sheetHolds(session, session.segments[0]), true, "卷子上的 T1 没动过，这份清单还算数");
  assert.equal(freshBrief(session, session.segments[0]).brief, "s1.md", "手上还是那一份，不另出一份");
  // 但结论要是 pass，它不覆盖 T2——所以它不能算"这一段已经审过"。
  const judged = fold([...ledger, { v: 35, at: T(8), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "pass", brief: "s1.md", findings: [], results: [{ id: "T1", verdict: "met" }] }]);
  assert.equal(verdictStands(judged.sessions[0], judged.sessions[0].segments[0]), false, "T2 没在这份结论里，pass 不算覆盖这一段");
});

// 沿用只在有在案结论时成立：期审把这一段点名重开（它的 pass 被顶掉），
// 这一段每一条都要重新过一遍，不能拿一份不存在的结论放行。
test("carried judgements do not outlive the conclusion they hang on", () => {
  const ledger = [
    turn(1), goal(2), add(3, "T1", ["core/fold.mjs"]), done(4, "T1"),
    { v: 36, at: T(5), k: "review.brief", s: null, segment: "S01.1", by: "agent", brief: "s1.md", guide: "s1-reviewer.md", tasks: ["T1"] },
    { v: 35, at: T(6), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "pass", brief: "s1.md", findings: [], results: [{ id: "T1", verdict: "met" }] },
    { v: 20, at: T(7), k: "review.brief", s: null, scope: "session", by: "qa", brief: "p1.md", briefDigest: "e".repeat(64) },
    { v: 35, at: T(8), k: "review.log", s: null, scope: "session", by: "qa", verdict: "fail", brief: "p1.md", findings: [], rework: ["S01.1"], why: "这一段说得不对" },
  ];
  const doc = fold(ledger);
  const session = doc.sessions[0];
  const seg = session.segments[0];
  assert.equal(reviewOf(session, seg), null, "期审把那一段的结论顶掉了");
  assert.equal(needsReview(config, session, seg), true, "没有在案结论，这一段得重新过一遍");
});

// 结论一落就把上一份的逐条判定全作废，会让"判过的不再判"永远不成立：
// 作废的是"这一段现在由谁说了算"，不是"当初那一条判成什么"。
test("per-item judgements outlive the conclusion that was superseded", () => {
  const brief = (n, name, tasks) => ({ v: 36, at: T(n), k: "review.brief", s: null, segment: "S01.1", by: "agent", brief: name, guide: name + "-r.md", tasks });
  const log = (n, results, brief) => ({ v: 35, at: T(n), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "pass", brief, findings: [], results });
  const ledger = [
    turn(1), goal(2), add(3, "T1", ["core/fold.mjs"]), add(4, "T2", ["core/rules.mjs"]), done(5, "T1"), done(6, "T2"),
    brief(7, "a.md", ["T1", "T2"]),
    log(8, [{ id: "T1", verdict: "met" }, { id: "T2", verdict: "met" }], "a.md"),
    { v: 1, at: T(9), k: "task.done", s: null, id: "T2", evidence: "改了一版", by: "agent", digest: "b".repeat(64), digestPath: "core/rules.mjs", changed: ["core/rules.mjs"], bytes: { "core/rules.mjs": 90 } },
    brief(10, "b.md", ["T2"]),
    log(11, [{ id: "T2", verdict: "met" }], "b.md"),
  ];
  const doc = fold(ledger);
  const session = doc.sessions[0];
  const t1 = session.tasks.find((one) => one.id === "T1");
  const t2 = session.tasks.find((one) => one.id === "T2");
  assert.equal(settledSince(session, t1)?.verdict, "met", "T1 没动过：它那一判还在，第二份清单不必展开它");
  assert.equal(settledSince(session, t2)?.verdict, "met", "T2 改过之后又被判了，新判定算数");
  // 被推翻才是"判错了"：那一判不能再沿用。
  const overturned = fold([
    ...ledger,
    { v: 1, at: T(12), k: "review.overturn", s: null, review: "R2", why: "这判不对", by: "user" },
  ]).sessions[0];
  assert.equal(settledSince(overturned, overturned.tasks.find((one) => one.id === "T2")), null, "被推翻的那一判不再沿用");
});

// 先判 pass 再判 fail：不合格把这一段交回执行。段头还挂着 pass 的话，
// 冻结、判决按钮、签收差三处会一起说错话（今天就是被这一格挡住的）。
test("a fail after a pass takes the segment back into execution, not into judgement", () => {
  const ledger = [
    turn(1), goal(2), add(3, "T1", ["core/fold.mjs"]), done(4, "T1"),
    { v: 36, at: T(5), k: "review.brief", s: null, segment: "S01.1", by: "agent", brief: "a.md", guide: "a-r.md", tasks: ["T1"] },
    { v: 35, at: T(6), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "pass", brief: "a.md", findings: [], results: [{ id: "T1", verdict: "met" }] },
    { v: 36, at: T(7), k: "review.brief", s: null, segment: "S01.1", by: "agent", brief: "b.md", guide: "b-r.md", tasks: ["T1"] },
    { v: 35, at: T(8), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "fail", brief: "b.md", findings: [], rework: ["T1"], why: "没过", results: [{ id: "T1", verdict: "unmet" }] },
  ];
  const session = fold(ledger).sessions[0];
  const seg = session.segments[0];
  assert.equal(seg.verdict, null, "段头不再挂 pass");
  assert.equal(awaitingJudgement(session, seg), false, "不再等你判决");
  assert.equal(onTheSheet(session, "S01.1", "T1"), false, "清单已经回答过，这一段不再冻着");
});

// 一次不合格之后立刻再出一份清单，判的是同一批字节、同一个问题：审查者一个接一个起，
// 作者被一次次叫醒，中间没人改过东西。出清单要有理由——自上一份结论以来这一段变过。
test("a fail without new work does not summon another sheet", () => {
  const ledger = [
    turn(1), goal(2), add(3, "T1", ["core/fold.mjs"]), done(4, "T1"),
    { v: 36, at: T(5), k: "review.brief", s: null, segment: "S01.1", by: "agent", brief: "a.md", guide: "a-r.md", tasks: ["T1"] },
    { v: 35, at: T(6), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "fail", brief: "a.md", findings: [], rework: ["T1"], why: "没过", results: [{ id: "T1", verdict: "unmet" }] },
  ];
  const doc = fold(ledger);
  assert.equal(reviewDue(doc, config), null, "没有新改动：不出清单，该动手的是作者");
  const moved = fold([...ledger, { v: 1, at: T(7), k: "task.done", s: null, id: "T1", evidence: "改了一版", by: "agent", digest: "c".repeat(64), digestPath: "core/fold.mjs", changed: ["core/fold.mjs"], bytes: { "core/fold.mjs": 90 } }]);
  assert.equal(reviewDue(moved, config)?.needs, "brief", "改过之后才出清单");
});
