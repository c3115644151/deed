import test from "node:test";
import assert from "node:assert/strict";
import { fold } from "../core/fold.mjs";
import { needsReview } from "../core/rules.mjs";

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

const carry = (n, id) => ({ v: 1, at: T(n), k: "task.carry", s: null, id });
const brief = (n, segment) => ({
  v: 1, at: T(n), k: "review.brief", s: null, segment, brief: "b.md", briefDigest: "a".repeat(64), guideDigest: "c".repeat(64),
});
// 第 11 版起：手上那份清单还在等结论时，新活自己开下一段。这条规矩按写它的版本重放。
const add11 = (n, id) => ({ ...add(n, id), v: 11 });

test("an entry not yet done moves to the next segment, and that segment takes what comes after it", () => {
  const doc = fold([
    turn(1), add(2, "T1"), add(3, "T2"), add(4, "T3"), done(5, "T1"),
    carry(6, "T2"), carry(7, "T3"), add(8, "T4"),
  ]);
  const [session] = doc.sessions;
  assert.equal(session.segments.length, 2, "一批搬运只开一段：十条未做的条目不该开出十个段");
  assert.equal(session.tasks.find((one) => one.id === "T2").segment, "S01.2");
  assert.equal(session.tasks.find((one) => one.id === "T3").segment, "S01.2");
  assert.equal(session.tasks.find((one) => one.id === "T4").segment, "S01.2", "新写的条目也跟着最新那一段走");
  assert.equal(session.segments[0].closedAt, null, "原来那一段没被封：它只是不再收东西");
});

test("a segment waiting for a verdict takes no new work: the next entry opens a segment", () => {
  const doc = fold([turn(1), add11(2, "T1"), add11(5, "T2"), done(3, "T1"), brief(4, "S01.1")].sort((a, b) => a.at.localeCompare(b.at)));
  const session = doc.sessions[0];
  assert.equal(session.tasks.find((one) => one.id === "T2").segment, "S01.2", "清单发出去了还在等结论，新活落到下一段");
  assert.equal(session.segments[0].closedAt, null, "等结论的那一段没被封：它只是不再收东西");
});

test("there is one prep segment, and every batch that moves in lands in it", () => {
  // 送审的那一批不再收活，接下来的活全进同一个预备段：第二批搬进来不该再开一个新段。
  const doc = fold([
    turn(1), add11(2, "T1"), done(3, "T1"), brief(4, "S01.1"),
    add11(5, "T2"), carry(6, "T2"), add11(7, "T3"), carry(8, "T3"), add11(9, "T4"),
  ]);
  const session = doc.sessions[0];
  assert.equal(session.segments.length, 2, "预备段只有一个：搬几次都还是它");
  assert.equal(session.segments[1].carried, true);
  for (const id of ["T2", "T3", "T4"]) {
    assert.equal(session.tasks.find((one) => one.id === id).segment, "S01.2", id + " 该在预备段里");
  }
});

