import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fold } from "../core/fold.mjs";
import { append } from "../lib/store.mjs";
import { renderBoard, when } from "../board/render.mjs";
import { start } from "../board/serve.mjs";
import { workspace } from "../support/lib.mjs";

const config = { review: { required: ["core/**"], exempt: ["docs/**"] }, board: { port: 0 } };
const T = (n) => new Date(Date.UTC(2026, 10, 22, 10, n)).toISOString();
const events = [
  { v: 1, at: T(1), k: "turn", s: null, who: "user", said: "先做重放和条款" },
  { v: 1, at: T(2), k: "task.add", s: null, id: "T1", title: "重放", criteria: "同账本同文档", files: ["docs/x.md"] },
  { v: 1, at: T(3), k: "task.done", s: null, id: "T1", evidence: "node --test 16/16", by: "agent" },
  { v: 1, at: T(4), k: "judge.pass", s: null, segment: "S01.1", by: "user" },
  { v: 1, at: T(5), k: "task.add", s: null, id: "T2", title: "服务", criteria: "SSE", files: ["core/serve.mjs"] },
  { v: 1, at: T(6), k: "task.done", s: null, id: "T2", evidence: "curl 200", by: "agent" },
  { v: 1, at: T(7), k: "ask.raise", s: null, id: "A1", text: "要不要兼容旧账", reading: "不兼容", why: "没定" },
];

// The threshold is folded out of the ledger, so a serving fixture states it
// the same way a real workspace does: as config.change events.
const configEvents = [
  { v: 1, at: T(0), k: "config.change", s: null, key: "review", from: null, to: config.review, why: "init 收下的门槛", by: "user" },
  { v: 1, at: T(0), k: "config.change", s: null, key: "board", from: null, to: config.board, why: "init 收下的门槛", by: "user" },
];

const doc = fold(events);
const zone = "Asia/Shanghai";
const ledger = events.length;
const render = (one = doc) => renderBoard(one, config, { zone, events: ledger });

const get = (port, pathname) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
  });

test("the sheet shows the period, both segments and both verdicts", () => {
  const html = render();
  assert.match(html, /S01\.1/);
  assert.match(html, /S01\.2/);
  assert.match(html, /判过/);
  assert.match(html, /要审/);
  assert.match(html, /S01\.2[\s\S]{0,4000}这一段碰了要审的路径：core\/serve\.mjs/, "第二段碰了要审的路径，页面上要明说哪一条");
  assert.match(html, /A1/);
});

test("the same ledger renders the same bytes, and no clock leaks in", () => {
  const first = render();
  const second = render(fold(events));
  assert.equal(first, second);
  assert.doesNotMatch(first, /分钟前|小时前|刚刚/);
  assert.match(first, /账本 <b>7<\/b> 条/, "报的是账本条数，不是轮次");
  assert.notEqual(first, renderBoard(doc, config, { zone: "UTC", events: 7 }), "时区是显式参数，不是机器状态");
});

test("a conclusion older than the last delivery says so on the page", () => {
  const stale = [
    { v: 1, at: T(1), k: "turn", s: null, who: "user", said: "先做重放" },
    { v: 1, at: T(2), k: "task.add", s: null, id: "T1", title: "重放", criteria: "同账本同文档", files: ["core/fold.mjs"] },
    { v: 1, at: T(3), k: "task.done", s: null, id: "T1", evidence: "node --test", by: "agent", digest: "a".repeat(64), digestPath: "core/fold.mjs", changed: ["core/fold.mjs"] },
    { v: 1, at: T(4), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict: "pass", brief: ".deed/review/S01.1-x.md", briefDigest: "b".repeat(64), findings: [] },
    { v: 1, at: T(6), k: "task.add", s: null, id: "T2", title: "再改重放", criteria: "一样", files: ["core/fold.mjs"] },
    { v: 1, at: T(7), k: "task.done", s: null, id: "T2", evidence: "又跑一遍", by: "agent", digest: "c".repeat(64), digestPath: "core/fold.mjs", changed: ["core/fold.mjs"] },
  ];
  const html = renderBoard(fold(stale), config, { zone, events: stale.length });
  assert.match(html, /要重审/, "结论早于最后一次交付：页面上不能仍说审过");
  assert.match(html, /结论早于最后一次交付/);
  assert.doesNotMatch(html, /undefined/);
});

test("the page names the next actor instead of listing everything", () => {
  const html = render();
  assert.match(html, /下一步 · user/);
  assert.match(html, /裁定/);
});

