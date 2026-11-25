import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/digest.mjs";
import { edges, tasksIn } from "../core/rules.mjs";
import { ensureDirs } from "../lib/store.mjs";
import { fileStamp, stamp0 } from "../lib/format.mjs";

// 审查清单是唯一落到账本外、又要交给别人的文件：它要先算好文件名与
// sha256（plan），再在账本收下这条事实时才写盘（write）。中间失败，
// 磁盘上什么也不留。

// 角色包：清单说"审什么"，这一份说"怎么审"。它和清单一起交出去，也一起
// 记下 sha256——换掉其中任何一份，结论就落不下来。
function guideText(subject, target, briefName, scratch, hand = null, nth = 1) {
  const verdict = "deed review --segment " + target;
  return [
    "# 审查者 · " + subject,
    "",
    "你要回答一件事：这一段交付的活，够不够得上它自己写的标准。",
    "清单在同目录（" + briefName + "）。你判的是清单上那几条，不是整个项目。",
    "",
    "## 这一段一直由同一个人判",
    "",
    (nth > 1
      ? "这是这一段的第 " + nth + " 份清单，前几份也是同一个人在看：先找出上一份点过哪几条，"
      : "这是这一段的第一份清单：这一段的清单此后都会交给你，不换人。") +
      "同一段的判断不该每轮换个人从头摸一遍——换手会把「这一段到底行不行」变成「今天谁在看」。",
    "",
    "## 先读标准，再读代码",
    "",
    "每条任务都写了做完的标准。先把标准读完再动手——先看代码会让人替作者找理由。",
    "",
    "## 不信交付记录，逐条复跑",
    "",
    "交付记录是作者自己写的。它说跑了测试，你就跑一遍；它说接口返回 200，你就发一次请求；",
    "它说读了哪个文件，你就打开看。跑不动、跑出来不一样，就是没达成；跑不动又说不清原因，写无法判断。",
    "",
    "## 每条标准给一个判断",
    "",
    "达成 / 未达成 / 无法判断，各配一句依据：命令、输出、文件:行。没有依据的判断，",
    "后面接手的人只能把活重做一遍才知道你说得对不对。",
    "",
    "## 往边界上探",
    "",
    "标准通常只说正常路径。至少试一次：空输入、重复调用、越界值、失败路径、两个入口写同一份数据、",
    "并发时谁先落盘。真问题大多在作者演示的那条路之外。",
    "",
    "## 发现怎么写",
    "",
    "结论（哪条标准没过）+ 为什么（看到的实际行为，不是推测）+ 依据在哪（命令、输出、文件:行）",
    "+ 怎么改（一句话）。四条齐了，写的人不用回来问你。",
    "",
    "## 结论怎么落",
    "",
    "全部达成：",
    "",
    "    " + verdict + " --by \"你是谁\" --verdict pass",
    "",
    "pass 把这一段交回给用户：判决那一下才是这一段关闭的时刻。",
    "",
    "有没达成的：",
    "",
    "    " + verdict + " --by \"你是谁\" --verdict fail --rework T1,T2 \\",
    "      --why \"一句话总结\" --finding \"…\" --finding \"…\"",
    "",
    "被点名的条目回到未做（交付记录退回），其余保持交付；这一段不关闭，补完再交再审。",
    "",
    "## 你怎么动手",
    "",
    "可以跑任何命令：跑测试、发请求、读文件、把整个工作区复制到临时区做破坏性实验。",
    "临时区（清单发出去时开的，落结论时连同里面的一切一起删掉）：",
    "",
    "    " + scratch + "",
    "",
    "- 在那里造夹具、改一处判断看用例是否真红、跑损坏的数据——随便。",
    "- 仓库里的东西一个字节都别动：这一段已经冻结在审，你改了这一段的东西，这份清单就不再是现在这一段，",
    "  结论也落不下来（重放会按当时的字节逐条点名）。要改，是作者的事：他得先撤回这份清单。",
    "- 别改账本（`.deed/`）：谁说了什么、谁判的，是别人读你的依据。",
    "- 别替作者修：发现写清楚就够了，改是他下一次交付的事。",
    "",
    "每条结论与发现都要配复现路径：命令加实际输出，或 文件:行。没有复现路径的发现，",
    "读的人只能重做一遍才知道你说得对不对。",
    "",
    "这份角色包和清单一起记进了账本（review.brief + 两份 sha256）：改其中任何一份，结论都落不下来。",
    "",
  ].join("\n");
}

