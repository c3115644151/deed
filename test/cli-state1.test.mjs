import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { workspace } from "../support/lib.mjs";
import { readEvents } from "../lib/store.mjs";
import { fold } from "../core/fold.mjs";
import { EVENT_VERSION, validateEvent } from "../core/events.mjs";
import { panelRecord, buildNow, watchedFiles, readPanel } from "../lib/panel.mjs";
import { applyGate, gatesOf } from "../board/gates.mjs";
import {
  CLI, OFF, deed, later, gate, judgeAll, judgeHere, signHere, judged, kinds, briefs, proof,
  writeLines, planFile, writePlan, readPlan,
  addTask, deliverTask, undoDelivery, dropTask,
} from "./support/cli.mjs";


test("doctor keeps saying it until the workspace tells its agents where to ask", () => {
  const cwd = workspace("doctor-words");
  deed(cwd, "init", "--said", "开始");
  assert.match(deed(cwd, "check", "--ledger").stdout, /接入 · 这个工作区没有 AGENTS\.md/);
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# 管理\n\n下一步看 `deed state`。\n");
  const told = deed(cwd, "check", "--ledger");
  assert.equal(told.status, 0);
  assert.match(told.stdout, /账本干净/);
  assert.doesNotMatch(told.stdout, /接入 · /, "已经写清楚了就别再念，否则这句提示会变成噪音");
});






test("doctor names the line that broke the ledger and the only repair it allows", () => {
  const cwd = workspace("ledger");
  deed(cwd, "init", "--said", "开始");
  assert.match(deed(cwd, "check", "--ledger").stdout, /账本干净/);
  const file = fs.readdirSync(path.join(cwd, ".deed", "log")).find((one) => one.endsWith(".jsonl"));
  const written = fs.readFileSync(path.join(cwd, ".deed", "log", file), "utf8").split("\n").filter(Boolean).length;
  fs.appendFileSync(path.join(cwd, ".deed", "log", file), "{ oh no\n");
  const broken = deed(cwd, "check", "--ledger");
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, new RegExp("账本坏了 · .* 第 " + (written + 1) + " 行"));
  assert.match(broken.stdout, /移到 .deed\/log\/rejected/);
});


test("a config.json saved with a BOM reads the same as one without", () => {
  // 记事本存 UTF-8 会带 BOM；这个文件本来就是给人改的，编码不该变成"审查设置 JSON 坏了"。
  const cwd = workspace("config-bom");
  assert.equal(deed(cwd, "init", "--said", "开始").status, 0);
  const configFile = path.join(cwd, ".deed", "config.json");
  fs.writeFileSync(configFile, "\uFEFF" + fs.readFileSync(configFile, "utf8"));
  const state = deed(cwd, "state");
  assert.equal(state.status, 0);
  assert.doesNotMatch(state.stdout, /审查设置 文件与账本不一致/);
  assert.equal(deed(cwd, "check", "--ledger").status, 0, "带 BOM 的那份照样读得动");
});








// 现挑一格能占的空号：并发的另一次跑、或机器上真在跑的面板，都不该让这一条红。
const emptyPort = () =>
  new Promise((ok) => {
    const probe = net.createServer(() => {});
    probe.once("error", () => ok(0));
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => ok(port));
    });
  });


// 面板跟着命令走：你不必记得先跑 serve，也不必在 dsh 重启之后手动把它拉回来。
test("a panel comes up with the first command, and the next one leaves it alone", async () => {
  const cwd = workspace("panel");
  const env = { ...process.env };
  delete env.DEED_NO_PANEL;
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env });
  // 声明号现挑一格空号：一个工作区只有一个面板，撞上机器上真在跑的那一条就不是在测这段代码了。
  const free = await emptyPort();
  try {
    run("init", "--said", "起点", "--port", String(free));
    const first = run("say", "看看面板");
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /面板 · http:\/\/127\.0\.0\.1:\d+/, "第一条命令就把面板拉起来了");

    const second = run("state");
    assert.equal(second.status, 0, second.stderr);
    assert.doesNotMatch(second.stdout, /面板 · /, "已经在跑就不再拉第二个，也不再刷屏");

    const now = run("panel");
    assert.equal(now.status, 0, now.stderr);
    const port = Number(now.stdout.match(/127\.0\.0\.1:(\d+)/)[1]);
    assert.equal(port > 0, true);

    const stop = run("panel", "--stop");
    assert.match(stop.stdout, /面板已停/);
    const after = run("state");
    assert.match(after.stdout, /面板 · http:\/\/127\.0\.0\.1:\d+/, "停掉之后下一条命令又把它拉起来");
  } finally {
    run("panel", "--stop");
  }
});


