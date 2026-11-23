import test from "node:test";
import assert from "node:assert/strict";
import { fold } from "../core/fold.mjs";
import {
  needsWhole,
  needsReview,
  nextAction,
  reading,
  reviewOf,
  reviewState,
  freshWholeBrief,
  sealBlockers,
  signBlockers,
  wholeState,
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
// 现在的结论自己封段（事件含义第 3 版起）；老账本里的结论只算一句判断。
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
    "这一段按门槛要审：结局得由审查者的结论落（deed review --segment S01.1）",
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
    "S01.1 还没有封存（门槛说这一段不用审：deed seal 记下凭什么不审）",
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
    "S01.1 还没有封存（门槛说这一段不用审：deed seal 记下凭什么不审）",
  ]);
  const asked = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1", "docs/a.md"), pass(4), ask(5)]);
  assert.deepEqual(signBlockers(asked, asked.sessions[0], config), ["还有 1 条待裁（A1）"]);
  const clean = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1", "docs/a.md"), pass(4)]);
  assert.deepEqual(signBlockers(clean, clean.sessions[0], config), []);
});

// 多段的一期：段都封了还差一句落在整期上的结论；它要拿目的当尺子，
// 而一段的一期不必再算一次——那一段的结论就是整期的结论。
test("a period with more than one segment needs a conclusion on the period itself", () => {
  const doc = fold([
    turn(1), goal(2),
    add(3, "T1", ["core/a.mjs"]), done(4, "T1"), sealed(5),
    add(6, "T2", ["core/b.mjs"]), done(7, "T2"), sealed(8, "S01.2"),
  ]);
  assert.equal(wholeState(doc.sessions[0]), "missing");
  const step = nextAction(doc, config);
  assert.equal(step.who, "reviewer");
  assert.match(step.command, /deed review --all/);
  const whole = fold([
    turn(1), goal(2),
    add(3, "T1", ["core/a.mjs"]), done(4, "T1"), sealed(5),
    add(6, "T2", ["core/b.mjs"]), done(7, "T2"), sealed(8, "S01.2"),
    { v: 5, at: T(9), k: "review.log", s: null, scope: "session", by: "qa", verdict: "pass", brief: "all.md", findings: [] },
  ]);
  assert.equal(wholeState(whole.sessions[0]), "pass");
  assert.equal(nextAction(whole, config).what, "签收");
});

// 材料已经交出去，下一步就是落结论——哪怕在案的结论是旧的。
// 再叫一次「另出一份」会让审查者去读一份没人回答过的旧纸，而新的那份已经在他手上。
test("a brief handed out after the last change is answered, not replaced", () => {
  const base = [
    turn(1), goal(2),
    add(3, "T1", ["core/a.mjs"]), done(4, "T1"),
    { v: 5, at: T(5), k: "review.brief", s: null, segment: "S01.1", brief: "S01.1-1.md", briefDigest: "b".repeat(64) },
    sealed(6),
    add(7, "T2", ["core/b.mjs"]), done(8, "T2"), sealed(9, "S01.2"),
    // 整期审打回 T1：那一段重新打开，任务回到未做，旧的那条通过结论留着但过期
    { v: 6, at: T(10), k: "review.log", s: null, scope: "session", by: "qa", verdict: "fail", rework: ["T1"], why: "记录说错了", brief: "all.md", briefDigest: "c".repeat(64) },
    done(11, "T1"),
  ];
  const old = fold(base);
  assert.equal(reviewState(config, old.sessions[0], old.sessions[0].segments[0]), "stale");
  assert.equal(nextAction(old, config).what, "重审", "手上没有新材料，就该另出一份");
  const fresh = fold([...base,
    { v: 6, at: T(12), k: "review.brief", s: null, segment: "S01.1", brief: "S01.1-2.md", briefDigest: "d".repeat(64) },
  ]);
  const step = nextAction(fresh, config);
  assert.equal(step.what, "落结论");
  assert.match(step.text, /S01\.1-2\.md/);
  assert.match(step.command, /--verdict pass/);
  // 整期材料同理：交出去、没人回答，就是落结论；被回答了就不再算新鲜。
  const whole = { ...fresh.sessions[0],
    briefs: [...fresh.sessions[0].briefs,
      { scope: "session", segment: null, brief: "S01-all-1.md", briefDigest: "e".repeat(64), at: T(13) },
    ] };
  assert.equal(freshWholeBrief(whole).brief, "S01-all-1.md");
  const answered = { ...whole, reviews: [...whole.reviews,
    { scope: "session", brief: "S01-all-1.md", verdict: "pass", at: T(14) }] };
  assert.equal(freshWholeBrief(answered), null);
});

