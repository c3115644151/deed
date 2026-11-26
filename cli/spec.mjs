// 一个动词认哪些开关，只有这一处说。parse 拿它拒掉拼错的开关，帮助也拿它排版：
// 少了这份表，--digset 会被当成一句"没给 digest"，交付照落，记下的内容却是空的。
//
// usage 是给人看的那几行，按 HELP 原来的样子抄下来——帮助不再另写一份，从这里出。
export const SPEC = {
  init: {
    flags: ["print-agents", "force", "said", "who", "review", "exempt", "port", "why"],
    booleans: ["print-agents", "force"],
    usage: [
      'deed init --print-agents         打印一段可粘贴的 AGENTS.md 规则，不改工作区',
      'deed init [--said "…"] [--review "src/**,…"] [--exempt "docs/**"] [--port 7317]',
    ],
  },
  reply: {
    flags: ["session", "from"],
    usage: [
      'deed reply --from dsh:<会话>:<消息号>   记下我这一侧说的话：原文的另一半，文本从 stdin 读',
      "                 它不数轮次、不开会话、不进下一步；同一个消息号只记一次",
    ],
  },
  say: {
    flags: ["session", "from"],
    usage: [
      'deed say "…" [--session S01]   记下一轮：只记你和用户之间那一轮，said 是位置参数',
      "                 没有位置参数时读 stdin（钩子交来的原文走这条路：引号与换行不被拆坏）",
      'deed say --from dsh:<会话>:<消息号> [--session S01]   原文由宿主交来：记 via:"hook"，同一个消息号只记一次',
      '                 我自己的进展写进交付记录或结论，不记成轮次',
    ],
  },
  point: {
    flags: ["id", "topic", "session"],
    usage: [
      'deed point "这一轮留下的一句话" [--topic I1]   记一条要点：没有状态，写下来就在；可挂议题，也可散着',
      'deed point P1 "改过的话"               同一个 id 再记一条就是更新：旧行留账本，界面只显示最新那句',
      "                 原文由系统记（现在是 say，将来宿主 hook 注入）；这里只写值得留下的判断",
    ],
  },
  topic: {
    flags: ["id", "title", "body", "points"],
    usage: [
      'deed topic "标题" --points P1,P2 --body "统合后的正文"   开一个议题草稿：要点由它统合',
      'deed topic I1 --body "统合后的正文" --points P1,P2   给草稿补正文（成立就收编这些要点）',
      "deed topic I1                                  看它长到哪：几条要点、正文、等哪一下确认",
      "                 议题成立与锁定出口都在面板上按：两次都是用户确认，命令行不代替",
    ],
  },
  plan: {
    flags: ["session"],
    usage: ["deed plan [--session S01]   这一期还没有清单时写一份（写法印在文件头部；再要一份，submit 记账之后自己会重画）"],
  },
  submit: {
    flags: ["session", "run"],
    usage: [
      'deed submit  [--run "<命令>"]   把清单上的改动一次记账（勾上=交付，取消勾=撤回，~~=不做）',
      '                                            --run 先真跑一遍，把条数记进账本；记录里对不上就整批拒',
    ],
  },
  review: {
    flags: ["segment", "verdict", "finding", "result", "result-all", "rework", "why", "withdraw", "session", "all", "skip", "due", "auto"],
    repeat: ["finding", "result"],
    booleans: ["withdraw", "all", "skip", "due", "auto"],
    usage: [
      "deed review [--segment S01.1]          发审查清单与角色包（记一条 review.brief），打印两份路径",
      'deed review --segment S01.1 --skip --why "…"   封一个免审段（没人审过，落款留着）',
      'deed review --segment S01.1 --verdict pass --result T1=met [--result T2=met]   审查通过：把这一段交回给用户判决',
      'deed review --segment S01.1 --verdict fail --rework T1,T2 --why "…" [--finding "…"]',
      "                 --result 逐条写判定（met／unmet／unknown:说明）；--result-all met 是这一句话的省写",
      "                 pass 要求这一段每条都判过：逐条写，或用 --result-all 统一说一句",
      "deed review --all              期审：各段都关了之后判这一期做成的样子",
      'deed review --all --verdict pass|fail [--rework S01.7] [--why "…"]   期审的结论；不合格点名的是段号',
      'deed review --segment S01.1 --withdraw --why "…"   撤回这份还没被回答的清单，这一段回到执行态',
      "deed review --due     只读：现在该谁审、清单在哪，机器读的一行 JSON（宿主插件用它决定起不起审查者）",
      '                 写下一份清单时带 --auto：这一次不是人敲的，账本上记 via:"auto"',
      "                 审查只在段里做：签收看的是每一段的结论都放行、条件都满足，没有另一道整期审查",
    ],
  },
  sign: {
    flags: ["words", "title", "session", "shelve", "why"],
    booleans: ["shelve"],
    usage: [
      "deed sign     只说一句：签收在面板上按（命令行不再提供）",
      'deed sign --shelve --why "…"   强制归档这一期（未结清也结束，理由留在账本上）',
    ],
  },
  state: { flags: [], usage: ["deed state"] },
  // 体检层：只读。它回答"这个工作区还是不是一个项目、差哪几条"，
  // 不产生行动，也不挡三种状态。
  check: {
    flags: ["ledger", "gates"],
    booleans: ["ledger", "gates"],
    usage: [
      "deed check               体检：项目状态与逐条诊断（只读，不挡任何动作）",
      "deed check --ledger      账本能不能重放（逐行校验；坏了报哪一行哪一条，退出码 1）",
      "deed check --gates [名字…]   按账本里的 gates 顺序跑门，没过就退出码 1",
    ],
  },
  project: {
    flags: ["shape", "background", "layers", "extras", "why"],
    usage: [
      'deed project --shape software      声明这个工作区是一个项目（形态决定启用哪些约束）',
      'deed project --background "是什么、为谁、不做什么"',
      'deed project --layers "core=core:,app=cli:core+lib"   每条写 格=目录：它可以依赖的格',
      'deed project --extras "scripts,examples"           不在结构里的顶层目录，说清它们不参与',
    ],
  },
  serve: { flags: ["port"], usage: ["deed serve [--port 7317]"] },
  panel: {
    flags: ["stop", "restart"],
    booleans: ["stop", "restart"],
    usage: [
      "deed panel              看面板在不在（没在跑就拉起来，打印 URL）",
      "deed panel --restart    在原端口上换个新的：请旧的退场，地址不变",
      "deed panel --stop       让它退场（它自己收摊）",
    ],
  },
};

