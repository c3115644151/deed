import test from "node:test";
import assert from "node:assert/strict";
import { fold } from "../core/fold.mjs";
import {
  byOrder,
  edges,
  needsReview,
  nextAction,
  reading,
  reviewOf,
  reviewState,
  costOf,
  pointsAtNothing,
  sealBlockers,
  signBlockers,
} from "../core/rules.mjs";

const config = { review: { required: ["src/**", "core/**", "apps/**"], exempt: ["docs/**", "*.md"] } };
const T = (n) => new Date(Date.UTC(2026, 10, 22, 10, n)).toISOString();
const turn = (n) => ({ v: 1, at: T(n), k: "turn", s: null, who: "user", said: "x" });
const add = (n, id, files = []) => ({ v: 1, at: T(n), k: "task.add", s: null, id, title: id, criteria: "c", files });
// A delivery pins a file: evidence that names no content cannot be checked
// later, so the fixtures pin one the way a real run would.
const done = (n, id, path = "core/fold.mjs") => ({ v: 1, at: T(n), k: "task.done", s: null, id, evidence: "ran", by: "agent", digest: "a".repeat(64), digestPath: path, changed: [], bytes: { [path]: 100 } });
const pass = (n, segment = "S01.1") => ({ v: 1, at: T(n), k: "judge.pass", s: null, segment, by: "user" });
const verdict = (n, v, segment = "S01.1") => ({ v: 1, at: T(n), k: "review.log", s: null, segment, by: "qa", verdict: v, brief: "b.md" });
const ask = (n) => ({ v: 1, at: T(n), k: "ask.raise", s: null, id: "A1", text: "要兼容旧账吗", reading: "不兼容", why: "不确定" });
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
  assert.equal(sealBlockers(config, session, session.segments[0]).includes("这一段已经有审查结论：结局由那份结论定（deed judge --overturn 只用来推翻它）"), true);
});

// A reviewer who looks and says no is not overruled by a glob.
test("a failing verdict counts even where review was not required", () => {
  const doc = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1", "docs/a.md"), verdict(4, "fail")]);
  const session = doc.sessions[0];
  assert.equal(reviewState(config, session, session.segments[0]), "fail");
  assert.equal(sealBlockers(config, session, session.segments[0]).some((one) => one.includes("deed judge --overturn")), true);
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
    "S01.1 还没有封存（审查设置说这一段不用审：deed seal 记下凭什么不审）",
  ]);
});

// 它给的命令得真能敲通：从管道里跑没人能替你填名字，--by 必须写在命令里。
test("the step it names is a command that carries its own name", () => {
  const doc = fold([
    turn(1),
    add(2, "T1", ["docs/a.md"]),
    { v: 1, at: T(3), k: "task.done", s: null, id: "T1", evidence: "ran", by: "agent", digest: "a".repeat(64), digestPath: "docs/a.md", changed: [], bytes: { "docs/a.md": 100 } },
  ]);
  const step = nextAction(doc, config);
  assert.equal(step.what, "封存");
  assert.match(step.command, /--by /u);
});

test("signing waits for the judgement and for every open question", () => {
  const delivered = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1", "docs/a.md")]);
  assert.deepEqual(signBlockers(delivered, delivered.sessions[0], config), [
    "S01.1 还没有封存（审查设置说这一段不用审：deed seal 记下凭什么不审）",
  ]);
  const asked = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1", "docs/a.md"), pass(4), ask(5)]);
  assert.deepEqual(signBlockers(asked, asked.sessions[0], config), ["还有 1 条待裁（A1）"]);
  const clean = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1", "docs/a.md"), pass(4)]);
  assert.deepEqual(signBlockers(clean, clean.sessions[0], config), []);
});

