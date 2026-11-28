import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fold } from "../core/fold.mjs";
import { append } from "../lib/store.mjs";
import { renderBoard, when } from "../board/render.mjs";
import { start } from "../board/serve.mjs";
import { buildNow } from "../lib/panel.mjs";
import { workspace } from "../support/lib.mjs";
import { addTask, deliverTask } from "./support/cli.mjs";
import { spawnSync } from "node:child_process";
import { readEvents } from "../lib/store.mjs";

const config = { review: { required: ["core/**"], exempt: ["docs/**"] }, board: { port: 0 } };
const T = (n) => new Date(Date.UTC(2026, 10, 22, 10, n)).toISOString();
const events = [
  { v: 1, at: T(1), k: "turn", s: null, who: "user", said: "先做重放和条款" },
  { v: 1, at: T(2), k: "task.add", s: null, id: "T1", title: "重放", criteria: "同账本同文档", files: ["docs/x.md"] },
  { v: 1, at: T(3), k: "task.done", s: null, id: "T1", evidence: "node --test 16/16", by: "agent" },
  { v: 1, at: T(4), k: "judge.pass", s: null, segment: "S01.1", by: "user" },
  { v: 1, at: T(5), k: "task.add", s: null, id: "T2", title: "服务", criteria: "SSE", files: ["core/serve.mjs"] },
  { v: 1, at: T(6), k: "task.done", s: null, id: "T2", evidence: "curl 200", by: "agent" },
];

// The threshold is folded out of the ledger, so a serving fixture states it
// the same way a real workspace does: as config.change events.
const configEvents = [
  { v: 1, at: T(0), k: "config.change", s: null, key: "review", from: null, to: config.review, why: "init 收下的审查设置", by: "user" },
  { v: 1, at: T(0), k: "config.change", s: null, key: "board", from: null, to: config.board, why: "init 收下的审查设置", by: "user" },
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
});

test("the same ledger renders the same bytes, and no clock leaks in", () => {
  const first = render();
  const second = render(fold(events));
  assert.equal(first, second);
  assert.doesNotMatch(first, /分钟前|小时前|刚刚/);
  assert.match(first, /账本 <b>6<\/b> 条/, "报的是账本条数，不是轮次");
  assert.notEqual(first, renderBoard(doc, config, { zone: "UTC", events: 6 }), "时区是显式参数，不是机器状态");
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

// 段里还有该做的事时，页面说的是那一步，不是别的。
test("the page names the next actor instead of listing everything", () => {
  const html = render();
  assert.match(html, /下一步 · agent/);
  assert.match(html, /记下文件/, "T2 的交付没记下文件：那是该先做的一步");
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
    assert.deepEqual(state.next.who, "agent", "段里还有该做的事：下一步是段内那一步");
    assert.equal(state.turns, 1);
    assert.equal(state.session.segment.id, "S01.2");
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
    // hello 里的时刻和指纹一起走：`{"at":"11/27 05:27","build":"…"}`
    const said = JSON.parse(stream.text.split("\n").find((line) => line.startsWith("data: ")).slice(6)).at;
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

// 面板闲着才自己退：有人开着页面（SSE 连着）时不能把他正看的页面收掉。
// 这两条用短 idle 跑——真等 30 分钟测不起。exit:false 让测试进程不被带走。
test("an open SSE connection keeps the panel from exiting as idle", async () => {
  const root = workspace("idle-stream");
  const prev = process.env.DEED_PANEL_IDLE_MIN;
  process.env.DEED_PANEL_IDLE_MIN = "0.002"; // 0.12 秒空闲线，检查间隔被压到 1 秒
  const server = start(root, 0, null, { exit: false });
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  let closedByUs = false;
  server.on("close", () => { closedByUs = true; });
  const stream = await new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port, path: "/events" }, (res) => {
      res.once("data", () => resolve(res));
    });
  });
  try {
    await new Promise((r) => setTimeout(r, 2200));
    assert.equal(closedByUs, false, "SSE 还连着，面板不该按闲置收摊");
    assert.equal(server.listening, true);
  } finally {
    stream.destroy();
    if (prev === undefined) delete process.env.DEED_PANEL_IDLE_MIN;
    else process.env.DEED_PANEL_IDLE_MIN = prev;
    await new Promise((r) => { if (server.listening) server.close(r); else r(); });
  }
});

