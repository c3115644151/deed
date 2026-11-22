# 现场的系统记录：人 + 多个 agent、一个仓库、连续几周，今天谁记着什么

> 目的：回答"这一类系统在软件架构里叫什么、占哪一层"。做法是把现场现有的每一种**系统记录**摆到分层史上（文件→VCS、构建→CI、基础设施→IaC、部署→GitOps、配置→声明式），看它拥有哪个唯一事实、明确不拥有什么、接口是什么；再看"跨会话的进度与授权"这个事实今天落在谁身上、为什么会漂。
> 纪律：一手材料优先（官方文档 / 规范 / 仓库源码），每条结论带 URL；正文由 JS 渲染或读不到正文的，标"标题级证据"或"未验证"。抓取时间 2026-11-23（Asia/Shanghai）。
> 口径：本文只讨论**架构位置**，不比对字段、命令、事件名。

---

## 0. 结论先行（约 300 字）

这一层今天没有主人。"跨会话的进度与授权"不是**一个**事实，是四格：谁提过（intent）、做到哪（progress）、谁定的（decision）、谁准的（authorization）。今天四格分居四处：issue tracker 记 intent/progress，ADR/RFC 记 decision，PR 审批 + 保护分支记 authorization，HANDOFF.md 与 agent 会话记 next step。每处只拥有自己那格，且都不是可重算的记录——issue 的编辑史可被作者或有写权限的人删除（GitHub 只保留 100 条中间编辑）；PR 的批准绑定平台算出的 diff state，dismiss 是一个开关而不是一条事件；ADR 的 status 是人手改的字段；会话 transcript 存在 `~/.claude` 且"entry format is internal ... changes between versions"。

所以缺口不是"缺工具"，而是**这四格事实没有一个共同的可复核载体**，于是判据分叉：文档说已定，tracker 说未做，PR 说已批，人的记忆说还要等某个东西。

deed 不是新的一层。按分层史，它是既有"过程记录层"的**载体替换**：GitOps 没有发明部署层，它把 desired state 放进 git 并让 agent 持续调谐；deed 把 decided state 放进 git 并让 fold 持续算"下一步"。它新拥有的只有一格：**授权**——谁判、判的是哪一份字节、判过之后改动是否作废。这一格今天确实无主。

---

## 1. 分层史的位置：这条线一直是"把某类事实搬进可版本化的载体"

四个先例，命名法完全一致（对象 + 载体 + 一个持续动作）：

| 既有层 | 对象 | 载体 | 持续动作 | 一手出处 |
|---|---|---|---|---|
| VCS | 源文件历史 | 内容寻址对象库 | 记录快照 | Pro Git：*Snapshots, Not Differences*；*Everything in Git is checksummed ... referred to by that checksum* |
| IaC | 机器与网络的定义 | 可执行的定义文件（shell/Ansible/Chef/Puppet） | 应用定义 | Fowler：*all configuration is defined in executable configuration definition files ... At no time should anyone log into a server and make on-the-fly adjustments* |
| GitOps | 系统的 desired state | git 里的声明 | agent 自动 pull + 持续调谐 | OpenGitOps：Declarative / **Versioned and Immutable**（"retains a complete version history"）/ Pulled Automatically / Continuously Reconciled |
| 配置/策略声明式 | 配置、策略 | 版本化配置 / policy 文件 | 每次启动或每次判定重算 | （同上族，本文不展开） |

这条线的共同点：**事实被搬到一个可 diff、可回滚、可离线取的载体上，然后由某个纯机制反复读取它**。deed 声称的是同一条动作，但搬的对象换成了"过程与授权"。

---

## 2. 现场的十一种记录，各占哪一格

### 2.1 git / VCS —— 拥有"树的内容与它的历史"，不拥有"为什么"

