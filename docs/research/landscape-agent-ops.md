# 领域调研：给编码 agent 用的任务 / 记忆 / 编排 / 长跑系统

> 目的：给 deed 的定位与 README 叙事找证据与反证。抓取时间 2026-11-22 前后，各条目版本/日期随文标注。
> 纪律：只用官方文档、仓库源码/README、release 记录；营销页只用于识别"它们怎么称呼自己"。拿不准的一律标"未验证"，不填空。
> 判断口径（每题都按这六问记）：①状态存哪 ②有没有 append-only / 事件溯源 ③状态能否从历史重算 ④任务与"证据"的关系（是不是只有一个勾）⑤谁有权说"完成了" ⑥多 agent 之间怎么知道对方做了什么 ⑦离线可用性 ⑧是否需要常驻进程 / MCP server。

---

## 0. 一句话结论

这一片的**主流共识确实是"任务/会话状态放数据库或 SaaS"**——Beads 用 Dolt、LangGraph 用 checkpointer（SQLite/Postgres/Agent Server）、Temporal/Restate/Inngest 用自家服务端 journal、Devin/Cursor/Codex/Copilot/Factory 用云 VM + 厂商后端。但"共识"只覆盖了**多机、多 agent、长跑**那一半；**单仓、一个人 + 几个 agent** 那一半反而以文件为主（Taskmaster 的 tasks.json、Claude Code 的本地 task 目录与 transcript、Conductor 的本地 app）。所以 deed 的立足点不在"用不用数据库"，而在**"判决"是不是一等事件、以及状态能不能丢弃重算**——这两件事我在整片里没有找到同时具备的同类，最接近的不是 agent 工具，而是 in-toto（职责分离 + 材料/产物哈希）和 git-appraise（评审即仓库对象）。

---

## 1. 横向矩阵（只填有出处的事实）

