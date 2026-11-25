import test from "node:test";
import assert from "node:assert/strict";
import { CHECKS, checkAll, projectState } from "../core/checks.mjs";

// 体检层是纯的：同样的账本 + 同样的目录快照，永远得到同样的结论。
// 这三条检查是这张表的第一批；以后每点亮一条机制，就在 CHECKS 里多一行。
const doc = (project = null) => ({
  v: 1,
  sessions: [{ id: "S01", turns: [] }],
  changes: [],
  config: { review: { required: [], exempt: [] } },
  project,
});

const tree = (files, imports = []) => ({ files, imports });
const declared = (extra = {}) => ({
  shape: "software",
  background: "一个本地工具，给一个人用；不碰网络。",
  layers: [
    { dir: "core", mayImport: [] },
    { dir: "app", mayImport: ["core"] },
  ],
  ...extra,
});

test("the registry is an ordered list of named checks", () => {
  assert.deepEqual(
    CHECKS.map((one) => one.id),
    ["workspace", "shape", "background"],
    "顺序就是它们成立的顺序：能记账 → 树对不对 → 背景写没写",
  );
  for (const one of CHECKS) {
    assert.equal(typeof one.judge, "function", one.id + " 要有一条判定");
    assert.ok(one.fix && one.fix.length > 0, one.id + " 要有修法");
    assert.ok(one.capability && one.capability.length > 0, one.id + " 要说清解锁什么");
  }
});

test("without a project, only the workspace check applies", () => {
  const state = projectState(doc(), tree([]));
  assert.equal(state.declared, false);
  assert.equal(state.missing.length, 0, "不适用不算未结项");
  assert.deepEqual(checkAll(doc(), tree([])).map((one) => one.verdict), ["pass", "na", "na"]);
});

test("a declared project passes when the tree keeps the declared directions", () => {
  const state = projectState(doc(declared()), tree(["core/a.mjs", "app/b.mjs"], [{ from: "app/b.mjs", to: "core/a.mjs" }]));
  assert.equal(state.declared, true);
  assert.equal(state.passed, 3);
  assert.deepEqual(state.missing, []);
});

test("a reversed import is a structural failure, and it says which edge", () => {
  const list = checkAll(doc(declared()), tree(["core/a.mjs", "app/b.mjs"], [{ from: "core/a.mjs", to: "app/b.mjs" }]));
  const shape = list.find((one) => one.id === "shape");
  assert.equal(shape.verdict, "fail");
  assert.match(shape.detail, /core → app/u);
  assert.match(shape.fix, /--layers/u, "未通过要给一条能跑的修法");
});

test("a declared layer that is not on disk fails, and says which one", () => {
  const list = checkAll(doc(declared()), tree(["core/a.mjs"]));
  const shape = list.find((one) => one.id === "shape");
  assert.equal(shape.verdict, "fail");
  assert.match(shape.detail, /app/u);
});

test("an empty background is a failure: signing would have no ruler", () => {
  const list = checkAll(doc(declared({ background: "   " })), tree(["core/a.mjs", "app/b.mjs"]));
  const background = list.find((one) => one.id === "background");
  assert.equal(background.verdict, "fail");
});

test("a project that opted out of structure passes that check without a tree", () => {
  const list = checkAll(doc(declared({ shape: "free", layers: [] })), null);
  assert.deepEqual(list.map((one) => one.verdict), ["pass", "pass", "pass"]);
});

test("the standing falls back when the tree moves: it is a value, not a badge", () => {
  const before = projectState(doc(declared()), tree(["core/a.mjs", "app/b.mjs"]));
  assert.equal(before.passed, 3);
  const after = projectState(doc(declared()), tree(["core/a.mjs", "app/b.mjs"], [{ from: "core/a.mjs", to: "app/b.mjs" }]));
  assert.equal(after.passed, 2);
  assert.deepEqual(after.missing, ["文件树符合声明的分层"]);
});