- Pro Git 原文：Git 把数据当**快照**而不是差异（*Snapshots, Not Differences*）；**一切先算校验和再存，并按校验和引用**（*Everything in Git is checksummed before it is stored and is then referred to by that checksum*）；**几乎所有操作本地完成**（*Nearly Every Operation Is Local*）。
- 它能回答：这一刻树里是什么、上一刻是什么、谁在哪个 commit 里写的（自述身份）。
- 它不能回答：这段改动是为了哪个承诺、做完了没有、谁批准放行、下一步谁动。commit message 是自由文本，不是字段。
- 它明确**不拥有**"进度"：一个 commit 存在，不等于它对应的任务被接受；反过来，任务被接受也不产生 commit。
- **关键性质（deed 借的就是这个）**：内容寻址 + 快照 = 任何后来的断言都能钉在"某一串字节"上，且可离线复算。

出处：https://raw.githubusercontent.com/progit/progit2/main/book/01-introduction/sections/what-is-git.asc

附：git 自带的"给对象挂注释"通道（`git notes`）——"Adds, removes, or reads notes attached to objects, **without touching the objects themselves**"，默认 ref `refs/notes/commits`。这证明"把元数据挂到不可变对象上并随仓库同步"是 git 的一等能力，不是外挂。
出处：https://git-scm.com/docs/git-notes

两个已把"流程"塞进 git 的先例（形态与 deed 同类，语义比 deed 浅）：

- **git-bug**：自述 "a bug tracker that ... is fully integrated in git ... is distributed ... works offline ... prevents vendor lock-in"。它证明"issue 可以在仓库里、可以 push/pull"，但它没有"谁判、判哪一版"。
  https://raw.githubusercontent.com/git-bug/git-bug/master/README.md
- **git-appraise**：自述 "code reviews are **stored inside of the repository as git objects**"，用 git-notes 承载评审，push/pull 自动合并。它证明"评审可以是仓库对象"，但批准是"acccept 一条 note"，没有绑定被审的那份字节的失效语义（详见 §2.5 的反面）。
  https://raw.githubusercontent.com/google/git-appraise/master/README.md

### 2.2 CI（GitHub Actions 等）—— 拥有"这次跑过没有、绿不绿"，不拥有"该不该做"

- 一次运行是**一次性的**："Each workflow run executes in a **fresh, newly-provisioned virtual machine**"。也就是说 runner 上的任何状态都不构成记录。
  出处：https://raw.githubusercontent.com/github/docs/main/content/actions/get-started/understand-github-actions.md
- 唯一留存下来的是**产物与日志**："An artifact is a file or collection of files produced during a workflow run. Artifacts allow you to **persist data after a job has completed**"。
  出处：https://raw.githubusercontent.com/github/docs/main/content/actions/concepts/workflows-and-actions/workflow-artifacts.md
- 这些留存是**管理员可配置且有上限的**：GitHub 组织设置里可配置 "checks, workflow runs, commit statuses, artifacts, and logs" 的 retention period——即它们不是仓库内容，不会随 clone 走。（标题级证据；正文客户端渲染未取到）
  https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization
- 它的接口只有一格：**某个 commit 的 status**。保护分支原文："Required status checks must have a `successful`, `skipped`, or `neutral` status before collaborators can make changes to a protected branch."
  出处：https://raw.githubusercontent.com/github/docs/main/content/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches.md
- 所以 CI 是**判据的输入**，不是判据本身：它说"能编译、测试过"，不说"这段该不该合"。

### 2.3 issue tracker（GitHub Issues / Linear / Jira）—— 拥有"有人提过、现在什么状态"，不拥有"证据"

- GitHub 官方定位："You can create issues in your repository to **plan, discuss, and track work**"。
  出处：https://raw.githubusercontent.com/github/docs/main/content/issues/tracking-your-work-with-issues/learning-about-issues/about-issues.md
- **它自己承认记录可被抹**：issue 描述的编辑史"is available **unless the author or a person with write access removes it**"；评论的编辑史里，"Comment authors and anyone with write access to a repository can **delete sensitive information**"，且"GitHub retains a **maximum of 100 edits** per content item. When an item exceeds this limit, the oldest intermediate edits are **automatically removed**"。
  出处：https://raw.githubusercontent.com/github/docs/main/content/issues/tracking-your-work-with-issues/using-issues/editing-an-issue.md
  https://raw.githubusercontent.com/github/docs/main/content/communities/moderating-comments-and-conversations/tracking-changes-in-a-comment.md
