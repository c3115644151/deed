import test from "node:test";
import assert from "node:assert/strict";
import { fold } from "../core/fold.mjs";
import {
  judgeBlockers,
  needsReview,
  nextAction,
  reading,
  reviewOf,
  reviewState,
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

test("a segment that needs review cannot be judged before the verdict lands", () => {
  const doc = fold([turn(1), add(2, "T1", ["core/fold.mjs"]), done(3, "T1")]);
  const session = doc.sessions[0];
  assert.equal(reviewState(config, session, session.segments[0]), "missing");
  assert.deepEqual(judgeBlockers(config, session, session.segments[0]), [
    "这一段要审，结论还没落盘：deed review --segment S01.1 出任务书",
  ]);
  const reviewed = fold([turn(1), add(2, "T1", ["core/fold.mjs"]), done(3, "T1"), verdict(4, "pass")]);
  assert.deepEqual(judgeBlockers(config, reviewed.sessions[0], reviewed.sessions[0].segments[0]), []);
});

test("a failing review keeps the segment shut until something changes", () => {
  const doc = fold([turn(1), add(2, "T1", ["core/fold.mjs"]), done(3, "T1"), verdict(4, "fail")]);
  const session = doc.sessions[0];
  assert.equal(reviewState(config, session, session.segments[0]), "fail");
  assert.deepEqual(judgeBlockers(config, session, session.segments[0]), ["审查结论是不合格，得补完再判"]);
});

// A reviewer who looks and says no is not overruled by a glob.
test("a failing verdict counts even where review was not required", () => {
  const doc = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1"), verdict(4, "fail")]);
  const session = doc.sessions[0];
  assert.equal(reviewState(config, session, session.segments[0]), "fail");
  assert.equal(judgeBlockers(config, session, session.segments[0]).includes("审查结论是不合格，得补完再判"), true);
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

test("signing waits for the judgement and for every open question", () => {
  const delivered = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1")]);
  assert.deepEqual(signBlockers(delivered, delivered.sessions[0]), ["当前段还没判决"]);
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
  assert.match(nextAction(unreviewed, config).command, /deed review --segment S01\.1/, "下一步只出任务书,不替人写结论");
  const judged = fold([turn(1), add(2, "T1", ["docs/a.md"]), done(3, "T1"), pass(4)]);
  assert.equal(nextAction(judged, config).what, "签收");
});