| 系统 | 状态存哪 | append-only / 事件溯源 | 能从历史重算 | 任务与证据 | 谁判"完成" | 多 agent 互知方式 | 离线 | 常驻进程 / MCP |
|---|---|---|---|---|---|---|---|---|
| **Beads** v1.4.0-rc.4 (2026-11-20) | 本地 **Dolt** 数据库（源真相）；`.beads/issues.jsonl` 只是导出 | 否 | 否（查询靠 SQL） | 无 evidence 概念，只有 status | agent 自己 `bd close` | `bd update --claim` 原子领取 + comments + merge-slot | 可（本地库） | 不需常驻；有 beads-mcp，但非必需；**零依赖不成立**（要 Dolt） |
| **Taskmaster**（claude-task-master） | 仓库内 `tasks.json` + 每任务一个文件 | 否（覆盖写） | 半：可"重新生成任务文件"保持一致 | 无 | 改 status 的人/agent | 靠 tasks.json 的依赖字段 | 可 | 有 CLI + MCP 工具面 |
| **Ruflo**（原 claude-flow） | **AgentDB**（向量/HNSW）+ 项目内注册物 | 部分（hooks 记事件，但不是权威状态） | 否 | ruPro workspace 里有 "evidence review" 概念（未逐字核） | swarm 自评 | swarm / missions / console | 需本机服务 | **需要 MCP server / daemon**（README 明确） |
| **LangGraph** | checkpointer：InMemory / SQLite / Postgres；Agent Server 代管 | 否，是**每 super-step 快照** | 可回放/时间旅行，但**按 thread 分区** | 无 | 图跑完 / 人说 OK | thread + store | 库形态可离线 | 库不需要；Agent Server 是服务 |
| **Temporal** | Temporal Service 的持久化库 | **是**（Event History = durable log） | **是**（replay 重建） | 无 | Workflow 完成 | 无（执行语义，不是协作语义） | 否 | **必需**服务 |
| **Restate** | 自家 journal 存储 | **是**（journal + replay） | **是** | 无 | handler 完成 | 无 | 否 | **必需**服务 |
| **Inngest** | 云侧（函数外部） | **是**（step 记忆化，成功的不重跑） | 是（从失败点续跑） | 无 | step 全绿 | 无 | 默认云 | 无需 worker，但要云 |
| **OpenHands** | EventLog：**immutable append-only store** | **是**，但**有后门**：State-Only Updates 可不写事件 | **不完整**（status 类字段绕过日志） | 无 | agent / 用户收尾 | 单会话级 | 可（local 实现） | Agent Server（remote）可选 |
| **CrewAI** | 记忆层：向量库 + LLM 推断 scope 树 | 否 | 否 | 无 | crew 流程 | 共享 memory | 可（本地向量库） | 否 |
| **AutoGen / AG2** | `save_state()` 快照（内存/model_context） | 否 | 否 | 无 | 会话结束 | 无 | 可 | 否 |
| **Devin** | Cognition 云（VM + Knowledge + Playbooks） | 未验证（内部实现不可见） | 未验证 | artifacts/PR | 人看 PR | Agent Command Center（Desktop 里统一管理本地+云 agent） | 否（云） | 否 |
| **Cursor Cloud Agents** | Cursor 云 VM + 快照 | 未验证 | 未验证 | "merge-ready PRs with artifacts"（截图/视频/日志） | 人审 PR | 多 repo 环境；会话隔离 | 否 | 否 |
| **Codex Cloud** | 每个任务独立 workspace（云） | 未验证 | 未验证 | 变更文件 + 结果 + PR | 人审 PR | Subagents | 否 | 否 |
| **GitHub Copilot cloud agent** | GitHub 侧 session + environment（云沙箱 / Actions runner / 自定义远程） | 未验证 | 未验证 | PR + checks | 人审 PR / CI | session 跨端延续；Copilot Memory 长期记忆 | 否 | 否 |
| **Factory** | Factory SaaS（Missions / Mission Control） | 未验证 | 未验证 | 里程碑 **validation workers 自动验证** | 自动 validator + 人批计划 | orchestrator + workers | 否 | 否 |
| **Conductor** | 本地 app 元数据 | 否 | 否 | 无 | 人 review/merge/archive | 一个 workspace 内多 agent 共享 branch/文件/上下文 | 可 | 否 |
| **Claude Code** | `~/.claude/tasks`（命名目录）/ 会话 transcript `.jsonl` / `~/.claude/teams/...` mailbox | transcript 是 append-only 文本，但**不是权威状态** | 否 | 无 | agent 自报 completed | 共享 task list + **文件锁** claim + JSON mailbox | 可 | 否（hooks 是本地 shell） |
| **git-bug** | **仓库内 git 对象（refs）** | 语义上 append-only（对象不可变） | 否 | 无 | 人 | push/pull 即同步 | 可 | 否 |
| **git-appraise** | **仓库内 git 对象（refs/notes/devtools/*）** | 语义上 append-only | 否 | 评审针对 commit | 人 | push/pull 自动 merge | 可 | 否 |
| **in-toto** | 磁盘上的 link 元数据文件 | 时间戳链 + 签名 | 可验证（不是重算状态） | **材料/产物哈希 + functionary 身份** | 验证者按 layout 校验 | 无（供应链） | 可 | 否 |
| **A2A** | 协议不管持久化 | 流式 status/artifact 事件 | 不适用 | Artifact（输出），不是证据指纹 | 协议只给终态 | 消息 + task 状态 | 可 | 需 agent 端点 |
| **Gerrit** | Gerrit 服务端库 | 变更历史 | 不适用 | label 投票 + Submit Requirements | 满足 submit requirement 才允许合入 | 服务端可见 | 否 | 必需服务 |

---

## 2. 分组与"这不就是 X 吗"

### A. repo 内文件即状态（最像 deed 的**形态**，机制最浅）
- **Taskmaster**：自述 "A task management system for AI-driven development"。状态是仓库里的 `tasks.json` 加每任务一个文件，官方文档有 "Task Fields in tasks.json" 与 "Individual task files follow this format"，并且要求"更新 tasks.json 后重新生成任务文件以保持一致"（https://tryhamster.com/docs/taskmaster/capabilities/task-structure ，2026-11-22 抓取）。→ **和 deed 差在**：没有事件、没有账本、没有"可丢弃重算"（它是可**重建派生物**，但真相仍是那份 JSON）、完成=改字段、证据=无。**这就是 deed README 现在那句"议事与执行机制"最容易被误认成的样子。**
- **Claude Code**：TaskCreate/TaskGet/TaskUpdate/TaskList；task list 可跨 context compaction 保留；`CLAUDE_CODE_TASK_LIST_ID` 把列表放到 `~/.claude/tasks/` 命名目录；agent teams（实验）用**文件锁**做 claim、用 JSON mailbox 通信（https://code.claude.com/docs ）。会话 transcript 是 append-only `.jsonl`，可 `--resume`，但**它不是权威状态**，也没有任何重算/判决语义。→ 差在：**事件在，判据不在**。
- **Spec Kit**（github/spec-kit）：把流程/模板/产物放进仓库喂给任意 agent（https://github.com/github/spec-kit ）。→ 差在：它是**提示与模板**，不是状态机；没有任何强制。

### B. 数据库 / 图 / 向量（"共识"的一半）
- **Beads**：README 首行现在是 "Distributed graph issue tracker for AI agents, powered by Dolt"；官方 sync 文档原话："Beads issue data lives in Dolt. The local Dolt database is the source of truth for `bd list`/`bd show`/`bd ready`"，"`.beads/issues.jsonl` is an export ... not the canonical cross-machine sync channel, and it is not a database backup"（https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md ）。跨机同步靠 `bd dolt push/pull`，数据在 `refs/dolt/data`。并发靠 `bd update <id> --claim`（首个 claim 胜），`bd ready` 列无 open blocker 的任务；assignee 只是字符串（原话 "Beads has no agent registry"）。
  - **这是对 deed 最强的反例**（详见 §4）。
- **Ruflo**（原 claude-flow；ruvnet/claude-flow 的 README 现在就是 ruflo 的内容）：`init` 会往项目里塞 agents/hooks/memory/MCP server；记忆插件 "RAG memory with HNSW vector search, **AgentDB** persistence"（https://github.com/ruvnet/ruflo/blob/main/plugins/ruflo-rag-memory/README.md ）。→ 差在：记忆=向量检索，不是可审计事实；权威状态在 AgentDB。
- **CrewAI**：Memory 类统一管理，写入时由 LLM 推断 scope/categories/importance，层级 scope 树，默认 OpenAI text-embedding-3-large(3072)，有 consolidation（similarity>0.85 交给 LLM 决定合并）（https://docs.crewai.com/en/concepts/memory ）。→ 差在：**记忆是概率的，账本必须是确定的**，这两者正好相反。

### C. 事件溯源 / durable execution（机制上最近，放置位置最远）
- **Temporal**："Event History, a complete and durable log of everything that has happened in the lifecycle of a Workflow Execution"，崩溃后用 Event History **replay** 重建状态（https://docs.temporal.io/encyclopedia/event-history ）。→ 这是 deed 之外最纯的"事件即真相 + 重算"，但：事件是**执行语义**（Activity/Timer），不是承诺/审查/签收；真相在服务端库，不在仓库；必须常驻。
- **Restate**：durable execution 靠 journal + replay，SDK 嵌进你自己的服务，部署在自家基础设施（https://docs.restate.dev/concepts/durable_execution ）。→ 同上，infra 层。
- **Inngest**："Function state is persisted outside of the function execution context. This enables function execution to be resumed from the point of failure on the same or different infrastructure"；step 已成功就不重跑（https://www.inngest.com/docs/learn/how-functions-are-executed ）。→ 云侧状态，SaaS 默认。
- **LangGraph**："A checkpointer saves a snapshot of graph state at each super-step, organized into threads"；短期记忆=checkpointer（thread 作用域），长期=store（https://docs.langchain.com/oss/python/langgraph/persistence ）。→ 快照式，**按 thread 分区**，跨 thread 不汇总；无判决。
- **OpenHands**：组件表里 "EventLog — Event storage — **Immutable append-only store** with efficient queries"，但状态更新有两条路：**State-Only Updates**（"Modify fields without appending events (e.g., status changes, stat increments)"）与 Event-Based Updates（https://docs.openhands.dev/sdk/arch/conversation ）。→ 这是全片最接近"事件日志"的实现，但它自己承认**不是所有状态都能从事件重算**；且是会话级 transcript，不入仓库。
- **AutoGen**：`save_state()/load_state()`，agent 状态=model_context，文档立场是"endpoint 无状态，需要时加载状态"（https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/state.html ）。→ 快照。

### D. 云 VM + 会话（另一半"共识"：状态在厂商后端）
- **Devin**：云 session 跑在 VM 上（macOS/Windows/Android emulator 都有专门页），Knowledge/Playbooks/blueprints 是跨 session 的长期资产；Devin Desktop 的 **Agent Command Center** "Manage all of your Devin Desktop agents — local and cloud — from a single view"，并支持 ACP（https://docs.devin.ai/_llms/en/desktop.txt ）。Devin Local 被官方描述为 "the Devin CLI **agent harness** with subagents, sandboxing, plan mode, worktrees, and permissions"——注意 **harness** 是它们的自述词。
- **Cursor Cloud Agents**："run in isolated VMs in the cloud"，克隆仓库→单独分支→push 回你的仓库做 handoff，"Cursor manages VM provisioning, isolation, snapshots, startup, artifacts"，产物是 "merge-ready PRs with artifacts"（截图/视频/日志）（https://cursor.com/docs/cloud-agent ）。
- **Codex Cloud**："Each task has its own workspace and can keep working while your computer is asleep"；可 inspect 变更、要求跟进、commit 或开 PR（https://learn.chatgpt.com/docs/cloud ）。
- **GitHub Copilot cloud agent**：官方把任务流拆成 "client / **session** / **environment**"，environment 是 "a cloud sandbox, a GitHub Actions runner, or a remote custom environment"；session 可跨 GitHub 网页、app、IDE、CLI 延续；另有 Copilot Memory 做跨 session 长期理解（https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent ）。
- **Factory**（自述 "the agent-native software development platform"）：Missions = "an orchestration layer that manages the work"，先与你共建计划（features/milestones/skills），批准后进入 Mission Mode；**验证由 validation workers 在每个 milestone 末尾自动跑**，官方估算 `total runs ≈ #features + 2 * #milestones`（https://docs.factory.com/missions/planning.md ，https://docs.factory.com/missions/overview.md ）。→ **这是"验收"这层在 SaaS 侧最完整的对手**：它把验收做成自动 validator 跑你的应用，而 deed 把验收做成**别人签的事件**。

### E. 编排 / worktree
- **Conductor**：多 workspace = 各自独立 branch + working tree，可独立 review/merge/archive；一个 workspace 内多 agent 共享同一 branch/文件/上下文；典型用法 "One agent implementing while another reviews the same diff"（https://www.conductor.build/docs/concepts/parallel-agents ，https://www.conductor.build/docs/concepts/git-worktrees ）。
- **Factory Worktrees**：Factory App 为每个 session 建独立工作目录，main 目录不变（https://docs.factory.com/factory-app/worktrees.md ）；另有 "Workstream Machines" 决定 orchestrator 跑在本机/Droid Computer/云机（https://docs.factory.com/workstreams/machines.md ）。
- **Claude Code agent teams**（实验）：lead + teammates，共享 task list（有依赖，blocked 不可自领，lead 可指派），claim 用文件锁防竞态，mailbox 是 `~/.claude/teams/{team}/inboxes/{agent}.json`，写入成功才算发出去。
→ 这三家都在解决"**并行不打架**"，没有一家解决"**谁有权说这一版交付算数**"。

### F. 协议层
- **A2A 1.0.0**：Task 生命周期 TASK_STATE_SUBMITTED/WORKING/…/COMPLETED/FAILED/CANCELED/REJECTED，**终态 task 拒收新消息**（UnsupportedOperationError）；Artifact 是 agent 输出（由 Parts 组成）；流式 TaskStatusUpdateEvent / TaskArtifactUpdateEvent（https://github.com/a2aproject/A2A/blob/main/docs/specification.md ）。→ 它规定**怎么对话**，不规定**状态存哪、谁判**。deed 明确不做这层。

---

## 3. 越界发现（名单外，但机制更近 —— 这一节比名单本身有用）

1. **git-bug**（github.com/MichaelMure/git-bug）：README 原话——"fully integrated in git: you only need your git repository to have a bug tracker"、"distributed: use your normal git remote to collaborate"、"**works offline**"、"**doesn't pollute your project: no files are added in your project**"（存在 refs 里）。→ **和 deed 同一条路线上的"分布式 issue tracker"**，比 Beads 的早期版本更彻底（连工作区文件都不加）。差在：没有可重算的状态投影、没有审查事件、没有证据指纹；它是"协作对象存储"而不是"判决机制"。
2. **git-appraise**（google/git-appraise v0.2，已归档）："code reviews are stored inside of the repository as git objects"、"Every developer ... has their own copy of the review history that they can push or pull"、"removes the need for any sort of server-side setup"、"can work with any git hosting provider"（https://github.com/google/git-appraise/blob/v0.2/README.md ）。→ **机制上离 deed 最近的祖先**：评审写在仓库里、无服务器、pull 自动 merge、离线。差三步：没有状态投影/重算；"谁能判"没有约束（任何人对任何 commit）；没有"这一份"的绑定（评审针对 commit 而非"被打成纸的承诺 + 指纹"）。
3. **in-toto**（https://github.com/in-toto/in-toto ）：README 原话——"verifying that each task in the chain is carried out **as planned, by authorized personnel only**, and that the product is not tampered with in transit"；机制是 project owner 写 **layout**（步骤序列 + 每步授权的 **functionaries**），functionary 执行时产出**带哈希的 link 元数据**。→ 这是"**交付者/判者的职责分离 + 材料与产物指纹**"的工业级成熟形式，而且它的真相是**文件**、不需要服务器。deed 的 `review.brief`（路径 + sha256）+ `by` + "交付者不能判自己交付的段"就是同一族约束的轻量版。**这条越界发现直接说明：deed 的核心机制有先例，只是没有人为"仓库里的多 agent 议事"搬过来。**
4. **Gerrit**（3.8.3 文档）：有 label（Code-Review/Verified）与 **Submit Requirements**，合入由"是否满足提交要求"决定（https://gerrit-documentation.storage.googleapis.com/Documentation/3.8.3/config-submit-requirements.html ）。→ "能不能放行"由规则判定，这点和 deed 的 `core/rules.mjs` 同构；但真相在服务端库，且"审的是哪个版本"由 patchset 隐含（**patchset 不可变这层我未在此次抓取的一手文档逐字确认**）。
5. **AGENTS.md / CLAUDE.md 生态**：各家都在往仓库里放"给 agent 的规则文件"（Codex 的 AGENTS.md、Claude Code 的 CLAUDE.md + auto memory）。→ 说明**"仓库是 agent 的共享上下文位"这一判断是行业共识**；deed 只是把"状态"也放进去，而不是只放"规则"。这是定位叙事最有力的一句铺垫。

---

## 4. 要害：共识是不是"用数据库/SaaS 保存 agent 的任务状态"？

**分三档，结论不一样：**

1. **云 / 多机 / 多 agent 并发**：是共识，而且很硬。Beads（Dolt）、Temporal/Restate/Inngest（服务端 journal）、Devin/Cursor/Codex/Copilot/Factory（云 VM + 厂商后端）、LangGraph 的托管形态（Agent Server "handles all persistence infrastructure behind the scenes"）、Ruflo（AgentDB）。连开源且强调"轻"的 Beads 都从 git 里的 JSONL 迁到了 Dolt。
2. **单仓 / 一个人 + 几个 agent**：**不是**共识，文件反而占上风。Taskmaster（tasks.json + 任务文件）、Claude Code（`~/.claude/tasks`、transcript、team mailbox 全是本地文件 + 文件锁）、Conductor（本地 app）、Factory 本地 worktree 会话。这些系统都不需要数据库也能跑。
3. **"判决"作为一等公民**：**全片空白**。没有一家把"谁在什么条件下、对哪一份产物、下的什么结论"做成可重放的事件。最接近的三处是：Factory 的 validation workers（自动、无指纹、无职责分离）、Copilot/Devin 的 PR review（人判、但审的是 PR 而不是"被打成纸的承诺"）、in-toto（职责分离 + 哈希，但面向供应链而非 agent 协作）。

**所以 deed 的正确定位不是"更好的任务库"，而是"把判决写进仓库的账本"。**

### 反例与反证（必须摆出来，否则结论不成立）
- **反证 1（最强）**：Beads 走过 deed 这条路又退回来了。它的 v0.9.3 README 还写 "Beads issues are backed by git... acts like a managed, centrally hosted SQL database shared by all agents"，现在明确 Dolt 才是 source of truth、JSONL 只是 export。**为什么退**：并发 claim、图查询、删除语义（JSONL upsert-only 无法表达删除）、跨机 merge——这些是 SQL 换来的。deed 必须能回答："这些需求你为什么没有？" 现有答案（需要写进 README）：deed 不承诺跨机实时并发写同一状态；一轮一件事、判决按段，把冲突面压到"谁在写哪一段"；不需要任意图查询，只需要 `ready/next` 这一个投影。
- **反证 2**：git-appraise 早就在仓库里放评审对象，2015 年起就存在，且已归档。**"仓库里放协作状态"不是新想法**，而且是**被主流放弃过一次的想法**（GitHub/GitLab 赢了）。deed 要在 README 里承认这一点，并把差异说成"agent 让这件事重新成立"：评审者从人变成 agent，agent 没有浏览器、没有账号、没有网络，它只能读仓库。
- **反例 3（反向支持）**：OpenHands 的 EventLog 是 immutable append-only，但文档自己保留了 State-Only Updates 的后门——说明"纯事件溯源"在实现压力下会破。deed 的答案是 `fold` 纯函数 + "能重算的不落盘"，把破口堵在设计层。

### 判断：新东西，还是又一个 todo 工具？
**都不是。** 严格说：
- **不是 todo 工具**：todo 工具的判据在写的人手里（谁能改 status 谁就是权威），deed 的判据是规则函数从账本算出来的；判决本身是事件、必须回答"已交出去的那一份"（`review.brief` 的 sha256）、交付者不能判自己交付的段、`judge --rework` 会作废旧结论。这四条我在这一片里逐个查过，**没有一家同时具备**。
- **也不是新品类**：event sourcing（Temporal）、职责分离 + 证明（in-toto）、仓库内协作对象（git-appraise）、规则化放行（Gerrit submit requirements）都是老机制。deed 的新颖性在**组合**与**放置位置**（仓库 + 零服务 + 零依赖），不在任何单个机制。
- **一句话定位**：*"把事件溯源、职责分离与证明搬进仓库，给一个人 + 若干 agent 的长跑做放行判定。"* 这句话每个词都有出处，且能被上面任何一家对照检验。

---

## 5. 最接近 deed 的 3 个（各差在哪一步）

1. **git-appraise v0.2**（https://github.com/google/git-appraise ）——差在"**判据**"这一步：它有"评审即仓库对象、无服务器、离线、pull 自动 merge"，但没有从历史算出的状态、没有"这一份"的绑定、没有职责分离约束。deed = git-appraise 的对象模型 + 一层可重算的规则投影。
2. **Beads v1.4.0-rc.4**（https://github.com/gastownhall/beads ）——差在"**判决**"这一步：它有 agent 友好的任务图、原子 claim、`ready` 视图、随仓库分发（早年），但没有审查事件、没有证据指纹、没有"交付者不能自判"，且真相已迁出到 Dolt。deed 与它的分歧点就是"要不要一个可查询的库"。
3. **in-toto**（https://github.com/in-toto/in-toto ）——差在"**场景与投影**"这一步：它有职责分离（layout + functionaries）与材料/产物哈希，但面向供应链构建，不解决"这一刻谁欠谁、下一步跑哪条命令"，也不做状态投影。

> 次席：Factory Missions（验收最完整，但 SaaS + 自动 validator）；git-bug（分发形态最像，但只是对象存储）；Temporal（事件溯源最纯，但在服务端且语义是执行）。

---

## 6. 这个类目现在被叫什么（英文词 + 谁在用）

- **agent orchestration / orchestration layer**：Factory（"Missions are the orchestration feature"，"an orchestration layer that manages the work"）、LangGraph、CrewAI、Conductor。→ 指"谁派活、怎么并行"。
- **durable execution**：Temporal、Restate、Inngest 的自述词。→ 指"崩了能续、状态在服务端"。
- **agent harness**：Devin 官方（"the Devin CLI **agent harness** with subagents, sandboxing, plan mode, worktrees, and permissions"），业内也泛指"包在模型外面的那层运行时"。→ 指"模型之外的一切"。
- **agent command center**：Devin Desktop 的板块名。→ 指"统一看管本地 + 云 agent 的面板"。
- **agent-native software development platform**：Factory 的自称。
- **issue tracker for AI agents / memory upgrade for your coding agent**：Beads 的自称。
- **cloud agents / coding agent**：Cursor（cloud agents）、GitHub（Copilot cloud agent）。
- **agent teams**：Claude Code（实验特性名）。
- **attestation / provenance**（不在 agent 圈但在同一机制族）：in-toto、SLSA。
- **event sourcing / audit log**（机制名）：Temporal 文档、OpenHands EventLog。

**没有任何一个现成词覆盖 deed 做的事。** 最贴近的两个词都各差一半：**"event-sourced coordination"**（准确但没人这么叫）与 **"ledger"**（Beads 用过 "ledger" 的说法，但指 Dolt 里的记录）。实践建议：README 不要挂 "task manager / todo / tracker"，挂 **"ledger"** 与 **"sign-off"** 这两个词，并把对照对象指名道姓写成 git-appraise（形态）、Beads（同类但换库）、in-toto（证明）——这比自创新词更省读者认知。

---

## 7. 对 README 的三条直接可用结论

1. **别再说"议事与执行机制"**，读者会把它归到 Taskmaster/Conductor 那一格（文件 + 状态位 + 人 review）。改用可检验的差异句：*账本只追加、状态可丢弃重算、判决是事件且必须回答"已交出去的那一份"*。
2. **主动承认反证**：Beads 从 git JSONL 迁到 Dolt、git-appraise 被主流放弃——先说出来，再解释"agent 没有浏览器/账号/网络，只能读仓库"。这是唯一能守住"为什么又回到 git"的论证。
3. **把"证据"讲成机制而不是态度**：`review.brief` 路径 + sha256、结论只能回答那一份、`by` 不能自判、`--rework` 作废旧结论。这四条一一对上 in-toto 的 layout/functionary 与 Gerrit 的 submit requirement，说明它不是自创规矩而是成熟约束的落地。

---

## 8. URL 清单（一手，抓取于 2026-11-22 前后）

**Beads**
- https://github.com/gastownhall/beads （README："Distributed graph issue tracker for AI agents, powered by Dolt"）
- https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md （Dolt = source of truth；JSONL = export）
- https://github.com/gastownhall/beads/releases （v1.4.0-rc.4 @2026-11-20；v1.3.1 @2026-09-30）

**Taskmaster**
- https://github.com/eyaltoledano/claude-task-master
- https://tryhamster.com/docs/taskmaster/capabilities/task-structure （tasks.json 字段表 / individual task files / 重新生成保持一致）
- https://tryhamster.com/docs/taskmaster/capabilities/mcp

**Ruflo（原 claude-flow）**
- https://github.com/ruvnet/ruflo （98 agents、MCP server、daemon、ruPro workspace）
- https://github.com/ruvnet/ruflo/blob/main/plugins/ruflo-rag-memory/README.md （AgentDB + HNSW）

**事件溯源 / durable execution**
- https://docs.temporal.io/encyclopedia/event-history
- https://docs.restate.dev/concepts/durable_execution
- https://www.inngest.com/docs/learn/how-functions-are-executed
- https://docs.langchain.com/oss/python/langgraph/persistence
- https://docs.langchain.com/oss/python/langgraph/checkpointers
- https://docs.openhands.dev/sdk/arch/conversation （EventLog immutable append-only；State-Only Updates 后门）
- https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/state.html

**记忆**
- https://docs.crewai.com/en/concepts/memory

**云 agent / 编排**
- https://docs.devin.ai/get-started/devin-intro.md
- https://docs.devin.ai/_llms/en/desktop.txt （Agent Command Center；"agent harness" 自述）
- https://cursor.com/docs/cloud-agent
- https://learn.chatgpt.com/docs/cloud
- https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent （client / session / environment）
- https://docs.factory.com/missions/overview.md
- https://docs.factory.com/missions/planning.md （validation workers；runs ≈ features + 2×milestones）
- https://docs.factory.com/factory-app/worktrees.md
- https://docs.factory.com/workstreams/machines.md
- https://www.conductor.build/docs/concepts/parallel-agents
- https://www.conductor.build/docs/concepts/git-worktrees

**Claude Code**
- https://code.claude.com/docs （hooks；TaskCreate/TaskUpdate/TaskList；agent teams 文件锁 + JSON mailbox；transcript .jsonl）

**越界（机制更近）**
- https://github.com/MichaelMure/git-bug
- https://github.com/google/git-appraise/blob/v0.2/README.md
- https://github.com/in-toto/in-toto
- https://gerrit-documentation.storage.googleapis.com/Documentation/3.8.3/config-submit-requirements.html
- https://github.com/a2aproject/A2A/blob/main/docs/specification.md
- https://github.com/github/spec-kit

---

## 9. 未验证 / 待补

- Devin、Cursor、Codex Cloud、Copilot cloud agent、Factory 的**内部状态持久化实现**（是否 append-only、能否重算）：只有产品文档，无技术文档 → 标未验证，报告中一律按"厂商后端，机制不可见"处理。
- Gerrit 的 **patchset 不可变语义**与"作者能否给自己投票"：此次抓取的 `intro-user.html` 未出现该规则原文 → 未验证，正文只使用 label + Submit Requirements 这条已确认事实。
- Taskmaster 的**存储目录**（是否 `.taskmaster/`）：文档页只确认 tasks.json 与任务文件的存在与同步关系，目录名未逐字确认。
- Ruflo 的 "evidence review" 具体机制（ruPro workspace 文案）：仅从 README 图片说明看到，未读到机制文档。
- Beads 是否有过"evidence"概念：README/核心文档中未出现，判定为无（检索性结论，非文档明示）。
