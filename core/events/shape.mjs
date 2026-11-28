// events/shape: 事件行的形状——含义版本表、写者版本、校验用的小工具。
// 校验只查形状：写得对不对由 fold 判；这里的每一句都在回答"这一行能不能读"。

export const EVENT_VERSION = 37;
export const WHO = ["user"];

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
  // 我这一侧说的话也是原文：宿主把 assistant 消息交来，记成 reply。
  // 它不参与规则（不数轮次、不开会话、不进下一步），只是让"当时各自说了什么"在账本上成对。
  replies: 30,
  // 不合格也要逐条给判定：它退的是哪几条，其余的那些在这一判里是什么结论，得写下来——
  // 不然下一次重审没有可沿用的判定，只能把整段重判一遍。旧行没有逐条判定，照读。
  resultsOnFail: 35,
};

// 一行说的是哪一套含义。旧行没有 v（第 0 版，最早的写法）。
export const meaningOf = (ev) => ev.v ?? 1;

// 读到不认得的事件类型，和"这一行坏了"是两件事：账本可能只是比程序新。
export class UnknownKindError extends Error {
  constructor(kind, writer, meaning) {
    super(`未知事件：${kind}`);
    this.name = "UnknownKindError";
    this.kind = kind;
    this.writer = writer ?? null;
    this.meaning = meaning ?? null;
  }
}

export const need = (ev, field) => {
  const value = ev[field];
  if (value === undefined || value === null || String(value).trim() === "")
    throw new Error(`事件 ${ev.k} 缺少 ${field}`);
  return value;
};

// 任务上下文只有一个字段：依据。标题写要做成什么，标准写怎么算做完。
export const contextShape = (ev) => {
  if (ev.source !== undefined && ev.source !== null && (typeof ev.source !== "string" || ev.source.trim() === ""))
    throw new Error("task 的 source 要是非空的一句话");
};