// 一段的一期不审两遍：那一段的结论已经回答了这一期。
// 下一步也得照这个读——段封了就该签收，不能再要一句目的、再要一次整期审。
test("one segment's verdict answers for the period, so no second pass is asked for", () => {
  const doc = fold([turn(1), goal(2), add(3, "T1", ["core/a.mjs"]), done(4, "T1"), sealed(5)]);
  assert.equal(wholeState(doc.sessions[0]), "pass");
  assert.deepEqual(signBlockers(doc, doc.sessions[0], config), []);
  assert.equal(nextAction(doc, config).what, "签收");
  // 没有目的也一样：一段的一期不拿目的当尺子，写完目的也不该冒出一次重审。
  const bare = fold([turn(1), add(2, "T1", ["core/a.mjs"]), done(3, "T1"), sealed(4)]);
  assert.equal(needsWhole(config, bare.sessions[0]), false);
  assert.equal(nextAction(bare, config).what, "签收");
  const aimed = fold([
    turn(1), add(2, "T1", ["core/a.mjs"]), done(3, "T1"), sealed(4), goal(5),
  ]);
  assert.equal(wholeState(aimed.sessions[0]), "pass", "改目的不是改这一期做过的事");
  assert.equal(nextAction(aimed, config).what, "签收");
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
// 一段都没人要审的一期，没有可比对的东西：整期审的对象本来就是"审查者看过的那些段"。
// 少了这一条，两段免审的期会被要一份没人能写的整期结论，签收永远差一格。
test("a period whose segments all sat out review needs no conclusion on the period", () => {
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
  assert.equal(needsWhole(config, session), false, "两段都免审：没有要审的东西可比对");
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

// 没称过不等于小：说不清多大的改动，门槛按要审处理。交付那一刻会替它称（工作区差里的、
// --digest 指的都称），所以这条只堵老账本和漏称。
test("a delivery that never weighed its files is not treated as a small one", () => {
  const session = fold([
    turn(1), add(2, "T1", ["docs/a.md"]),
    { v: 1, at: T(3), k: "task.done", s: null, id: "T1", evidence: "ran", by: "agent", digest: "a".repeat(64), digestPath: "docs/a.md", changed: [] },
  ]).sessions[0];
  assert.equal(needsReview(config, session, session.segments[0]), true, "称不出规模，就别指望它按 0 字节放行");
});
// 门槛后来写细了，不回头改写已经封过的段：封存那一刻的决定留在账本上。
// 少了这一条，一次收紧就能把「全部免审」的期重新算成欠一份整期结论，
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
  assert.equal(needsReview(config, session, first), false, "封过就不重算：账本上那句「不用审」还算数");
  assert.equal(needsReview(config, session, second), false);
  assert.equal(reviewState(config, session, first), "exempt");
  assert.equal(needsWhole(config, session), false, "没人审过的期不必再补一份整期结论");
  assert.deepEqual(signBlockers(doc, session, config), []);
  assert.equal(nextAction(doc, config).what, "签收");
});

// 整期审的对象是「审查者看过的那些段」：审过的段算数，不是按它交付的字节重量重算。
// 少了这一条，段一旦被 pass 封住，它后来算不算「小改动」就会决定这一期还要不要整期审——
// 而真正该问的是有没有人看过。这条用例自己收口，不要借上面那条的夹具，否则一次变异会把两条
// 用例一起带红，看不出是哪一条在守。
test("a segment a reviewer read counts for the whole review, whatever its deliveries weigh later", () => {
  const seal = (n, segment) => ({ v: 5, at: T(n), k: "segment.seal", s: null, segment, why: "只动了文档", by: "agent" });
  const light = (n, id, path) => ({ v: 1, at: T(n), k: "task.done", s: null, id, evidence: "ran", by: "agent",
    digest: "a".repeat(64), digestPath: path, changed: [path], bytes: { [path]: 100 } });
  const doc = fold([
    turn(1), goal(2),
    add(3, "T1", ["docs/a.md"]), light(4, "T1", "docs/a.md"), sealed(5, "S01.1"),
    add(6, "T2", ["docs/b.md"]), light(7, "T2", "docs/b.md"), seal(8, "S01.2"),
  ]);
  const session = doc.sessions[0];
  assert.equal(needsReview(config, session, session.segments[0]), false, "这一段的字节数出来确实很小");
  assert.equal(needsWhole(config, session), true, "可它被人看过：整期审还得有一句结论");
  assert.equal(signBlockers(doc, session, config).some((one) => one.includes("整体审")), true);
});