- 架构后果：issue 的"状态"是**一行可变字段**，历史是**厂商侧的事件流**（REST: issue events），不是仓库里的字节；谁能改、改过什么、删过什么，取决于平台的权限模型与保留策略，与代码是否一致无关。Linear / Jira 同类（Linear 文档索引列出 Issues/cycles/workspace 等概念：https://linear.app/docs；Jira 的 changelog 是服务端 API，具体字段未逐字核 → 未验证）。
- 它明确**不拥有**："这段做完了"的证明。close 是一个人（或一个关键词）做出的判断，锚点是**字段**，不是**内容指纹**。

### 2.4 文档与决策记录（ADR / RFC / spec 目录）—— 拥有"当时为什么这么定"，不拥有"现在还算不算数"

- ADR 的定义："An Architectural Decision Record (ADR) **captures a single AD and its rationale** ... The collection of ADRs ... constitute its **decision log**"。这层已经把自己的名字叫"log"，但载体是**一篇一篇文档**，状态靠人改 Status 字段。
  出处：https://adr.github.io/
- Oxide 的 RFD 把状态写成文档头部元数据（AsciiDoc）：`:state:` 必须是六态之一 —— prediscussion / ideation / discussion / published / committed / abandoned；`:discussion:` 是一个指向 PR 的链接。**状态在文件里，判定在人的脑子里，讨论在 PR 里**。
  出处：https://rfd.shared.oxide.computer/rfd/0001
- Kubernetes KEP 同一形状：`status` **Must be one of** provisional / implementable / implemented / deferred / rejected / withdrawn / replaced。
  出处：https://raw.githubusercontent.com/kubernetes/enhancements/master/keps/sig-architecture/0000-kep-process/README.md
- Rust RFC 是"文档 + PR 上的一次动议"："a member of the subteam will propose a '**motion for final comment period**' (FCP), along with a *disposition* for the RFC (merge, close, or postpone)"；RFC 合入 RFC 仓库后才"active"。
  出处：https://raw.githubusercontent.com/rust-lang/rfcs/master/README.md
- 架构缺陷（位置缺陷，不是功能缺陷）：**决定的事实被写进了一篇不可计算的文档**。文档可以被后来者改状态、可以被 supersede 但不留事件、可以根本没写；"这条决定还成立吗"无法从数据算出，只能再读一遍文档并祈祷 Status 是最新的。判据因此分叉：`DESIGN.md` 说 A，三个月前的 ADR 说 B，代码说 C。

### 2.5 PR 审批 + 保护分支 —— 拥有"某一份 diff 被谁批过"，不拥有"批过之后还算不算"

这是今天最接近 deed 那一格的东西，也最能说明它为什么不够：

- GitHub 原文："**GitHub records the state of the diff at the point when a pull request is approved. This state represents the set of changes that the reviewer approved.** If the diff changes from this state ... " —— 即批准绑定的是**平台自己算出的 diff state**，不是评审者能离线复算的内容指纹。
- 失效是**开关而不是事件**："Optionally, you can choose to **dismiss stale pull request approvals** when commits are pushed ..."；而这个开关默认不必开。
- 更硬的一条："If a reviewer who requests changes on a pull request isn't available, **anyone with write permissions for the repository can dismiss the blocking review**." —— 阻塞可以被有写权限的人单方面解除，且这是权限操作，不进仓库。
- 门槛本身（需要几人、要不要 CODEOWNERS、要不要签名）也在服务端设置里，不在仓库里；"为什么是这条门槛"没有记录。
  出处：https://raw.githubusercontent.com/github/docs/main/content/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches.md
- 结论：PR 层拥有"authorization"这一格的一半（**批过**），另一半（**批的是哪一份、还能不能算数、当时门槛是什么**）漂在平台状态里；跨会话、跨工具、离线一律读不到。

### 2.6 agent harness 自身（Claude Code / Codex / Cursor 的本地会话与 todo）—— 拥有"这台机器上这一次聊了什么"，不拥有"这个仓库现在到哪了"

