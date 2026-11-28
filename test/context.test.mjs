import test from "node:test";
import assert from "node:assert/strict";
import { validateEvent, EVENT_VERSION } from "../core/events/index.mjs";
import { fold } from "../core/fold.mjs";
import { draft, parse } from "../cli/plan.mjs";
import { references, findStaleTasks } from "../core/stale.mjs";

const at = "2026-11-27T00:00:00.000Z";
const base = { v: EVENT_VERSION, at, s: null, by: "agent", w: "0.28.0" };
// 第一条 turn 自己开会话；task 事件落在它开的会话里。
const turn = validateEvent({ ...base, at: "2026-11-26T00:00:00.000Z", k: "turn", who: "user", said: "开一期" });

// 任务只有三样该有的信息：标题（说人话，解决什么）、标准（怎么算完）、依据（出处）。
test("task.add carries a source; old rows without one still read", () => {
  const ev = validateEvent({
    ...base,
    k: "task.add",
    id: "T1",
    title: "把黑话标题换成人话",
    criteria: "做完的标准",
    source: "R3 的第 2 轮",
  });
  assert.equal(ev.source, "R3 的第 2 轮");
  const doc = fold([turn, ev]);
  const t = doc.sessions[0].tasks[0];
  assert.equal(t.source, "R3 的第 2 轮");

  // 老账本没有依据：照旧读。
  const old = validateEvent({ ...base, v: 9, k: "task.add", id: "T2", title: "老任务", criteria: "旧标准" });
  const t2 = fold([turn, ev, old]).sessions[0].tasks.find((one) => one.id === "T2");
  assert.equal(t2.source, null);
});

test("task.context fills in the source without touching title, criteria or status", () => {
  const add = validateEvent({ ...base, k: "task.add", id: "T1", title: "一件事", criteria: "标准" });
  const ctx = validateEvent({ ...base, at: "2026-11-27T02:00:00.000Z", k: "task.context", id: "T1", source: "R7" });
  const t = fold([turn, add, ctx]).sessions[0].tasks[0];
  assert.equal(t.title, "一件事");
  assert.equal(t.criteria, "标准");
  assert.equal(t.status, "todo");
  assert.equal(t.source, "R7");
});

test("task.title corrects a jargon title and keeps the old one in history", () => {
  const add = validateEvent({ ...base, k: "task.add", id: "T1", title: "放出那道闸", criteria: "标准" });
  const fix = validateEvent({ ...base, at: "2026-11-27T03:00:00.000Z", k: "task.title", id: "T1", title: "让人在面板上确认议题后才拆任务" });
  const t = fold([turn, add, fix]).sessions[0].tasks[0];
  assert.equal(t.title, "让人在面板上确认议题后才拆任务");
  assert.equal(t.criteria, "标准", "改标题不动标准");
  assert.equal(t.status, "todo");
});

test("source must be one non-empty sentence when present", () => {
  assert.throws(() => validateEvent({ ...base, k: "task.context", id: "T1", source: "" }), /source/);
  assert.throws(() => validateEvent({ ...base, k: "task.context", id: "T1" }), /依据/);
});

test("the draft prints the source and reading it back keeps it", () => {
  const session = {
    goal: { text: "把依据带上。" },
    segments: [{ id: "S01.1", closedAt: null }],
    tasks: [
      { id: "T1", segment: "S01.1", title: "一件事", criteria: "标准", source: "R3", status: "todo", evidence: [] },
    ],
  };
  const text = draft(session);
  assert.match(text, /依据：R3/u);
  const back = parse(text);
  assert.equal(back.problems.length, 0);
  assert.equal(back.items[0].source, "R3");
});

test("references finds commands and switches with their owner", () => {
  const refs = references('deed say "…" --topic I1；deed review --segment S01.1');
  assert.ok(refs.some((r) => r.verb === "say" && r.flag === null));
  assert.ok(refs.some((r) => r.verb === "say" && r.flag === "topic" && r.ref === "say --topic"));
  assert.ok(refs.some((r) => r.verb === "review" && r.flag === null));
  assert.ok(refs.some((r) => r.verb === "review" && r.flag === "segment"));
  assert.equal(refs.length, 4);
});

test("staleness is measured only for open undone tasks, against the given surface", () => {
  const surface = { say: ["from", "session"], review: ["segment"] };
  const segments = [{ id: "S01.1", closedAt: null }, { id: "S01.0", closedAt: at }];
  const tasks = [
    { id: "T1", segment: "S01.1", status: "todo", criteria: 'deed say --topic I1' },
    { id: "T2", segment: "S01.1", status: "todo", criteria: "deed say --from x" },
    { id: "T3", segment: "S01.1", status: "done", criteria: "deed ask answer" },
    { id: "T4", segment: "S01.0", status: "todo", criteria: "deed ask answer" },
  ];
  const stale = findStaleTasks(tasks, segments, surface);
  assert.deepEqual(stale.map((one) => one.id), ["T1"]);
  assert.match(stale[0].ref, /say --topic/u);
  assert.deepEqual(findStaleTasks(tasks, segments, null), [], "没有命令面就不猜");
});

test("a criteria that names a command the surface no longer has can be corrected", () => {
  const add = validateEvent({ ...base, k: "task.add", id: "T1", title: "一件事", criteria: "deed ask answer A1 --decision 说定了" });
  const fix = validateEvent({ ...base, at: "2026-11-27T04:00:00.000Z", k: "task.criteria", id: "T1", criteria: "说成一句话就落一行", why: "ask 已经删了" });
  const t = fold([turn, add, fix]).sessions[0].tasks[0];
  assert.equal(t.criteria, "说成一句话就落一行");
  assert.equal(t.status, "todo", "改标准不改状态");
  assert.throws(() => validateEvent({ ...base, k: "task.criteria", id: "T1", criteria: "x" }), /为什么|why/u);
});