// 一个工作区只有一个面板：声明的号被占着时不再换号（换号=同时两条页面），
// 只说清是谁占着，命令照跑；号让出来之后，下一条命令在原格上把面板拉起来。
// 按原端口重启：一条命令，地址不变，pid 换了。中间那一步是旧的把号让出来（不是被杀）。
test("the panel can be replaced in place, on the same address", async () => {
  const cwd = workspace("panel-restart");
  const env = { ...process.env };
  delete env.DEED_NO_PANEL;
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env });
  const port = await emptyPort();
  const url = (out) => Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);
  try {
    assert.equal(run("init", "--said", "起点", "--port", String(port)).status, 0);
    const first = run("panel");
    assert.equal(url(first.stdout), port, "先起来在声明的那一格");
    const before = readPanel(cwd);
    const again = run("panel", "--restart");
    assert.equal(again.status, 0, again.stderr);
    assert.equal(url(again.stdout), port, "地址不变");
    const after = readPanel(cwd);
    assert.notEqual(after.pid, before.pid, "换了进程");
  } finally {
    run("panel", "--stop");
  }
});


test("a taken port is named, and the panel appears there once it is free", async () => {
  const cwd = workspace("panel-port");
  const env = { ...process.env };
  delete env.DEED_NO_PANEL;
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env });
  const url = (out) => Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);
  const base = await emptyPort();
  const held = net.createServer(() => {});
  const listen = () => new Promise((ok) => held.listen(base, "127.0.0.1", ok));
  const give = () => new Promise((ok) => held.close(() => ok()));
  try {
    assert.equal(run("init", "--said", "起点", "--port", String(base)).status, 0);
    await listen();
    const taken = run("say", "看看面板");
    assert.equal(taken.status, 0, "面板起不来不该让命令失败：" + taken.stderr);
    assert.match(taken.stdout, new RegExp("面板没起来 —— .*（端口 " + base + "）"), "占着就说清，不换号：" + taken.stdout);
    assert.doesNotMatch(taken.stdout, /面板 · http:/, "不许另开第二条页面");
    // 号让出来：下一条命令把它起在声明的这一格上，地址就是收藏的那一条
    await give();
    const again = run("state");
    assert.equal(again.status, 0, again.stderr);
    assert.equal(url(again.stdout), base, "就在声明的那一格上起来");
    // 记号里写的是它自己：pid、端口，以及它手里那版代码的指纹（= 当前这份代码）。
    // 换了代码之后由面板自己换代（每 2 秒对一次指纹、端口不动），所以这里只验不变量。
    const now = readPanel(cwd);
    assert.ok(now && now.pid > 0, "记号里记着它自己的 pid");
    assert.equal(now.port, base, "记号里的端口就是声明的那一格");
    assert.equal(now.build, buildNow(), "记号里的指纹就是当前这份代码——旧渲染因此能被发现");
  } finally {
    run("panel", "--stop");
    if (held.listening) await give();
  }
});


test("the panel stays out of the way when it is told to", () => {
  const cwd = workspace("panel-off");
  deed(cwd, "init", "--said", "起点");
  const run = deed(cwd, "state");
  assert.doesNotMatch(run.stdout, /面板 · /, "DEED_NO_PANEL=1 时一条都不许起");
});


// 先做后记：文件在任务被记下之前就写好了，那条任务记的是既成事实。
// doctor 只报事实，不算坏账。