- 会话是**本地文件、绑目录、格式会变**：Claude Code "A session is a saved conversation **tied to a project directory**. Claude Code stores it **locally** as you work"；transcript 在 `~/.claude/projects/<project>/<session-id>.jsonl`，且"**The entry format is internal to Claude Code and changes between versions**, so scripts that parse these files di..."。
  出处：https://code.claude.com/docs/en/sessions.md
- 配置与记忆分两处：项目文件"Commit project files to git to share them with your team"，`~/.claude` 是"**personal configuration** that applies across all your projects"（含 auto memory）。
  出处：https://code.claude.com/docs/en/claude-directory.md
- 厂商自己把"失忆"写在第一句：Cursor 文档 —— "**Large language models don't retain memory between completions. Rules provide persistent, reusable context at the prompt level.**"；项目规则放 `.cursor/rules`、"version-controlled"。
  出处：https://cursor.com/docs/rules
- 规则文件是**静态指令**不是状态：AGENTS.md 自述 "A simple, open format for guiding coding agents ... Think of AGENTS.md as a **README for agents**"。
  出处：https://agents.md/
- 架构后果：agent 的"进度"活在**会话**里（易失、换机即失、换工具即失），"规则"活在**仓库里的静态文件**里（不带状态）。两者之间没有桥——所以每个新会话都要重新问"我们做到哪了"，而答案只能从 git log + 人的记忆 + 一堆 markdown 里重建。这正是 HANDOFF.md 这类文件存在的原因，也是它必然过期的原因。

### 2.7 团队协作工具（Notion / Confluence / 飞书）—— 拥有"有人写过一页"，不拥有"这页还是不是事实"

- Confluence 有 Page History / Page Comparison（可看版本、可比较、可回退）——说明**版本是平台功能**，不是仓库内容。（标题级证据：https://confluence.atlassian.com/doc/page-history-and-page-comparison-views-139379.html）
- 这一类工具的形态是**可编辑页面 + 平台侧版本**：页面永远是"最新的一版"，读到的是渲染结果；哪句话被谁在什么时候改掉，只有平台知道，且不随仓库走。Notion / 飞书同类（具体保留策略与 API 细节未验证）。
- 架构后果：把"下一步做什么"写进 wiki，等于把**状态**放进一个**以叙述为主、无判据、无失效语义**的载体；任何读者读到的都是某个时刻的快照，且无法判断它是否已被后来的决定取代。

### 2.8 包与依赖锁（lockfile）—— 拥有"这份树被解析成了什么"，不拥有"为什么升"

- `package-lock.json` 是 npm 官方定义的"**A manifestation of the manifest**"（页面 meta description），即 package.json 的**确定性展开**；`npm ci` 以它为准做冻结安装。（正文客户端渲染，语义未逐字核对 → 部分未验证）
  出处：https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json
- 这一层是**分层史里最干净的样板**：一个纯派生物（derived artifact），可从输入重算，随仓库提交，diff 即变更。它证明"派生物进仓库"是可行的、且已工业化。
- 但它**只覆盖依赖图这一格**：谁为什么允许升级、这次升级批准过没有，lockfile 一个字都不记。它和 deed 的关系是**结构上的近亲**（都是"可重算的派生物"），**语义上的外人**（不含人）。

### 2.9 "人的口头决定" —— 拥有"当下对齐"，不拥有"任何可复核的东西"

- Anthropic 官方 best practices 把这类东西列在"agent 看不见、默认也猜不到"的第一位："**A deploy process that lives in someone's head**"。
  出处：https://code.claude.com/docs/en/best-practices.md
- 口头决定的架构位置：它是**唯一的零延迟、零成本载体**，所以永远是第一选择；它也是**唯一没有任何残余**的载体，所以每次跨会话都要重新加载一遍人的记忆。
- 后果不是"忘了"，是"**无法区分『没说过』和『说过但我不知道』**"。任何下游（tracker、文档、PR）都无法引用它，因为它没有地址。

### 2.10 HANDOFF.md / NOTES.md 这一类"交接便条" —— 拥有"昨天那个人记得的事"，不拥有"它是否仍然为真"