test("with no stream the panel closes on idle, and exit:false keeps the host alive", async () => {
  const root = workspace("idle-plain");
  const prev = process.env.DEED_PANEL_IDLE_MIN;
  process.env.DEED_PANEL_IDLE_MIN = "0.002";
  const server = start(root, 0, null, { exit: false });
  await new Promise((resolve) => server.once("listening", resolve));
  let closed = false;
  server.on("close", () => { closed = true; });
  try {
    await new Promise((r) => setTimeout(r, 2200));
    assert.equal(closed, true, "没人连着就该按闲置收摊");
    assert.equal(server.listening, false);
  } finally {
    if (prev === undefined) delete process.env.DEED_PANEL_IDLE_MIN;
    else process.env.DEED_PANEL_IDLE_MIN = prev;
    if (server.listening) await new Promise((r) => server.close(r));
  }
});

// 挡着的时候不画按钮：条件不满足的闸只在边上说明为什么，不给人一个按不下去的位置。
test("a gate that cannot be pressed is not drawn", () => {
  const html = render();
  assert.doesNotMatch(html, /data-gate="sign"/, "这一期还欠着交付：没有签收的按钮");
  assert.match(html, /先把上面挡路的清掉/);
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
    assert.match(page.body, /deed check --ledger/);
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



test("a port somebody else already holds is named, not routed around", async () => {
  // 一个工作区只有一个面板：号被占着的时候不再换号（换号=同时两条页面）。
  // serve 该做的是把这件事说出来，然后退出——路由到别的号就是把"看哪一条"变成记忆问题。
  const other = http.createServer((req, res) => res.end("not deed"));
  await new Promise((resolve) => other.listen(0, "127.0.0.1", resolve));
  const taken = other.address().port;
  const root = workspace("port-taken");
  fs.mkdirSync(path.join(root, ".deed"), { recursive: true });
  let said = "";
  const errors = [];
  const quiet = (err) => errors.push(err);
  process.on("uncaughtException", quiet);
  const server = start(root, taken, (body) => {
    said = body;
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  process.off("uncaughtException", quiet);
  try {
    assert.match(said, /端口 \d+ 被占着，面板不再换号/, "占着就明说，不换号：" + said);
    assert.match(said, /\/__deed/, "顺手给出确认它是谁的办法");
    server.close();
  } finally {
    await new Promise((resolve) => other.close(resolve));
  }
});


test("a panel stands down when it is asked to, so nobody has to kill it", async () => {
  const root = workspace("retire");
  fs.mkdirSync(path.join(root, ".deed"), { recursive: true });
  const server = start(root, 0, null, { exit: false });
  const port = await new Promise((resolve) => {
    const see = () => (server.address()?.port ? resolve(server.address().port) : setTimeout(see, 10));
    see();
  });
  const res = await fetch("http://127.0.0.1:" + port + "/__deed/retire", { method: "POST" });
  assert.equal(res.status, 200, "让位的话说得出");
  const who = await res.json();
  assert.equal(who.ok, true);
  assert.equal(who.pid, process.pid, "退的是它自己");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const gone = await fetch("http://127.0.0.1:" + port + "/__deed").then(() => false).catch(() => true);
  assert.equal(gone, true, "说完就收摊：那一格空出来了");
});


test("a panel answers who it is, so nothing has to guess", async () => {
  const root = workspace("identity");
  fs.mkdirSync(path.join(root, ".deed"), { recursive: true });
  const server = start(root, 0);
  const port = await new Promise((resolve) => {
    const see = () => (server.address()?.port ? resolve(server.address().port) : setTimeout(see, 10));
    see();
  });
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/__deed");
    const who = await res.json();
    assert.equal(who.deed, true, "这个号上是 deed 的面板");
    assert.equal(path.resolve(who.root), path.resolve(root), "是这一份账本的面板，不是别的工作区的");
    assert.equal(who.port, port, "它自己说得出自己在哪一格");
    assert.equal(who.build, buildNow(), "它手里的代码是哪一版也说得出——这就是旧渲染能被发现的原因");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test("every list on the page runs newest first", () => {
  const html = render();
  const turns = [...html.matchAll(/<p class="tsaid">([^<]*)<\/p>/g)].map((m) => m[1]);
  // 讨论屏：只有一轮，先确认它在；再拿执行屏的段来验次序
  const segs = [...html.matchAll(/<span class="vid">(S01\.\d)<\/span>/g)].map((m) => m[1]);
  const exec = [...html.matchAll(/<article class="seg"[^>]*data-seg="(S01\.\d)"/g)].map((m) => m[1]);
  const order = exec.length ? exec : segs;
  assert.deepEqual(order, [...order].sort().reverse(), "段从新到旧排：" + order.join(","));

  // 轮次：造两轮，最新的那一条要在前面
  const twoTurns = fold([
    { v: 1, at: T(1), k: "turn", s: null, who: "user", said: "先说的话" },
    { v: 1, at: T(2), k: "turn", s: null, who: "user", said: "后说的话" },
  ]);
  const page = renderBoard(twoTurns, config, { zone, events: 2 });
  const said = [...page.matchAll(/<p class="tsaid">([^<]*)<\/p>/g)].map((m) => m[1]);
  assert.deepEqual(said, ["后说的话", "先说的话"], "最新的那轮在最上面");
});

test("the one write the panel accepts is a gate, and signing happens there", async () => {
  const root = workspace("gate-panel");
  const run = (...args) =>
    spawnSync(process.execPath, [path.join(import.meta.dirname, "..", "cli", "deed.mjs"), ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, DEED_NO_PANEL: "1" },
    });
  run("init", "--said", "开始", "--review", "core/**");
  addTask(root, "改重放", "同账本同文档");
  fs.mkdirSync(path.join(root, "core"), { recursive: true });
  fs.writeFileSync(path.join(root, "core", "a.mjs"), "a\n");
  assert.equal(deliverTask(root, "T1", "写完了", { file: "core/a.mjs" }).status, 0, "勾上就是交付");
  // 审查通过只把这一段交回来：判决那一按才是它的结局。
  assert.equal(run("review", "--segment", "S01.1").status, 0);
  assert.equal(run("review", "--segment", "S01.1", "--verdict", "pass", "--result-all", "met").status, 0);

  const server = start(root, 0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  const post = (body, headers = {}) =>
    new Promise((resolve) => {
      const req = http.request(
        { host: "127.0.0.1", port, method: "POST", path: "/gate", headers: { "content-type": "application/json", ...headers } },
        (res) => {
          let text = "";
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
        },
      );
      req.end(JSON.stringify(body));
    });
  try {
    // 审查通过之后这一段等你判：判决那一下在页面上，签收还挡着。
    const waiting = await get(port, "/");
    assert.match(waiting.body, /data-gate="judgement" data-segment="S01\.1"/, "等判决的段上有那一下");
    assert.doesNotMatch(waiting.body, /data-gate="sign"/, "这一段还没判，签收的闸不出按钮");
    assert.doesNotMatch(waiting.body, /deed sign --words/, "签收不再写在页面上让人去命令行里敲");

    const foreign = await post({ action: "sign", words: "可以" }, { origin: "http://evil.example" });
    assert.equal(foreign.status, 403, "别的站点发来的按不动");

    const empty = await post({ action: "judgement", segment: "  " });
    assert.equal(empty.status, 400);
    assert.match(empty.body.why, /哪一段/);

    const early = await post({ action: "sign", words: "可以" });
    assert.equal(early.status, 400, "判决没按，签收按不下去");

    const judged1 = await post({ action: "judgement", segment: "S01.1" });
    assert.equal(judged1.status, 200, JSON.stringify(judged1.body));
    const closed = fold(readEvents(root)).sessions[0].segments[0];
    assert.equal(closed.closedAt !== null, true);
    assert.equal(closed.judgedBy, "user");
    const again2 = await post({ action: "judgement", segment: "S01.1" });
    assert.equal(again2.status, 400, "判过的段不再判");
    assert.equal(run("review", "--all").status, 0);
    assert.equal(run("review", "--all", "--verdict", "pass").status, 0);

    const open = await get(port, "/");
    assert.match(open.body, /data-gate="sign"/, "段都判过、期审也过了：签收的闸开在这里");

    const pressed = await post({ action: "sign", words: "可以，就这样" });
    assert.equal(pressed.status, 200, JSON.stringify(pressed.body));
    const signed = fold(readEvents(root)).sessions[0];
    assert.equal(signed.closeKind, "signed");
    assert.equal(signed.sign.words, "可以，就这样");
    assert.equal(signed.sign.by, "user", "按下的人是用户");
    assert.equal(signed.sign.via, "panel", "账本要读得出这一下是从哪按的");

    const again = await post({ action: "sign", words: "再签一次" });
    assert.equal(again.status, 400, "签过的一期不再有闸");
    assert.match(again.body.why, /签收|搁下/);

    // 条件不满足就不画那个按钮：签过的一期上没有签收闸，也没有可推翻的结论。
    const after = await get(port, "/");
    assert.doesNotMatch(after.body, /data-gate="sign"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


// T88：议题卡把收编要点显示的轮号链回讨论屏原文（#turn-N）。
test("topic cards link their point rounds back to the original turns", () => {
  const doc = fold([
    { v: 1, at: T(1), k: "turn", s: null, who: "user", said: "先说的那句" },
    { v: 30, at: T(2), k: "point.add", s: null, id: "P1", text: "一句判断" },
    { v: 30, at: T(3), k: "topic.create", s: null, id: "I1", title: "一个议题", body: "正文", points: ["P1"], by: "agent" },
  ]);
  const html = renderBoard(doc, config, { zone, events: 4 });
  assert.match(html, /<a class="tlink" href="#turn-1">第 1 轮<\/a>/u, "议题卡有指向第一轮的锚点");
  assert.match(html, /<li class="turn user" id="turn-1"/u, "讨论屏那一条原文有对应的锚点");
});


// 执行屏任务卡的「依据」引用 P/I/轮次要能直链到讨论屏；不存在的号不造死链。
test("a task's source references link straight to the discuss screen", () => {
  const doc = fold([
    { v: 1, at: T(1), k: "turn", s: null, who: "user", said: "讨论的第一轮" },
    { v: 28, at: T(2), k: "point.add", s: null, id: "P14", text: "一条判断" },
    { v: 30, at: T(3), k: "topic.create", s: null, id: "I1", title: "一个议题", body: "正文", points: [], by: "agent" },
    { v: 32, at: T(4), k: "task.add", s: null, id: "T1", title: "一件事", criteria: "c",
      source: "来自 P14、I1 与第 1 轮；P99 还没记" },
  ]);
  const html = renderBoard(doc, config, { zone, events: 4 });
  assert.match(html, /<a class="xref" href="#P14" data-screen="discuss">P14<\/a>/u, "要点可链");
  assert.match(html, /<a class="xref" href="#I1" data-screen="discuss">I1<\/a>/u, "议题可链");
  assert.match(html, /<a class="xref" href="#turn-1" data-screen="discuss">第 1 轮<\/a>/u, "轮次可链");
  assert.match(html, /<li class="clue" id="P14"/u, "讨论屏要点有锚点");
  assert.match(html, /<li class="qa" id="I1"/u, "讨论屏议题有锚点");
  assert.ok(!html.includes('href="#P99"'), "没记的要点不造死链");
});


// 出口的条目在任务卡上写明它来自哪个议题，并且点得到那张议题卡。
test("a task exported from a topic says so, and the topic is one click away", () => {
  const doc = fold([
    { v: 1, at: T(1), k: "turn", s: null, who: "user", said: "聊" },
    { v: 33, at: T(2), k: "point.add", s: null, id: "P1", text: "一句" },
    { v: 33, at: T(3), k: "topic.create", s: null, id: "I1", title: "一个议题", body: "正文", points: ["P1"], by: "agent" },
    { v: 33, at: T(4), k: "topic.establish", s: null, id: "I1", body: "正文", points: ["P1"], by: "user", via: "panel" },
    { v: 33, at: T(5), k: "topic.release", s: null, id: "I1", by: "user", via: "panel" },
    { v: 33, at: T(6), k: "task.add", s: null, id: "T1", title: "出口的活", criteria: "c", topic: "I1" },
  ]);
  const html = renderBoard(doc, config, { zone, events: 7 });
  assert.match(html, /<p class="k">来自议题<\/p>/u);
  assert.match(html, /<a class="xref" href="#I1" data-screen="discuss">I1<\/a>/u, "议题号是直链");
  assert.match(html, /已经出口：T1/u, "议题卡说出出口了哪几条");
});

// 一段走过不止一帧：几份清单、几次结论都看得见，作废的也在时间线上标出来；
// 每条条目印它最近一次被判成什么。屏上原来只剩最后那一帧，读不出"怎么走过来的"。
test("a segment shows how it got here: every sheet, every verdict, and what each item was judged", () => {
  const sheet = (n, name, tasks) => ({ v: 36, at: T(n), k: "review.brief", s: null, segment: "S01.1", by: "agent", brief: name, guide: name.replace(".md", "-reviewer.md"), tasks });
  const log = (n, verdict, results, brief = "b.md") => ({
    v: 35, at: T(n), k: "review.log", s: null, segment: "S01.1", by: "qa", verdict, brief, findings: [], results,
    ...(verdict === "fail" ? { rework: results.filter((one) => one.verdict === "unmet").map((one) => one.id) } : {}),
  });
  const ledger = [
    { v: 1, at: T(1), k: "turn", s: null, who: "user", said: "做重放" },
    { v: 1, at: T(2), k: "task.add", s: null, id: "T1", title: "重放", criteria: "同账本同文档", files: ["core/fold.mjs"] },
    { v: 1, at: T(3), k: "task.done", s: null, id: "T1", evidence: "node --test", by: "agent" },
    sheet(4, "s011-a.md", ["T1"]),
    log(5, "fail", [{ id: "T1", verdict: "unmet", note: "重放里还有一处读时钟" }], "s011-a.md"),
    { v: 1, at: T(5), k: "task.done", s: null, id: "T1", evidence: "node --test 又跑一遍", by: "agent" },
    sheet(6, "s011-b.md", ["T1"]),
    log(7, "fail", [{ id: "T1", verdict: "unmet", note: "第二遍还是慢" }], "s011-b.md"),
    { v: 1, at: T(7), k: "task.done", s: null, id: "T1", evidence: "node --test 第三遍", by: "agent" },
    sheet(8, "s011-c.md", ["T1"]),
    log(9, "fail", [{ id: "T1", verdict: "unmet", note: "又读时钟了" }], "s011-c.md"),
    { v: 1, at: T(10), k: "task.done", s: null, id: "T1", evidence: "node --test 第四遍", by: "agent" },
  ];
  const one = fold(ledger);
  const page = renderBoard(one, config, { zone, events: ledger.length });
  assert.match(page, /第 3 份清单 · 判过 3 次/u, "走过几份、判过几次");
  const hist = page.slice(page.indexOf('class="hist"'));
  assert.match(hist, /s011-a\.md/u, "第一份清单在时间线上");
  assert.match(hist, /s011-c\.md/u, "最后一份也在");
  assert.match(hist, /作废/u, "被后来的结论顶掉的要标出来");
  assert.match(page, /最近一次判定/u, "每条条目印它最近一次被判成什么");
  assert.match(page, /这条之后改过，判定说的是旧内容/u, "判过之后又改过的，不假装那句判定还算数");
});

// 清单交出去了、还没人回答：这一段此刻"在判"。屏上写成"要审"或"等判决"都说不清谁在动。
test("a segment whose sheet is out says it is being judged", () => {
  const ledger = [
    { v: 1, at: T(1), k: "turn", s: null, who: "user", said: "做重放" },
    { v: 1, at: T(2), k: "task.add", s: null, id: "T1", title: "重放", criteria: "同账本同文档", files: ["core/fold.mjs"] },
    { v: 1, at: T(3), k: "task.done", s: null, id: "T1", evidence: "node --test", by: "agent" },
    { v: 36, at: T(4), k: "review.brief", s: null, segment: "S01.1", by: "agent", brief: "s011.md", guide: "s011-reviewer.md", tasks: ["T1"] },
  ];
  const page = renderBoard(fold(ledger), config, { zone, events: ledger.length });
  const seg = page.slice(page.indexOf('id="S01.1"'));
  assert.match(seg.slice(0, 400), /在判/u, "清单出去了，这一段在判");
  assert.doesNotMatch(seg.slice(0, 400), /tag[^>]*>要审/u, "印花不是「要审」");
});