test("a panel is replaced when any module it loaded changes, not only its own files", () => {
  // 进程把模块装进内存：改了 core/fold.mjs 之后，旧进程手里的还是旧判断，
  // 页面上会印一段命令行根本不认的段号。指纹要盖住它加载过的每一份。
  const pkg = path.join(import.meta.dirname, "..");
  const listed = watchedFiles();
  for (const one of ["board/render.mjs", "board/serve.mjs", "core/fold.mjs", "core/rules.mjs", "lib/store.mjs"]) {
    assert.ok(listed.includes(one), "指纹要盖住 " + one);
  }
  const stale = createHash("sha256");
  for (const one of ["board/render.mjs", "board/serve.mjs", "lib/panel.mjs"]) {
    stale.update(one + "\n");
    stale.update(fs.readFileSync(path.join(pkg, one)));
  }
  assert.notEqual(buildNow(), stale.digest("hex").slice(0, 16), "只盖面板自己那三份，等于改了 core 也不换进程");
});


test("init refuses to overwrite a workspace that is already bound", () => {
  const cwd = workspace("rebind");
  deed(cwd, "init", "--said", "开始");
  const again = deed(cwd, "init", "--said", "又一次");
  assert.equal(again.status, 0);
  assert.match(again.stdout, /已经接过钩子/);
  assert.match(again.stdout, /deed serve/, "已经接过的也要说一次剩下的可选项");
  assert.equal(kinds(cwd).length, 4);
});


test("init --print-agents hands over the rules without writing into the workspace", () => {
  const cwd = workspace("print-agents");
  const said = deed(cwd, "init", "--print-agents");
  assert.equal(said.status, 0);
  assert.match(said.stdout, /deed state/, "那段里得点名查下一步的命令");
  assert.match(said.stdout, /deed say/);
  assert.equal(fs.existsSync(path.join(cwd, ".deed")), false, "只打印，不建账本");
  assert.equal(fs.existsSync(path.join(cwd, "AGENTS.md")), false, "规则归属人，deed 不替它写文件");
});


// 一期要做成什么：写在清单第一行，可改，账本留每一次；签收核对与签收都拿它当尺子。
test("a period says what it is for in the first line of the plan, and the sentence can change", () => {
  const cwd = workspace("goal-set");
  deed(cwd, "init", "--said", "开始");
  // 只改第一行下面的那句：条目本身还在文件里，改目的不该动清单。
  const aim = (text) => {
    const lines = readPlan(cwd).split("\n");
    lines[1] = text;
    writePlan(cwd, lines.join("\n"));
  };
  writePlan(cwd, ["# 这一期要做成什么", "把面板做到一眼看懂", "", "- ? 把面板做完", "  标准：一眼能看懂"].join("\n"));
  const first = deed(cwd, "submit");
  assert.equal(first.status, 0, first.stderr);
  assert.equal(kinds(cwd).filter((one) => one === "goal.set").length, 1, "第一行的目的随清单记账");
  assert.match(deed(cwd, "state").stdout, /目的 · 把面板做到一眼看懂/);

  // 改一句也是账本上的一次：旧的那句留在历史里，不是被覆盖。
  aim("这一期只把面板做完");
  assert.equal(deed(cwd, "submit").status, 0);
  assert.equal(kinds(cwd).filter((one) => one === "goal.set").length, 2);
  const session = fold(readEvents(cwd)).sessions[0];
  assert.equal(session.goal.text, "这一期只把面板做完");
  assert.equal(session.goals.length, 1, "旧的那句留着");

  // 清空第一行抹不掉目的：账本只追加，要改就再写一句（清空只是清单上没写字）。
  aim("");
  writePlan(cwd, readPlan(cwd).replace("  标准：一眼能看懂", "  标准：一眼能看懂\n\n- ? 再写一句\n  标准：说清"));
  assert.equal(deed(cwd, "submit").status, 0);
  assert.equal(fold(readEvents(cwd)).sessions[0].goal.text, "这一期只把面板做完");
});