- 它是 2.6 与 2.9 的**补丁**：把会话里的东西抄进仓库，好让下一个会话看到。它在形态上已经接近"仓库内的过程记录"，差的是三件事：**只追加**（它被覆盖写）、**有判据**（它只是一段话）、**有一处下一步**（它和 issue、PR、TODO 并列，谁都能写）。
- 这一条不引外部材料：它是本仓库自己的 `HANDOFF.md` 与 §2.6 的直接推论。**判断**：交接便条是"层的替身"，不是层；它出现得越频繁，越说明那一格事实没有主人。

### 2.11 账本（deed 声称的载体）—— 拥有"已决事实"，不拥有"代码、构建、需求、身份"

- 它的形态与 §2.8 同族：**只追加的事件 + 纯函数折叠出的状态**；差别是折叠的对象不是依赖树，而是"承诺 / 交付 / 判决 / 签收"。
- 它的接口只有两个方向：**读**——一行"下一步 · 谁 · 做什么"；**写**——一条事件（`tick` / `task add` / `task done` / `review` / `judge` / `sign`）。
- 它明确**拒绝拥有**：代码内容（git 有）、构建结果（CI 有）、依赖解析（lockfile 有）、需求优先级与验收（人 有）、身份真伪（它只记自述："身份是约定不是鉴权"）、知识的解释（文档 有）。

---

## 3. 必须给的那张表：层与层之间（README 用）

判断标准只用三条：**它拥有哪个唯一事实 / 它明确不拥有什么 / 当"跨会话的进度与授权"需要主人时，今天落在谁身上、为什么漂。**

| 层 | 它拥有的唯一事实 | 它明确不拥有 | "跨会话进度与授权"落在这层的哪一格 | 为什么会漂（谁都能改 / 改了什么没人知道 / 重算不出来） |
|---|---|---|---|---|
| **git / VCS** | 某一刻树里是哪串字节（内容寻址，可离线复算） | 为什么改、做完没有、谁准的 | 只提供**锚点**（commit / 文件字节），不提供语义 | 不算漂：内容不可改，只能新增。缺的是"这条 commit 对应哪个承诺"，而 commit message 是自由文本 |
| **CI（Actions 等）** | 这一次在某个 commit 上跑过、绿不绿 | 该不该做、做完算不算数 | 只提供**一格输入**（status check 是否 success） | 运行是一次性 VM，日志/产物按组织策略保留且有上限；platform 侧，不随 clone 走；重跑就换一批事实 |
| **issue tracker（Issues/Linear/Jira）** | 有人提过这件事、现在被标成什么状态 | 交付证据、判决、门槛 | 今天**默认的进度主人**（open/closed、assignee） | 状态是一行可变字段；编辑史可被作者或有写权限的人删除，超 100 条中间编辑自动丢；历史在厂商事件流里，不在仓库里 |
| **ADR / RFC / spec 目录** | 当时为什么这么定（rationale） | 现在还算不算数、下一步谁动 | 今天**默认的决定主人**（Status 字段 / FCP 动议） | 状态是人手改的字段；被 supersede 不留事件；文档与代码可以各说各话，且没有任何东西会把两者对账 |
| **PR 审批 + 保护分支** | 某一份 **diff state** 被谁批过 | 批的是哪串字节、批过之后改动是否作废（默认不作废） | 今天**最接近授权的载体**，也是漂得最隐蔽的一格 | 批准绑定平台算出的 diff state，不是可离线复算的指纹；dismiss stale approvals 是可选开关；有写权限的人可单方面 dismiss 阻塞评审；门槛配置在服务端 |
| **agent harness（Claude Code / Cursor / Codex）** | 这台机器上这次会话说了什么 | 这个仓库现在到哪了、谁允许继续 | 提供**执行**，不提供**记录**（transcript 在 ~/.claude，格式随版本变） | 绑定机器与目录；`~/.claude` 是个人配置不随仓库走；transcript 格式"internal ... changes between versions"；换 agent 即失忆 |
| **AGENTS.md / CLAUDE.md / .cursor/rules** | 静态规则（怎么干活） | 任何状态（干到哪、谁准的） | 只提供**约束**，明确不提供进度 | 它是文档：谁都能改，改了不产生事件；agent 每次重读，读到的都是"最新"，无法知道上一版说了什么 |
| **团队文档（Notion/Confluence/飞书）** | 有人写过这一页 | 这页是否仍为事实、谁批准的 | 常被当作**决定与进度的实际主人**（最常见、最危险） | 页面永远呈现最新一版；版本是平台功能；无判据、无失效语义；与代码/PR 无对账关系 |
| **包与依赖锁（lockfile）** | 这份依赖树被解析成了什么（可重算的派生物） | 为什么升、谁准的 | 不落这一格（纯结构事实） | 不漂：可从 package.json 重算、随仓库走。它是"派生物进仓库"的样板，但没有人的语义 |
| **口头决定** | 当下对齐（零延迟、零成本） | 一切可复核的东西 | 今天**真正的最终主人**（"这一步要不要现在判"往往只在这里有答案） | 没有地址：下游无法引用；跨会话只能重新加载人的记忆；无法区分"没说过"与"说过但我不知道" |
| **HANDOFF.md 类交接便条** | 昨天那个人记得的事 | 它是否仍然为真、是否被后来的决定取代 | 层的**替身**：谁都能写、谁都能覆盖 | 覆盖写、无事件、无判据；与 issue/PR/TODO 并列，等于又开了一条"下一步"的来源 |

