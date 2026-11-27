// 讨论域三层：原文（turn）→ 要点（point）→ 议题（topic），两次面板确认。
import test from "node:test";
import assert from "node:assert/strict";
import { fold } from "../core/fold.mjs";
import { EVENT_VERSION } from "../core/events.mjs";
import { signBlockers, nextAction } from "../core/rules.mjs";
import { applyGate, gatesOf } from "../board/gates.mjs";
import { renderBoard } from "../board/render.mjs";
import { append, readEvents } from "../lib/store.mjs";
import { workspace } from "../support/lib.mjs";

const T = (n) => new Date(Date.UTC(2026, 10, 27, 10, n)).toISOString();
const V = EVENT_VERSION;
const turn = (n, said) => ({ v: 1, at: T(n), k: "turn", s: null, who: "user", said });
const point = (n, id, text, topic = null, replaces = null) => ({ v: V, at: T(n), k: "point.add", s: null, id, text, topic, ...(replaces ? { replaces } : {}) });
const create = (n, id, title, points, body, replaces) => ({ v: V, at: T(n), k: "topic.create", s: null, id, title, points, body, by: "agent:claude", ...(replaces ? { replaces } : {}) });
const establish = (n, id) => ({ v: V, at: T(n), k: "topic.establish", s: null, id, body: "成文", points: [], by: "user", via: "panel" });
const release = (n, id) => ({ v: V, at: T(n), k: "topic.release", s: null, id, by: "user", via: "panel" });

test("points have no state; establishment absorbs them without deleting a line", () => {
  const events = [turn(1, "聊讨论"), point(2, "P1", "原文归系统"), point(3, "P2", "要点无状态"),
    create(4, "I1", "三层", ["P1", "P2"], "原文→要点→议题"),
    establish(5, "I1"), release(6, "I1")];
  const doc = fold(events);
  const s = doc.sessions[0];
  assert.equal(s.points.length, 2, "账本只追加：两条要点都在");
  assert.deepEqual(s.points.map((p) => p.absorbedBy), ["I1", "I1"], "收编是盖标记，不是删除");
  assert.deepEqual(s.topics[0].points, ["P1", "P2"]);
  assert.equal(s.topics[0].state, "released");
  assert.equal(s.topics[0].establishedBy, "user");
  assert.equal(s.topics[0].releasedBy, "user");
});

test("a topic needs both confirmations, in order, and cannot take the same point twice", () => {
  const head = [turn(1, "聊"), point(2, "P1", "一句"), create(3, "I1", "题", ["P1"], "正文")];
  assert.throws(() => fold([...head, release(4, "I1")]), /还没成立/);
  assert.throws(() => fold([...head, establish(4, "I1"), establish(5, "I1")]), /已经成立/);
  assert.throws(() => fold([...head, create(5, "I1", "又一遍", ["P1"], "正文")]), /已经有 I1/);
  assert.throws(() => fold([turn(1, "聊"), create(2, "I1", "题", ["P9"], "正文")]), /没有要点 P9/);
  assert.equal(fold([...head, establish(4, "I1")]).sessions[0].topics[0].state, "established");
});

test("正文在出口前都能改，锁定之后冻住", () => {
  const events = [turn(1, "聊"), point(2, "P1", "一句"),
    create(3, "I1", "题", ["P1"], "第一版"),
    create(4, "I1", "题", ["P1"], "第二版", "I1")];
  const s = fold(events).sessions[0];
  assert.equal(s.topics.length, 1, "同一议题只留最新那份草稿");
  assert.equal(s.topics[0].body, "第二版");
  // 成立到出口之间仍是讨论期：改正文保留 established 状态。
  const mid = fold([...events, establish(5, "I1"), create(6, "I1", "题", ["P1"], "第三版", "I1")]);
  assert.equal(mid.sessions[0].topics[0].state, "established");
  assert.equal(mid.sessions[0].topics[0].body, "第三版");
  assert.equal(mid.sessions[0].topics[0].establishedAt, T(5), "成立时刻不被改写");
  // 锁定出口之后正文冻住。
  assert.throws(
    () => fold([...events, establish(5, "I1"), release(6, "I1"), create(7, "I1", "题", ["P1"], "第四版", "I1")]),
    /锁定出口：正文不往回改/,
  );
});

test("要点同 id 再记一条是更新；已收编的不能改", () => {
  const head = [turn(1, "聊"), point(2, "P1", "旧内容")];
  const updated = fold([...head, point(3, "P1", "新内容", null, "P1")]);
  assert.equal(updated.sessions[0].points.length, 1, "界面只留最新那条");
  assert.equal(updated.sessions[0].points[0].text, "新内容");
  const withTopic = fold([...head, create(3, "I1", "题", ["P1"], "正文"), establish(4, "I1")]);
  assert.equal(withTopic.sessions[0].points[0].absorbedBy, "I1");
  assert.throws(
    () => fold([...withTopic.sessions[0] && [...head, create(3, "I1", "题", ["P1"], "正文"), establish(4, "I1"), point(5, "P1", "改", null, "P1")]]),
    /已经被 I1 收编/,
  );
});

