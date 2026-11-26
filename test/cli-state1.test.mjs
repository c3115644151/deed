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
import { panelRecord, buildNow, watchedFiles } from "../lib/panel.mjs";
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








// 面板跟着命令走：你不必记得先跑 serve，也不必在 dsh 重启之后手动把它拉回来。
test("a panel comes up with the first command, and the next one leaves it alone", () => {
  const cwd = workspace("panel");
  const env = { ...process.env };
  delete env.DEED_NO_PANEL;
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env });
  try {
    run("init", "--said", "起点");
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


// 地址要能收藏：面板守在工作区审查设置里写的那个端口；那个号被别人占着时，
// 它挨着往后找一格（+1、+2…），并且"哪个被占、改开在哪"这句话必须由拉它起来的那一头说出来——
// 子进程不接管道，它自己那句只会掉进虚空。
// 起点号每跑一次现挑一格：写死 7433 会让并发的另一次跑抢走同一格，红了也说明不了代码有问题。
test("a panel says when the declared port was taken, and goes back to it when the port is free", async () => {
  const cwd = workspace("panel-port");
  const env = { ...process.env };
  delete env.DEED_NO_PANEL;
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env });
  // 子进程在 listen 之后才写记号，探活成功与记号落盘之间有几毫秒：读到就等它写完，
  // 不让这条用例因为「差几毫秒」红（跑全量时机器更慢，这个窗口会放大）。
  const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const record = () => {
    for (let step = 0; step < 40; step += 1) {
      try {
        return JSON.parse(fs.readFileSync(panelRecord(cwd), "utf8"));
      } catch {
        nap(100);
      }
    }
    throw new Error("面板的记号一直没写出来：" + panelRecord(cwd));
  };
  const url = (out) => Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);
  const canBind = (port) =>
    new Promise((ok) => {
      const probe = net.createServer(() => {});
      probe.once("error", () => ok(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => ok(true)));
    });
  const pick = async () => {
    for (let step = 0; step < 40; step += 1) {
      const want = 5200 + Math.floor(Math.random() * 600);
      if (await canBind(want)) return want;
    }
    return 0;
  };
  const held = net.createServer(() => {});
  const base = await pick();
  assert.notEqual(base, 0, "找不到一格空号，这一条跑不了");
  const listen = () => new Promise((ok) => held.listen(base, "127.0.0.1", ok));
  const free = () => new Promise((ok) => held.close(() => ok()));
  try {
    assert.equal(run("init", "--said", "起点", "--port", String(base)).status, 0);
    await listen();
    const taken = run("say", "看看面板");
    assert.equal(taken.status, 0, taken.stderr);
    const fell = url(taken.stdout);
    assert.ok(fell > base && fell <= base + 9, "被占着就挨着往后找，落点离声明号不超过九格：" + fell + " 对 " + base);
    for (let step = 1; step < fell - base; step += 1)
      assert.equal(await canBind(base + step), true, base + step + " 当时是空的，却跳了过去");
    assert.match(taken.stdout, new RegExp("端口 " + base + " 被占着；面板改开在 " + fell), "退到哪儿要说出来，不是无声换掉一条地址");
    assert.equal(record().port, fell, "记号里记的就是它实际在听的那个号");
    assert.match(String(record().build), /^[0-9a-f]{16}$/, "记号里带着面板代码的指纹");
    // 停了再起：声明号还被占着，退回的地址也得是同一格，否则每次重启都要人重收一次书签。
    run("panel", "--stop");
    const restarted = run("state");
    assert.equal(restarted.status, 0, restarted.stderr);
    assert.equal(url(restarted.stdout), fell, "重新起来还是那一格");
    // 号让出来了：下一条命令要把它挪回审查设置里写的那个地址——地址是用来收藏的。
    // 这里不先停下旧面板：活着的那个停在退回的号上，得由"号空出来了"这件事把它挪回去，
    // 否则它一辈子守着那个意外落点，声明过的地址就再也没人用过。
    await free();
    const again = run("state");
    assert.equal(again.status, 0, again.stderr);
    assert.equal(url(again.stdout), base, "号空出来之后回到声明的那个地址");
    assert.equal(record().port, base, "记号里也跟着挪回去了");
    assert.notEqual(record().pid, fell, "挪回去的是另一个进程，不是一个改过口的进程");
    // 面板代码换过（记号里的指纹对不上）：下一条命令自己把旧的换掉，
    // 不必有人记得"改完要重启"——换过之后地址不变。
    const heard = record();
    fs.writeFileSync(panelRecord(cwd), JSON.stringify({ pid: heard.pid, port: heard.port, build: "0000000000000000" }));
    const swapped = run("state");
    assert.equal(swapped.status, 0, swapped.stderr);
    const now = record();
    assert.notEqual(now.pid, heard.pid, "旧进程被换掉了");
    assert.equal(now.port, base, "换掉的进程守的还是同一个号");
  } finally {
    run("panel", "--stop");
    if (held.listening) await free();
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
  deed(cwd, "review", "--skip", "--why", "只改了文档", "--by", "agent");
  const sealed = deliverTask(cwd, "T1", "封过之后又改", { keep: true });
  assert.equal(sealed.status, 1, "判过的段不能再往任务上写");
  assert.match(sealed.stderr, /已封存|没有要落的改动/u);
  assert.equal(readEvents(cwd).length, before, "封存之后那一次交付被拒，账本一个字都没多");
  assert.equal(deed(cwd, "state").status, 0, "工作区没被写坏");
  assert.equal(deed(cwd, "check", "--ledger").status, 0);
});
