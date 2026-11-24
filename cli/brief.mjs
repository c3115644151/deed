import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/digest.mjs";
import { tasksIn,
  edges,
} from "../core/rules.mjs";
import { ensureDirs } from "../lib/store.mjs";
import { fileStamp, stamp0 } from "../lib/format.mjs";

// 审查清单是唯一落到账本外、又要交给别人的文件：它要先算好文件名与
// sha256（plan），再在账本收下这条事实时才写盘（write）。中间失败，
// 磁盘上什么也不留。

// 角色包：清单说"审什么"，这一份说"怎么审"。它和清单一起交出去，也一起
// 记下 sha256——换掉其中任何一份，结论就落不下来。
function guideText(subject, target, briefName) {
  const verdict = target ? "deed review --segment " + target : "deed review --all";
  return [
    "# 审查者 · " + subject,
    "",
    target
      ? "你要回答一件事：这一段交付的活，够不够得上它自己写的标准。"
      : "你要回答一件事：这一期各段的结论合起来，够不够得上它写下的目的。段里的条目由段审判过；你要看的是它们之间\u3001与这一期那句话之间还有什么没对齐。",
    "清单在同目录（" + briefName + "）。你判的是清单上那几条，不是整个项目。",
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
    "pass 直接封段，不需要第二个人签字。",
    "",
    "有没达成的：",
    "",
    "    " + verdict + " --by \"你是谁\" --verdict fail --rework " + (target ? "T1,T2" : "S0x.N") + " \\",
    "      --why \"一句话总结\" --finding \"…\" --finding \"…\"",
    "",
    target
      ? "被点名的条目回到未做（交付记录退回），其余保持交付；段不封，补完再交再审。"
      : "被点名的段整段重开（段里的条目保持交付，谁也不重新交），那一段重新出清单、由它自己的审查者再审。",
    "",
    "## 你不能",
    "",
    "- 不能改代码：动过这一段的活，你的结论就不再是独立的。",
    "- 不能判自己交付过的活：deed 会拒这条结论。",
    "- 不能把没达成写成达成来结束这件事。",
    "",
    "这份角色包和清单一起记进了账本（review.brief + 两份 sha256）：改其中任何一份，结论都落不下来。",
    "",
  ].join("\n");
}

// 一条任务在清单上的样子：段审和整体审共用，两种清单说的应该是同一件事。
// 一批 submit 里的几条交付共用一份工作区差，分不出哪条改了哪份。数出来说清楚，
// 比让读的人自己发现「三份记录一模一样」好。
// 批号说的是「这一批落账那一刻」；条数由落账时的账本记下。撤回同批的一条之后
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
    "- 状态：" + task.status,
    ...task.evidence.map((proof) => {
      const files = proof.files ?? (proof.digest ? [{ path: proof.path, digest: proof.digest }] : []);
      return (
        "- 交付记录：" + (proof.claim ?? "") + "（" + proof.by + " · " + stamp0(proof.at) + "）" +
        (files.length === 0 ? "" : "\n  - 记下：" + files.map((one) => one.path + " " + one.digest.slice(0, 12)).join("、")) +
        (proof.batch ? batchLine(batches.get(proof.batch.at)) : "")
      );
    }),
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
  const text = [
    "# 审查清单 · " + segment.id,
    "",
    "会话 " + open.id + " · 段 " + segment.id + " · " + tasks.length + " 条 · 生成于 " + stamp0(at),
    "",
    "## 要审的任务",
    "",
    ...tasks.flatMap((task) => taskBlock(task, batchInfo(tasks))),
    "## 怎么审",
    "",
    "1. 对每条标准，看交付记录够不够证明它达成；没有交付记录就是没达成。",
    "2. 只看这一段的任务，不替它补未来的事。",
    "3. 结论落盘：deed review --segment " + segment.id + " --by \"<你是谁>\" --verdict pass|fail --finding \"<不合格的那几条>\"",
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
  const guide = guideText("段 " + segment.id, segment.id, path.basename(file));
  return {
    file,
    text,
    digest: digest(text),
    guideFile: base(n) + "-reviewer.md",
    guideText: guide,
    guideDigest: digest(guide),
  };
}