// 一条任务在清单上的样子。
// 一批 submit 里的几条交付共用一份工作区差，分不出哪条改了哪份。数出来说清楚，
// 比让读的人自己发现「三份记录一模一样」好。
// 批号说的是「这一批记账那一刻」；条数由记账时的账本记下。撤回同批的一条之后
// 数目还是原来的那个：剩下的条数做分母的话，2 条一批撤回一条就成了「单条的一批」。
function batchInfo(tasks) {
  const seen = new Map();
  const book = (key) => {
    if (!seen.has(key)) seen.set(key, { size: 0, live: 0, undone: 0 });
    return seen.get(key);
  };
  for (const task of tasks) {
    for (const proof of task.evidence) {
      if (!proof.batch) continue;
      const one = book(proof.batch.at);
      one.live += 1;
      if (proof.batch.size) one.size = Math.max(one.size, proof.batch.size);
    }
    for (const gone of task.undone ?? []) {
      if (!gone.batch) continue;
      const one = book(gone.batch.at);
      one.undone += 1;
      if (gone.batch.size) one.size = Math.max(one.size, gone.batch.size);
    }
  }
  for (const one of seen.values()) one.size = Math.max(one.size, one.live + one.undone);
  return seen;
}

function batchLine(one) {
  if (!one || (one.size < 2 && one.undone === 0)) return "";
  return (
    "\n  - 同批交付：这一批共 " + one.size + " 条" +
    (one.undone > 0 ? "（其中 " + one.undone + " 条已撤回）" : "") +
    "，改动记在每一条上（一次 submit 只量一次差）"
  );
}

function taskBlock(task, batches = new Map()) {
  return [
    "### " + task.id + " · " + task.title,
    "",
    "- 做完的标准：" + task.criteria,
    "- 触及路径：" + (task.files.length === 0 ? "（未声明，按要审算）" : task.files.join("、")),
    "- 状态：" + task.status + (task.deferredWhy ? (task.status === "dropped" ? " · 理由：" : " · 为什么延后：") + task.deferredWhy : ""),
    ...task.evidence.map((proof) => {
      const files = proof.files ?? (proof.digest ? [{ path: proof.path, digest: proof.digest }] : []);
      return (
        "- 交付记录：" + (proof.claim ?? "") + "（" + proof.by + " · " + stamp0(proof.at) + "）" +
        (files.length === 0 ? "" : "\n  - 记下：" + files.map((one) => one.path + " " + one.digest.slice(0, 12)).join("、")) +
        (proof.run ? "\n  - 跑过：" + proof.run.command + " · 退出 " + proof.run.exit +
            (proof.run.tests === null ? "" : " · " + proof.run.pass + "/" + proof.run.tests + " 通过") : "") +
        (proof.batch ? batchLine(batches.get(proof.batch.at)) : "") +
        (proof.expects ?? []).map((one) => "\n  - 核过：" + one.command + " => " + one.want).join("") +
        (proof.run || (proof.expects ?? []).length > 0 ? "" : "\n  - 只是说法：这条没配命令核过")
      );
    }),
    // 撤回过的放弃：清单要看得见这条走过那一遭，不然「未做」与「一直没做」分不出。
    ...(task.revived ?? []).map(
      (one) =>
        "- 撤回过的放弃：" + one.why + "（" + one.by + " · " + stamp0(one.at) + "）· 它回到未做，可以重新交付",
    ),
    ...(task.undone ?? []).map(
      (one) =>
        "- 撤回的交付：" +
        one.why +
        "（" +
        one.by +
        " · " +
        stamp0(one.at) +
        "）· 那条不计入" +
        ((one.undoes ?? []).length > 0
          ? "；它当时记下的是 " + one.undoes.map((file) => file.path + " " + file.digest.slice(0, 12)).join("、")
          : "；它当时没有记下任何内容"),
    ),
    "",
  ];
}

