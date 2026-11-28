// facts/review: 一次审查此刻"在等谁"——清单交出去了在等结论，结论落下了在等判决。
// 这两问要同时看 items 与 reviews，所以它们单独住在这里，segment 与 task 都来问它。

export const awaitingVerdict = (session, segment) => {
  // 只有手上最后那一份算数：再出一份清单，前一份没人回答也不再是这一段的"等结论"。
  // 按"有哪一份没被回答"去判，一段只要发过两回就永远解不开——第二份被回答，第一份还挂着 null。
  const last = (session.briefs ?? [])
    .filter((one) => one.scope === "segment" && one.segment === segment.id)
    .at(-1);
  return Boolean(last) && last.answeredBy === null && last.withdrawnAt === undefined;
};

// 含义第 23 版起，审查通过只是把这一段交回给人：判别的是用户，段在手那一刻还没关闭。

export const awaitingJudgement = (session, segment) =>
  Boolean(segment) && segment.closedAt === null && segment.verdict === "pass";

// 冻结管的是"手上那一份清单里列的条目"：审查者正在读的那些字节不许在他眼下换掉，
// 别的条目照收——它们进的是下一份清单。审查通过、等你判决的这段时间同理：判的是那一份
// 里列的东西，人换掉它，判决就落在一份没人看过的内容上。
// 清单记了它要判哪几条（含义第 36 版起）；更早的清单没记，那时整段都算在审——照旧一律挡，
// 别拿今天的话去回读旧行。