// 4 MB 以上没称重的文件以前直接跳过：只声明文档的交付能把它盖过去，段还判"免审"。
test("a file too large to weigh still counts as a change", () => {
  const cwd = workspace("unweighed");
  deed(cwd, "init", "--said", "开始");
  addTask(cwd, "写文档", "读完能上手", "--files", "docs/a.md");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "a.md"), "# a\n");
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "fixture.bin"), Buffer.alloc(4_000_001));
  assert.equal(deliverTask(cwd, "T1", "文档写完了").status, 0, "交付本身不被挡");
  const delivery = readEvents(cwd).find((one) => one.k === "task.done");
  assert.ok(delivery.changed.includes("src/fixture.bin"), "没称重的文件也是改动：" + delivery.changed);
  assert.match(deed(cwd, "state").stdout, /要审/, "碰撞了要审的路径，段不能再叫免审");
});



// The slip the review found: an action that fold refuses must leave nothing behind.
test("a refused action never reaches the ledger, and the workspace keeps working", () => {
  const cwd = workspace("refused");
  deed(cwd, "init", "--said", "开始", "--exempt", "docs/**");
  addTask(cwd, "写文档", "读完能上手", "--files", "docs/a.md");
  deliverTask(cwd, "T1", "一次");
  const before = readEvents(cwd).length;
  const beforeText = readPlan(cwd);
  writePlan(cwd, beforeText.replace(/\s*$/u, "\n") + "\n~~ T9 不存在的条目\n  理由：手滑\n");
  const unknown = deed(cwd, "submit");
  writePlan(cwd, beforeText);
  assert.equal(unknown.status, 1, "点名不存在的条目要被拒");
  assert.match(unknown.stderr, /没有这条|账本里没有|T9/u);
  assert.equal(readEvents(cwd).length, before, "被拒的动作一个字节也没写进去");
  deed(cwd, "review", "--skip", "--why", "只改了文档");
  const sealed = deliverTask(cwd, "T1", "封过之后又改", { keep: true });
  assert.equal(sealed.status, 1, "判过的段不能再往任务上写");
  assert.match(sealed.stderr, /已封存|没有要落的改动|已经交付过/u);
  assert.equal(readEvents(cwd).length, before, "封存之后那一次交付被拒，账本一个字都没多");
  assert.equal(deed(cwd, "state").status, 0, "工作区没被写坏");
  assert.equal(deed(cwd, "check", "--ledger").status, 0);
});

// plan 只剩一件事：还没有清单时写一份。看内容读文件，语法印在文件头部——
// 所以 --print／--format／--force 都不在了，敲它们会被当成拼错的开关拒掉。
test("plan writes the file once, and nothing has to be printed or forced", () => {
  const cwd = workspace("plan-one-job");
  deed(cwd, "init", "--said", "开始");
  const first = deed(cwd, "plan");
  assert.equal(first.status, 0);
  assert.match(first.stdout, /改它，再 deed submit/u);
  const second = deed(cwd, "plan");
  assert.equal(second.status, 1, "已经在的那份不再重写：改它就行");
  assert.match(second.stderr, /直接改它/u);
  for (const flag of ["--print", "--format", "--force"]) {
    const gone = deed(cwd, "plan", flag);
    assert.equal(gone.status, 1, flag + " 已经不在这个动词上");
    assert.match(gone.stderr, /不认/u);
  }
});

// 被拒的动作不进账本（那是原则），但"这个面好不好用"要靠数回答：
// 每一次拒绝在 .deed/tmp 里留一行，账本上一个字都不多。
test("a refusal leaves no ledger line, and one line where the numbers are counted", () => {
  const cwd = workspace("refusal-count");
  deed(cwd, "init", "--said", "开始");
  const before = readEvents(cwd).length;
  const refused = deed(cwd, "submit");
  assert.equal(refused.status, 1);
  assert.equal(readEvents(cwd).length, before, "账本一个字都没多");
  const log = fs.readFileSync(path.join(cwd, ".deed", "tmp", "refusals.log"), "utf8").trim().split("\n");
  assert.equal(log.length, 1);
  const one = JSON.parse(log[0]);
  assert.equal(one.verb, "submit");
  assert.match(one.why, /还没有清单：先 deed plan/u, "记下的是那句拒绝，原话");
  assert.match(one.at, /^\d{4}-\d{2}-\d{2}T/u, "带时间：看得出是哪一轮");
});
