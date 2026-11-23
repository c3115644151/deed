import test from "node:test";
import assert from "node:assert/strict";
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
  assert.doesNotMatch(newer.advice, /rejected/, "账本新的时候，指去挪走就是毁证据");

  const hand = unknownKindNotice("task.block", null, "0.2.0");
  assert.equal(hand.newer, false);
  assert.match(hand.headline, /没有写者版本/);
  assert.match(hand.advice, /\.deed\/log\/rejected/);

  const older = unknownKindNotice("task.block", "0.1.0", "0.2.0");
  assert.equal(older.newer, false, "写者不比当前新，就不是版本差能解释的");
  assert.match(older.headline, /写者版本 0\.1\.0/);
});

test("the running version comes from the package it ships with", () => {
  assert.match(currentVersion(), /^\d+\.\d+\.\d+$/);
});
