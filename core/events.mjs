// Event shape and validation. The ledger is the only authority; everything else
// is a projection of these lines.

export const EVENT_KINDS = [
  "turn",
  "task.add",
  "task.done",
  "task.undo",
  "task.defer",
  "task.drop",
  // 一段送审之后就不再收新活：没做的条目靠这一行改到下一段（理由写在清单的 改到下一段： 里）。
  "task.carry",
  // 清单上那张 先后： 也是一个事实：同段里谁先做。它只决定印出来的顺序。
  "task.order",
  "ask.raise",
  "ask.resolve",
  "ask.withdraw",
  // 讨论域：原文（turn）之外，agent 记要点，要点聚成议题；议题两次由人确认。
  "point.add",
  "topic.create",
  "topic.establish",
  "topic.release",
  "goal.set",
  "review.brief",
  "review.log",
  // 清单发出去之后要改这一段的活，先把它撤回：这不是"清单过期"，是一个人在账本上签了"这一份不作数"。
  "review.withdraw",
  "review.overturn",
  "verdict.pass",
  "segment.plan",
  // 这个工作区是项目，还是只是借它干活的地方：形态、背景、分层都写在这一行里。
  "project.declare",
  "segment.seal",
  // 只读：旧账本里还有这两种结局，命令面已经不再产生它们（一段的结局由审查者的
  // 结论定，人只能推翻结论）。
  "judge.pass",
  "judge.rework",
  "sign",
  "shelve",
  "config.change",
];

// 轮次是你和用户之间的一轮对话：只有人开口的那一轮才是轮次。agent 自己做了什么
// 记在交付记录与结论里，说成轮次就把我的工作假装成了讨论。
export const WHO = ["user"];

// 事件含义的版本。每一行都记着写它的那一套含义（v 字段）；加一个事件类型、
// 或者改变已有字段的含义，就把这个数 +1（同时升 package.json 的 minor）。
// 这样"账本比程序新"能被证明，而不是靠猜：读不动的行带着一个比自己更新的 v，
// 就是账本新；v 不超前才可能是这一行被手写或被改过。
export const EVENT_VERSION = 29;

// 事件含义里"从第几版起"的规矩只写在这一处：要判读旧行的人问 MEANING，
// 不要再在业务分支里写裸数字——写散的数字没人能一次看全，改一版就漏一处。
export const MEANING = {
  // 不合格必须点名要重做的条目；pass 当场关闭这一段（打回不再是另一条命令）。
  namedFail: 3,
  // 签收核对打回时点名的是段号，不是段里的条目。
  segmentRework: 9,
  // 轮次只记人开口的那一轮：agent 的进展不记成轮次。
  userOnlyRounds: 12,
  // 「改到下一段」从下一段里挪出去就真挪：以前它原地不动，那一段于是永远出不了清单。
  carryOut: 14,
  // 撤回可以撤一条放弃：放弃不再是一锤子买卖，撤回来它就回到未做，能重新交付。
  // 以前这种撤回只会被当成「没有可撤回的交付」拒掉，所以旧行照旧按那一套读。
  dropBack: 15,
  // 撤回一条「改到下一段」：段不是排期工具，挪出去只该发生在送审那一刻，挪错了能挪回来。
  undoCarry: 16,
  // 条目可以带一个「先后」：同段里谁先做。它只决定印出来的顺序，不进门也不进结论。
  order: 17,
  // 审查只在段里做：签收看的是每段的结论都放行、条件都满足，整期上不再有第二份结论能落。
  // 旧账本里落过的那几行照读（历史事实），既不挡签收，也不再产生新的。
  noWholeReview: 18,
  // 结论按条落下：一条标准一个判定，pass 只在每条都有判定时才关闭这一段；重审只判没判过与字节变过的。
  // 之前只有段级 pass/fail，那种行按当时的写法读。
  perItem: 19,
  // 清单没被回答之前这一段冻结：交付、撤回、放弃、改到下一段都不收；要改先把清单撤回。
  freeze: 19,
  // 撤回一份还没被回答的清单：它作废、段回到执行态，账本上留着谁、为什么。
  withdraw: 19,
  // 期审回来：段全关之后还要有人判「这一期做成的样子对不对、各段之间说不说得通」，
  // 签收压在它后面。它记的不是"各段结论的汇总"，是另一层问题。
  // 从这一版起清单不再写明交给谁：名字由通道决定，命令行不收 --by。
  periodReview: 20,
  // 三个闸放到面板上：签收与推翻结论不再从命令行发生，落下的行要写明是谁在哪按的
  // （by + via:"panel"）。命令行那两条路当场拒。旧行照读（那时 by 是自述）。
  gates: 21,
  // 推翻这个动作不存在了：结论判错由审查机制自己回答，人不需要 Amendments 账本。
  // 新行一律拒；旧账本里那一两行照读，占位仍留着，读得动、不再产生。
  noOverturn: 22,
  // 判决是用户按的第二个入口：审查通过只把这一段交回来，关闭等用户判决（by + via:"panel"）。
  judgement: 23,
  // 段可以由清单预先排进来：一节就是一个段，先声明、按顺序接过活。
  segmentsPlanned: 24,
  // 项目声明：工作区可以是项目，也可以只是干活的地方。声明之后才有项目级的东西
  // （结构约束、条目、期审拿背景当尺子），没有声明时三种状态照常跑。
  projectDeclared: 25,
  // 题只记"我不确定的是什么"：--why 与 --reading 说的是同一件事，两处写就两处对不上。
  askNoWhy: 26,
  // 讨论域三层：要点（无状态）、议题（两次由人确认：成立、锁定出口）、原文留给宿主注入。
  discussionTopics: 27,
  // 待裁这个概念不存在了：它只是用户两次按钮时的交流，不再是对象、不进账本。
  // 旧账本里的 ask.* 照读（那时是真事），新行一律拒。
  askRetired: 28,
  // 原文可以由宿主交来（钩子），不是 agent 复述：这一条起轮次能带 via/origin/mid。
  // 人的话仍然是人的话（who:"user"）；通道写着它怎么到的（via:"hook"），
  // mid 是宿主给的消息号，重复交来的同一句按它认。旧行没有这三样，照读。
  turnOrigin: 29,
};

