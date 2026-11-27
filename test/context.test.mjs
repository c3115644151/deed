import test from "node:test";
import assert from "node:assert/strict";
import { validateEvent, EVENT_VERSION } from "../core/events.mjs";
import { fold } from "../core/fold.mjs";
import { draft, parse } from "../cli/plan.mjs";
import { references, findStaleTasks } from "../core/stale.mjs";

const at = "2026-11-27T00:00:00.000Z";
const base = { v: EVENT_VERSION, at, s: null, by: "agent", w: "0.28.0" };
// 第一条 turn 自己开会话；task 事件落在它开的会话里。
const turn = validateEvent({ ...base, at: "2026-11-26T00:00:00.000Z", k: "turn", who: "user", said: "开一期" });

// 三个字段是正式字段，not "当时的世界" 那种说法。
test("task.add carries problem, source and premise; old rows still read", () => {
  const ev = validateEvent({
    ...base,
    k: "task.add",
    id: "T1",
    title: "一件事",
    criteria: "做完的标准",
    problem: "用户看到的错现象",
    source: "R3 的第 2 轮",
    premise: ["deed say", "SPEC 第 9 版"],
  });
  assert.equal(ev.problem, "用户看到的错现象");
  const doc = fold([turn, ev]);
  const t = doc.sessions[0].tasks[0];
  assert.equal(t.problem, "用户看到的错现象");
  assert.equal(t.source, "R3 的第 2 轮");
  assert.deepEqual(t.premise, ["deed say", "SPEC 第 9 版"]);

  // 老账本没有这三个字段：照旧读，不报错。
  const old = validateEvent({ ...base, v: 9, k: "task.add", id: "T2", title: "老任务", criteria: "旧标准" });
  const doc2 = fold([turn, ev, old]);
  const t2 = doc2.sessions[0].tasks.find((one) => one.id === "T2");
  assert.equal(t2.problem, null);
  assert.deepEqual(t2.premise, []);
});

test("task.context fills in context without touching title, criteria or status", () => {
  const add = validateEvent({ ...base, k: "task.add", id: "T1", title: "一件事", criteria: "标准" });
  const ctx = validateEvent({ ...base, at: "2026-11-27T02:00:00.000Z", k: "task.context", id: "T1", problem: "现象", source: "R7", premise: ["deed say"] });
  const t = fold([turn, add, ctx]).sessions[0].tasks[0];
  assert.equal(t.title, "一件事");
  assert.equal(t.criteria, "标准");
  assert.equal(t.status, "todo");
  assert.equal(t.problem, "现象");
  assert.equal(t.source, "R7");
  assert.deepEqual(t.premise, ["deed say"]);
});

test("premise must be a list of non-empty strings", () => {
  assert.throws(() => validateEvent({ ...base, k: "task.context", id: "T1", premise: "不是数组" }), /premise/);
  assert.throws(() => validateEvent({ ...base, k: "task.context", id: "T1", premise: [""] }), /premise/);
});

test("the draft prints context and reading it back keeps it", () => {
  const session = {
    goal: { text: "把上下文带上。" },
    segments: [{ id: "S01.1", closedAt: null }],
    tasks: [
      {
        id: "T1", segment: "S01.1", title: "一件事", criteria: "标准",
        problem: "要消掉的现象", source: "R3", premise: ["deed say", "SPEC 9"],
        status: "todo", evidence: [],
      },
    ],
  };
  const text = draft(session);
  assert.match(text, /问题：要消掉的现象/u);
  assert.match(text, /依据：R3/u);
  assert.match(text, /前提：deed say、SPEC 9/u);
  const back = parse(text);
  assert.equal(back.problems.length, 0);
  assert.equal(back.items[0].problem, "要消掉的现象");
  assert.equal(back.items[0].source, "R3");
  assert.equal(back.items[0].premise, "deed say、SPEC 9");
});

test("references finds commands and switches with their owner", () => {
  const refs = references('deed say "…" --topic I1；deed review --segment S01.1');
  // 顺序不定；每组引用都在就行。
  assert.ok(refs.some((r) => r.verb === "say" && r.flag === null));
  assert.ok(refs.some((r) => r.verb === "say" && r.flag === "topic" && r.ref === "say --topic"));
  assert.ok(refs.some((r) => r.verb === "review" && r.flag === null));
  assert.ok(refs.some((r) => r.verb === "review" && r.flag === "segment"));
  assert.equal(refs.length, 4);
});

test("staleness is measured against the given command surface, only for open undone tasks", () => {
  const surface = { say: ["from", "session"], review: ["segment"] };
  const segments = [{ id: "S01.1", closedAt: null }, { id: "S01.0", closedAt: at }];
  const tasks = [
    { id: "T1", segment: "S01.1", status: "todo", criteria: 'deed say --topic I1', premise: [] },
    { id: "T2", segment: "S01.1", status: "todo", criteria: "deed say --from x", premise: [] },
    { id: "T3", segment: "S01.1", status: "done", criteria: "deed ask answer", premise: [] },
    { id: "T4", segment: "S01.0", status: "todo", criteria: "deed ask answer", premise: [] },
  ];
  const stale = findStaleTasks(tasks, segments, surface);
  assert.deepEqual(stale.map((one) => one.id), ["T1"]);
  assert.match(stale[0].ref, /say --topic/u);
  assert.deepEqual(findStaleTasks(tasks, segments, null), [], "没有命令面就不猜");
});
