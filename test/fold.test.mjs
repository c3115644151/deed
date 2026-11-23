import test from "node:test";
import assert from "node:assert/strict";
import { fold } from "../core/fold.mjs";

const T = (n) => new Date(Date.UTC(2026, 10, 22, 10, n)).toISOString();

const turn = (n, said = "hi", s = null) => ({ v: 1, at: T(n), k: "turn", s, who: "user", said });
const add = (n, id, files = []) => ({ v: 1, at: T(n), k: "task.add", s: null, id, title: id, criteria: "c", files });
const done = (n, id) => ({ v: 1, at: T(n), k: "task.done", s: null, id, evidence: "ran", by: "agent" });
const review = (n, segment, verdict = "pass", findings = []) => ({
  v: 1, at: T(n), k: "review.log", s: null, segment, by: "qa", verdict, brief: "b.md", findings,
});
const judgePass = (n, segment) => ({ v: 1, at: T(n), k: "judge.pass", s: null, segment, by: "user" });
const rework = (n, segment, tasks, why = "不够", by = "qa") => ({ v: 1, at: T(n), k: "judge.rework", s: null, segment, tasks, why, by });
const sign = (n, words = "可以", title = "第一期") => ({ v: 1, at: T(n), k: "sign", s: null, words, title, by: "user" });

test("the first recorded turn opens a session by itself", () => {
  const doc = fold([turn(1, "先把这一段跑完")]);
  assert.equal(doc.sessions.length, 1);
  assert.equal(doc.sessions[0].id, "S01");
  assert.equal(doc.sessions[0].turns.length, 1);
  assert.equal(doc.sessions[0].closedAt, null);
});

test("the same ledger always folds to the same document", () => {
  const events = [turn(1), add(2, "T1"), done(3, "T1"), judgePass(4, "S01.1")];
  assert.deepEqual(fold(events), fold(events));
});

test("a segment exists only once a task arrives, and a judged one never reopens by accident", () => {
  const doc = fold([turn(1), add(2, "T1")]);
  assert.equal(doc.sessions[0].segments.length, 1);
  assert.equal(doc.sessions[0].segments[0].id, "S01.1");
  assert.equal(doc.sessions[0].tasks[0].segment, "S01.1");
  const after = fold([turn(1), add(2, "T1"), done(3, "T1"), judgePass(4, "S01.1"), add(5, "T2")]);
  assert.equal(after.sessions[0].segments.length, 2);
  assert.equal(after.sessions[0].segments[1].id, "S01.2");
  assert.equal(after.sessions[0].tasks[1].segment, "S01.2");
});

test("judging closes the segment and accepts what was delivered", () => {
  const doc = fold([turn(1), add(2, "T1"), done(3, "T1"), judgePass(4, "S01.1")]);
  const [task] = doc.sessions[0].tasks;
  assert.equal(task.status, "accepted");
  assert.ok(doc.sessions[0].segments[0].closedAt);
});

test("a rework sends the named task back, clears its evidence, and voids the verdict", () => {
  const doc = fold([
    turn(1), add(2, "T1"), done(3, "T1"),
    review(4, "S01.1", "pass"),
    judgePass(5, "S01.1"),
    rework(6, "S01.1", ["T1"], "记录不足"),
  ]);
  const session = doc.sessions[0];
  assert.equal(session.tasks[0].status, "todo");
  assert.equal(session.tasks[0].evidence.length, 0, "旧交付记录不跟着新交付走");
  assert.equal(session.segments[0].reviewVerdict, null);
  assert.equal(session.segments[0].closedAt, null);
  assert.equal(session.reviews[0].voidedAt, T(6), "结论留在账本里，但不再算数");
});

test("the hand that did the work cannot clear it", () => {
  // The default label does both jobs: an agent delivers and then writes the verdict.
  const self = { v: 1, at: T(4), k: "review.log", s: null, segment: "S01.1", by: "agent", verdict: "pass", brief: "b.md", findings: [] };
  assert.throws(() => fold([turn(1), add(2, "T1"), done(3, "T1"), self]), /同一个人不能判自己交付的段/u);
  // A different label clears it: independence is a label, not an approval.
  const other = { ...self, by: "qa" };
  assert.equal(fold([turn(1), add(2, "T1"), done(3, "T1"), other]).sessions[0].reviews.length, 1);
  // Independence is per segment: delivering the last one does not bar this one.
  const next = { ...self, at: T(7), segment: "S01.2" };
  const second = { v: 1, at: T(6), k: "task.done", s: null, id: "T2", evidence: "ran", by: "qa" };
  const doc = fold([turn(1), add(2, "T1"), done(3, "T1"), judgePass(4, "S01.1"), add(5, "T2"), second, next]);
  assert.equal(doc.sessions[0].reviews.length, 1);
});

test("signing closes the period and the next turn opens a new one", () => {
  const doc = fold([turn(1), add(2, "T1"), done(3, "T1"), judgePass(4, "S01.1"), sign(5), turn(6)]);
  assert.equal(doc.sessions[0].closeKind, "signed");
  assert.equal(doc.sessions[0].title, "第一期");
  assert.equal(doc.sessions[1].id, "S02");
});

test("shelving keeps the unfinished work in the record", () => {
  const doc = fold([turn(1), add(2, "T1"), { v: 1, at: T(3), k: "shelve", s: null, why: "换方向", by: "user" }]);
  assert.equal(doc.sessions[0].closeKind, "shelved");
  assert.equal(doc.sessions[0].tasks[0].status, "todo");
  assert.equal(doc.sessions[0].words, "换方向");
});

test("an unknown session id in the ledger is a broken ledger, not a silent reset", () => {
  assert.throws(() => fold([turn(1, "x", "S99")]), /没有这个会话/);
});

