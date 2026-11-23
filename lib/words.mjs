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
  "- 每轮对话先 `deed tick --who user|agent --said \"…\" --did \"…\"`；会话跟着轮次自己开合，不用手动建。",
  "- 要做事先 `deed task add \"承诺\" --criteria \"做完的标准\" --files core/a.mjs,cli/b.mjs`（逗号分隔、正斜杠）；做完 `deed task done <T> --evidence \"命令与结果\" --digest <工作区里的文件>`。",
  "- 拿不准就问 `deed ask \"…\" --reading \"我理解成…\" --why \"为什么得你定\"`，只有用户能 `ask resolve`。",
  "- `deed state` 只说下一步是谁；照着做，不要自己另排优先级。",
  "- 要审的段：`deed review --segment S0x.N` 出任务书（记一条 `review.brief`，不写结论），审查者照它落 `--by \"谁\" --verdict pass|fail`；结论要求这一段已经全部交付（还有未做的会被拒），并且是这一段的最后一份结论。",
  "- 只有交出去过的任务书才能被回答：没出过任务书就落结论会被拒；交出去之后那份字节被改过、或文件不在了，结论也落不下来（`deed review --segment S0x.N` 另出一份，旧的那条记录留着让 `verify` 报）。",
  "- 结论钉的是交出去那一刻的 sha256（`briefDigest`，必填），不是落结论时现写的一份；`deed verify` 会重算核对。",
  "- 判决 `deed judge --pass --by 「谁」`／`deed judge --rework T1,T2 --why 「为什么」 --by 「谁」`，签收 `deed sign --words 「用户原话」 --by 「谁」`：人在终端里敲可以省 `--by`（账本记 user），从管道里跑必须写清谁按的。",
  "- 身份是约定不是鉴权：`--by`、`who` 记的是自述，账本保证「谁说过什么」可回溯，不保证「说的人是谁」；它能做的只有一件事——不替任何动作填名字。",
  "- 交付证据每条都带 `--digest <工作区里的文件>`：说得清做了什么，也钉得住当时的内容；没钉的证据仍在账本里，但会挡住要审段的判决。",
  "- 查：`deed verify`（证据与指纹）、`deed doctor`（账本能否折叠）、`deed serve`（本机只读面板）。",
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
