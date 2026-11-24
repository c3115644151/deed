import test from "node:test";
import assert from "node:assert/strict";
import { EVENT_VERSION, validateEvent } from "../core/events.mjs";
import { compareVersions, currentVersion, unknownKindNotice } from "../lib/version.mjs";

test("versions compare by three numbers, and only by them", () => {
  assert.equal(compareVersions("0.2.0", "0.1.9"), 1);
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
  // 预发布标记不参与排序：解析不了就是解析不了，不猜。
  assert.equal(compareVersions("0.2.0-rc.1", "0.2.0"), null);
  assert.equal(compareVersions(undefined, "0.1.0"), null);
});

test("a ledger written by a newer deed is not a broken ledger", () => {
  const newer = unknownKindNotice("task.block", "9.9.9", "0.2.0");
  assert.equal(newer.newer, true);
  assert.match(newer.headline, /账本比 deed 新：task\.block 是 deed 9\.9\.9 写的/);
  assert.match(newer.advice, /别删也别挪/);
  assert.doesNotMatch(newer.advice, /rejected/, "账本新的时候，指去挪走就是毁记录");

  const hand = unknownKindNotice("task.block", null, "0.2.0");
  assert.equal(hand.newer, false);
  assert.match(hand.headline, /没有写者版本/);
  assert.match(hand.advice, /\.deed\/log\/rejected/);

  const older = unknownKindNotice("task.block", "0.1.0", "0.2.0");
  assert.equal(older.newer, false, "写者不比当前新，就不是版本差能解释的");
  assert.match(older.headline, /写者版本 0\.1\.0/);
});

test("a line from a newer vocabulary is newer even when the version string matches", () => {
  // 加一个事件类型没升版本号，旧程序（同一个 0.2.0、更少的类型）就会把合法的新行
  // 当成坏账，还叫人挪去 rejected——这是会真丢数据的一次误诊。含义版本就是为了
  // 让这一步有据可依：行自己说了它属于第几套含义。
  const ahead = unknownKindNotice("task.undo", "0.2.0", "0.2.0", EVENT_VERSION + 1);
  assert.equal(ahead.newer, true);
  assert.match(ahead.headline, new RegExp(`事件含义第 ${EVENT_VERSION + 1} 版`));
  assert.match(ahead.advice, /别删也别挪/);
  assert.doesNotMatch(ahead.advice, /rejected/);

  const same = unknownKindNotice("task.undo", "0.2.0", "0.2.0", EVENT_VERSION);
  assert.equal(same.newer, false, "含义版本不超前，才轮到「手写或被改过」这条解释");
  assert.match(same.advice, /\.deed\/log\/rejected/);
  assert.match(same.headline, new RegExp(`含义第 ${EVENT_VERSION} 版，当前第 ${EVENT_VERSION} 版`));

  const old = unknownKindNotice("task.undo", "0.2.0", "0.2.0", 1);
  assert.equal(old.newer, false, "旧行不认得的类型，也不是账本新");
});

test("an older line is read by the standard it was written under, not today's", () => {
  // 第 3 版把打回并进了不合格：新写的 fail 必须点名、必须说为什么。
  // 但 doctor 会逐行校验旧账本——用今天的规矩去验 11-23 之前的行，等于把一份
  // 干净的账本判成坏的。历史行按它自己那一版读。
  const line = {
    k: "review.log",
    s: "S01",
    segment: "S01.1",
    by: "reviewer:old",
    verdict: "fail",
    brief: ".deed/review/S01.1-1.md",
    briefDigest: "a".repeat(64),
    at: "2026-11-23T00:00:00.000Z",
  };
  assert.doesNotThrow(() => validateEvent({ ...line, v: 2 }, line.at), "第 2 版的行不带 why/rework 也成立");
  assert.doesNotThrow(() => validateEvent({ ...line, v: undefined }, line.at), "没写 v 的行更早");
  assert.throws(() => validateEvent({ ...line, v: 3 }, line.at), /why/);
  assert.throws(() => validateEvent({ ...line, v: 3, why: "看不清" }, line.at), /rework/);
});

test("a round the agent wrote for itself is history, not a new breach", () => {
  // 第 12 版起轮次只记人开口的那一轮。旧账本里 agent 自记的那些行要照读：
  // 这条规矩只对写在它之后的行生效，否则 doctor 会把当时合法的历史全判成坏账。
  const line = { k: "turn", s: "S01", who: "agent", said: "这一轮读了代码", at: "2026-11-23T00:00:00.000Z" };
  assert.doesNotThrow(() => validateEvent({ ...line, v: 2 }, line.at), "第 2 版的 agent 轮照读");
  assert.doesNotThrow(() => validateEvent({ ...line }, line.at), "没写 v 的行更早");
  assert.throws(() => validateEvent({ ...line, v: EVENT_VERSION }, line.at), /轮次只记你和用户之间的一轮/);
});

test("the running version comes from the package it ships with", () => {
  assert.match(currentVersion(), /^\d+\.\d+\.\d+$/);
});