// 签收只看各段的结论与条件：段都封了就该签收，整期上没有第二道审查。
// 旧账本里落过一句整期上的结论，它照读（历史事实），但不添任何门。
test("every segment's verdict is the whole story: signing asks for nothing more", () => {
  const doc = fold([
    turn(1), goal(2),
    add(3, "T1", ["core/a.mjs"]), done(4, "T1"), sealed(5),
    add(6, "T2", ["core/b.mjs"]), done(7, "T2"), sealed(8, "S01.2"),
  ]);
  assert.deepEqual(signBlockers(doc, doc.sessions[0], config), []);
  assert.equal(nextAction(doc, config).what, "签收");
  const withOldVerdict = fold([
    turn(1), goal(2),
    add(3, "T1", ["core/a.mjs"]), done(4, "T1"), sealed(5),
    add(6, "T2", ["core/b.mjs"]), done(7, "T2"), sealed(8, "S01.2"),
    { v: 9, at: T(9), k: "review.log", s: null, scope: "session", by: "qa", verdict: "pass", brief: "all.md", briefDigest: "a".repeat(64), findings: [] },
  ]);
  assert.deepEqual(signBlockers(withOldVerdict, withOldVerdict.sessions[0], config), [], "旧结论不给签收添门");
  assert.equal(nextAction(withOldVerdict, config).what, "签收");
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
  assert.equal(nextAction(old, config).what, "重审", "手上那份早于最后一次交付：另出一份");
  const fresh = fold([...base,
    { v: 6, at: T(12), k: "review.brief", s: null, segment: "S01.1", brief: "S01.1-2.md", briefDigest: "d".repeat(64) },
  ]);
  const step = nextAction(fresh, config);
  assert.equal(step.what, "落结论");
  assert.match(step.text, /S01\.1-2\.md/);
  assert.match(step.command, /--verdict pass/);
});

// 一段的一期不审两遍：那一段的结论就是这一期的结论。
// 下一步也得照这个读——段封了就该签收，不再要一句落在整期上的话。
test("one segment's verdict answers for the period, so no second pass is asked for", () => {
  const doc = fold([turn(1), goal(2), add(3, "T1", ["core/a.mjs"]), done(4, "T1"), sealed(5)]);
  assert.deepEqual(signBlockers(doc, doc.sessions[0], config), []);
  assert.equal(nextAction(doc, config).what, "签收");
  const bare = fold([turn(1), add(2, "T1", ["core/a.mjs"]), done(3, "T1"), sealed(4)]);
  assert.equal(nextAction(bare, config).what, "签收");
  const aimed = fold([
    turn(1), add(2, "T1", ["core/a.mjs"]), done(3, "T1"), sealed(4), goal(5),
  ]);
  assert.equal(nextAction(aimed, config).what, "签收", "改目的不是改这一期做过的事");
});

test("the next step names one actor and one action", () => {
  assert.equal(nextAction(fold([]), config).who, "agent");
  assert.equal(nextAction(fold([turn(1)]), config).what, "开段");
  const asked = fold([turn(1), ask(2)]);
  assert.equal(nextAction(asked, config).who, "user");
  assert.match(nextAction(asked, config).command, /ask resolve A1/);
  const todo = fold([turn(1), add(2, "T1", ["docs/a.md"])]);
  assert.equal(nextAction(todo, config).who, "agent");
  assert.match(nextAction(todo, config).text, /T1/);
  const unreviewed = fold([turn(1), add(2, "T1", ["core/x.mjs"]), done(3, "T1")]);
  assert.equal(nextAction(unreviewed, config).who, "reviewer");
  assert.match(nextAction(unreviewed, config).command, /deed review --segment S01\.1/, "下一步只出清单,不替人写结论");
  const judged = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1"), pass(4)]);
  assert.equal(nextAction(judged, config).what, "签收");
});
// 两段都由 deed seal 关的期也一样：没人需要写的东西，不该有人等到它。
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
  assert.deepEqual(signBlockers(doc, session, config), []);
  assert.equal(nextAction(doc, config).what, "签收");
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
  assert.equal(first.sealedBy, "agent", "封它的是 deed seal");
  assert.notEqual(first.closedAt, null, "账本上真写过一次封存");
  assert.equal(needsReview(tight, session, { ...first, closedAt: undefined }), true, "没有 closedAt 就不是封存");
  assert.deepEqual(signBlockers(doc, session, tight), []);
  assert.equal(nextAction(doc, config).what, "签收");
});

