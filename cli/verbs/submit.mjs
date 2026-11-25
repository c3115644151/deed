import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { nextAction, sessionById, takingSegment } from "../../core/rules.mjs";
import { changedPaths, rel, writeSnapshot } from "../../lib/store.mjs";
import { auditDelivered, pinSet, requireUnchanged, weigh } from "../pins.mjs";
import { draft as planDraft, parse as parsePlan } from "../plan.mjs";
import { ROOT, parse, load, transactMany, targetSession, nextId, fail, guard, undoesOf } from "../session.mjs";


// 数由工具采。node --test 两种输出（TAP 的 # tests 与默认的 ℹ tests）都认；
// 命令不报条数时留 null——「没有数」与「数对不上」是两件事。
// 顺序只有一个来源：条目在它那一节里的位置。把行上下挪一下，位置就变了；
// 不另设「先后：」这样的数——两处说顺序，早晚会打架。
// 位置只数"还没了结"的条目：做完的、撤回的都沉在清单下半截，它们挪动不该改
// 别人手上那一份先后——否则每交一条，后面十条都要落一条新的先后记录。
const placeOf = (items, item) =>
  Math.max(
    1,
    items.filter(
      (one) =>
        one.section === item.section &&
        one.at <= item.at &&
        (one.box === " " || one.box === "?"),
    ).length,
  );

const summary = (text) => {
  const num = (name) => {
    const hit = new RegExp("(?:^# " + name + " |\u2139 " + name + " )(\\d+)", "mu").exec(text);
    return hit ? Number(hit[1]) : null;
  };
  return { tests: num("tests"), pass: num("pass"), fail: num("fail") };
};

// 自己是在测试进程里被调起来的（node --test 会给子进程设 NODE_TEST_CONTEXT）：
// 把那个变量带进被测命令，它的总结行会换成另一种格式，条数就采不到。
const cleanEnv = () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
};

const runOnce = (command) => {
  const r = spawnSync(command, { shell: true, cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 24, env: cleanEnv() });
  const text = (r.stdout ?? "") + (r.stderr ?? "");
  return { command, exit: r.status ?? -1, ...summary(text), tail: text.trim().split("\n").slice(-4).join(" / ") };
};

// 交付记录里写着 196/196，而采到的是 195/196：那是抄来的数。
// 只比与总条数同一分母的那些对，逐文件的条数（109/109）不归它管。
const checkNumbers = (item, observed) => {
  if (!observed || observed.tests === null) return;
  const total = observed.pass + "/" + observed.tests;
  const pairs = [...item.claim.matchAll(/(\d+)\s*\/\s*(\d+)/gu)].map((one) => [Number(one[1]), Number(one[2])]);
  // 同一个分母的那一对必须与采到的分子一致：1/2 而报 2/2，说明这数是抄来的。
  for (const [pass, all] of pairs)
    if (all === observed.tests && pass !== observed.pass)
      fail(
        item.id + " 的记录写着 " + pass + "/" + all + "，--run 采到的是 " + total +
          "：数字要在你要交的那份字节上跑出来，抄上一轮的数不行",
      );
  // 分母都不同的，也得有一处写着跑出来的那一对：没有就等于这条记录里根本没有这个数。
  if (!pairs.some(([pass, all]) => pass === observed.pass && all === observed.tests))
    fail(
      item.id + " 的记录里没有一处写着 --run 跑出来的 " + total + "：数要在你要交的那份字节上跑出来；" +
        "这一条要是只跑了另一件事，就别加 --run，或者把两件都写上",
    );
};

// 交付记录里写「这么一跑会看到那个」的，配一行 期望：命令 => 要看到的话，记账前真跑一遍。
// 说得出现象却跑不出来，那条记录就是假的——比事后被人对出来便宜。
const expectLines = (text) =>
  [...text.matchAll(/(?:^|[；;])\s*期望\s*[:：]\s*(.+?)\s*(?:=>|→)\s*(.+?)\s*$/gmu)].map((one) => ({ command: one[1], want: one[2] }));