test("an unconfirmed topic blocks signing and drives the next step; a released one can be exported", () => {
  const head = [turn(1, "聊"), point(2, "P1", "一句"), create(3, "I1", "题", ["P1"], "正文")];
  const draft = fold(head).sessions[0];
  assert.ok(signBlockers(null, draft, null).some((b) => b.includes("议题")), "没成立的议题挡签收");
  assert.equal(nextAction(fold(head), null).what, "确认议题成立");
  const established = fold([...head, establish(4, "I1")]);
  assert.ok(signBlockers(null, established.sessions[0], null).some((b) => b.includes("议题")), "没出口的议题也挡签收");
  assert.equal(nextAction(established, null).what, "确认议题出口");
  const released = fold([...head, establish(4, "I1"), release(5, "I1")]);
  assert.ok(!signBlockers(null, released.sessions[0], null).some((b) => b.includes("议题")), "锁定后不再挡签收");
  assert.equal(nextAction(released, null).what, "出口议题");
});

test("the panel draws exactly the open confirmation, and absorbed points leave the live list", () => {
  const head = [turn(1, "聊"), point(2, "P1", "原文归系统"), point(3, "P2", "要点无状态"),
    create(4, "I1", "三层", ["P1", "P2"], "正文")];
  const render = (doc) => renderBoard(doc, null, { zone: "Asia/Shanghai", events: 10 });
  const draft = render(fold(head));
  assert.match(draft, /data-gate="topic-establish" data-topic="I1"/);
  assert.doesNotMatch(draft, /data-gate="topic-release"/);
  assert.match(draft, /原文归系统/, "没成立前两条要点还在活跃清单");
  const established = render(fold([...head, establish(5, "I1")]));
  assert.match(established, /data-gate="topic-release" data-topic="I1"/);
  assert.doesNotMatch(established, /data-gate="topic-establish"/);
  assert.doesNotMatch(established, /原文归系统/, "成立后要点退出活跃清单");
  const released = render(fold([...head, establish(5, "I1"), release(6, "I1")]));
  assert.doesNotMatch(released, /data-gate="topic-establish"/);
  assert.doesNotMatch(released, /data-gate="topic-release"/);
});

test("the two panel gates write panel-signed lines and refuse to be pressed twice", () => {
  const root = workspace("discussion-gates");
  for (const ev of [turn(1, "聊"), point(2, "P1", "一句"), point(3, "P2", "两句"),
    create(4, "I1", "三层", ["P1", "P2"], "正文")]) append(root, ev);
  const before = fold(readEvents(root));
  assert.equal(gatesOf(before, null).topicEstablish.open, true);
  const a = applyGate(root, { action: "topic-establish", topic: "I1", by: "user", at: T(5) });
  assert.equal(a.ev.k, "topic.establish");
  assert.equal(a.ev.via, "panel");
  assert.deepEqual(a.ev.points, ["P1", "P2"]);
  const mid = fold(readEvents(root));
  assert.equal(gatesOf(mid, null).topicRelease.open, true);
  const b = applyGate(root, { action: "topic-release", topic: "I1", by: "user", at: T(6) });
  assert.equal(b.ev.k, "topic.release");
  assert.equal(b.ev.via, "panel");
  assert.equal(fold(readEvents(root)).sessions[0].topics[0].state, "released");
  assert.throws(() => applyGate(root, { action: "topic-establish", topic: "I1", by: "user", at: T(7) }), /已经锁定/);
  assert.throws(() => applyGate(root, { action: "topic-release", topic: "I1", by: "user", at: T(8) }), /还没成立|已经锁定/);
});


// 原文是两半：讨论屏不能只画人说的那一半，否则看起来像"只有用户在说话"。
test("the discussion screen shows both halves of the raw text, in one timeline", () => {
  const events = [
    turn(1, "你这一句"),
    { v: V, at: T(2), k: "reply", s: null, text: "我这一句", via: "hook", origin: "dsh", mid: "m-1" },
  ];
  const doc = fold(events);
  const html = renderBoard(doc, { zone: "UTC" });
  assert.match(html, /你这一句/, "人说的那一半在");
  assert.match(html, /我这一句/, "我说的那一半也在");
  const order = [html.indexOf("你这一句"), html.indexOf("我这一句")];
  assert.ok(order[0] >= 0 && order[1] >= 0, "两句都被画出来");
  const s = doc.sessions[0];
  assert.equal(s.replies.length, 1, "回复折在 session.replies 里，与 turns 并列");
  assert.equal(s.turns.length, 1, "回复不增加轮次");
});


