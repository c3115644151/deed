import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/digest.mjs";
import { tasksIn } from "../core/rules.mjs";
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
      : "你要回答一件事：这一期交付的活，合起来够不够得上它写下的目的。段只是批次，判断落在整期。",
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
    "    " + verdict + " --by \"你是谁\" --verdict fail --rework T1,T2 \\",
    "      --why \"一句话总结\" --finding \"…\" --finding \"…\"",
    "",
    "被点名的条目回到未做（交付记录退回），其余保持交付；段不封，补完再交再审。",
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

// 一条任务在清单上的样子：段审和整体审共用，两种材料说的应该是同一件事。
// 一批 submit 里的几条交付共用一份工作区差，分不出哪条改了哪份。数出来说清楚，
// 比让读的人自己发现「三份记录一模一样」好。
function batchCount(tasks) {
  const seen = new Map();
  for (const task of tasks)
    for (const proof of task.evidence) if (proof.batch) seen.set(proof.batch, (seen.get(proof.batch) ?? 0) + 1);
  return seen;
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
        (proof.batch
          ? "\n  - 同批交付：这一批共 " + (batches.get(proof.batch) ?? 1) + " 条，改动记在每一条上（一次 submit 只量一次差）"
          : "")
      );
    }),
    ...(task.undone ?? []).map((one) => "- 撤回的交付：" + one.why + "（" + one.by + " · " + stamp0(one.at) + "）· 那条不计入"),
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
    ...tasks.flatMap((task) => taskBlock(task, batchCount(tasks))),
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
  // 清单和角色包同名成对：两份都是这一份交给审查者的材料，谁少了都不算一对。
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

// 整期审的材料：目的在最上面（签收与这一份比的是它），下面是每一段的活与段审结论。
// 单段的一期出这一份就够了——段审和整体审本来就看同一批任务。
export function planWhole(root, session, at) {
  const p = ensureDirs(root);
  const verdicts = new Map(
    session.reviews.filter((one) => one.scope !== "session" && !one.voidedAt).map((one) => [one.segment, one]),
  );
  const text = [
    "# 整体审清单 · " + session.id,
    "",
    "会话 " + session.id + " · " + session.segments.length + " 段 · " + session.tasks.length + " 条 · 生成于 " + stamp0(at),
    "",
    "## 这一期要做成什么",
    "",
    session.goal
      ? session.goal.text + "（" + session.goal.by + " · " + stamp0(session.goal.at) + "）"
      : "（账本里还没写这一期要做成什么）",
    "",
    ...session.segments.flatMap((segment) => {
      const review = verdicts.get(segment.id) ?? null;
      return [
        "## 段 " + segment.id + " · " +
          (review
            ? (review.verdict === "pass" ? "段审通过" : "段审不合格") + "（" + review.by + " · " + stamp0(review.at) + "）"
            : "没有段审"),
        "",
        ...tasksIn(session, segment).flatMap((task) => taskBlock(task, batchCount(session.tasks))),
      ];
    }),
    "## 怎么审",
    "",
    "1. 拿这一期写下的目的当尺子：这些交付合起来，兑现了那句话没有。",
    "2. 段审看的是单条标准；你要看它们合起来还缺什么——缺的那一块，就是这一期没做成的事。",
    "3. 结论落盘：deed review --all --by \"<你是谁>\" --verdict pass|fail --finding \"<缺的那一块>\"",
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