**这张表要说的一句话**：十一种记录里，没有一个同时拥有"承诺 / 交付 / 判决 / 授权"四格；也没有一个能回答"判过之后改动是否作废"。所以跨会话时，进度靠 tracker、决定靠文档、授权靠 PR、下一步靠人的记忆——四者之间没有共同载体，也就没有共同判据。

---

## 4. 判定：deed 是新的一层，还是既有层的另一种实现

按三条架构标准逐条判：

1. **它拥有哪个事实？**
   唯一新增的是"**授权**"这一格的可复核形态：谁判、判的是哪一份字节（内容指纹）、判过之后这一份是否被改动（= 判决是否作废）。这一格今天在 PR 层只有一半，且那一半不可离线复算。→ **不是新事实，是旧事实被搬到了可重算的载体上。**
2. **它拒绝拥有哪些事实？**
   代码（git）、构建（CI）、依赖（lockfile）、需求与优先级（人）、身份真伪（鉴权层）、知识解释（文档）。拒绝得很干净——它不是"又一个 tracker"，因为它拒绝拥有 assignee、优先级、排期、附件、富文本。→ **这正是一个"层"该有的样子：窄到能一句话说清不拥有什么。**
3. **它向上下层暴露什么接口？**
   向下：只写"事件"（一行 JSONL）与"内容指纹"（sha256），不碰宿主的任何文件；向上：只读一行"下一步 · 谁 · 做什么"。中间没有第二个真值源。→ **接口窄到可以夹在 git 与 agent 之间，不需要任何服务端。**

**结论**：deed 不是"新的一层"，而是**既有"过程记录层"的一次载体替换**——和 GitOps 对部署层做的那件事同构：

- GitOps：把 **desired state** 从"人点控制台/跑脚本"搬进 git，由 agent 持续调谐；
- deed：把 **decided state** 从"tracker 字段 + 文档状态 + PR 批准 + 人的记忆"搬进 git，由 fold 持续算"下一步"。

它不是新层，理由是：它没有引入任何**新的抽象**（事件、折叠、指纹、判决都是既有词汇），也没有改变上下层的职责边界。它改变的是**这一层的事实所有权**：从"四个 SaaS 各持一格 + 一个人的记性"变成"仓库里一份可重算的记录"。层级史上，载体替换从来就是"看起来像新层"的那种变化。

**但要诚实说一句它确实新增的东西**：把"授权"降级为**事件**而不是**权限**。PR 层的授权是权限操作（dismiss 是权限、门槛是设置），deed 的授权是账本里的一条记录，且不许与交付同手（"交付过这一段的 by 不能判这一段"）。这一条在今天的任何既有层里都找不到等价物——**这是它唯一可能构成"新层"的地方，也是最该被质疑的地方**：一条自述身份的事件，凭什么算授权？deed 自己的答案是"不算鉴权，只算可回溯"，这等于承认它只拥有"授权**记录**"，不拥有"授权**效力**"。所以更准确的说法是：**deed 拥有"授权记录"这一格；"授权效力"仍然在平台权限模型里，没有被替代。**