test("serving is read-only and says so", async () => {
  const root = workspace("serve");
  // The workspace already tells its agents where the ledger is, so the page
  // has nothing to add -- and the bytes stay comparable to a bare render.
  fs.writeFileSync(path.join(root, "AGENTS.md"), "看下一步：deed state\n");
  for (const event of configEvents) append(root, event);
  for (const event of events) append(root, event);
  const server = start(root, 0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  try {
    const page = await get(port, "/");
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /text\/html/);
    assert.equal(
      page.body,
      renderBoard(fold([...configEvents, ...events]), config, { zone: new Intl.DateTimeFormat().resolvedOptions().timeZone, events: ledger + configEvents.length }),
    );
    const state = JSON.parse((await get(port, "/state")).body);
    assert.equal(state.reading, "execute");
    assert.equal(state.events, ledger + configEvents.length, "报的是账本条数，不是轮次");
    assert.deepEqual(state.next.who, "user");
    assert.equal(state.turns, 1);
    assert.equal(state.session.segment.id, "S01.2");
    assert.deepEqual(state.session.asks, ["A1"]);
    assert.equal((await get(port, "/nope")).status, 404);
    const posted = await new Promise((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/" }, (res) => resolve(res.statusCode));
      req.end();
    });
    assert.equal(posted, 405);
    const stream = await new Promise((resolve) => {
      http.get({ host: "127.0.0.1", port, path: "/events" }, (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk;
          if (text.includes("\n\n")) {
            resolve({ status: res.statusCode, type: res.headers["content-type"], text });
            res.destroy();
          }
        });
      });
    });
    assert.equal(stream.status, 200);
    assert.match(stream.type, /text\/event-stream/);
    // The hello line is the only clock this stream reads, and it must speak the
    // zone the page speaks: one moment cannot read two ways on one screen.
    const said = stream.text.split("\n").find((line) => line.startsWith("data: ")).slice(6);
    const minutes = (text) => {
      const parts = text.match(/^(\d\d\/\d\d) (\d\d):(\d\d)$/);
      return Number(parts[2]) * 60 + Number(parts[3]);
    };
    const expected = when(new Date().toISOString(), new Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(Math.abs(minutes(said) - minutes(expected)) <= 1, true, "流里的开场时刻 " + said + " 该和页面同一个钟：" + expected);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a notice is an input to the page, not something the page looks up", () => {
  assert.doesNotMatch(render(), /class="notice"/);
  const told = { zone, events: ledger, notice: "AGENTS.md 里没提 deed state" };
  const html = renderBoard(doc, config, told);
  assert.match(html, /<p class="notice">AGENTS\.md 里没提 deed state<\/p>/);
  assert.equal(html, renderBoard(fold(events), config, told), "同一份事实与同一条提示，还是同一页");
});

