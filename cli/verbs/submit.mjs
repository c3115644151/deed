import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { SEGMENT_MAX, nextAction, segmentRoom, sessionById, takingSegment } from "../../core/rules.mjs";
import { changedPaths, rel, snapshotPath, workspaceFingerprint, writeSnapshot } from "../../lib/store.mjs";
import { prints, weigh } from "../pins.mjs";
import { draft as planDraft, parse as parsePlan } from "../plan.mjs";
import { EVENT_VERSION } from "../../core/events.mjs";
import { onTheSheet } from "../../core/fold.mjs";
import { findStaleTasks } from "../../core/stale.mjs";
import { checkLanded } from "../../lib/landed.mjs";
import { ROOT, parse, load, transactMany, targetSession, nextId, fail, guard, undoesOf, commandSurface } from "../session.mjs";


// 数由工具采。node --test 两种输出（TAP 的 # tests 与默认的 ℹ tests）都认；
// 命令不报条数时留 null——「没有数」与「数对不上」是两件事。
// 顺序只有一个来源：条目在它那一节里的位置。把行上下挪一下，位置就变了；
// 不另设「先后：」这样的数——两处说顺序，早晚会打架。
// 先后只比"还没了结的条目"之间的相对次序。做完的、撤回的都沉在清单下半截：
// 它们一沉下去，后面每一条的"第几位"都会往前挪一格——按数字比，每交一条就要给
// 后面十条各落一条新的先后记录（这个账本里 542 条 task.order 对 138 条任务，
// 四倍于条目数，就是这么来的）。所以这里比的是次序本身：
//   清单里还没了结的那些号排成一列 → 拿账本里那一列现成的数字按顺序发下去。
// 次序没变，发下去的还是同一批数字，一条都不用落；真把两行上下调换，只有这两条
// 换到的数字不同——各落一条，其余一条不动。
const placeOf = (items, item) =>
  Math.max(
    1,
    items.filter(
      (one) => one.section === item.section && one.at <= item.at && (one.box === " " || one.box === "?"),
    ).length,
  );
// 新条目要一个数字：它在还没了结的条目里的位置；那个数字这一段已经有主时往后挪一格。
// 两处用同一个数字只会让读的人以为"这两条一样先"，真的先手由写下的次序定，不靠并列。
const freeSlot = (want, used) => {
  let n = want;
  while (used.has(n)) n += 1;
  used.add(n);
  return n;
};
const unfinishedIn = (items, section) =>
  items.filter((one) => one.section === section && (one.box === " " || one.box === "?"));
const orderPlan = (items, tasks, secIndex, segment) => {
  // 清单这一节里还没了结的条目，按文件顺序：已知的号在前，新条目先占个空位。
  const wanted = unfinishedIn(items, secIndex).map((item) => (item.box === "?" ? null : item.id));
  // "还没了结"就是还没动手的那一条：交过的、判过的、放弃的都沉在清单下半截，
  // 它们挪动不该改别人手上那一份先后。
  const live = tasks.filter((one) => (segment === undefined || one.segment === segment.id) && one.status === "todo");
  const pool = live.filter((one) => Number.isInteger(one.order)).map((one) => one.order).sort((a, b) => a - b);
  const known = wanted.filter((id) => id !== null && live.some((one) => one.id === id));
  // 账本里现在的次序：按 order 排，没有 order 的按号补在后面。
  const current = [...live].filter((one) => known.includes(one.id))
    .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.id.localeCompare(b.id))
    .map((one) => one.id);
  const same = current.length === known.length && current.every((id, at) => id === known[at]);
  const assigned = new Map();
  if (same) {
    // 次序没变：每条沿用账本里那个数字，新条目排在它前面那条之后。
    for (const one of live) if (Number.isInteger(one.order)) assigned.set(one.id, one.order);
    return { assigned, changed: new Map(), renumber: null };
  }
  // 次序变了：把现成的数字按新次序整批发下去（空出来的数字原样留着，只在真变了的那几条上记账）。
  const changed = new Map();
  known.forEach((id, at) => {
    const want = pool[at] ?? at + 1;
    const has = live.find((one) => one.id === id)?.order ?? null;
    if (want !== has) changed.set(id, want);
    assigned.set(id, want);
  });
  return { assigned, changed, renumber: null };
};

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
  // 跑之前取指纹：命令自己可能写工作区（测试会造临时文件），跑完之后那份字节
  // 已经不是"我要交的那份"了——记的是它跑之前站的那一版。
  const fingerprint = workspaceFingerprint(ROOT);
  const at = new Date().toISOString();
  const r = spawnSync(command, { shell: true, cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 24, env: cleanEnv() });
  const text = (r.stdout ?? "") + (r.stderr ?? "");
  return { command, exit: r.status ?? -1, ...summary(text), fingerprint, at, tail: text.trim().split("\n").slice(-4).join(" / ") };
};