// 守卫的另一半：被 pass 封的段没有 exemptions——它照常按今天的审查设置重算。
// 少了这一条，把守卫写成「只要 closedAt 不是 null 就豁免」也能全绿，而那会把
// 审过的段一并免责，与「pass 封的段照样重算」正好相反。
test("a segment a reviewer passed is still weighed, so the exemption is only for a seal", () => {
  const heavy = (n, id, path) => ({ v: 1, at: T(n), k: "task.done", s: null, id, evidence: "ran", by: "agent",
    digest: "a".repeat(64), digestPath: path, changed: [path], bytes: { [path]: 92160 } });
  const session = fold([turn(1), goal(2), add(3, "T1", ["docs/a.md"]), heavy(4, "T1", "docs/a.md"), sealed(5, "S01.1")]).sessions[0];
  const first = session.segments[0];
  assert.equal(first.sealedBy, null, "关闭这一段的是结论，不是 deed seal");
  assert.equal(needsReview(config, session, first), true, "这一份 92160 字节，今天的审查设置会把它送去审");
  assert.equal(reviewState(config, session, first), "pass", "可它已经有人看过：结局不因此改变");
  assert.equal(first.sealedBy, null, "半封存不在这条上");
});

// 半个封存的真实来路：签收核对把一条写在 deed seal 封过的段里的任务点回来，段被重新打开——
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
  assert.equal(pointsAtNothing({ digest: "a".repeat(64), path: "docs/a.md" }), false, "记下了内容");
  assert.equal(pointsAtNothing({ files: [{ path: "docs/a.md", digest: "b".repeat(64) }] }), false, "记下了一组内容");
});


// 旧账本里那句整期上的不合格照读：它点名的段重新打开，段里的条目保持交付。
// 它是历史决定，不是今天还要再走一道的门——新账本里这种行已经产生不出来了（含义第 18 版）。
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
  assert.deepEqual(signBlockers(reopened, reopened.sessions[0], config), [], "段重新判过，签收不再差什么");
  assert.equal(nextAction(reopened, config).what, "签收");
});

test("a segment says what it cost: briefs handed out, deliveries taken back, minutes it stayed open", () => {
  const briefN = (n) => ({ v: 1, at: T(n), k: "review.brief", s: null, segment: "S01.1", brief: "b" + n + ".md", briefDigest: "a".repeat(64) });
  const undo = (n, id) => ({ v: 1, at: T(n), k: "task.undo", s: null, id, why: "说错了话", by: "agent" });
  const doc = fold([
    turn(1),
    add(2, "T1"),
    add(3, "T2"),
    done(4, "T1"),
    briefN(5),
    briefN(6),
    undo(7, "T1"),
    done(8, "T1"),
    done(9, "T2"),
    sealed(10),
  ]);
  const session = doc.sessions[0];
  // 这些数只回答"为什么慢"：从账本算，不读时钟，也不参与任何门。
  assert.deepEqual(costOf(session, session.segments[0]), { tasks: 2, briefs: 2, undos: 1, minutes: 8 });
});

test("a decision can carry a border and an abandoned thing, and both are read off the words", () => {
  // 结论块不另立事件、不加字段：这两个行是从那句裁定里读出来的，
  // 所以同一句话里的其它内容不会被误当边界。
  const doc = fold([
    turn(1),
    ask(2),
    { v: 1, at: T(3), k: "ask.raise", s: null, id: "A2", text: "还没定的一条", reading: "x", why: "y" },
    {
      v: 1, at: T(4), k: "ask.resolve", s: null, id: "A1", by: "user", why: "就这么定",
      decision: "按第一种读法办\n边界：文档里不再写「黑话」这个词\n边界: 半角冒号也认\n弃：那套导出格式不做了\n补充一句不是边界的话",
    },
  ]);
  const got = edges(doc.sessions[0]);
  assert.deepEqual(got.map((one) => one.kind), ["border", "border", "abandon"], "两行边界、一件不做；开着的题不参与");
  assert.deepEqual(got.map((one) => one.text), ["文档里不再写「黑话」这个词", "半角冒号也认", "那套导出格式不做了"]);
  assert.equal(got[0].id, "A1");
  assert.equal(fold([turn(1), ask(2)]).sessions[0].asks.length, 1);
  assert.deepEqual(edges(fold([turn(1), ask(2)]).sessions[0]), [], "没裁过的题没有结论可读");
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