test("a workspace that never told its agents where to ask gets one line on the page", async () => {
  const root = workspace("notice");
  for (const event of configEvents) append(root, event);
  for (const event of events) append(root, event);
  const server = start(root, 0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  try {
    assert.match((await get(port, "/")).body, /<p class="notice">这个工作区没有 AGENTS\.md/);
    fs.writeFileSync(path.join(root, "AGENTS.md"), "## 账在 deed\n- 看下一步：\`deed state\`\n");
    assert.doesNotMatch((await get(port, "/")).body, /class="notice"/, "写进去之后就不该再念");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a new line in the ledger pushes an event to the open page", async () => {
  const root = workspace("sse");
  append(root, events[0]);
  const server = start(root, 0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  try {
    const chunks = [];
    const stream = await new Promise((resolve) => {
      http.get({ host: "127.0.0.1", port, path: "/events" }, (res) => resolve(res));
    });
    stream.on("data", (chunk) => chunks.push(chunk.toString("utf8")));
    assert.equal(stream.statusCode, 200);
    append(root, events[1]);
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !chunks.join("").includes("event: change")) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.match(chunks.join(""), /event: change/);
    // The other half of the wire: the page must listen for the name the server
    // sends, or the browser gets a silent stream and nobody notices.
    assert.match(chunks.join(""), /^event: hello$/m);
    assert.match(render(), /addEventListener\("change"/);
    stream.destroy();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a broken ledger makes the panel say so instead of vanishing", async () => {
  const root = workspace("broken");
  append(root, events[0]);
  fs.appendFileSync(path.join(root, ".deed", "log", new Date().toISOString().slice(0, 7) + ".jsonl"), "GARBAGE-LINE\n");
  const server = start(root, 0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  try {
    const page = await get(port, "/");
    assert.equal(page.status, 500, "读不动就说读不动，不要 200 一张空页");
    assert.match(page.headers["content-type"], /text\/html/);
    assert.match(page.body, /账本里有读不动的行/);
    assert.match(page.body, /deed doctor/);
    const state = await get(port, "/state");
    assert.equal(state.status, 500);
    assert.ok(JSON.parse(state.body).broken, "机器也要看出这是坏账，不是空账");
    const chunks = [];
    const stream = await new Promise((resolve) => {
      http.get({ host: "127.0.0.1", port, path: "/events" }, (res) => resolve(res));
    });
    stream.on("data", (chunk) => chunks.push(chunk.toString("utf8")));
    fs.appendFileSync(path.join(root, ".deed", "log", new Date().toISOString().slice(0, 7) + ".jsonl"), "MORE-GARBAGE\n");
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !chunks.join("").includes("event: broken")) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.match(chunks.join(""), /event: broken/, "连着的页面要知道账坏了，而不是静静停在旧内容");
    stream.destroy();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a segment that took more than one brief says so on its head", () => {
  const brief = (n) => ({ v: 1, at: T(n), k: "review.brief", s: null, segment: "S01.1", brief: "b" + n + ".md", briefDigest: "a".repeat(64) });
  const busy = fold([
    ...configEvents,
    { v: 1, at: T(1), k: "turn", s: null, who: "user", said: "先做重放" },
    { v: 1, at: T(2), k: "task.add", s: null, id: "T1", title: "重放", criteria: "同账本同文档", files: ["core/x.mjs"] },
    { v: 1, at: T(3), k: "task.done", s: null, id: "T1", evidence: "node --test 1/1", by: "agent" },
    brief(4),
    brief(5),
  ]);
  const html = renderBoard(busy, config, { zone, events: 6 });
  assert.match(html, /<span class="scost"[^>]*>清单 2</, "出过两份清单就写在段头上");
  assert.match(html, /\.scost \{/, "那一枚有它自己的样式");
});

test("a port somebody else already holds does not take the panel down with it", async () => {
  // 面板的意义是"随时能看"：号被占了就换一个号继续开，并在页面上说清它开在哪。
  const other = http.createServer((req, res) => res.end("not deed"));
  await new Promise((resolve) => other.listen(0, "127.0.0.1", resolve));
  const taken = other.address().port;
  const root = workspace("port-taken");
  fs.mkdirSync(path.join(root, ".deed"), { recursive: true });
  const server = start(root, taken);
  const actual = await new Promise((resolve) => {
    const see = () => (server.address()?.port ? resolve(server.address().port) : setTimeout(see, 10));
    see();
  });
  try {
    assert.notEqual(actual, taken, "占了就换一个");
    assert.ok(actual > 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => other.close(resolve));
  }
});

test("the turns are the axis, and a question collects the words that came in while it was open", () => {
  // 讨论屏的主轴是轮次：谁在什么时候说了什么。题在右边，是还没发出去的档案——
  // 它只在自己的窗口里攒用户说的话，不复制主轴上的轮次。
  const events = [
    ...configEvents,
    { v: 1, at: T(1), k: "turn", s: null, who: "user", said: "先说两句" },
    { v: 1, at: T(2), k: "ask.raise", s: null, id: "A1", text: "第一个问题", reading: "当成这样", why: "得你定" },
    { v: 1, at: T(3), k: "turn", s: null, who: "user", said: "第一个问题接着问" },
    { v: 1, at: T(4), k: "ask.raise", s: null, id: "A2", text: "第二个问题", reading: "当成那样", why: "也得你定" },
    { v: 1, at: T(5), k: "turn", s: null, who: "user", said: "两个都谈谈" },
    { v: 1, at: T(6), k: "ask.resolve", s: null, id: "A1", decision: "按第一个办\n边界：不许再问一遍", by: "user", why: "就这么定" },
    { v: 1, at: T(7), k: "turn", s: null, who: "agent", said: "记下了" },
  ];
  const html = renderBoard(fold(events), config, { zone, events: 7 });
  const main = html.slice(html.indexOf('<div class="col logs">'), html.indexOf('<aside class="side">'));
  assert.equal((main.match(/class="turn /gu) ?? []).length, 4, "四条轮次都摊在主轴上，一条不折");
  assert.match(main, /先说两句/, "没成题的轮次也在主轴上，不用先成题才能出现");
  assert.match(html, /data-state="pending"[\s\S]{0,400}A2/, "还开着的题标成等你定");
  assert.match(html, /deed ask resolve A2/, "等它定的时候给出那条命令");
  assert.match(html, /class="clues"[\s\S]{0,400}两个都谈谈/, "开着的题把窗口里你说的话攒在自己名下");
  assert.match(html, /攒到 1 句/, "题头说清它攒到了几句");
  assert.match(html, /class="qdone">按第一个办</, "卡里的结论只留当场那句话，边界行另算");
  assert.match(html, /已经定下的[\s\S]{0,400}A1/, "裁过的题收进右边那组，不占主轴");
  assert.ok(html.indexOf("两个都谈谈") < html.indexOf('<aside class="side">'), "主轴在前，题在后");
});

test("the accept screen lists the borders a decision drew", () => {
  // 签收前要看得见这一期定过哪些不许做的事；它不是任务，所以不在执行屏上。
  const events = [
    ...configEvents,
    { v: 1, at: T(1), k: "turn", s: null, who: "user", said: "先做重放" },
    { v: 1, at: T(2), k: "ask.raise", s: null, id: "A1", text: "文档要不要一起改", reading: "只改代码", why: "两种都说得通" },
    { v: 1, at: T(3), k: "ask.resolve", s: null, id: "A1", by: "user", why: "先这样", decision: "只改代码\n边界：文档里不再新增旧词\n弃：导出不做了" },
  ];
  const html = renderBoard(fold(events), config, { zone, events: 3 });
  assert.match(html, /定过的边界与不做/);
  assert.match(html, /文档里不再新增旧词/);
  assert.match(html, /导出不做了/);
  assert.match(html, /<span class="ekind">边界</);
  assert.match(html, /<span class="ekind">弃</);
});