// 命令按三种状态分组：讨论把不确定说清，执行把说清的做出来，验收判它过没过。
// 管理面是与状态无关的手（装、看、声明、起面板）。帮助与 ORDER 都从这一处出。
export const GROUPS = [
  { title: "讨论 · 把讨论说清", verbs: ["say", "reply", "point", "topic"] },
  { title: "执行 · 把说清的做出来", verbs: ["plan", "submit"] },
  { title: "验收 · 判它过没过", verbs: ["review", "sign", "check"] },
  { title: "管理 · 装它、看它、声明它", verbs: ["init", "project", "state", "serve", "panel"] },
];

export const ORDER = GROUPS.flatMap((one) => one.verbs);

export const HEAD = ["deed · 一个工作区的放行协议", "", "deed --version                   打印这个程序自己的版本"];

// 拼错的开关按最近的名字猜一次：写错一个字的人想知道是哪个字。
export function closest(name, pool) {
  const cost = (a, b) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      let last = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const keep = last + (a[i - 1] === b[j - 1] ? 0 : 1);
        last = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, keep);
      }
    }
    return row[b.length];
  };
  let best = null;
  for (const one of pool) {
    const d = cost(name, one);
    if (d <= 2 && (best === null || d < best.d)) best = { name: one, d };
  }
  return best?.name ?? null;
}
