// 一个动词认哪些开关，只有这一处说。parse 拿它拒掉拼错的开关，帮助也拿它排版：
// 少了这份表，--digset 会被当成一句"没给 digest"，交付照落，记下的内容却是空的。
//
// usage 是给人看的那几行，按 HELP 原来的样子抄下来——帮助不再另写一份，从这里出。
export const SPEC = {
  init: {
    flags: ["print-agents", "force", "said", "who", "review", "exempt", "port", "why", "by"],
    booleans: ["print-agents", "force"],
    usage: [
      'deed init --print-agents         打印一段可粘贴的 AGENTS.md 规则，不改工作区',
      'deed init [--said "…"] [--review "src/**,…"] [--exempt "docs/**"] [--port 7317]',
    ],
  },
  tick: {
    flags: ["who", "said", "did", "session", "by"],
    usage: ['deed tick --who user|agent --said "…" [--did "…"] [--session S01]'],
  },
  task: {
    flags: ["id", "title", "criteria", "session", "files", "evidence", "digest", "by", "why"],
    repeat: ["digest"],
    usage: [
      'deed task add "<要做的事>" --criteria "<做完的标准>" [--files "src/a.mjs,docs/b.md"]',
      'deed task done <T1> --evidence "<命令与结果>" [--digest <路径> …] [--session S01]',
      'deed task undo <T1> --why "…"         收回最后那条交付（说错了话用它，别改写成对的）',
      'deed task defer|drop <T1> --why "…"',
    ],
  },
  ask: {
    flags: ["reading", "decision", "why", "session", "by", "id"],
    usage: [
      'deed ask "<问题>" --reading "我理解成…" --why "…"',
      'deed ask resolve|withdraw <A1> --decision "…" --by "谁"   只有人裁：从管道里跑要写清谁按的',
    ],
  },
  plan: {
    flags: ["format", "print", "force", "session"],
    booleans: ["format", "print", "force"],
    usage: ["deed plan [--format|--print] [--force]   把这一期的清单写成草稿（--format 打印格式，--force 覆盖磁盘上那份）"],
  },
  submit: {
    flags: ["by", "session"],
    usage: ['deed submit [--by "谁"]                把清单上的改动一次记账（勾上=交付，取消勾=撤回，~~=不做）'],
  },
  goal: {
    flags: ["text", "why", "session", "by"],
    usage: ['deed goal "<这一期要做成什么>" [--why "…"]   签收与整体审都拿它当尺子'],
  },
  review: {
    flags: ["all", "segment", "verdict", "by", "finding", "rework", "why", "session"],
    booleans: ["all"],
    repeat: ["finding"],
    usage: [
      "deed review [--segment S01.1]          发审查清单与角色包（记一条 review.brief），打印两份路径",
      "deed review --all                      发整期清单（列各段的结论；段都封之后用它，一段的一期由那一段的结论回答）",
      'deed review --segment S01.1 --by "谁" --verdict pass [--finding "…"]   pass 直接关闭这一段',
      'deed review --segment S01.1 --by "谁" --verdict fail --rework T1,T2 --why "…" [--finding "…"]',
      'deed review --all --by "谁" --verdict pass|fail [--rework S0x.N,…] [--why "…"]   结论落在整期（点名的是段）',
    ],
  },
  seal: {
    flags: ["segment", "why", "by", "session"],
    usage: ['deed seal [--segment S01.1] --why "…"  封一个免审段（审查设置说不用审，没人审过）'],
  },
  judge: {
    flags: ["overturn", "why", "by"],
    usage: ['deed judge --overturn R1 --why "…"    推翻一条在案的结论（例外，不是步骤）'],
  },
  sign: {
    flags: ["words", "title", "by", "session"],
    usage: ['deed sign --words "<用户原话>" [--title "<这一期的名字>"]'],
  },
  shelve: {
    flags: ["why", "by", "session"],
    usage: ['deed shelve --why "…"'],
  },
  state: { flags: [], usage: ["deed state"] },
  verify: { flags: [], usage: ["deed verify"] },
  doctor: { flags: [], usage: ["deed doctor"] },
  gate: { flags: [], usage: ["deed gate [名字…]              按账本里的 gates 顺序跑门，失败即退出"] },
  serve: { flags: ["port"], usage: ["deed serve [--port 7317]"] },
  panel: { flags: ["stop"], booleans: ["stop"], usage: ["deed panel [--stop]              看面板在不在（没在跑就拉起来，打印 URL）"] },
};

// 帮助里的顺序就是这里的顺序：帮助从 SPEC 出，不再有一份手抄的清单。
export const ORDER = ["init", "tick", "task", "ask", "goal", "plan", "submit", "review", "seal", "judge", "sign", "shelve", "state", "verify", "doctor", "gate", "serve", "panel"];

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