---

## 5. 这一层如果成立，它该叫什么

命名要跟分层史的语法对齐：既有层都是"**对象 + 载体 + 一个持续动作**"。所以候选必须能填满这句：

> `<对象>` 的 `<载体>`，由 `<机制>` 持续 `<动作>`。

- GitOps 填的是：部署的 **desired state**，放在 **git** 里，由 **agent** 持续**调谐**。
- deed 要填的是：过程的 **decided state**，放在 **git** 里，由 **fold** 持续**算下一步**。

据此，三个名字，按推荐度排：

1. **已决状态（decided state）／已决层**——最准确，且与 desired state 并列成一句可背的话：*desired state 说系统该是什么样，decided state 说人已经允许它是什么样*。缺点：中文"已决"略生造，但语义无歧义。
2. **工作台账（work ledger）／台账层**——行业里已经在用（Beads/Hive 的 work ledger），中文读者一看就懂"只追加、可对账"。缺点：现有用法多指调度队列（claim/close），与"判决"不同，需要在 README 里一句话切开。
3. **议事层（deliberation layer）**——贴合 deed 自己的"议事与执行机制"，也点出"判决"这一格。缺点：听起来像会议系统，容易被误读成协作工具。

**建议**：对外用一个组合，别只用一个词：

> **已决层（decided state）——一份只追加的工作台账，记录"谁承诺、谁交了、谁判了、谁准了"。**

一句话定位（README 开头可直接用）：**它不是项目管理系统，它是这一层的账本：进度、决定、授权是同一份记录的不同投影，下一步只有一处。**

---

## 6. 边界清单（给 README 的"层与层之间"段落，可直接改写）

- **与 git 的边界**：git 拥有字节与历史；deed 只读仓库、只写 `.deed/`，把每次交付钉在一个 sha256 上，从不改写 git 的历史。
- **与 CI 的边界**：CI 拥有"能不能过"；deed 拥有"过不过算不算数"——门槛（gates）由账本里的 `config.change` 折叠出来，改门槛必须带 `--why` 并进账本。
- **与 issue tracker 的边界**：tracker 拥有"有人提过、现在什么状态"；deed **不**拥有 assignee、优先级、排期、附件。它只拥有"这一段承诺了什么、做到哪、判了没有"。
- **与 ADR/RFC 的边界**：ADR 拥有"为什么"；deed 拥有"算不算数"。两者可以并存：ADR 解释理由，账本记"这条决定被谁在什么时候收下/推翻"。
- **与 PR 审批的边界**：PR 拥有 diff 与批准动作；deed 拥有"批准绑定的是哪一份字节、之后改动是否让批准作废"。前者是权限，后者是记录。
- **与 agent harness 的边界**：harness 拥有执行与会话；deed 拥有跨会话的"下一步"。harness 换掉、会话清空，账本不变。
- **与文档/wiki 的边界**：文档拥有解释；deed 拥有状态。文档可以错、可以旧，账本必须能算。
- **与 lockfile 的边界**：lockfile 是可重算的派生物，deed 是只追加的记录；形态同族（都进仓库、都可 diff），语义不同（一个没有人的位置）。
- **与人**：人拥有目标、优先级、验收和最终决定；deed 只记"人说过什么"，不替人决定。

---

## 7. URL 清单（一手材料）