// 一行说的是哪一套含义。旧行没有 v（第 0 版，最早的写法）。
export const meaningOf = (ev) => ev.v ?? 1;

// 读到不认得的事件类型，和"这一行坏了"是两件事：账本可能只是比程序新。
// core 不知道当前版本（也不许读文件），所以这里只把事实带出去——类型名、
// 写者版本、这一行自己的含义版本，由 CLI 层去比大小、去说人话。
export class UnknownKindError extends Error {
  constructor(kind, writer, meaning) {
    super(`未知事件：${kind}`);
    this.name = "UnknownKindError";
    this.kind = kind;
    this.writer = writer ?? null;
    this.meaning = meaning ?? null;
  }
}

const need = (ev, field) => {
  const value = ev[field];
  if (value === undefined || value === null || String(value).trim() === "")
    throw new Error(`事件 ${ev.k} 缺少 ${field}`);
  return value;
};

// Validation is deliberately shallow: it rejects malformed events, not wrong
// ones. Rules (can this segment be judged?) live in rules.mjs, never here.
export function validateEvent(ev, at) {
  need(ev, "k");
  if (!EVENT_KINDS.includes(ev.k)) throw new UnknownKindError(ev.k, ev.w, ev.v);
  if (ev.at && !/^\d{4}-\d{2}-\d{2}T/.test(String(ev.at)))
    throw new Error(`时间不是 ISO 时刻：${ev.at}`);
  // v 放在最后，调用方改不了：一行说的是哪一套含义，由写它的程序决定。
  const stamped = { at: ev.at ?? at, ...ev, v: EVENT_VERSION };
  // 校验按"这一行自己说的那一版"来。没带 v 的行写在版本字段之前（第 1 版），
  // 要按当时的标准读；写入方显式带 v（transact 会带上当前版本），才按当前版校验。
  // 反过来做——拿今天的版本去核旧行——补一个字段就把历史里合法的行全判成坏账。
  const meaning = ev.v ?? 1;
  switch (ev.k) {
    case "turn":
      need(ev, "who");
      // 第 12 版起轮次只记人开口的那一轮。旧行里的 agent 轮照读：
      // 拿新规矩去核旧行，会把当时合法的历史全判成坏账（doctor 会逐行核）。
      if (meaning >= MEANING.userOnlyRounds && !WHO.includes(ev.who))
        throw new Error(`轮次只记你和用户之间的一轮：你自己的进展写进交付记录或结论，不记成轮次（deed say 只写人开口的那一轮）`);
      need(ev, "said");
      // 空参数会被有些 shell 吞掉（PowerShell 5.1 会把 --did "" 变成裸开关），
      // 于是 did 落成 true，账本读起来像"这轮做过事"。类型也要查：这不是记轮的人
      // 说错了，是一行会被误读的事实。
      if (ev.did !== undefined && typeof ev.did !== "boolean" && typeof ev.did !== "string")
        throw new Error("turn 的 did 要写成一句话，或者 true/false");
      // 第 29 版起原文可以由宿主交来：通道（via）、谁交的（origin）、它的消息号（mid）。
      // mid 是重复交来的同一句的认据——没有它，钩子重启一次就会把同一句记两遍。
      if (meaning >= MEANING.turnOrigin) {
        if (ev.via !== undefined && typeof ev.via !== "string")
          throw new Error("turn 的 via 要写成一句话（例如 hook）");
        if (ev.origin !== undefined && typeof ev.origin !== "string")
          throw new Error("turn 的 origin 要写成一句话（例如 dsh）");
        if (ev.mid !== undefined && typeof ev.mid !== "string")
          throw new Error("turn 的 mid 要写成一句话：它是宿主给这条消息的号");
        if (ev.via === "hook" && typeof ev.mid !== "string")
          throw new Error("钩子交来的原文要带 mid：没有消息号，重复交来的一句没法认出来");
      }
      break;
    case "task.add":
      need(ev, "id");
      need(ev, "title");
      need(ev, "criteria");
      if (ev.order !== undefined && (!Number.isInteger(ev.order) || ev.order < 1))
        throw new Error("task.add 的 order 要是不小于 1 的整数：清单上写 先后：1");
      break;
    case "task.order":
      need(ev, "id");
      if (!Number.isInteger(ev.order) || ev.order < 1)
        throw new Error("task.order 的 order 要是不小于 1 的整数：清单上写 先后：1");
      break;
    case "task.done":
      need(ev, "id");
      need(ev, "evidence");
      need(ev, "by");
      if (ev.changed !== undefined && !Array.isArray(ev.changed))
        throw new Error("task.done 的 changed 要是路径数组");
      if (ev.bytes !== undefined) {
        if (typeof ev.bytes !== "object" || ev.bytes === null || Array.isArray(ev.bytes))
          throw new Error("task.done 的 bytes 要是 {路径: 字节数}");
        for (const [file, size] of Object.entries(ev.bytes))
          if (!Number.isFinite(size) || size < 0) throw new Error("task.done 的 bytes 里 " + file + " 不是字节数");
      }
      // 一批交付记的是这一批的时刻与几条：条数写进账本，撤回同批的一条之后
      // 清单仍说得出原本几条，而不是拿剩下的数现算。
      if (ev.batch !== undefined) {
        const one = ev.batch;
        if (!one || typeof one !== "object" || Array.isArray(one))
          throw new Error("task.done 的 batch 要是 {at, size}");
        if (typeof one.at !== "string" || !Number.isInteger(one.size) || one.size < 2)
          throw new Error("task.done 的 batch 要有 at 与不少于 2 的 size");
      }
      // 数由工具采：交付时跑过的那条命令、它的退出码与它自己报的条数。
      // 账本里有这一格，清单与面板上的数才有出处，不是从我抄来的。
      if (ev.run !== undefined) {
        const one = ev.run;
        if (!one || typeof one !== "object" || Array.isArray(one))
          throw new Error("task.done 的 run 要是 {command, exit, tests, pass, fail}");
        if (typeof one.command !== "string" || one.command === "")
          throw new Error("task.done 的 run.command 要是那条命令的原文");
        if (!Number.isInteger(one.exit)) throw new Error("task.done 的 run.exit 要是退出码");
        for (const key of ["tests", "pass", "fail"])
          if (one[key] !== null && !Number.isInteger(one[key]))
            throw new Error("task.done 的 run." + key + " 要是条数或 null");
      }
      if (ev.files !== undefined) {
        if (!Array.isArray(ev.files)) throw new Error("task.done 的 files 要是 [{ path }] 数组");
        for (const one of ev.files) {
          if (!one || typeof one.path !== "string") throw new Error("task.done 的 files 每一项都要有 path");
        }
      }
      // 说得出会看到什么的那几条，真跑过才算数：账本记下命令与它必须印出的那段话。
      if (ev.expects !== undefined) {
        if (!Array.isArray(ev.expects) || ev.expects.length === 0)
          throw new Error("task.done 的 expects 要是 [{command, want}]");
        for (const one of ev.expects) {
          if (!one || typeof one !== "object" || Array.isArray(one))
            throw new Error("task.done 的 expects 一条要写成 {command, want}");
          if (typeof one.command !== "string" || one.command === "")
            throw new Error("task.done 的 expects 里那条命令要是原文");
          if (typeof one.want !== "string" || one.want === "")
            throw new Error("task.done 的 expects 里那条期望要是原文");
        }
      }
      break;
    case "task.undo":
      need(ev, "id");
      need(ev, "why");
      // 撤的是哪份字节，撤的那一刻就得写下来：重放再去推，等于让后来的形状改口。
      if (ev.undoes !== undefined) {
        if (!Array.isArray(ev.undoes)) throw new Error("task.undo 的 undoes 要是数组");
        for (const one of ev.undoes) {
          if (!one || typeof one.path !== "string") throw new Error("task.undo 的 undoes 每一项都要有 path");
        }
      }
      break;
    case "task.defer":
    case "task.drop":
      need(ev, "id");
      need(ev, "why");
      break;
    case "task.carry":
      need(ev, "id");
      break;
    case "ask.raise":
      if (meaningOf(ev) >= MEANING.askRetired)
        throw new Error("ask.raise 已经不存在：待裁只是用户两次确认议题时的交流，不再是账本里的对象");
      need(ev, "id");
      need(ev, "text");
      need(ev, "reading");
      // 第 26 版起题不再收 --why：说不确定的那句话就在 reading 里，再多一处只会两边对不上。
      if (meaningOf(ev) < MEANING.askNoWhy) need(ev, "why");
      break;
    case "ask.resolve":
      if (meaningOf(ev) >= MEANING.askRetired)
        throw new Error("ask.resolve 已经不存在：待裁只是用户两次确认议题时的交流，不再是账本里的对象");
      need(ev, "id");
      need(ev, "decision");
      break;
    case "ask.withdraw":
      if (meaningOf(ev) >= MEANING.askRetired)
        throw new Error("ask.withdraw 已经不存在：待裁只是用户两次确认议题时的交流，不再是账本里的对象");
      need(ev, "id");
      need(ev, "why");
      break;
    // 要点：agent 每轮记下的一句，没有状态；可挂议题，也可散着。
    case "point.add":
      if (meaningOf(ev) < MEANING.discussionTopics)
        throw new Error("point.add 是含义第 27 版才有的事件：v 要写 " + MEANING.discussionTopics);
      need(ev, "id");
      need(ev, "text");
      if (ev.by !== undefined)
        throw new Error("要点不记名字：它是从这一轮里留下的判断，不是谁交的活");
      break;
    // 议题：agent 统合要点开一份草稿，之后两次由人在面板上确认。
    case "topic.create":
      if (meaningOf(ev) < MEANING.discussionTopics)
        throw new Error("topic.create 是含义第 27 版才有的事件：v 要写 " + MEANING.discussionTopics);
      need(ev, "id");
      need(ev, "title");
      if (ev.points !== undefined && !Array.isArray(ev.points))
        throw new Error("topic.create 的 points 要是数组");
      break;
    case "topic.establish":
      if (meaningOf(ev) < MEANING.discussionTopics)
        throw new Error("topic.establish 是含义第 27 版才有的事件：v 要写 " + MEANING.discussionTopics);
      need(ev, "id");
      need(ev, "body");
      need(ev, "by");
      if (ev.via !== "panel") throw new Error('议题成立只在面板上按：via 要写 "panel"');
      if (ev.points !== undefined && !Array.isArray(ev.points))
        throw new Error("topic.establish 的 points 要是数组");
      break;
    case "topic.release":
      if (meaningOf(ev) < MEANING.discussionTopics)
        throw new Error("topic.release 是含义第 27 版才有的事件：v 要写 " + MEANING.discussionTopics);
      need(ev, "id");
      need(ev, "by");
      if (ev.via !== "panel") throw new Error('议题锁定只在面板上按：via 要写 "panel"');
      break;
    // 一期要做成什么：签收签的是它，签收核对比的也是它。可以改，改一次一条记录。
    case "goal.set":
      need(ev, "text");
      need(ev, "by");
      break;
    // Handing the brief out is a fact, not a side effect: without it the
    // ledger cannot say which document a verdict answered.
    case "review.brief":
      // 审查只在段里做：清单必须说清是哪一段的。整期清单是第 17 版之前的写法，
      // 旧账本里读得出来，新行不再产生。
      // 第十 8 版起清单只落在段上；第 20 版把期审装回来，整期重新有清单——但那不是
      // 一次「汇总」，是另一个问题（这一期做成的样子、各段之间说不说得通）。
      if (ev.scope === "session" && meaningOf(ev) >= MEANING.noWholeReview && meaningOf(ev) < MEANING.periodReview)
        throw new Error("审查清单落在段上：那一版里整期上不出清单（签收只看各段的结论与条件）");
      if (ev.scope === "session") need(ev, "goal");
      else need(ev, "segment");
      // 第 20 版起清单写明谁在看（那时是自述的名字）；从写者 0.25 起这一项恒为 agent：
      // 名字由通道决定，命令行不收 --by。
      if (meaningOf(ev) >= MEANING.periodReview) need(ev, "by");
      need(ev, "brief");
      // 角色包和清单成对交出去：两份一起给审查者，结论回答的是这两份。
      if (ev.guide !== undefined) need(ev, "guide");
      break;
    case "review.log":
      if (ev.scope === "session" && meaningOf(ev) >= MEANING.noWholeReview && meaningOf(ev) < MEANING.periodReview)
        throw new Error("审查结论落在段上：那一版里整期上没有第二份结论（签收只看各段的结论与条件）");
      if (ev.scope !== "session") need(ev, "segment");
      need(ev, "by");
      need(ev, "verdict");
      if (!["pass", "fail"].includes(ev.verdict))
        throw new Error(`审查结论只能是 pass 或 fail：${ev.verdict}`);
      need(ev, "brief");
      // The brief is outside the ledger, so the only way a verdict can be held
      // to the words the reviewer read is its sha256. A line without one is a
      // conclusion nobody can check.
      // 不合格必须点名：一条结论要么放行，要么说清哪几条要重做。
      // 只说"不合格"而不点名，接到这条记录的人还得回来猜。
      // 第 3 版才并进来（打回不再是另一条命令），所以只查从这一版起写的行：
      // 账本只追加，历史行按它自己那一版的标准读，不回头补字段。
      if (ev.verdict === "fail" && meaning >= MEANING.namedFail) {
        need(ev, "why");
        if (!Array.isArray(ev.rework) || ev.rework.length === 0)
          throw new Error("review.log 的 fail 要点名要重做的条目（--rework T1,T2）");
      }
      // 按条落下（第 19 版起）：一条标准一个判定；pass 只在每条都有判定时才说得通，
      // 缺了哪条由重放拒，免得"通过了"这句话盖着一张没人看过的条目。
      if (ev.results !== undefined) {
        if (!Array.isArray(ev.results)) throw new Error("review.log 的 results 要是 [{ id, verdict, note }] 数组");
        const seen = new Set();
        for (const one of ev.results) {
          if (!one || typeof one.id !== "string" || !one.id.trim()) throw new Error("review.log 的 results 每一条都要写清是哪一条（id）");
          if (!["met", "unmet", "unknown"].includes(one.verdict))
            throw new Error(`review.log 的 results 判定只能是 met／unmet／unknown：${one.verdict}`);
          if (seen.has(one.id)) throw new Error(`review.log 的 results 里 ${one.id} 出现了两次：一条标准只有一个判定`);
          seen.add(one.id);
          if (one.files !== undefined && !Array.isArray(one.files))
            throw new Error("review.log 的 results 里 files 要是数组");
        }
      }
      // 被点名之后改主意不做的条目，放行时要把这件事与理由一起记下来：它是这条
      // 结论为什么会过的一部分，只印在当场终端里，读账本的人就看不到。
      if (ev.gaveUp !== undefined) {
        if (!Array.isArray(ev.gaveUp)) throw new Error("review.log 的 gaveUp 要是 [{ id, why }] 数组");
        for (const one of ev.gaveUp)
          if (!one || typeof one.id !== "string" || !one.id.trim())
            throw new Error("review.log 的 gaveUp 每一条都要写清是哪一条（id）");
      }
      break;
    case "review.withdraw":
      need(ev, "segment");
      need(ev, "brief");
      need(ev, "why");
      need(ev, "by");
      break;
    case "verdict.pass":
      need(ev, "segment");
      need(ev, "by");
      if (meaningOf(ev) < MEANING.judgement)
        throw new Error("verdict.pass 是含义第 23 版才有的事件：v 要写 " + MEANING.judgement);
      if (ev.via !== "panel") throw new Error('判决只在面板上按：via 要写 "panel"');
      break;
    case "review.overturn":
      need(ev, "review");
      need(ev, "why");
      need(ev, "by");
      // 第 22 版起这个动作不收了：推翻一条结论不是人要做的事。旧行照读（见 fold）。
      if (meaningOf(ev) >= MEANING.noOverturn)
        throw new Error("推翻一条结论已经不收（含义第 22 版）：账本不往回改，要改结论就开新一期把要补的记进去");
      break;
    // 免审段的结局：审查设置说这一段不用审，但段仍然要有人封，不然它永远开在
    // state 里、谁也签不了收。它不是审查结论，所以不写 review.log。
    // 清单预排的段：先声明，前面的段判过它才接过活。
    case "segment.plan":
      need(ev, "segment");
      if (!/^S\d+\.\d+$/u.test(String(ev.segment))) throw new Error("segment.plan 的段号要写成 S01.1：" + ev.segment);
      if (meaningOf(ev) < MEANING.segmentsPlanned)
        throw new Error("segment.plan 是含义第 24 版才有的事件：v 要写 " + MEANING.segmentsPlanned);
      break;
    // 项目声明：形态说这个工作区是哪一类项目；背景说它是什么、为谁、不做什么；
    // 分层说它自己的目录与依赖方向（每个项目不一样，所以要它自己说）。
    case "project.declare": {
      if (meaningOf(ev) < MEANING.projectDeclared)
        throw new Error("project.declare 是含义第 25 版才有的事件：v 要写 " + MEANING.projectDeclared);
      need(ev, "shape");
      if (typeof ev.shape !== "string" || ev.shape.trim() === "") throw new Error("project.declare 缺少 shape");
      for (const layer of ev.layers ?? []) {
        if (!layer || typeof layer.dir !== "string" || layer.dir.trim() === "")
          throw new Error("project.declare 的每一层都要写 dir：收到 " + JSON.stringify(layer));
        if (layer.role !== undefined && typeof layer.role !== "string")
          throw new Error("project.declare 的 role 要是一个名字：" + JSON.stringify(layer.role));
        if (layer.mayImport !== undefined && !Array.isArray(layer.mayImport))
          throw new Error("project.declare 的 mayImport 要是数组：" + JSON.stringify(layer.mayImport));
      }
      if (ev.extras !== undefined && !Array.isArray(ev.extras))
        throw new Error("project.declare 的 extras 要是数组：" + JSON.stringify(ev.extras));
      if (ev.background !== undefined && typeof ev.background !== "string")
        throw new Error("project.declare 的 background 要是一段文字");
      break;
    }
    case "segment.seal":
      need(ev, "segment");
      need(ev, "why");
      need(ev, "by");
      break;
    case "judge.pass":
      need(ev, "segment");
      need(ev, "by");
      break;
    case "judge.rework":
      need(ev, "segment");
      need(ev, "why");
      // Tearing up a verdict is a decision about someone else's work: it needs
      // the same signature as handing one out, or the record shows who judged
      // and never who overruled.
      need(ev, "by");
      break;
    case "sign":
      if (meaningOf(ev) >= MEANING.gates) {
        need(ev, "by");
        if (ev.via !== "panel") throw new Error('sign 只在面板上按：via 要写 "panel"');
      }
      need(ev, "words");
      need(ev, "title");
      break;
    case "shelve":
      need(ev, "why");
      break;
    case "config.change":
      need(ev, "key");
      if (ev.to === undefined) throw new Error("事件 config.change 缺少 to");
      need(ev, "why");
      break;
    default:
      break;
  }
  return stamped;
}
