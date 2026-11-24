import test from "node:test";
import assert from "node:assert/strict";
import { draft, parse } from "../cli/plan.mjs";

const section = (lines) => lines.join("\n");

// The file is the interface: what a line means has to be readable from the line
// alone, and anything the parser does not understand has to come back as a line
// number instead of silence.
test("the plan reads the four things a line can say", () => {
  const plan = parse(
    section([
      "# 这一期要做成什么",
      "把清单做成一个文件。",
      "",
      "## 段 S01.1",
      "- [x] T1 已经交付的条目",
      "  标准：说得清",
      "  交付：npm test 129/129",
      "- [ ] T2 还没做的条目",
      "  标准：写得出",
      "- ? 新条目",
      "  标准：还没编号",
      "~~ T3 不做了的条目",
      "  理由：想法变了",
    ]),
  );
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.goal, "把清单做成一个文件。");
  assert.deepEqual(
    plan.items.map((one) => [one.id, one.box, one.title]),
    [
      ["T1", "x", "已经交付的条目"],
      ["T2", " ", "还没做的条目"],
      [null, "?", "新条目"],
      ["T3", "~", "不做了的条目"],
    ],
  );
  assert.equal(plan.items[0].claim, "npm test 129/129");
  assert.equal(plan.items[1].criteria, "写得出");
  assert.equal(plan.items[3].why, "想法变了");
});

test("a line nobody can read comes back with its number", () => {
  const plan = parse(section(["# 这一期要做成什么", "一句话的目的", "", "## 段 S01.1", "- [ ] T1 一件事", "  这件说两句", "没有缩进的一句"]));
  assert.equal(plan.problems.length, 2, plan.problems.join(" / "));
  assert.match(plan.problems[0], /第 6 行/);
  assert.match(plan.problems[1], /第 7 行/);
});

test("a field written twice is a question, not the last word", () => {
  const plan = parse(section(["- [ ] T1 一件事", "  标准：甲", "  标准：乙"]));
  assert.equal(plan.problems.length, 1);
  assert.match(plan.problems[0], /写了不止一遍/);
});

test("the same task twice in one file is refused", () => {
  const plan = parse(section(["- [ ] T1 一件事", "- [x] T1 同一件事"]));
  assert.match(plan.problems.join(" "), /同一个条目标了两次：T1/);
});

test("a field that belongs to nobody is a problem of its own line", () => {
  const plan = parse(section(["  标准：悬空的一句"]));
  assert.match(plan.problems[0], /不属于任何条目/);
});

// The draft is what the ledger can account for; reading it back has to give the
// same facts, or the file and the ledger drift apart one round at a time.
test("reading the draft back gives the ledger the same items", () => {
  const session = {
    goal: { text: "把清单做成一个文件。" },
    segments: [{ id: "S01.1" }],
    tasks: [
      { id: "T1", segment: "S01.1", title: "已经交付", criteria: "说得清", status: "done", evidence: [{ claim: "npm test 129/129" }] },
      { id: "T2", segment: "S01.1", title: "还没做", criteria: "写得出", status: "todo", evidence: [] },
      { id: "T3", segment: "S01.1", title: "延后了", criteria: "以后", status: "deferred", deferredWhy: "等下一轮", evidence: [] },
      { id: "T4", segment: "S01.1", title: "不做了", criteria: "算了", status: "dropped", dropWhy: "想法变了", evidence: [] },
    ],
  };
  const text = draft(session);
  const back = parse(text);
  assert.deepEqual(back.problems, []);
  assert.equal(back.goal, "把清单做成一个文件。");
  assert.deepEqual(
    back.items.map((one) => [one.id, one.box]),
    [["T1", "x"], ["T2", " "], ["T3", " "], ["T4", "~"]],
  );
  assert.equal(back.items[0].claim, "npm test 129/129");
  assert.equal(back.items[2].later, "等下一轮");
  assert.equal(back.items[3].why, "想法变了");
});

// 清单里写着哪一节，不等于新条目就落进那一段：一段送审还在等结论时它不再收东西。
// 那一节印不出来，就把它印出来——写 ? 的人得知道这些条目会去哪儿。
test("the draft shows where a new entry will land when the open segment is waiting", () => {
  const base = {
    goal: { text: "把清单做成一个文件。" },
    segments: [{ id: "S01.1", closedAt: null }],
    tasks: [{ id: "T1", segment: "S01.1", title: "还没做", criteria: "写得出", status: "todo", evidence: [] }],
    briefs: [],
  };
  const waiting = draft({
    ...base,
    briefs: [{ scope: "segment", segment: "S01.1", answeredBy: null }],
  });
  assert.match(waiting, /## 下一段（S01\.1 在等结论，它不再收新条目：写在这里的 \? 落到下一段，submit 时才领号）/);
  assert.deepEqual(parse(waiting).problems, [], "多出来的那一节不该让清单读不懂");

  const settled = draft({
    ...base,
    briefs: [{ scope: "segment", segment: "S01.1", answeredBy: "R1" }],
  });
  assert.doesNotMatch(settled, /## 下一段/, "这一段收得了活，就没有下一段可指");

  const shut = draft({ ...base, segments: [{ id: "S01.1", closedAt: "2026-11-24T00:00:00.000Z" }], briefs: [] });
  assert.match(shut, /## 下一段（这一段的活都结束了：写在这里的 \? 会开下一段）/);
});