export function planBrief(root, open, segment, at) {
  const p = ensureDirs(root);
  const tasks = tasksIn(open, segment);
  // 上一次判过的条目：判过、达成、而且它判的那几份内容今天没变——这次不再重判。
  const standing = open.reviews.filter((one) => one.voidedAt === null && one.scope === "segment" && one.segment === segment.id).at(-1) ?? null;
  const judged = new Map((standing?.results ?? []).map((one) => [one.id, one]));
  const untouched = (task) => {
    const result = judged.get(task.id);
    if (!result || result.verdict !== "met") return false;
    return (result.files ?? []).every((file) => {
      try {
        return digest(fs.readFileSync(path.resolve(root, file.path))) === file.digest;
      } catch {
        return false;
      }
    });
  };
  const still = tasks.filter(untouched);
  const again = tasks.filter((task) => !untouched(task));
  // 审查者的临时区：清单发出去时开，结论落地时删。它不属于工作区，也不进账本。
  const scratch = path.join(p.tmp, segment.id + "-" + fileStamp(at));
  fs.mkdirSync(scratch, { recursive: true });
  const text = [
    "# 审查清单 · " + segment.id,
    "",
    "会话 " + open.id + " · 段 " + segment.id + " · " + tasks.length + " 条 · 生成于 " + stamp0(at) +
      (still.length > 0 ? " · 这次要判 " + again.length + " 条（" + still.length + " 条判过了、不再判）" : ""),
    "",
    ...(still.length > 0
      ? [
          "## 判过了、这次不再判",
          "",
          ...still.map(
            (task) =>
              "- " + task.id + " · " +
              (judged.get(task.id).verdict === "met" ? "达成" : judged.get(task.id).verdict) +
              "（" + standing.by + " · " + stamp0(standing.at) + "）· 记下的内容没变",
          ),
          "",
          "这一条判过就是判过：它在上一份清单上被看过，之后它指的那几份内容没被动过。",
          "",
        ]
      : []),
    "## 要审的任务",
    "",
    ...again.flatMap((task) => taskBlock(task, batchInfo(tasks))),
    "## 怎么审",
    "",
    "1. 对每条标准，看交付记录够不够证明它达成；没有交付记录就是没达成。",
    "2. 只看这一段的任务，不替它补未来的事。",
    "3. 每条标准给一个判定，落结论时逐条写：--result T1=met --result T2=unmet；pass 要求这一段每条都有判定。",
    "4. 结论落盘：deed review --segment " + segment.id + " --by \"<你是谁>\" --verdict pass|fail --finding \"<不合格的那几条>\"",
    "",
    "这份文件已经记进账本（review.brief + sha256）：改了它再落结论会被拒。",
    "",
  ].join("\n");
  const base = (n) => path.join(p.review, segment.id + "-" + fileStamp(at) + (n === 1 ? "" : "-" + n));
  let n = 1;
  let file = base(n) + ".md";
  // 清单和角色包同名成对：两份都是这一份交给审查者的清单，谁少了都不算一对。
  while (fs.existsSync(file) || fs.existsSync(base(n) + "-reviewer.md")) {
    n += 1;
    file = base(n) + ".md";
  }
  const nth = open.briefs.filter((one) => one.scope === "segment" && one.segment === segment.id).length + 1;
  const hand = open.briefs.filter((one) => one.scope === "segment" && one.segment === segment.id).at(-1)?.by ?? null;
  const guide = guideText("段 " + segment.id, segment.id, path.basename(file), scratch, hand, nth);
  return {
    file,
    text,
    digest: digest(text),
    guideFile: base(n) + "-reviewer.md",
    guideText: guide,
    guideDigest: digest(guide),
  };
}


// 期审的角色包：它判的不是一条条标准（那些在段里已经判过），是这一期做成的样子。
function periodGuideText(session, briefName, scratch) {
  return [
    "# 审查者 · 这一期 " + session.id,
    "",
    "你要回答的不是「这一段对不对」，而是两件更高一层的事：",
    "这一期**做成的样子**对不对得上它自己写的目的；**各段之间**说不说得通。",
    "清单在同目录（" + briefName + "）。段里每条标准的判定已经做过、结论在案，不必重判——",
    "重判一遍等于把别人的工作重做，也让「谁判了什么」变成两处都能改的事。",
    "",
    "## 你判什么",
    "",
    "1. 目的那句在账本上成立吗：这一期真的做成了它写的那件事，还是只把条目勾完了？",
    "2. 各段之间一致吗：同一件事在两段里是不是两种做法、留下两套说法；后面段的取舍推翻了前面段的结论？",
    "3. 欠下的东西说清了吗：放弃有理由、延后有原因、待裁不悬着；有没有一段的结论本身就建立在一个已经不成立的前提上。",
    "",
    "## 你怎么动手",
    "",
    "可以在仓库外的临时区（" + scratch + "）里造夹具、复制整个工作区做破坏性实验；",
    "仓库内一个字节都不要改：不改源码、不改测试、不改账本、不提交。",
    "每条结论都要配复现路径：命令 + 实际输出，或 文件:行。",
    "",
    "## 你怎么落结论",
    "",
    "- 通过：deed review --all --by \"<你是谁>\" --verdict pass",
    "- 不合格：deed review --all --by \"<你是谁>\" --verdict fail --rework S02.7,S02.9 --why \"一句话总结\"",
    "  点名的是段号：哪一段的前提不成立了，就退回那一段——段里的条目由那一段的审查者点名。",
    "- 具体问题写成 --finding，逐条带位置。",
    "",
    "期审每次换一双手：同一期里判过段的人不能判这一期（段审一直用同一双手，期审每次都新开）。",
    "",
  ].join("\n");
}