// 交回真跑过的那几条：账本里要留下「这条说法是怎么核的」，不然它只是话。
const runExpectations = (item) => {
  const list = expectLines(item.claim ?? "");
  const done = [];
  if (list.length > 5) fail(item.id + " 写了 " + list.length + " 条期望：一次交付最多核 5 条，多的写进下一次的交付记录");
  for (const one of list) {
    const r = spawnSync(one.command, { shell: true, cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 24, env: cleanEnv() });
    const text = (r.stdout ?? "") + (r.stderr ?? "");
    if (text.includes(one.want)) {
      done.push({ command: one.command, want: one.want });
      continue;
    }
    fail(
      item.id + " 的期望没跑出来：命令「" + one.command + "」要看到「" + one.want + "」，实际是「" +
        text.trim().split("\n").slice(0, 2).join(" / ").slice(0, 200) + "」",
    );
  }
  return done;
};

export default function submit(argv) {
    const { flags } = parse(argv, "submit");
    guard(() => {
      const file = path.join(ROOT, ".deed", "plan.md");
      if (!fs.existsSync(file)) fail("还没有清单：先 deed plan 出一份草稿，改完再 deed submit");
      const plan = parsePlan(fs.readFileSync(file, "utf8"));
      if (plan.problems.length > 0)
        fail("清单有 " + plan.problems.length + " 处看不懂，一个字都没落：" + "\n" + "  " + plan.problems.join("\n" + "  "));
      // 先跑，再量：--run 与期望都会动工作区（测试会写临时文件），
      // 记下的字节要以跑完之后磁盘上的为准。
      const observed = flags.run === undefined ? null : runOnce(String(flags.run));
      if (observed) {
        if (observed.exit !== 0)
          fail("--run 的命令没有跑通（退出 " + observed.exit + "）：这份东西不成立，先别记账" +
            (observed.tail ? "；最后几行：" + observed.tail : ""));
        if (observed.fail !== null && observed.fail !== 0)
          fail("--run 的命令报了 " + observed.fail + " 条失败（" + observed.pass + "/" + observed.tests + " 通过）：红了不能记成交付");
      }
      // --run 只给这一次真交的那几条核数：清单里早就交过的条目还带着当时的数，
      // 拿今天跑的条数去核它们，等于每交一条就把整份清单判错一次。
      const { doc: peek } = load();
      const still = new Set(
        peek.sessions.flatMap((one) => one.tasks)
          .filter((task) => task.status !== "done" && task.status !== "accepted")
          .map((task) => task.id),
      );
      const expectsOf = new Map();
      const claiming = plan.items.filter((item) => item.box === "x" && item.id && item.claim && still.has(item.id));
      for (const item of claiming) {
        checkNumbers(item, observed);
        expectsOf.set(item.id, runExpectations(item));
      }

      // 称重与快照在锁外做：跑一遍工作区是慢的那一半，锁里只做判与落。
      const scanned = changedPaths(ROOT);
      const by = flags.by ?? "agent";
      const sizes = weigh(ROOT, scanned.changed);
      const pins = pinSet(ROOT, scanned.changed, scanned.now);
      const { doc, evs } = transactMany(
        flags,
        (doc0) => {
          const one = targetSession(doc0, flags);
          if (one.closeKind)
            fail("这一期已经" + (one.closeKind === "signed" ? "签收" : "搁下") + "：账本不往回改；要接着做就记一轮，会话自己开新一期");
          const specs = [];
          const said = plan.goal.startsWith("（还没写") ? "" : plan.goal;
          if (said && said !== (one.goal?.text ?? "")) specs.push({ k: "goal.set", s: one.id, text: said, by });
          if (plan.items.length === 0 && one.tasks.length === 0) fail("清单里一条都没有：先写一条再 submit");
          const known = new Map(one.tasks.map((t) => [t.id, t]));
          // 清单的每一节是一个段：写了段号的落那一段，空着节的当场领一个新号（预备段）。
          // 收活只有一段：这一段之外的段只能记条目，交付要等它轮到。
          const bySection = new Map();
          const take = one.segments.find((seg) => seg.closedAt === null && seg.plannedAt === null) ?? null;
          // 同一批里新开的段也要占号：doc0 还没被这一批改过，只看它会开出两个同号的段。
          let topNumber = one.segments.reduce((top, seg) => Math.max(top, Number(seg.id.split(".").pop()) || 0), 0);
          const sectionTarget = (item) => {
            if (bySection.has(item.section)) return bySection.get(item.section);
            const title = String(item.sectionTitle ?? "").trim();
            let id;
            if (title) {
              if (!one.segments.some((seg) => seg.id === title))
                fail("清单里写的 ## 段 " + title + " 账本里没有：新的一段写成空标题的 ## 段，submit 时领号");
              const home = one.segments.find((seg) => seg.id === title);
              if (home.closedAt !== null) fail("段 " + title + " 已经关闭：新条目进不去，另开一段写");
              id = title;
            } else if (take && ![...bySection.values()].includes(take.id)) {
              // 空标题的第一节就是现在收活的那一段：草稿里它本来写着段号，
              // 手写一份没写号时按"手上那一段"理解，不然一条活都落不下去。
              // 前面已经认领过它的话，再一个空节就是新的一段。
              id = take.id;
            } else {
              topNumber += 1;
              id = one.id + "." + topNumber;
              specs.push({ k: "segment.plan", s: one.id, segment: id });
            }
            bySection.set(item.section, id);
            return id;
          };
          const mentioned = new Set();
          // 先把各节对应的段定下来（该领号的先领）：条目按文件顺序落，而 改到下一段 依赖
          // "下一段已经排好"，所以段的声明必须走在条目前面。每一节都排在队里——哪怕它只印着
          // 历史条目（那一节对上的是已经关闭的段，从此不再认领"现在收活的那一段"）。
          for (const sec of plan.sections) {
            const takes = plan.items.some((item) => item.section === sec.index && item.box === "?");
            const title = String(sec.title ?? "").trim();
            if (title && !takes) {
              if (!bySection.has(sec.index) && one.segments.some((seg) => seg.id === title)) bySection.set(sec.index, title);
              continue;
            }
            if (!title && !takes) continue;
            sectionTarget({ section: sec.index, sectionTitle: sec.title });
          }
          let seq = Number(nextId(doc0, "T").slice(1));
          for (const item of plan.items) {
            if (item.box === "?") {
              if (!item.criteria) fail("第 " + item.at + " 行是新条目，但没有写一行 标准：——没有标准就不算一件事");
              const id = "T" + seq;
              seq += 1;
              specs.push({
                k: "task.add", s: one.id, id, title: item.title, criteria: item.criteria, files: [],
                segment: sectionTarget(item),
                order: placeOf(plan.items, item),
              });
              mentioned.add(id);
              continue;
            }
            if (item.box === "x" && !item.id)
              fail(
                "第 " + item.at + " 行勾上了却没有编号：一次 submit 不能既新增又交付——先把条目写成任务，做完再勾上交",
              );
            const task = known.get(item.id);
            if (!task) fail("第 " + item.at + " 行的 " + item.id + " 账本里没有：新条目写成 - ? 标题，submit 时领号");
            mentioned.add(item.id);
            if (item.title && item.title !== task.title)
              fail(item.id + " 的标题和账本不一样：清单只做四件事（勾上、撤勾、~~、?），改标题不算其中");
            // 位置是能改的（标题与标准不行）：把行挪个地方再 submit，就落一条 task.order。
            // 位置在段内算，不跨段——同段里谁先做是一件事，跨段是另一件事。
            // 已封存的段里的条目不再改：那一段的事实已经定下来了，事后重排只是噪音。
            const home = one.segments.find((seg) => seg.id === task.segment);
            const wanted = home && home.closedAt === null ? placeOf(plan.items, item) : null;
            if (wanted !== null && wanted !== (task.order ?? null)) specs.push({ k: "task.order", s: one.id, id: item.id, order: wanted });
            if (item.criteria && item.criteria !== task.criteria)
              fail(item.id + " 的标准和账本不一样：清单不改已经写下的标准；做法变了就新开一条，把旧的那条说清为什么不做");
            if (item.box === "~") {
              if (task.status === "dropped") continue;
              if (!item.why) fail(item.id + " 要放弃，但没有写一行 理由：——放弃是账本里的一件事实，得说清为什么");
              specs.push({ k: "task.drop", s: one.id, id: item.id, why: item.why });
              continue;
            }
            // 这一段送审之后不再收活：没做的条目写一行 改到下一段： 就落到下一段。
            // 这里不能看清单画的那个勾：清单给自己交过的条目画的就是 [x]，按勾判会让
            // 这一行被当成"没变化"静默吞掉——用户写了 改到下一段：，得到的却是一句"没有要落的改动"。
            // 改到下一段只对还没动手的条目成立。
            if (item.carry) {
              if (task.status !== "todo")
                fail(
                  item.id +
                    " 已经交过（" +
                    task.status +
                    "）：交付过的条目不能改到下一段——要重做就在这一段重交，要换说法就新开一条",
                );
              specs.push({ k: "task.carry", s: one.id, id: item.id });
              continue;
            }
            // 放弃过的条目能撤回：撤回是一条新事实（task.undo），撤回来它回到未做，
            // 同一批再勾上就是重新交付。没有 理由： 的撤回转不成一条能读的事实。
            if (task.status === "dropped") {
              if (!item.why)
                fail(item.id + " 已经放弃过：要撤回来接着做，就在这一行下面写一条 理由：——撤回一条放弃得说清为什么");
              specs.push({ k: "task.undo", s: one.id, id: item.id, why: item.why, by });
            }
            if (item.box === "x") {
              // 判过（accepted）的条目在清单里也是勾着的：它已经交过、也有人判过，
              // 再交一次既没有意义，也会撞上「已关闭的段不能再改」。
              if (task.status === "done" || task.status === "accepted") continue;
              const take = takingSegment(one);
              const home = one.segments.find((seg) => seg.id === task.segment);
              if (!take || (home && home.plannedAt !== null && take.id !== task.segment))
                fail(
                  item.id + " 在段 " + task.segment + " 里，轮到它的那一段还没开" +
                    (take ? "（现在收活的是 " + take.id + "：它判过、关闭之后这一段才接过活）" : "") +
                    "：清单上这一节是排好的下一段，它只记条目，交付等轮到再做",
                );
              if (!item.claim) fail(item.id + " 勾上了，但没有写一行 交付：——勾上就是交付，得写清跑了什么、结果几比几");
              // 一条交付总要指着点什么：既没量到改动、也没有文件可指时，写下去就是一条谁也核不了的空话。
              // 只删不改也算动了——那时 pins 是空的，但 changed 里有那条走了的路径，得放行。
              if (pins.length === 0 && scanned.changed.length === 0)
                fail(
                  item.id +
                    " 勾上了，但这一批没有量到任何改动、也没有文件可指：先真的动过再勾，或者用 deed task done " +
                    item.id +
                    " --evidence \"…\" --digest <工作区里的文件> 手工指那份内容",
                );
              specs.push({
                k: "task.done",
                s: one.id,
                id: item.id,
                evidence: item.claim,
                by,
                ...(observed ? { run: { command: observed.command, exit: observed.exit, tests: observed.tests, pass: observed.pass, fail: observed.fail } } : {}),
                ...((expectsOf.get(item.id) ?? []).length > 0 ? { expects: expectsOf.get(item.id) } : {}),
                digest: pins[0]?.digest ?? null,
                digestPath: pins[0]?.path ?? null,
                files: pins,
                changed: scanned.changed,
                bytes: sizes,
              });
              continue;
            }
            if (task.status === "done") {
              if (!item.why) fail(item.id + " 的勾去掉了，但没有写一行 理由：——撤回一条交付得说清为什么");
              const undoes = undoesOf(task);
              specs.push({
                k: "task.undo", s: one.id, id: item.id, why: item.why, by,
                ...(undoes === null ? {} : { undoes }),
              });
              continue;
            }
            if (item.later) {
              if (task.status === "deferred") continue;
              specs.push({ k: "task.defer", s: one.id, id: item.id, why: item.later });
            }
          }
          // 一次只做一件事：一次 submit 只收一条交付。同一批里落下好几条，改动的归属
          // 就分不出来（工作区只量了一次差），账本上只能写「这几条共用一份差」——
          // 那是替读账本的人猜。做完一条就勾一条，是这里的规矩，也是它的用法。
          const dones = specs.filter((spec) => spec.k === "task.done");
          if (dones.length > 1)
            fail(
              "这一批勾了 " + dones.length + " 条交付（" + dones.map((one) => one.id).join("、") + "）：一次只交一条——" +
                "先交此刻在做的那一条（deed state 说是 " + dones[0].id + "），写完 交付： 提交一次，再做下一条。" +
                "账本一个字都没动",
            );
          // 量差到记账之间，工作区可能被别的东西写过：记账之前再核一遍每条交付要记的路径。
          // 这一处能真拒——抛在 build 里，一条事件都不落。
          requireUnchanged(ROOT, pins);
          const gone = one.tasks.filter((t) => !mentioned.has(t.id) && t.status !== "dropped");
          if (gone.length > 0)
            fail("清单里少了 " + gone.map((t) => t.id).join("、") + "：账本里有的条目不能自己消失——不做了就写 ~~ " + gone[0].id + " " + gone[0].title + "，再加一行 理由：");
          return specs;
        },
        (stamped) => {
          // 只有真交付过才刷新基线：一次只加条目或只领号的 submit 如果也刷新，
          // 工作区里那些改动就被它吃掉了——下一条交付看起来什么都没动。
          if (stamped.some((ev) => ev.k === "task.done")) writeSnapshot(ROOT, scanned.now);
          // 记账与落到磁盘之间还剩一条缝：重算一遍每条交付记下的路径。
          // 变了、或者压根没指着东西，都不能当没发生——那条交付已经在账本里，只能撤回。
          const audited = stamped.filter((ev) => ev.k === "task.done").length;
          for (const one of auditDelivered(ROOT, stamped)) {
            if (one.empty) {
              console.log("空交付 · " + one.id + " · 谁也没指着：账本上这一条核不了");
              console.log("  这条交付已经写进账本：deed task undo " + one.id + " --why \"这是一条空交付\"，重跑一遍再交");
            } else {
              console.log(
                "字节变了 · " + one.id + " · " + one.path + " · 记下 " + one.digest.slice(0, 12) +
                  "，记账这一刻是 " + (one.now === null ? "文件不在了" : one.now.slice(0, 12)),
              );
              console.log("  这条交付已经写进账本：deed task undo " + one.id + " --why \"记账时字节变了\"，重跑一遍再交");
            }
            process.exitCode = 1;
          }
          // 核过就说一句：没有这一行，谁也不知道这一步真的跑过（删掉它，用例会红）。
          if (audited > 0 && process.exitCode !== 1)
            console.log("记账之后核对 · " + audited + " 条都对得上当时那份内容");
        },
      );
      // 落过账就把清单按账本重写一遍：新条目领到的号要写回去，不然下一次 submit
      // 会把同一个 ? 再加一条。文件里说过的话都已经在账本上，重写不丢东西。
      const after = sessionById(doc, evs[0].s ?? targetSession(doc, flags).id);
      fs.writeFileSync(file, planDraft(after) + "\n", "utf8");
      for (const ev of evs) {
        if (ev.k === "goal.set") console.log("目的 · " + ev.s + " · " + ev.text);
        // 新条目落到哪一段由账本说得算，不是清单里写着哪一节算哪一段：说出来，别让人
        // 到下一次 deed plan 才发现它换了一节。
        if (ev.k === "task.add")
          console.log(
            "写进清单 · " + ev.id + " · " + (after.tasks.find((t) => t.id === ev.id)?.segment ?? "") + " · " + ev.title,
          );
        if (ev.k === "task.done") console.log("交付 · " + ev.id + " · " + ev.evidence);
        if (ev.k === "task.undo") {
          const walked = after.tasks.find((t) => t.id === ev.id)?.revived?.some((one) => one.at === ev.at);
          console.log((walked ? "撤回放弃 · " : "撤回 · ") + ev.id + " · " + ev.why);
        }
        if (ev.k === "task.defer") console.log("延后 · " + ev.id + " · " + ev.why);
        if (ev.k === "task.drop") console.log("放弃 · " + ev.id + " · " + ev.why);
        if (ev.k === "task.carry")
          console.log("改到下一段 · " + ev.id + " · " + (after.tasks.find((t) => t.id === ev.id)?.segment ?? ""));
      }
      console.log("记账 " + evs.length + " 条 · 清单 " + rel(ROOT, file));
      const step = nextAction(doc, doc.config);
      console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
      console.log("  " + step.command);
    });
};
