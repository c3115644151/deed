// events/review: 清单与结论相关的行。
import { need, MEANING, WHO, contextShape, meaningOf } from "./shape.mjs";

export const KINDS = ["review.brief","review.log","review.withdraw","verdict.pass","review.overturn"];

export const VALIDATE = {
  "review.brief": (ev, meaning) => {
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
      return;
  },
  "review.log": (ev, meaning) => {
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
      return;
  },
  "review.withdraw": (ev, meaning) => {
      need(ev, "segment");
      need(ev, "brief");
      need(ev, "why");
      need(ev, "by");
      return;
  },
  "verdict.pass": (ev, meaning) => {
      need(ev, "segment");
      need(ev, "by");
      if (meaningOf(ev) < MEANING.judgement)
        throw new Error("verdict.pass 是含义第 23 版才有的事件：v 要写 " + MEANING.judgement);
      if (ev.via !== "panel") throw new Error('判决只在面板上按：via 要写 "panel"');
      return;
  },
  "review.overturn": (ev, meaning) => {
      need(ev, "review");
      need(ev, "why");
      need(ev, "by");
      // 第 22 版起这个动作不收了：推翻一条结论不是人要做的事。旧行照读（见 fold）。
      if (meaningOf(ev) >= MEANING.noOverturn)
        throw new Error("推翻一条结论已经不收（含义第 22 版）：账本不往回改，要改结论就开新一期把要补的记进去");
      return;
  },
};