// 整期审的清单：目的在最上面（签收与这一份比的是它），下面是每一段的活与段审结论。
// 单段的一期出这一份就够了——段审和整体审本来就看同一批任务。
export function planWhole(root, session, at) {
  const p = ensureDirs(root);
  // 整体审以段为单位：清单列的是每一段的结论，不是段里每条任务的清单。
  // 段里每一条标准的判断，段审已经做过并留了依据；整期再审一遍等于把别人的
  // 工作重做，也让「谁判了什么」变成两处都能改的事。
  const verdicts = new Map(
    session.reviews.filter((one) => one.scope !== "session" && !one.voidedAt).map((one) => [one.segment, one]),
  );
  const segLine = (segment) => {
    const review = verdicts.get(segment.id) ?? null;
    const count = tasksIn(session, segment).length;
    if (review)
      return (
        "- " + segment.id + " · " +
        (review.verdict === "pass" ? "段审通过" : "段审不合格") + " · " +
        review.by + " · " + stamp0(review.at) + " · " +
        count + " 条" + (review.findings.length > 0 ? " · " + review.findings.length + " 条发现" : "") +
        (review.rework.length > 0 ? " · 退回 " + review.rework.join("、") : "")
      );
    if (segment.sealedBy)
      return (
        "- " + segment.id + " · 免审封存 · " + segment.sealedBy + " · " +
        stamp0(segment.closedAt) + " · " + count + " 条 · 门槛说这一段不用审（" + (segment.sealWhy ?? "") + "）"
      );
    return "- " + segment.id + " · 没有段审 · " + count + " 条";
  };
  const findings = session.segments.flatMap((segment) => {
    const review = verdicts.get(segment.id);
    if (!review || review.findings.length === 0) return [];
    return ["", "  " + segment.id + " 的发现（" + review.by + "）", ...review.findings.map((one) => "  - " + one)];
  });
  const carried = session.segments.flatMap((segment) =>
    tasksIn(session, segment)
      .filter((task) => task.status === "deferred" || task.status === "dropped")
      .map((task) =>
        "- " + task.id + " · " + (task.status === "deferred" ? "延后" : "放弃") +
        "（" + segment.id + "）· " + task.title + "：" + (task.deferredWhy ?? task.droppedWhy ?? "没有写理由"),
      ),
  );
  const waiting = session.asks.filter((one) => one.resolvedAt === null);
  // 这一期定过的边界与不做：整期审的尺子不只有目的那句话，还有拍板时划下的线。
  const lines = edges(session).map((one) => "- " + (one.kind === "border" ? "边界" : "弃") + " · " + one.text + "（" + one.id + (one.by ? " · " + one.by : "") + "）");
  const text = [
    "# 整体审清单 · " + session.id,
    "",
    "会话 " + session.id + " · " + session.segments.length + " 段 · 生成于 " + stamp0(at),
    "",
    "## 这一期要做成什么",
    "",
    session.goal
      ? session.goal.text + "（" + session.goal.by + " · " + stamp0(session.goal.at) + "）"
      : "（账本里还没写这一期要做成什么）",
    "",
    "## 各段的结论",
    "",
    ...session.segments.map(segLine),
    ...findings,
    "",
    "## 这一期定过的边界与不做",
    "",
    ...(lines.length > 0 ? lines : ["- 没有划下过边界，也没有谈定不做的事"]),
    "",
    "## 段的结论之外，还留在这一期里的",
    "",
    ...(carried.length > 0 ? carried : ["- 没有延后或放弃的条目"]),
    ...waiting.map((one) => "- 待裁 " + one.id + " · " + one.text),
    "",
    "## 怎么审",
    "",
    "1. 你手上是每一段自己的结论，不是段里每条任务的清单：段内每条标准判没判过，那一段的审查者已经判过、也留了依据。",
    "2. 拿这一期写下的那句话当尺子：这些段合起来，兑现了没有；有没有两段互相打脸（同一件事两种说法、后一段假设前一段没做的行为、两段的门宽窄不一样）。",
    "3. 看不出来的地方就去读代码与账本，别停在结论上：结论只有一句话，为什么这么判在它的发现里。",
    "4. 结论落盘：deed review --all --by \"<你是谁>\" --verdict pass|fail；打回点名的是段（--rework S02.3 --why \"…\"），那一段整段重开，段里的条目由它自己的审查者重新看。",
    "",
    "这份文件已经记进账本（review.brief + sha256）：改了它再落结论会被拒。",
    "",
  ].join("\n");
  const base = (n) => path.join(p.review, session.id + "-all-" + fileStamp(at) + (n === 1 ? "" : "-" + n));
  let n = 1;
  let file = base(n) + ".md";
  while (fs.existsSync(file) || fs.existsSync(base(n) + "-reviewer.md")) {
    n += 1;
    file = base(n) + ".md";
  }
  const guide = guideText("这一期 " + session.id, null, path.basename(file));
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