test("a judgement cannot close a segment holding unfinished tasks", () => {
  assert.throws(() => fold([turn(1), add(2, "T1"), judgePass(3, "S01.1")]), /还有没做完/);
});

// The guarantees the review asked for: writing into last period, inventing a
// second session, and reusing an id are all refused before the line lands.
test("only a turn opens a period; a task cannot invent one", () => {
  assert.throws(() => fold([add(1, "T1")]), /还没有会话/);
  assert.throws(() => fold([turn(1), sign(2), add(3, "T1")]), /已经收口/);
  assert.throws(() => fold([turn(1), sign(2), turn(3, "x", "S01")]), /已经收口/);
});

test("a duplicate id is refused instead of shadowing the first one", () => {
  assert.throws(() => fold([turn(1), add(2, "T1"), add(3, "T1")]), /已经有 T1/);
  assert.throws(
    () => fold([turn(1), { v: 1, at: T(2), k: "ask.raise", s: null, id: "A1", text: "t", reading: "r", why: "w" }, add(3, "A1")]),
    /已经有 A1/,
  );
});

test("a sealed segment resists stray writes: only a rework reopens it", () => {
  const base = [turn(1), add(2, "T1"), done(3, "T1"), judgePass(4, "S01.1")];
  assert.throws(() => fold([...base, done(5, "T1")]), /已封存/);
  assert.throws(() => fold([...base, judgePass(5, "S01.1")]), /已经封存/);
  assert.throws(() => fold([...base, review(5, "S01.1", "fail")]), /已经封存/);
  // ...unless it is the newest segment: a rework is how settled work reopens.
  const reopened = fold([...base, rework(5, "S01.1", ["T1"])]);
  assert.equal(reopened.sessions[0].segments[0].closedAt, null);
  assert.equal(reopened.sessions[0].tasks[0].status, "todo");
});

test("a rework cannot reopen an older segment while a newer one is open", () => {
  const events = [turn(1), add(2, "T1"), done(3, "T1"), judgePass(4, "S01.1"), add(5, "T2")];
  assert.throws(() => fold([...events, rework(6, "S01.1", ["T1"])]), /后面还有 S01\.2/);
});

test("a rework cannot reach a task that belongs to another segment", () => {
  const events = [
    turn(1), add(2, "T1"), done(3, "T1"), judgePass(4, "S01.1"),
    add(5, "T2"), done(6, "T2"),
  ];
  assert.throws(() => fold([...events, rework(7, "S01.2", ["T1"])]), /打回不能跨段/);
});

test("a refused event leaves the document exactly as it was", () => {
  const events = [turn(1), add(2, "T1")];
  const before = fold(events);
  try {
    fold([...events, done(3, "T9")]);
  } catch {
    /* refused */
  }
  assert.deepEqual(fold(events), before);
});

test("signing refuses to close a period with work still owed", () => {
  assert.throws(() => fold([turn(1), add(2, "T1"), sign(3)]), /没结清/);
  const asked = [
    turn(1), add(2, "T1"), done(3, "T1"), judgePass(4, "S01.1"),
    { v: 1, at: T(5), k: "ask.raise", s: null, id: "A1", text: "要不要兼容旧账", reading: "不兼容", why: "不确定" },
  ];
  assert.throws(() => fold([...asked, sign(6)]), /待裁项/);
});

// 更早的账本里那些没点名的结论一样挡着 pass：规则是在案那条说了什么，
// 不是它当时是第几版。否则同一条历史结论会因为"新来的那行是第 4 版"而变得可以被覆盖。
test("a standing fail written before verdicts named anything still blocks a later pass", () => {
  const old = { v: 2, at: T(5), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "fail", brief: "b.md", findings: ["x"] };
  const pass4 = { v: 4, at: T(6), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "pass", brief: "b2.md" };
  const ledger = [turn(1), add(2, "T1"), done(3, "T1"), old];
  assert.throws(() => fold([...ledger, pass4]), /没有可结清的东西/u);
  // 出路只有一条：人推翻那条结论，然后重新审。
  const overturned = { v: 4, at: T(6), k: "review.overturn", s: null, review: "R1", why: "看错了", by: "user" };
  assert.equal(fold([...ledger, overturned, { ...pass4, at: T(7) }]).sessions[0].segments[0].verdict, "pass");
});

// 一条不合格不会被后一条 pass 悄悄顶掉：它点名的条目得先重新交付。
// 判没判过看的是在案那条记录说了什么——不是新来的那条带着几版的版本号（每行都是最新版）。
test("a standing fail outranks a later pass until the work it named is delivered again", () => {
  const fail = { v: 3, at: T(5), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "fail", brief: "b.md", findings: ["x"], rework: ["T1"], why: "没跑" };
  const pass = { v: 3, at: T(7), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "pass", brief: "b2.md" };
  const before = [turn(1), add(2, "T1"), done(3, "T1"), fail];
  // 没重新交付之前连结论都落不了：先交付，才轮得到"能不能判"。
  assert.throws(() => fold([...before, { ...pass, at: T(6) }]), /还有没交付的/u);
  // 放弃了被点名的那条也不算结清：活没人做过，结论就还没到。
  const dropped = { v: 3, at: T(6), k: "task.drop", s: null, id: "T1", why: "不做了" };
  assert.throws(() => fold([...before, dropped, pass]), /还没结清/u);
  const again = { v: 3, at: T(6), k: "task.done", s: null, id: "T1", evidence: "again", by: "agent" };
  const doc = fold([...before, again, pass]);
  assert.equal(doc.sessions[0].segments[0].verdict, "pass");
  assert.equal(doc.sessions[0].segments[0].closedAt, T(7));
});