test("a delivery does not move: 搬 is for work not yet done", () => {
  assert.throws(() => fold([turn(1), add(2, "T1"), done(3, "T1"), carry(4, "T1")]), /只有没做的能搬到下一段/u);
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
  // 放弃是另一条落过的决定，它自己也带着理由：被点名的那条改主意不做了，
  // 就没有交付等着结清，结论可以落下来（下一个审查者读得到它被放弃这件事）。
  const dropped = { v: 3, at: T(6), k: "task.drop", s: null, id: "T1", why: "不做了" };
  const noWork = fold([...before, dropped, pass]);
  assert.equal(noWork.sessions[0].segments[0].verdict, "pass");
  assert.equal(noWork.sessions[0].tasks[0].status, "dropped");
  const again = { v: 3, at: T(6), k: "task.done", s: null, id: "T1", evidence: "again", by: "agent" };
  const doc = fold([...before, again, pass]);
  assert.equal(doc.sessions[0].segments[0].verdict, "pass");
  assert.equal(doc.sessions[0].segments[0].closedAt, T(7));
});
test("a rework takes back the paths the delivered work touched, not just the claim", () => {
  const touched = (n, id, changed) => ({
    v: 3, at: T(n), k: "task.done", s: null, id, evidence: "ran", by: "agent", changed, bytes: { [changed[0]]: 40 },
  });
  const before = fold([turn(1), add(2, "T1"), touched(3, "T1", [".gitignore", "notes.md"])]);
  assert.deepEqual(before.sessions[0].tasks[0].changed, [".gitignore", "notes.md"]);
  const after = fold([
    turn(1), add(2, "T1"), touched(3, "T1", [".gitignore", "notes.md"]),
    { v: 3, at: T(4), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "fail", brief: "b.md", why: "不够", rework: ["T1"] },
    touched(5, "T1", ["notes.md"]),
  ]);
  const task = after.sessions[0].tasks[0];
  assert.deepEqual(task.changed, ["notes.md"], "退回的那条交付碰过的路径不再算这一段的性质");
  assert.deepEqual(Object.keys(task.sizes), ["notes.md"]);
  // 门槛就在这几条路径上判：退回之前那一批有 .gitignore，要审；退回之后只剩 *.md，免审。
  const config = { review: { required: ["core/**"], exempt: ["*.md"] } };
  assert.equal(needsReview(config, before.sessions[0], before.sessions[0].segments[0]), true, "碰过 .gitignore 的那一批要审");
  assert.equal(needsReview(config, after.sessions[0], after.sessions[0].segments[0]), false, "退回之后再交的只有 *.md，门槛不再判要审");
  // 退回那一刻也得干净：不等下一次交付重算，被退回的那条交付碰过的路径当场就不再算。
  const justReworked = fold([
    turn(1), add(2, "T1"), touched(3, "T1", [".gitignore", "notes.md"]),
    { v: 3, at: T(4), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "fail", brief: "b.md", why: "不够", rework: ["T1"] },
  ]);
  assert.deepEqual(justReworked.sessions[0].tasks[0].changed, [], "退回当场，那批路径就不在任务上了");
  assert.deepEqual(justReworked.sessions[0].tasks[0].sizes, {});
});
test("taking a delivery back, or sending it to rework, also gives its paths back", () => {
  const touched = (n, id, changed) => ({
    v: 3, at: T(n), k: "task.done", s: null, id, evidence: "ran", by: "agent", changed, bytes: { [changed[0]]: 40 },
  });
  const undone = fold([
    turn(1), add(2, "T1"), touched(3, "T1", [".gitignore", "notes.md"]),
    { v: 3, at: T(4), k: "task.undo", s: null, id: "T1", why: "说错了话" },
  ]);
  assert.deepEqual(undone.sessions[0].tasks[0].changed, [], "撤回之后，那条交付碰过的路径不再算这一段的性质");
  assert.deepEqual(undone.sessions[0].tasks[0].sizes, {});
  const reworked = fold([
    turn(1), add(2, "T1"), touched(3, "T1", [".gitignore", "notes.md"]),
    { v: 5, at: T(4), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "pass", brief: "b.md" },
    { v: 5, at: T(5), k: "judge.rework", s: null, segment: "S01.1", tasks: ["T1"], why: "补钉", by: "user" },
  ]);
  assert.deepEqual(reworked.sessions[0].tasks[0].changed, [], "人点名重做之后，路径同样归零");
  assert.deepEqual(reworked.sessions[0].tasks[0].sizes, {});
});
test("a delivery that only pins files still counts as touching them", () => {
  const config = { review: { required: ["core/**"], exempt: ["*.md"] } };
  const pinnedOnly = {
    v: 3, at: T(3), k: "task.done", s: null, id: "T1", evidence: "重钉", by: "agent",
    files: [{ path: "core/fold.mjs", digest: "a".repeat(64) }], changed: [],
  };
  const doc = fold([turn(1), add(2, "T1"), pinnedOnly]);
  const task = doc.sessions[0].tasks[0];
  assert.deepEqual(task.changed, ["core/fold.mjs"], "手工 --digest 交付没有工作区差，记下的文件就是它碰过的");
  assert.equal(needsReview(config, doc.sessions[0], doc.sessions[0].segments[0]), true);
});
// 撤回那行自己写着撤的是哪份字节：重放读它，不拿"最后一条交付"去猜。
// 猜出来的那份会跟着将来的形状改口——加一条交付，历史里的撤回就换了个说法。
test("a take-back is read from the line that recorded it, not from the delivery it guesses", () => {
  const delivered = {
    v: 8, at: T(3), k: "task.done", s: null, id: "T1", evidence: "ran", by: "agent",
    files: [{ path: "a.txt", digest: "a".repeat(64) }],
  };
  const said = {
    v: 8, at: T(4), k: "task.undo", s: null, id: "T1", why: "说错了话", by: "agent",
    undoes: [{ path: "b.txt", digest: "b".repeat(64) }],
  };
  const doc = fold([turn(1), add(2, "T1"), delivered, said]);
  assert.equal(doc.sessions[0].tasks[0].undone[0].undoes[0].path, "b.txt", "账本那行说撤的是 b.txt");
  const older = fold([turn(1), add(2, "T1"), delivered, { ...said, undoes: undefined }]);
  assert.equal(older.sessions[0].tasks[0].undone[0].undoes[0].path, "a.txt", "旧行没有这一格，才退回最后一条交付");
});


// 整体审的对象是各段的结论，所以它退回去的也只能是段：点条目在账本这一层就该拒，
// 不能只靠 CLI 挡——别的地方照样能写出这个形状的行。
test("a whole-period verdict names segments, and a task id is refused in the ledger too", () => {
  const pass = (n, segment) => ({ v: 9, at: T(n), k: "review.log", s: null, segment, by: "qa", verdict: "pass",
    brief: segment + ".md", briefDigest: "a".repeat(64) });
  const whole = (n, verdict, rework) => ({ v: 9, at: T(n), k: "review.log", s: null, scope: "session", by: "qa2",
    verdict, brief: "all-1.md", briefDigest: "b".repeat(64),
    ...(verdict === "fail" ? { rework, why: "那一段的结论没对上这一期" } : {}) });
  const base = [turn(1), add(2, "T1"), done(3, "T1"), pass(4, "S01.1"),
    add(5, "T2"), done(6, "T2"), pass(7, "S01.2")];
  assert.throws(() => fold([...base, whole(8, "fail", ["T1"])]), /不是段/, "整体审点不了条目");
  const session = fold([...base, whole(8, "fail", ["S01.1"])]).sessions[0];
  assert.equal(session.segments[0].closedAt, null, "被点名的段整段重开");
  assert.equal(session.tasks[0].status, "done", "段里的条目保持交付");
  assert.equal(session.segments[1].closedAt !== null, true, "没被点名的段不动");
  assert.notEqual(session.reviews.find((one) => one.scope === "segment").voidedAt, null, "那一段原先的结论留史作废");
  // 作废它的是一条结论，所以那一格记的是结论号：记成段号的话，"谁把它顶掉的"
  // 看着像"这一段顶掉了自己"，跟同名字段的语义（同文件里另一处记 R<n>）也对不上。
  const older = session.reviews.find((one) => one.scope === "segment");
  const newer = session.reviews.find((one) => one.scope === "session");
  assert.equal(older.supersededBy, newer.id, "被整体审作废的结论记下顶掉它的那一条结论号");
  assert.match(older.supersededBy, /^R\d+$/, "记的是结论号，不是段号");
});
