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
function guideText(subject, target, briefName, scratch) {
  const verdict = "deed review --segment " + target;
  return [
    "# 审查者 · " + subject,
    "",
    "你要回答一件事：这一段交付的活，够不够得上它自己写的标准。",
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
    "pass 直接关闭这一段，不需要第二个人签字。",
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
  const guide = guideText("段 " + segment.id, segment.id, path.basename(file), scratch);
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

