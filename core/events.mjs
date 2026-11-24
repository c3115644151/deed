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
  "goal.set",
  "review.brief",
  "review.log",
  "review.overturn",
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
export const EVENT_VERSION = 17;

// 事件含义里"从第几版起"的规矩只写在这一处：要判读旧行的人问 MEANING，
// 不要再在业务分支里写裸数字——写散的数字没人能一次看全，改一版就漏一处。
export const MEANING = {
  // 不合格必须点名要重做的条目；pass 当场关闭这一段（打回不再是另一条命令）。
  namedFail: 3,
  // 整期审打回时点名的是段号，不是段里的条目。
  segmentRework: 9,
  // 轮次只记人开口的那一轮：agent 的进展不记成轮次。
  userOnlyRounds: 12,
  // 「改到下一段」从预备段里挪出去就真挪：以前它原地不动，那一段于是永远出不了清单。
  carryOut: 14,
  // 撤回可以撤一条放弃：放弃不再是一锤子买卖，撤回来它就回到未做，能重新交付。
  // 以前这种撤回只会被当成「没有可撤回的交付」拒掉，所以旧行照旧按那一套读。
  dropBack: 15,
  // 撤回一条「改到下一段」：段不是排期工具，挪出去只该发生在送审那一刻，挪错了能挪回来。
  undoCarry: 16,
  // 条目可以带一个「先后」：同段里谁先做。它只决定印出来的顺序，不进门也不进结论。
  order: 17,
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
        throw new Error(`轮次只记你和用户之间的一轮：你自己的进展写进交付记录或结论，不记成轮次（--who 写 user）`);
      need(ev, "said");
      // 空参数会被有些 shell 吞掉（PowerShell 5.1 会把 --did "" 变成裸开关），
      // 于是 did 落成 true，账本读起来像"这轮做过事"。类型也要查：这不是记轮的人
      // 说错了，是一行会被误读的事实。
      if (ev.did !== undefined && typeof ev.did !== "boolean" && typeof ev.did !== "string")
        throw new Error("turn 的 did 要写成一句话，或者 true/false");
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
        if (!Array.isArray(ev.files)) throw new Error("task.done 的 files 要是 {path, digest} 数组");
        for (const one of ev.files) {
          if (!one || typeof one.path !== "string" || typeof one.digest !== "string")
            throw new Error("task.done 的 files 每一项都要有 path 与 digest");
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
          if (!one || typeof one.path !== "string" || typeof one.digest !== "string")
            throw new Error("task.undo 的 undoes 每一项都要有 path 与 digest");
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
      need(ev, "id");
      need(ev, "text");
      need(ev, "reading");
      need(ev, "why");
      break;
    case "ask.resolve":
      need(ev, "id");
      need(ev, "decision");
      break;
    case "ask.withdraw":
      need(ev, "id");
      need(ev, "why");
      break;
    // 一期要做成什么：签收签的是它，整体审比的也是它。可以改，改一次一条记录。
    case "goal.set":
      need(ev, "text");
      need(ev, "by");
      break;
    // Handing the brief out is a fact, not a side effect: without it the
    // ledger cannot say which document a verdict answered.
    case "review.brief":
      // 整体审的清单覆盖整期，没有"段"这一格；段审的必须有。
      if (ev.scope === "session") need(ev, "goal");
      else need(ev, "segment");
      need(ev, "brief");
      if (!/^[0-9a-f]{64}$/.test(String(need(ev, "briefDigest"))))
        throw new Error("review.brief 的 briefDigest 要是清单的 sha256（64 位小写 hex）：" + ev.briefDigest);
      // 角色包和清单成对交出去：两份都记下指纹，谁改了哪一份都查得出来。
      if (ev.guide !== undefined) {
        need(ev, "guide");
        if (!/^[0-9a-f]{64}$/.test(String(need(ev, "guideDigest"))))
          throw new Error("review.brief 的 guideDigest 要是角色包的 sha256（64 位小写 hex）：" + ev.guideDigest);
      }
      break;
    case "review.log":
      if (ev.scope !== "session") need(ev, "segment");
      need(ev, "by");
      need(ev, "verdict");
      if (!["pass", "fail"].includes(ev.verdict))
        throw new Error(`审查结论只能是 pass 或 fail：${ev.verdict}`);
      need(ev, "brief");
      // The brief is outside the ledger, so the only way a verdict can be held
      // to the words the reviewer read is its sha256. A line without one is a
      // conclusion nobody can check.
      if (!/^[0-9a-f]{64}$/.test(String(need(ev, "briefDigest"))))
        throw new Error("review.log 的 briefDigest 要是清单的 sha256（64 位小写 hex）：" + ev.briefDigest);
      // 不合格必须点名：一条结论要么放行，要么说清哪几条要重做。
      // 只说"不合格"而不点名，接到这条记录的人还得回来猜。
      // 第 3 版才并进来（打回不再是另一条命令），所以只查从这一版起写的行：
      // 账本只追加，历史行按它自己那一版的标准读，不回头补字段。
      if (ev.verdict === "fail" && meaning >= MEANING.namedFail) {
        need(ev, "why");
        if (!Array.isArray(ev.rework) || ev.rework.length === 0)
          throw new Error("review.log 的 fail 要点名要重做的条目（--rework T1,T2）");
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
    case "review.overturn":
      need(ev, "review");
      need(ev, "why");
      need(ev, "by");
      break;
    // 免审段的结局：审查设置说这一段不用审，但段仍然要有人封，不然它永远开在
    // state 里、谁也签不了收。它不是审查结论，所以不写 review.log。
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
