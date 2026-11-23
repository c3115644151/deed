import test from "node:test";
import assert from "node:assert/strict";
import { fold } from "../core/fold.mjs";
import {
  needsReview,
  nextAction,
  reading,
  reviewOf,
  reviewState,
  sealBlockers,
  signBlockers,
} from "../core/rules.mjs";

const config = { review: { required: ["src/**", "core/**", "apps/**"], exempt: ["docs/**", "*.md"] } };
const T = (n) => new Date(Date.UTC(2026, 10, 22, 10, n)).toISOString();
const turn = (n) => ({ v: 1, at: T(n), k: "turn", s: null, who: "user", said: "x" });
const add = (n, id, files = []) => ({ v: 1, at: T(n), k: "task.add", s: null, id, title: id, criteria: "c", files });
// A delivery pins a file: evidence that names no content cannot be checked
// later, so the fixtures pin one the way a real run would.
const done = (n, id) => ({ v: 1, at: T(n), k: "task.done", s: null, id, evidence: "ran", by: "agent", digest: "a".repeat(64), digestPath: "core/fold.mjs", changed: [] });
const pass = (n, segment = "S01.1") => ({ v: 1, at: T(n), k: "judge.pass", s: null, segment, by: "user" });
const verdict = (n, v, segment = "S01.1") => ({ v: 1, at: T(n), k: "review.log", s: null, segment, by: "qa", verdict: v, brief: "b.md" });
const ask = (n) => ({ v: 1, at: T(n), k: "ask.raise", s: null, id: "A1", text: "要兼容旧账吗", reading: "不兼容", why: "不确定" });

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
  const exempt = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1")]);
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
  const doc = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1"), verdict(4, "fail")]);
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
    { v: 1, at: T(3), k: "task.done", s: null, id: "T1", evidence: "ran", by: "agent", digest: "a".repeat(64), digestPath: "docs/a.md", changed: [] },
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
    { v: 1, at: T(3), k: "task.done", s: null, id: "T1", evidence: "ran", by: "agent", digest: "a".repeat(64), digestPath: "docs/a.md", changed: [] },
  ]);
  const step = nextAction(doc, config);
  assert.equal(step.what, "封存");
  assert.match(step.command, /--by /u);
});

test("signing waits for the judgement and for every open question", () => {
  const delivered = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1")]);
  assert.deepEqual(signBlockers(delivered, delivered.sessions[0], config), [
    "S01.1 还没有封存（门槛说这一段不用审：deed seal 记下凭什么不审）",
  ]);
  const asked = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1"), pass(4), ask(5)]);
  assert.deepEqual(signBlockers(asked, asked.sessions[0], config), ["还有 1 条待裁（A1）"]);
  const clean = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1"), pass(4)]);
  assert.deepEqual(signBlockers(clean, clean.sessions[0], config), []);
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