// 同一份字节上跑过的同一条命令，不必再跑：那次的结果连同它站的那一版指纹都在账本里。
// 认它的只有一条——指纹一样。变了就照旧真跑，绝不拿旧数冒充新的。
const runCachePath = () => path.join(ROOT, ".deed", "tmp", "runs.json");
const readRunCache = () => {
  try {
    return JSON.parse(fs.readFileSync(runCachePath(), "utf8"));
  } catch {
    return {};
  }
};
const writeRunCache = (fingerprint, entry) => {
  try {
    fs.mkdirSync(path.dirname(runCachePath()), { recursive: true });
    const all = readRunCache();
    all[fingerprint] = entry;
    fs.writeFileSync(runCachePath(), JSON.stringify(all, null, 1) + "\n", "utf8");
  } catch {
    // 缓存写不进去不影响记账：它省的只是时间，不是事实。
  }
};
const cachedRun = (command, fingerprint) => {
  const one = readRunCache()[fingerprint];
  if (!one || one.command !== command) return null;
  return one;
};
const reusedRun = (events, command, fingerprint) => {
  for (let at = events.length - 1; at >= 0; at -= 1) {
    const one = events[at];
    if (one.k !== "task.done" || !one.run) continue;
    if (one.run.command !== command || !one.run.fingerprint) continue;
    if (one.run.fingerprint !== fingerprint) continue;
    return one.run;
  }
  return null;
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
      const command = flags.run === undefined ? null : String(flags.run);
      // 先问账本：同一条命令、同一份字节，上一次跑出来的结果还算数。
      const { events: past } = load();
      const stamp = command === null ? null : workspaceFingerprint(ROOT);
      // 名字别跟下面的任务表撞：这里说的是"上一次那次跑"，不是"账本里已有的条目"。
      const earlierRun = command === null ? null : reusedRun(past, command, stamp) ?? cachedRun(command, stamp);
      const observed = command === null ? null : earlierRun ? earlierRun : runOnce(command);
      // 真跑过的结果先落进缓存：这一次就算被拒，下一次同一份字节不必再跑一遍。
      if (command !== null && !earlierRun) writeRunCache(observed.fingerprint, observed);
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
      const by = "agent";
      const sizes = weigh(ROOT, scanned.changed);
      // 同一路径可能被换成同尺寸的另一份，字节数看不出来：当场把内容也算一遍。
      const shas = prints(ROOT, scanned.changed);
      // 记账之后核对发现的对不上的交付：对上了才安静，对不上要以非零退出码结束——
      // 只印一行的话，读的人照样往下走，那条记录就永远是"看着成立"。
      const brokenAfter = [];
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
              // 在审（或等判决）的段**照收新条目**：冻结管的是"手上那一份清单里列的条目"
              // 不能交付、不能撤回；新加的一条不在那一份里，它进的是下一份清单。
              // 以前把新条目也挡在外面，结果是每有一笔临时活就得多开一段。
              id = title;
            } else if (take && ![...bySection.values()].includes(take.id)) {
              // 空标题的第一节就是现在收活的那一段：草稿里它本来写着段号，
              // 手写一份没写号时按"手上那一段"理解，不然一条活都落不下去。
              // 前面已经认领过它的话，再一个空节就是新的一段。
              // 同样：手上这一段在审也照收新条目（它们进下一份清单）。
              id = take.id;
            } else {
              topNumber += 1;
              id = one.id + "." + topNumber;
              specs.push({ k: "segment.plan", s: one.id, segment: id });
            }
            // 一段装不下太多：段是被一起审的那一批，大到一次读不完，清单就没人真读。
            // 到了上限，新的一条另起一节（空标题的 ## 段），submit 时自己开下一段。
            const already = one.tasks.filter((task) => task.segment === id && task.status !== "dropped").length;
            const home = one.segments.find((seg) => seg.id === id);
            if (home && segmentRoom(one, home) && already >= SEGMENT_MAX)
              fail(
                id + " 已经有 " + already + " 条（一段最多 " + SEGMENT_MAX + " 条）：这一条写在这一节之后另起一个空标题的 ## 段，submit 时直接开下一段；" +
                  "段是审查的单位，大到一次读不完，清单就没人真读了",
              );
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
          // 先后按段算：同一段里谁在谁前面是段内的事，跨段不互相影响（已关闭的段不再改）。
          // 数字由账本自己发：清单改动了次序，先算清楚这一节该发哪一批数字，再逐条比对。
          const usedOrders = new Set(
            one.tasks.filter((task) => task.status === "todo" && Number.isInteger(task.order))
              .map((task) => task.order),
          );
          const planOf = new Map();
          for (const id of new Set(bySection.values())) {
            const seg = one.segments.find((seg) => seg.id === id);
            // 清单这一节的序号也在里面：段与节不是一回事（段是账本上的，节是文件里的）。
            const sec = plan.sections.find((one) => bySection.get(one.index) === id) ?? null;
            planOf.set(id, orderPlan(plan.items, one.tasks, sec ? sec.index : -1, seg));
          }
          let seq = Number(nextId(doc0, "T").slice(1));
          for (const item of plan.items) {
            if (item.box === "?") {
              if (!item.criteria) fail("第 " + item.at + " 行是新条目，但没有写一行 标准：——没有标准就不算一件事");
              // 来自议题的条目：只认已经锁定出口的议题。没立过、没出口的写不进去——
              // 否则"从哪来"就成了一句随手指的一句话，议题那边也永远不知道自己出口了什么。
              if (item.topic !== undefined) {
                const home = (one.topics ?? []).find((one) => one.id === item.topic);
                if (!home) fail("第 " + item.at + " 行写的是来自：" + item.topic + "，账本里没有这个议题——先 deed topic 立它");
                if (home.state !== "released")
                  fail("第 " + item.at + " 行写的是来自：" + item.topic + "，这个议题还" +
                    (home.state === "draft" ? "没成立" : "没锁定出口") +
                    "：等你在面板上按过出口那一下，它才能拆成任务");
              }
              const id = "T" + seq;
              seq += 1;
              specs.push({
                k: "task.add", s: one.id, id, title: item.title, criteria: item.criteria, files: [],
                source: item.source ?? null,
                ...(item.topic === undefined ? {} : { topic: item.topic }),
                segment: sectionTarget(item),
                order: freeSlot(placeOf(plan.items, item), usedOrders),
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
            // 标题是能改的：把黑话换成人话，落一条 task.title，旧说法留在账本历史里。
            // 标准不能改：做法变了就新开一条，旧的说清为什么不做了。
            if (item.title && item.title !== task.title) specs.push({ k: "task.title", s: one.id, id: item.id, title: item.title });
            // 位置是能改的：把行挪个地方再 submit，就落一条 task.order。
            // 位置在段内算，不跨段——同段里谁先做是一件事，跨段是另一件事。
            // 已封存的段里的条目不再改：那一段的事实已经定下来了，事后重排只是噪音。
            const home = one.segments.find((seg) => seg.id === task.segment);
            const wanted = home && home.closedAt === null ? (planOf.get(task.segment)?.assigned.get(item.id) ?? null) : null;
            if (wanted !== null && wanted !== (task.order ?? null)) specs.push({ k: "task.order", s: one.id, id: item.id, order: wanted });
            if (item.criteria && item.criteria !== task.criteria) {
              // 标准能改的只有一种情形：它已经与今天的命令面对不上（写的是删掉的动词或开关）。
              // 那时照它敲只会撞上「不认这个开关」，还不知道该怀疑标准本身——改成今天说得通的
              // 那句话，并写清为什么。其余时候标准仍不改：做法变了就新开一条，把旧的说不做。
              const gone = findStaleTasks([task], one.segments, commandSurface()).filter((one) => one.id === task.id);
              if (gone.length === 0)
                fail(
                  item.id +
                    " 的标准和账本不一样，但它引用的命令与开关今天都还在：清单不改已经写下的标准；做法变了就新开一条，把旧的那条说清为什么不做",
                );
              if (!item.why)
                fail(
                  item.id + " 要改正标准（" + gone.map((one) => one.ref).join("、") + " 已经不在命令面上），但没有写一行 理由：——改一句话也得说清为什么",
                );
              specs.push({ k: "task.criteria", s: one.id, id: item.id, criteria: item.criteria, why: item.why });
            }
            // 依据是能补的：写清出处，落一条 task.context，不动标题/标准/状态。
            // 这正是"事后给老任务补上下文"的正路——不必伪造工作区改动，也不改写历史。
            const context = {};
            if (item.source !== undefined && item.source !== (task.source ?? null)) context.source = item.source;
            if (Object.keys(context).length > 0) specs.push({ k: "task.context", s: one.id, id: item.id, ...context });
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
            // 已经改到下一段的条目要拿回来：把它写回"收活的那一节"、去掉 改到下一段：，
            // 再写一行 理由：。改到下一段是决定，不是判决——它得有回头路。
            {
              const take = takingSegment(one);
              const home = one.segments.find((seg) => seg.id === task.segment);
              const landed = bySection.get(item.section) ?? null;
              // 只认"还没被谁审过"的段：拿回一条会让那一段的清单/结论对不上它当时的样子。
              const untouched =
                home &&
                !(one.briefs ?? []).some((brief) => (brief.segment ?? null) === home.id) &&
                !one.reviews.some((review) => review.segment === home.id);
              if (take && task.segment !== take.id && home && home.closedAt === null && untouched && landed === take.id) {
                if (!item.why)
                  fail(item.id + " 要从 " + task.segment + " 拿回 " + take.id + "：写一行 理由：——撤回一条改到下一段得说清为什么");
                specs.push({ k: "task.uncarry", s: one.id, id: item.id, to: take.id, why: item.why });
                continue;
              }
            }
            // 放弃过的条目能撤回：撤回是一条新事实（task.undo），撤回来它回到未做，
            // 同一批再勾上就是重新交付。没有 理由： 的撤回转不成一条能读的事实。
            if (task.status === "dropped") {
              if (!item.why)
                fail(item.id + " 已经放弃过：要撤回来接着做，把它写回 - [ ] 并在下面写一条 理由：——撤回一条放弃得说清为什么");
              specs.push({ k: "task.undo", s: one.id, id: item.id, why: item.why, by });
            }
            if (item.box === "x") {
              // 判过（accepted）的条目在清单里也是勾着的：它已经交过、也有人判过，
              // 再交一次既没有意义，也会撞上「已关闭的段不能再改」。
              // 但已经交付过的条目再勾一次不是在说"交过了"，而是在试"再交一版"——
              // 那种尝试要看这一段冻没冻：冻着就当场拒（在审 / 等你判决），没冻就说清先撤回。
              if (task.status === "done" || task.status === "accepted") {
                // 清单是重印的：勾着、交付那句话和账本里最后一条一模一样——那不是"再交一版"，
                // 是清单在重画事实，照旧跳过。
                const recorded = task.evidence.at(-1)?.claim ?? null;
                if (item.claim === recorded) continue;
                const session = one;
                const home = session.segments.find((seg) => seg.id === task.segment);
                // 冻结管的是"手上那份清单里列的条目"（core/fold.mjs 的 onTheSheet）：
                // 审查者正在读的那些字节不能在他眼下换掉，别的条目照收。
                if (home && onTheSheet(session, task.segment, task.id))
                  fail(
                    home.verdict === "pass"
                      ? task.segment + " 审查通过了、等你判决：这一段先冻着，判过之后才收新的交付（判决在面板上按）"
                      : task.segment + " 的清单已经发出去、还没人回答：这一段在审，不能交付（要改先把清单撤回：deed review --segment " + task.segment + ' --withdraw --why "…"）',
                  );
                fail(
                  item.id + " 已经交付过" + (task.status === "accepted" ? "、也判过" : "") +
                    "：要在这一条上再交一版，先把它取消勾选并写一行 理由：——撤回一条交付得说清为什么",
                );
              }
              const take = takingSegment(one);
              const home = one.segments.find((seg) => seg.id === task.segment);
              // 新条目只要不在手上那份清单里，冻结就管不着它——它进的是下一份清单。
              if (task.status === "todo" && home && onTheSheet(one, task.segment, task.id))
                fail(
                  task.segment + " 的清单已经发出去、这一条也在那一份里：先等结论（或者把清单撤回再改）" +
                    "，别让审查者读的字节在他眼下换掉",
                );
              if (!take || (home && home.plannedAt !== null && take.id !== task.segment))
                fail(
                  item.id + " 在段 " + task.segment + " 里，轮到它的那一段还没开" +
                    (take ? "（现在收活的是 " + take.id + "：它判过、关闭之后这一段才接过活）" : "") +
                    "：清单上这一节是排好的下一段，它只记条目，交付等轮到再做",
                );
              if (!item.claim) fail(item.id + " 勾上了，但没有写一行 交付：——勾上就是交付，得写清跑了什么、结果几比几");
              // 一条交付总要指着点什么，否则就是一条谁也核不了的空话。指着什么有两种：
              //   1. 这一批真的量到了改动（改了一个文件、或删了一个文件——删也算动）；
              //   2. 或者这条记录自己带着当场能跑出来的现象（期望：命令 => 要看到的话），
              //      记账前刚真跑过、跑出来了。
              // 第二种是给"能力已经在、只是没有字节可改"的条目留的路：它比伪造一次改动诚实，
              // 也比"只能放弃"多一条出路。
              const provesItself = (expectsOf.get(item.id) ?? []).length > 0;
              if (scanned.changed.length === 0 && !provesItself)
                fail(
                  item.id +
                    " 勾上了，但这一批没有量到任何改动，记录里也没有一条当场能跑出来的 期望：——交付总得指着点什么：" +
                    "要么先真的动过一个文件，要么在 交付： 后面写一行 期望：<命令> => <要看到的话>，它会当场跑一遍",
                );
              specs.push({
                k: "task.done",
                s: one.id,
                id: item.id,
                evidence: item.claim,
                by,
                // run 记下这次数的出处：同一份字节上跑过一次就带着那次指纹与时刻，
                // 复用的说明白它复用的是哪一次——复制来的数字和"同一份字节上的真跑"要分得开。
                ...(observed
                  ? {
                      run: {
                        command: observed.command,
                        exit: observed.exit,
                        tests: observed.tests,
                        pass: observed.pass,
                        fail: observed.fail,
                        fingerprint: observed.fingerprint,
                        at: observed.at,
                        ...(observed.at === earlierRun?.at ? { reused: true } : {}),
                      },
                    }
                  : {}),
                ...((expectsOf.get(item.id) ?? []).length > 0 ? { expects: expectsOf.get(item.id) } : {}),
                files: scanned.changed.map((one) => ({ path: one })),
                changed: scanned.changed,
                bytes: sizes,
                sha: shas,
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
          // 写了 理由： 却没有任何事件可落的行：按条回一句。静默收下等于把人说的话吞掉，
          // 只回一句"没有要落的改动"又让人不知道该去哪找那一条。
          for (const item of plan.items) {
            if (!item.why) continue;
            if (specs.some((spec) => spec.id === item.id)) continue;
            // 放弃/延后过的条目，清单上那行 理由：/延后： 是账本印出来的事实，不是新说的话。
            const was = known.get(item.id);
            if (was && (was.status === "dropped" || was.status === "deferred")) continue;
            fail(
              item.id + " 没有改到下一段，也没有交付或放弃可撤回：这行 理由： 没有可撤的东西" +
                (item.box === "x" ? "（勾着的条目：交付要写 交付：，撤回要把它改回 - [ ]）" : ""),
            );
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
          // 已关闭的段不在这份文件里（它们的事实全在账本上）：缺不等于"消失"。
          // 只有还没关闭的那几段，条目不许自己不见。
          const open = new Set(one.segments.filter((seg) => seg.closedAt === null).map((seg) => seg.id));
          const gone = one.tasks.filter((t) => !mentioned.has(t.id) && t.status !== "dropped" && open.has(t.segment));
          if (gone.length > 0)
            fail(
              "清单里少了 " + gone.map((t) => t.id).join("、") + "：还没关闭的段里，账本有的条目不能自己消失——不做了就写成 - [~] " +
                gone[0].id + " " + gone[0].title + "，再加一行 理由：",
            );
          return specs;
        },
        (stamped) => {
          // 只有真交付过才刷新基线：一次只加条目或只领号的 submit 如果也刷新，
          // 工作区里那些改动就被它吃掉了——下一条交付看起来什么都没动。
          if (stamped.some((ev) => ev.k === "task.done")) writeSnapshot(ROOT, scanned.now);
          // 记账之后只留一句：这一步真的跑过。没有这一行，谁也不知道它跑没跑。
          if (earlierRun) console.log("复用上一次的跑 · " + earlierRun.command + " · 工作区自 " + earlierRun.at + " 起没变");
          // 记账之后再核一遍，不是核"记没记上"，是核"那句话指得到东西吗"：
          // 它点到的路径此刻在不在、是不是 0 字节的空壳。只在记账那一刻成立还不够——
          // 读账本的人看到的是这条记录，他没法回到那一刻；这里当场把说不通的说出来。
          const landed = stamped.filter((ev) => ev.k === "task.done");
          const checked = landed.filter((ev) => (ev.files ?? []).length > 0);
          brokenAfter.push(...checkLanded(ROOT, landed));
          if (checked.length > 0)
            console.log(
              brokenAfter.length > 0
                ? "记账后核对 · " + brokenAfter.length + " 条对不上"
                : "记账后核对 · " + checked.length + " 条都对得上当时那份内容",
            );
        },
      );
      // 落过账就把清单按账本重写一遍：新条目领到的号要写回去，不然下一次 submit
      // 会把同一个 ? 再加一条。文件里说过的话都已经在账本上，重写不丢东西。
      const after = sessionById(doc, evs[0].s ?? targetSession(doc, flags).id);
      fs.writeFileSync(file, planDraft(after) + "\n", "utf8");
      if (brokenAfter.length > 0) {
        console.log("记账之后核对 · 对不上就不算数：");
        for (const one of brokenAfter) console.log("  " + one);
        console.log("  把它补上再交一次（deed submit 会按账本重画清单），或者在那条交付里说清它为什么空着");
        process.exitCode = 1;
      }
      for (const ev of evs) {
        if (ev.k === "goal.set") console.log("目的 · " + ev.s + " · " + ev.text);
        // 新条目落到哪一段由账本说得算，不是清单里写着哪一节算哪一段：说出来，别让人
        // 到下一次 deed plan 才发现它换了一节。
        if (ev.k === "task.add")
          console.log(
            "写进清单 · " + ev.id + " · " + (after.tasks.find((t) => t.id === ev.id)?.segment ?? "") + " · " + ev.title,
          );
        if (ev.k === "task.context") console.log("补依据 · " + ev.id);
        if (ev.k === "task.title") console.log("改标题 · " + ev.id + " · " + ev.title);
        if (ev.k === "task.criteria") console.log("改正标准 · " + ev.id + " · " + ev.why);
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
