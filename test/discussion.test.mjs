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
const point = (n, id, text, topic = null) => ({ v: V, at: T(n), k: "point.add", s: null, id, text, topic, by: "agent:claude" });
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

test("a draft can be revised before establishment, but not after", () => {
  const events = [turn(1, "聊"), point(2, "P1", "一句"),
    create(3, "I1", "题", ["P1"], "第一版"),
    create(4, "I1", "题", ["P1"], "第二版", "I1")];
  const s = fold(events).sessions[0];
  assert.equal(s.topics.length, 1, "同一议题只留最新那份草稿");
  assert.equal(s.topics[0].body, "第二版");
  assert.throws(() => fold([...events, establish(5, "I1"), create(6, "I1", "题", ["P1"], "第三版", "I1")]), /正文不往回改/);
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
