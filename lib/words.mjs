// words: what the workspace tells a person or an agent about deed.
//
// deed never writes here. The ledger is deed's own; a repository's AGENTS.md
// belongs to whoever governs that repository, and silently editing it would be
// exactly the kind of side effect a tool should not have. What deed can do is
// notice that the file never mentions it -- an agent that has not been told
// where to ask "what is next" will invent its own answer -- and print a block
// the owner can paste where their own rules live.

import fs from "node:fs";
import path from "node:path";

// The files an agent actually reads at the start of a turn. Both are optional:
// a workspace may govern itself with either, neither, or something else
// entirely, so a missing file is a hint rather than a fault.
export const WORDS = ["AGENTS.md", "CLAUDE.md"];

// The command that has to be discoverable. Mentioning "deed" in passing is not
// enough -- an agent needs to know which verb answers "where are we".
const MARK = /deed\s+state/u;

export const BLOCK = [
  "## 治理",
  "- 用户每说一轮先 `deed say \"…\"`：said 是位置参数，没有 `--who`——轮次只有人开口的那一轮，我自己的进展写进交付记录（`deed submit`）或结论（`deed review`）。会话跟着轮次自己开合，不用手动建。",
  "- 要做什么先 `deed plan`：从账本出一份清单草稿 `.deed/plan.md`（每段的任务、标准、交付记录）。在文件里加条目、写标准，改完 `deed submit` 一次记账；整批原子——有一行不合格，一个字都不落。清单里可以写好几节 `## 段`：一节就是一个段，空标题的那一节 submit 时领号、排在后面；只有收活的那一段能交付，前一段判过它才接过活。",
  "- 清单上的写法：`- ? 标题` + 一行 `  标准：` = 新条目（submit 领号）；`- [x] T1 标题` + 一行 `  交付：跑了什么、结果几比几` = 交付；把它改回 `- [ ]` + `  理由：` = 撤回最后那条交付；`~~ T3 标题` + `  理由：` = 放弃；`  延后：什么时候` = 延后；`  改到下一段：原因` = 这条没做的落到下一段（清单里排好的那一节；没排就先加一节，否则会被拒）。说错了话就把勾去掉，别把话说圆。",
  "- 清单上已有的条目改了标题或标准会被整批拒：还没有 amend，改就是开一条新条目，旧的留着。新条目不能在同一次里勾上交：任务要先记账，做完再勾。",
  "- 每轮讨论里值得留下的判断，用 `deed point \"…\" --by \"谁\"` 记一条要点：要点没有状态，写下来就在；原文由系统记（`deed say`），你不要抄写原文。散着的要点攒够了，用 `deed topic \"标题\" --points P1,P2 --body \"统合后的正文\" --by \"谁\"` 统合成议题；正文没想好就先别开。",
  "- 议题有两次确认，都在面板上按：先确认成立（要点被收编，界面上不再散着显示，但账本里还查得到），再确认出口（锁定，才允许把它拆成清单里的任务）；命令行不代替这两下。",
  "- 拿不准就问 `deed ask \"…\" --reading \"我理解成…\"`：待裁只记「我不确定的是什么」，--why 与 --reading 是同一件事。只有人裁：`deed ask answer A1 --decision \"结论\" --by \"谁\"`；不做这件事就 `deed ask drop A1 --why \"为什么\"`。裁定里能带两行：`边界：…`（以后不许这么干）与 `弃：…`（这件事不做了）——它们不进清单，跟着那句话留在这期的账里。",
  "- `deed state` 只说下一步是谁；照着做，不要自己另排优先级。",
  "- 这一期要做成什么，写在清单第一行（`# 这一期要做成什么` 下面那一句），`deed submit` 记账；可以改，旧的那句留在历史里。签收拿它当尺子。",
  "- 要审的段：`deed review --segment S0x.N` 出清单与角色包——清单（审什么）与角色包（怎么审），记一条 `review.brief`，不写结论；结论要求这一段已经全部交付（还有未做的会被拒）。",
  "- 只有发出去过的清单才能被回答：没发过清单就落结论会被拒；清单丢了、或账本里没有它发出去那条记录，结论也落不下来（`deed review --segment S0x.N` 另出一份，旧的那条记录留着）。",
  "- 结论回答的是发出去那一份清单与角色包：账本记的是这两份文件的路径，不是它们的指纹。",
  "- 审查者判的是「这一段通不通过」：`deed review --segment S0x.N --by 「谁」 --verdict pass --result T1=met`（每条标准一个判定；`--result-all met` 是省写）通过之后这一段**还在**，它被交回给你——判过之后这一段的结局才落下来（在面板上按「判决通过」）。判不通过要 `--verdict fail --rework T1,T2 --why 「为什么」`：被点名的条目回到未做，其余保持交付，这一段不关闭。清单每份都列全部条目：判过的也列出来，改没改过由审查者当场看。",
  "- 清单发出去、还没人回答的这段时间，这一段冻结：交付与撤回交付不收（新活落进下一段）；记轮次、记要点、放弃、改到下一段照旧。要改这一段的活就先撤回这份清单：`deed review --segment S0x.N --withdraw --why 「为什么」 --by 「谁」`。",
  "- 审查分两层，判决在中间：审查者的 pass 只是把这一段交回来，你在面板上按「判决通过」这一段才关闭（免审段由 `deed review --skip` 封）；各段都判过之后，这一期做成的样子还要有人审——`deed review --all` 是期审，判的是目的与各段之间说不说得通，不重判段里的条目。期审通过才轮到你签收。段审一直用同一双手（清单交给谁，结论由谁落）；期审每次都换一双手。",
  "- 人只在面板上出手：在验收屏写下原话按「签收这一期」（`deed sign` 在命令行上只回一句「去面板上按」，不记账——账本要读得出是人按的：`by` 与 `via: panel`）。审查的结论不归你改：判错了由审查机制自己回答。",
  "- 审查设置说这一段不用审（改动只落在免审路径）：`deed review --segment S0x.N --skip --why 「凭什么不审」` 封这一段。它不是结论，签收时这一段会被列成「没经过审查」。一段的结局只由审查者的结论落；`sign` 在命令行上只回一句「去面板上按」，不记账。",
  "- 身份是约定不是鉴权：`--by`、`who` 记的是自述，账本保证「谁说过什么」可回溯，不保证「说的人是谁」；它能做的只有一件事——不替任何动作填名字。",
  "- 在清单里勾上时不用挑文件：`submit` 按工作区快照前后差自己算碰了哪些文件（只记路径与字节数，不记内容）。没记下文件的交付仍在账本里，但会挡住要审段的放行。",
  "- 交付记录里的数字要在你要交的那份字节上跑出来：`deed submit --run <命令>` 真跑一遍，条数由工具采进账本，记录里那一对数字与它不一致整批拒。说得出现象的配一行 `期望：<命令> => 要看到的话`，记账前真跑；跑不出来就是假记录；两样都没配的，清单上标成「只是说法」，不算可核的事实。",
  "- 这个工作区是不是项目，说一句就算：`deed project --shape software --layers \"core:,lib:core\" --background \"是什么、为谁、不做什么\" --by \"谁\"`；没声明就是工作区模式，三种状态照常。`deed check` 看通过几条（只读，不挡任何动作）。",
  "- 查：`deed check --ledger`（账本能否重放）、`deed check --gates`（跑配置里的门）、面板（跟着命令自己起，`deed panel` 看它在不在）。",
  "",
  "没有落进账本的动作不算发生过；状态是推出来的，不用手写。",
].join("\n");

// Returns the one sentence a workspace needs to hear, or null when its rules
// already name the command. Read-only: no file is created, nothing is repaired.
export function wordsNotice(root) {
  const found = WORDS.map((name) => path.join(root, name)).filter((file) => fs.existsSync(file));
  if (found.length === 0)
    return "这个工作区没有 AGENTS.md：加一段 deed 的用法，人或 agent 才知道下一步问谁（deed init --print-agents 打印可粘贴的一段）";
  for (const file of found) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (MARK.test(text)) return null;
  }
  return (
    path.basename(found[0]) + " 里没提 deed state：人或 agent 会自己编一个「下一步」（deed init --print-agents 打印可粘贴的一段）"
  );
}