1. Pro Git（snapshots / checksum / local）— https://raw.githubusercontent.com/progit/progit2/main/book/01-introduction/sections/what-is-git.asc
2. git-notes（notes attach to objects without touching them）— https://git-scm.com/docs/git-notes
3. git-bug README（bug tracker inside git，offline，distributed）— https://raw.githubusercontent.com/git-bug/git-bug/master/README.md
4. git-appraise README（reviews stored as git objects）— https://raw.githubusercontent.com/google/git-appraise/master/README.md
5. GitHub Actions：Understand（fresh VM per run）— https://raw.githubusercontent.com/github/docs/main/content/actions/get-started/understand-github-actions.md
6. GitHub Actions：Workflow artifacts（persist after job）— https://raw.githubusercontent.com/github/docs/main/content/actions/concepts/workflows-and-actions/workflow-artifacts.md
7. GitHub：retention period for checks/workflow runs/statuses/artifacts/logs（标题级）— https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization
8. GitHub：About protected branches（diff state 绑定 / dismiss stale / 有写权限者可 dismiss 阻塞 / required status checks）— https://raw.githubusercontent.com/github/docs/main/content/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches.md
9. GitHub：About issues（plan, discuss, track）— https://raw.githubusercontent.com/github/docs/main/content/issues/tracking-your-work-with-issues/learning-about-issues/about-issues.md
10. GitHub：Editing an issue（编辑史可被作者/有写权限者移除）— https://raw.githubusercontent.com/github/docs/main/content/issues/tracking-your-work-with-issues/using-issues/editing-an-issue.md
11. GitHub：Tracking changes in a comment（最多 100 条编辑，超出自动丢最旧）— https://raw.githubusercontent.com/github/docs/main/content/communities/moderating-comments-and-conversations/tracking-changes-in-a-comment.md
12. ADR（captures a single AD and its rationale；collection = decision log）— https://adr.github.io/
13. Oxide RFD 0001（六态；`:state:` 元数据）— https://rfd.shared.oxide.computer/rfd/0001
14. Kubernetes KEP process（status 七态）— https://raw.githubusercontent.com/kubernetes/enhancements/master/keps/sig-architecture/0000-kep-process/README.md
15. Rust RFC process（FCP 动议 + disposition；合入即 active）— https://raw.githubusercontent.com/rust-lang/rfcs/master/README.md
16. OpenGitOps Principles（Declarative / Versioned and Immutable / Pulled / Reconciled）— https://raw.githubusercontent.com/open-gitops/documents/main/PRINCIPLES.md
17. Fowler：Infrastructure As Code（定义文件；不许登录服务器手改）— https://martinfowler.com/bliki/InfrastructureAsCode.html
18. Claude Code：Manage sessions（本地 transcript 路径；格式随版本变）— https://code.claude.com/docs/en/sessions.md
19. Claude Code：.claude directory（项目文件提交进 git；~/.claude 是个人配置/auto memory）— https://code.claude.com/docs/en/claude-directory.md
20. Claude Code：Best practices（"A deploy process that lives in someone's head"）— https://code.claude.com/docs/en/best-practices.md
21. Cursor：Rules（"LLMs don't retain memory between completions"；.cursor/rules 版本化）— https://cursor.com/docs/rules
22. AGENTS.md（"a README for agents"）— https://agents.md/
23. npm：package-lock.json（"A manifestation of the manifest"；正文客户端渲染，未逐字核对）— https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json
24. Confluence：Page History and Page Comparison（标题级）— https://confluence.atlassian.com/doc/page-history-and-page-comparison-views-139379.html
25. Linear Docs 索引（Issues / cycles / workspace；细粒度未验证）— https://linear.app/docs
26. Wikipedia：System of record（"authoritative data source for a given data element"）— https://en.wikipedia.org/wiki/System_of_record
27. GitHub REST：issue events（历史在厂商侧事件流，字段未逐字核）— https://docs.github.com/en/rest/issues/events

## 8. 未验证 / 需补

- GitHub Actions retention 的**默认天数**（正文客户端渲染未取到；只确认"可配置保留期"这一事实）。
- Jira / Linear 的 issue 变更历史（changelog / activity）具体保留策略与 API 字段——只确认它们存在，未逐字核。
- Notion / 飞书的版本历史保留策略（未取到可引用正文）。
- npm 文档正文"describes the exact tree ... identical trees"一句（页面 JS 渲染，仅取到 meta description）。
- PR 审批绑定的是 diff state 的**平台内部表示**（非内容哈希）——由官方这句话推出，未见其数据结构说明。

---

## 9. 一句话给 lead

**这一层今天由四个 SaaS 的一个字段加一个人的记性代理着；deed 不是新层，是把这四格收进一份可重算台账的载体替换，唯一真正新拥有的格是"授权记录"（不是"授权效力"）。名字建议：已决层（decided state）／工作台账（work ledger）。**
