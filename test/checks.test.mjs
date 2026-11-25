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
    { role: "core", dir: "core", mayImport: [] },
    { role: "app", dir: "app", mayImport: ["core"] },
  ],
  extras: [],
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
  const state = projectState(
    doc(declared({ layers: [
      { role: "core", dir: "core", mayImport: [] },
      { role: "app", dir: "app", mayImport: ["core"] },
      { role: "tests", dir: "tests", mayImport: ["core", "app"] },
    ] })),
    tree(["core/a.mjs", "app/b.mjs", "tests/c.mjs"], [{ from: "app/b.mjs", to: "core/a.mjs" }]),
  );
  assert.equal(state.declared, true);
  assert.equal(state.passed, 3);
  assert.deepEqual(state.missing, []);
});

test("a reversed import is a structural failure, and it says which edge", () => {
  const list = checkAll(
    doc(declared({ layers: [
      { role: "core", dir: "core", mayImport: [] },
      { role: "app", dir: "app", mayImport: ["core"] },
      { role: "tests", dir: "tests", mayImport: ["core", "app"] },
    ] })),
    tree(["core/a.mjs", "app/b.mjs", "tests/c.mjs"], [{ from: "core/a.mjs", to: "app/b.mjs" }]),
  );
  const shape = list.find((one) => one.id === "shape");
  assert.equal(shape.verdict, "fail");
  assert.match(shape.detail, /core → app/u);
  assert.match(shape.fix, /--layers/u, "未通过要给一条能跑的修法");
});

test("a declared layer that is not on disk fails, and says which one", () => {
  const list = checkAll(
    doc(declared({ layers: [
      { role: "core", dir: "core", mayImport: [] },
      { role: "app", dir: "app", mayImport: ["core"] },
      { role: "tests", dir: "tests", mayImport: ["core", "app"] },
    ] })),
    tree(["core/a.mjs", "tests/c.mjs"]),
  );
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

const software = (extra = {}) => declared({
  layers: [
    { role: "core", dir: "core", mayImport: [] },
    { role: "app", dir: "app", mayImport: ["core"] },
    { role: "tests", dir: "tests", mayImport: ["core", "app"] },
  ],
  ...extra,
});

test("the standing falls back when the tree moves: it is a value, not a badge", () => {
  const before = projectState(doc(software()), tree(["core/a.mjs", "app/b.mjs", "tests/c.mjs"]));
  assert.equal(before.passed, 3);
  const after = projectState(
    doc(software()),
    tree(["core/a.mjs", "app/b.mjs", "tests/c.mjs"], [{ from: "core/a.mjs", to: "app/b.mjs" }]),
  );
  assert.equal(after.passed, 2);
  assert.deepEqual(after.missing, ["文件树符合声明的结构"]);
});

// 结构检查对着范式的"格"来判：一类项目至少要有的角色，目录名可以不同。
test("a software project that is missing a required role says which one", () => {
  const thin = declared({
    layers: [
      { role: "core", dir: "core", mayImport: [] },
      { role: "app", dir: "app", mayImport: ["core"] },
    ],
  });
  const shape = checkAll(doc(thin), tree(["core/a.mjs", "app/b.mjs"])).find((one) => one.id === "shape");
  assert.equal(shape.verdict, "fail");
  assert.match(shape.detail, /缺这1格：tests/u);
});

test("a directory nobody claims is reported, and extras is how you say it does not belong", () => {
  const before = checkAll(doc(software()), tree(["core/a.mjs", "app/b.mjs", "tests/c.mjs", "scripts/d.mjs"]))
    .find((one) => one.id === "shape");
  assert.equal(before.verdict, "fail");
  assert.match(before.detail, /没有归属：scripts/u, "盘上多出来的目录要有人认领，或者被显式排除");
  const after = checkAll(doc(software({ extras: ["scripts"] })), tree(["core/a.mjs", "app/b.mjs", "tests/c.mjs", "scripts/d.mjs"]))
    .find((one) => one.id === "shape");
  assert.equal(after.verdict, "pass");
});

test("a directory may claim a role whose name differs from its own", () => {
  const renamed = declared({
    layers: [
      { role: "core", dir: "core", mayImport: [] },
      { role: "app", dir: "cli", mayImport: ["core"] },
      { role: "tests", dir: "test", mayImport: ["core", "app"] },
    ],
  });
  const shape = checkAll(doc(renamed), tree(["core/a.mjs", "cli/b.mjs", "test/c.mjs"], [{ from: "cli/b.mjs", to: "core/a.mjs" }]))
    .find((one) => one.id === "shape");
  assert.equal(shape.verdict, "pass", shape.detail);
  assert.match(shape.detail, /3 个目录认领 3 格/u);
});