// 出口：从议题拆出来的条目 —— 只有锁定出口的议题能拆，拆了议题那头记得住。
test("只认锁定出口的议题：没出口的写不进清单，拆过之后议题知道自己出口了哪几条", async () => {
  const { parse } = await import("../cli/plan.mjs");
  const head = [turn(1, "聊"), point(2, "P1", "一句"), create(3, "I1", "题", ["P1"], "正文")];
  const draftOnly = fold(head).sessions[0];
  assert.equal(draftOnly.topics[0].state, "draft");
  // 折：没出口的议题不能挂条目。
  assert.throws(
    () => fold([...head, { v: V, at: T(4), k: "task.add", s: null, id: "T1", title: "一条", criteria: "c", topic: "I1" }]),
    /还没锁定出口/,
  );
  // 折：没有的议题也不能挂。
  assert.throws(
    () => fold([...head, { v: V, at: T(4), k: "task.add", s: null, id: "T1", title: "一条", criteria: "c", topic: "I9" }]),
    /没有议题 I9/,
  );
  // 清单能读懂 来自： 这一行，并且不再把它当成看不懂的那一行。
  const text = "# 这一期\n\n## 段 S01.1\n- [?] 从议题拆出来的一条\n  来自：I1\n  标准：能跑\n";
  const read = parse(text);
  assert.deepEqual(read.problems, []);
  assert.equal(read.items[0].topic, "I1");
});

test("出口之后条目带着议题号，议题那头记下它出口了谁", () => {
  const events = [turn(1, "聊"), point(2, "P1", "一句"), create(3, "I1", "题", ["P1"], "正文"),
    establish(4, "I1"), release(5, "I1"),
    { v: V, at: T(6), k: "task.add", s: null, id: "T1", title: "出口的一条", criteria: "c", topic: "I1" },
    { v: V, at: T(7), k: "task.add", s: null, id: "T2", title: "又一条", criteria: "c", topic: "I1" }];
  const s = fold(events).sessions[0];
  assert.deepEqual(s.tasks.map((one) => one.topic), ["I1", "I1"]);
  assert.equal(s.topics[0].exportedAt, T(6), "第一次出口的时刻");
  assert.deepEqual(s.topics[0].exported, ["T1", "T2"], "议题记下出口了哪几条");
  // 出口过之后下一步不再指着"去拆它"。
  const next = nextAction(fold(events), null);
  assert.notEqual(next.what, "出口议题");
});

// CLI 一路：清单里写 来自：I1，没出口的议题整批拒并点名第几行；出口之后落进账本。
// 时间是"此刻往后"：init 自己会记一轮（就在现在），比它早的行会被排到它前面去。
test("the CLI refuses a 来自 line for an unopened topic, and lands one after the gate", async () => {
  const { workspace } = await import("../support/lib.mjs");
  const { append, readEvents } = await import("../lib/store.mjs");
  const { deed, writePlan, readPlan } = await import("./support/cli.mjs");
  const soon = (n) => new Date(Date.now() + 60000 * n).toISOString();
  const root = workspace("topic-export-cli");
  const init = deed(root, "init", "--said", "开一期", "--review", "core/**");
  assert.equal(init.status, 0, init.stderr);
  append(root, { v: V, at: soon(1), k: "point.add", s: null, id: "P1", text: "一句" });
  append(root, { v: V, at: soon(2), k: "topic.create", s: null, id: "I1", title: "题", points: ["P1"], body: "正文", by: "agent" });
  // 还没成立、没出口：整批拒，点名行号，账本零新增。
  const before = readEvents(root).length;
  writePlan(root, "# 这一期\n\n## 段\n- [?] 从议题来的一条\n  来自：I1\n  标准：能跑\n");
  const refused = deed(root, "submit");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /第 4 行/);
  assert.match(refused.stderr, /没成立|没锁定出口/);
  assert.equal(readEvents(root).length, before, "拒了就是一个字都不落");
  // 出口之后再交：条目带议题号落进账本。
  append(root, { v: V, at: soon(3), k: "topic.establish", s: null, id: "I1", body: "成文", points: ["P1"], by: "user", via: "panel" });
  append(root, { v: V, at: soon(4), k: "topic.release", s: null, id: "I1", by: "user", via: "panel" });
  const ok = deed(root, "submit");
  assert.equal(ok.status, 0, ok.stderr);
  const landed = readEvents(root).filter((one) => one.k === "task.add");
  assert.equal(landed.length, 1);
  assert.equal(landed[0].topic, "I1", "账本记下它来自哪个议题");
});