// 期审清单：列的是这一期的目的、各段结局、当期定下的边界与弃、还挂着的东西。
export function planWhole(root, session, at) {
  const p = ensureDirs(root);
  const scratch = path.join(p.tmp, "period-" + session.id + "-" + fileStamp(at));
  fs.mkdirSync(scratch, { recursive: true });
  const verdicts = new Map(
    session.reviews.filter((one) => one.voidedAt === null && one.scope !== "session").map((one) => [one.segment, one]),
  );
  const segLine = (segment) => {
    const review = verdicts.get(segment.id) ?? null;
    const count = tasksIn(session, segment).length;
    if (review)
      return "- " + segment.id + " · " + (review.verdict === "pass" ? "审查通过" : "审查不合格") + " · " + review.by + " · " +
        stamp0(review.at) + " · " + count + " 条" +
        (review.findings.length > 0 ? " · " + review.findings.length + " 条发现" : "") +
        (review.rework.length > 0 ? " · 退回 " + review.rework.join("、") : "");
    if (segment.sealedBy)
      return "- " + segment.id + " · 免审封存 · " + segment.sealedBy + " · " + stamp0(segment.closedAt) + " · " + count + " 条 · 审查设置说这一段不用审" +
        (segment.sealedWhy ? "（" + segment.sealedWhy + "）" : "");
    return "- " + segment.id + " · 没有结论 · " + count + " 条";
  };
  const findings = session.segments.flatMap((segment) => {
    const review = verdicts.get(segment.id);
    if (!review || review.findings.length === 0) return [];
    return ["", "  " + segment.id + " 的发现（" + review.by + "）", ...review.findings.map((one) => "  - " + one)];
  });
  const carried = session.tasks
    .filter((task) => task.status === "deferred" || task.status === "dropped")
    .map((task) => "- " + task.id + " · " + (task.status === "deferred" ? "延后" : "放弃") + " · " + task.title + "：" +
      (task.deferredWhy ?? task.droppedWhy ?? "没有写理由"));
  const waiting = session.asks.filter((one) => one.resolvedAt === null && one.state === "pending");
  const lines = edges(session).map((one) => "- " + (one.kind === "border" ? "边界" : "弃") + " · " + one.text + "（" + one.id + (one.by ? " · " + one.by : "") + "）");
  const nth = session.briefs.filter((one) => one.scope === "session").length + 1;
  const text = [
    "# 期审清单 · " + session.id + " · 第 " + nth + " 份",
    "",
    "会话 " + session.id + " · " + session.segments.length + " 段 · 生于 " + stamp0(at),
    "",
    "## 这一期要做成什么",
    "",
    session.goal ? "- " + session.goal.text + "（" + session.goal.by + " · " + stamp0(session.goal.at) + "）" : "- 还没有写下这一期要做成什么",
    "",
    "## 各段的结局",
    "",
    ...session.segments.map(segLine),
    ...findings,
    "",
    "## 这一期定下的边界与弃",
    "",
    ...(lines.length > 0 ? lines : ["- 还没有定过"]),
    "",
    "## 还挂着的",
    "",
    ...(waiting.length > 0 ? waiting.map((one) => "- 待裁 " + one.id + " · " + one.text + "（我理解成：" + one.reading + "）") : ["- 没有待裁"]),
    ...(carried.length > 0 ? carried : ["- 没有放弃或延后的条目"]),
    "",
    "## 怎么审",
    "",
    "1. 判的是这一期做成的样子，不是段里每条标准（那些已经判过，见上）。",
    "2. 看各段之间说不说得通：同一件事两种做法、两套说法、后一段推翻前一段的前提。",
    "3. 结论：deed review --all --by \"<你是谁>\" --verdict pass|fail；不合格点名段号 --rework S02.7。",
    "4. 期审每次换一双手：判过段的人不判这一期。",
    "",
    "这份文件已经记进账本（review.brief + sha256）：改了它再落结论会被拒。",
    "",
  ].join("\n");
  const base = (n) => path.join(p.review, session.id + "-period-" + fileStamp(at) + (n === 1 ? "" : "-" + n));
  let n = 1;
  let file = base(n) + ".md";
  while (fs.existsSync(file) || fs.existsSync(base(n) + "-reviewer.md")) {
    n += 1;
    file = base(n) + ".md";
  }
  const guide = periodGuideText(session, path.basename(file), scratch);
  return {
    file,
    text,
    digest: digest(text),
    guideFile: base(n) + "-reviewer.md",
    guideText: guide,
    guideDigest: digest(guide),
  };
}

export function writeBrief(plan, brief) {
  fs.writeFileSync(plan.file, plan.text, "utf8");
  fs.writeFileSync(plan.guideFile, plan.guideText, "utf8");
  return brief;
}

