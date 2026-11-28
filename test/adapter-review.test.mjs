// T153：适配器的两条审查路——同一段复用同一个审查者，整期审另开一个。
// 不起真子代理：把宿主给的那几个服务换成记账的替身，断言适配器伸手要了哪一条路。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { workspace } from "../support/lib.mjs";
import { readEvents } from "../lib/store.mjs";
import { fold } from "../core/fold.mjs";
import { reviewDue } from "../core/rules.mjs";
import { deed, addTask, deliverTask, gate } from "./support/cli.mjs";

// 一个够用的宿主：把钩子收进来，服务用替身。
const host = (root, services) => {
  const handlers = new Map();
  const ctx = {
    on(name, fn) {
      handlers.set(name, fn);
    },
    effect(fn) {
      fn();
      return () => {};
    },
    get(name) {
      return services[name];
    },
  };
  return { ctx, handlers };
};

const sessionOf = (root) => ({ header: { cwd: root, id: "s-" + path.basename(root) } });

const waitFor = async (probe, ms = 8000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (probe()) return true;
    await new Promise((one) => setTimeout(one, 60));
  }
  return false;
};

const logText = (root) => {
  try {
    return fs.readFileSync(path.join(root, ".deed", "tmp", "dsh.log"), "utf8");
  } catch {
    return "";
  }
};

test("the same segment's review goes back to the same agent; a period review gets its own", async () => {
  const cwd = workspace("adapter-review");
  assert.equal(deed(cwd, "init", "--said", "开始", "--review", "core/**").status, 0);
  addTask(cwd, "做一", "跑得通");
  fs.writeFileSync(path.join(cwd, "a.md"), "改动\n");
  deliverTask(cwd, "T1", "跑：跑得通");

  const started = [];
  const messaged = [];
  const firstPrompts = [];
  const services = {
    agents: { get: (id) => ({ session: sessionOf(cwd) }) },
    subagents: {
      startContinuable: async (args) => {
        started.push(args.label);
        firstPrompts.push(args.request?.prompt?.[0]?.text ?? "");
        return { childId: "child-" + started.length };
      },
      sendMessage: async (agent, childId, prompt) => {
        messaged.push({ childId, text: prompt?.[0]?.text ?? "" });
      },
      listChildren: async () => [],
    },
  };
  const { ctx, handlers } = host(cwd, services);
  const mod = await import("../adapters/dsh/index.js");
  mod.apply(ctx, {});

  const doc = () => fold(readEvents(cwd));
  assert.equal(reviewDue(doc(), doc().config).kind, "segment", "这一段此刻该审");

  // 第一次：清单与角色包还没出，适配器让 deed 自己出一份，然后把清单交给一个新起的审查者。
  handlers.get("session/event")(sessionOf(cwd), { type: "turn/start" });
  assert.ok(await waitFor(() => started.length === 1), "起了一个审查者");
  const firstChild = started.length;

  // 第二次问同一段、同一份清单：它还在他手上，不重发。
  handlers.get("session/event")(sessionOf(cwd), { type: "turn/start" });
  assert.ok(await waitFor(() => /还在他手上/u.test(logText(cwd))), "同一份不再发第二遍");
  assert.equal(messaged.length, 0, "一个字都没重发");

  // 判一份不合格、修完再交：这才真的出了第二份清单。同一个人接着判，但只发增量。
  assert.equal(
    deed(cwd, "review", "--segment", "S01.1", "--verdict", "fail", "--result", "T1=unmet", "--rework", "T1", "--why", "没做到").status,
    0,
  );
  fs.writeFileSync(path.join(cwd, "a.md"), "改动 · 第二版\n");
  deliverTask(cwd, "T1", "跑：跑得通 v2", { file: "a.md" });
  assert.equal(deed(cwd, "review", "--segment", "S01.1").status, 0, "出第二份清单");
  console.log("DEBUG due", deed(cwd, "review", "--due").stdout.trim());
  handlers.get("session/event")(sessionOf(cwd), { type: "turn/start" });
  const sent = await waitFor(() => messaged.length >= 1);
  if (!sent) console.log("DEBUG log\n" + logText(cwd));
  assert.ok(sent, "把第二份发回给同一个审查者");
  assert.equal(started.length, firstChild, "没有再起一个审查者");
  assert.equal(messaged[0].childId, "child-1", "发回的是第一个那个");
  assert.match(logText(cwd), /重审交给 child-1/u);
  // 第一次发全（清单 + 角色包）；第二份起只发增量，角色包不再重发。
  assert.match(firstPrompts[0], /角色包（怎么审）/u, "第一次要他读角色包");
  assert.doesNotMatch(messaged[0].text, /角色包（怎么审）/u, "复审不重发角色包");
  assert.match(messaged[0].text, /第 \d+ 份清单/u, "复审说清这是第几份");
});

test("a period review opens its own agent, not the segment's", async () => {
  const cwd = workspace("adapter-period");
  assert.equal(deed(cwd, "init", "--said", "开始", "--review", "core/**").status, 0);
  addTask(cwd, "做一", "跑得通");
  fs.writeFileSync(path.join(cwd, "a.md"), "改动\n");
  deliverTask(cwd, "T1", "跑：跑得通");

  const started = [];
  const messaged = [];
  const services = {
    agents: { get: () => ({ session: sessionOf(cwd) }) },
    subagents: {
      startContinuable: async (args) => {
        started.push(args.label);
        return { childId: "child-" + started.length };
      },
      sendMessage: async (agent, childId) => {
        messaged.push(childId);
      },
      listChildren: async () => [],
    },
  };
  const { ctx, handlers } = host(cwd, services);
  const mod = await import("../adapters/dsh/index.js");
  mod.apply(ctx, {});

  // 先让段审起一个审查者：它留在内存里，正是"期审别把清单与角色包发给他"要防的那一个。
  handlers.get("session/event")(sessionOf(cwd), { type: "turn/start" });
  assert.ok(await waitFor(() => started.length === 1), "段审起了一个审查者");
  const segmentHand = started[0];

  // 段审通过、判决、段关闭：此刻轮到期审。
  assert.equal(deed(cwd, "review", "--segment", "S01.1", "--verdict", "pass", "--result", "T1=met").status, 0);
  gate(cwd, { action: "judgement", segment: "S01.1" });
  const doc0 = fold(readEvents(cwd));
  assert.ok(doc0.sessions[0].segments.every((one) => one.closedAt !== null), "段都关了");
  assert.equal(reviewDue(doc0, doc0.config).kind, "period", "轮到期审");

  handlers.get("session/event")(sessionOf(cwd), { type: "turn/start" });
  assert.ok(await waitFor(() => started.length === 2), "期审另起了一个");
  assert.equal(messaged.length, 0, "没有把期审清单与角色包发给段审那个审查者");
  assert.notEqual(started[1], segmentHand, "期审的名字与段审不同：" + started[1]);
  assert.match(logText(cwd), /整期/u, "日志里说的是整期那一次");
});
