# 规格驱动 / 文档驱动的 agent 开发工具：一手调研

抓取时点：2026-11-23（GitHub API 与各官方 docs；版本号与日期见各条）。
作者：subagent `spec`。目的：给 deed 的定位与 README 叙事找证据，重点不是复述别人的好话，而是指出"这不就是 X 吗"里的 X，以及 X 与 deed 的机制差异。

---

## 0. 结论（200 字）

这一批工具没有一个是 deed 的同类。它们都建立在同一个假设上：**真相是一份人维护、可被反复改写的规格文档，实现向文档靠拢，完成与否写回文档里的一句话/一个勾/一个状态值**。所以它们的"审查"是阶段关卡（approval gate），"状态"是文档当前内容，"历史"交给 git，"交接"靠下一个 agent 再读一遍同一份文档。

deed 的真相不是文档而是**带署名与对象指纹的事件流**：审查的对象是被封存的那一份（路径+sha256），判决是不可共手的第二个人，驳回是作废旧结论的新事件，状态是随时可丢弃重算的投影。这在软件行业里最近的名字不是 SDD，而是**变更管控里的"审计追踪 + 电子签名 + 职责分离"**（21 CFR Part 11 那一路），在供应链里叫 **attestation/provenance**（in-toto、SLSA），在代码托管里已经以"分支保护 + 必须审查 + 新提交作废旧批准 + 批准人不能是最后推代码的人"落地。deed 的差异不是功能多，而是把这三样东西装进一个**随仓库提交、可离线重算、零依赖**的纯文本账本里，并且把"下一步谁动什么命令"当成一等输出。

被审的假设与 deed 分属两个物种：SDD 管"要建什么"，deed 管"这一份能不能放行、谁欠谁、下一步谁动"。README 现在那句"一个工作区的议事与执行机制"之所以显弱，是因为它没有回答"和什么比"——它其实是一个**agent 工作的审计追踪/签收台账**，不是规格工具。

---

## 1. 我按什么看（七个问题）

对每个工具问同一组问题，答案决定它和 deed 的关系：

1. **真相载体**：哪几个文件？是人写的、会被改的吗？
2. **完成与否谁判**：人、agent、还是规则从数据算出来？
3. **有没有"审查 / 签收 / 驳回"这一层**：判决是不是独立事件？有没有对象绑定？能不能作废？
4. **多 agent 交接靠什么**：文档？issue？进程内存？还是"下一条命令"？
5. **状态存在哪**：文件 / git / 本地 DB / 常驻进程 / SaaS。
6. **能不能离线**：断网、无账号、无服务端是否仍成立。
7. **许可证与热度**：stars、最新 release 日期（决定它是不是还在演进）。

---

## 2. 逐个工具

> 表内"真相载体"列只写**文件/位置**，"人写/机写"指这份东西是否被人手工维护并被反复改写。

### 2.1 OpenSpec（Fission-AI）

- 真相载体：`openspec/changes/<name>/` 下 `proposal.md`、`specs/`（requirements + scenarios）、`design.md`、`tasks.md`；归档后进 `openspec/changes/archive/<date>-<name>/` 并把变更吸收回 `openspec/specs`。**全是人/agent 共同改写 markdown**。
- 完成由谁判：没人判。`openspec validate` 只查结构问题，`openspec status` 是"artifact completion status"（文件齐不齐），**不是"这一份能不能放行"**。
- 审查/签收/驳回：无。官方 Quickstart 第 3 步写着"Review（you correct the plan，直接改 markdown 或让 agent 改）"——**"审"= 直接改文档**，不留判决，也没有"被审的是哪一版"。
- 交接：下一个会话读同一个 change 目录 + `tasks.md` 逐条勾。跨仓库用 Stores(beta)：独立的 specs repo，靠 `git push` 共享，平台团队拥有、产品团队只读。
- 状态：文件内容（tasks.md 的勾、目录是否 archived）。无 DB，离线成立。
- 许可/热度：MIT，75,468 stars，v2.1.1（2026-11-19），v2.0.0（2026-11-11，命令改 skills，30+ 工具）。
- **"这不就是 X 吗"**：X = **带模板的 plan 文档 + 一组斜杠命令 + 归档目录**。自家 tagline 已经承认了："OpenSpec is a lightweight agreement layer between you and your AI. Agree on what to build before any code is written."（openspec.dev）
- URL：https://github.com/Fission-AI/OpenSpec ；https://openspec.dev

### 2.2 GitHub Spec Kit（spec-kit）

- 真相载体：`.specify/` 下模板与产物；SDD 主线产物是 spec/plan/tasks 三件套；bug 扩展 `.specify/bugs/<slug>/`，idea 评估 `.specify/assessments/<slug>/`。**人写、可改**。
- 完成由谁判：agent。流程 `/speckit-implement` ↔ `/speckit-converge` 循环，直到 converge 报 `Converged`；bug 修复的最终 `verdict = verified / partial / failed`，官方原话"only `verified` confirms a successful fix"；评估结论 `go / needs-clarification / kill`。**判决由同一个 agent 写进报告**。
- 审查/签收/驳回：只有人肉软门——README 写"one at a time, reviewing each result before continuing"。没有判决对象、没有驳回事件。
- 交接：下一个 skill 读上一阶段产物 + 模板；air-gapped 模式用本地 extension catalog（企业自托管）。
- 状态：文件。离线可行（官方有 air-gapped 能力）。
- 许可/热度：MIT，151,037 stars，v1.4.3（2026-11-19）。
- **"这不就是 X 吗"**：X = **一套写死的 prompt 流水线 + 模板仓库**；它的"完成"是 agent 自己宣布收敛。
- URL：https://github.com/github/spec-kit

### 2.3 AWS Kiro（specs / hooks / steering）

- 真相载体：`requirements.md`（EARS："WHEN … THE SYSTEM SHALL …"）/ `design.md` / `tasks.md`（完成打勾）；bugfix spec 用 `bugfix.md`。`.kiro/steering/`（工作区级）与 `~/.kiro/steering/`（全局级，冲突时工作区优先，基础文件 product.md/tech.md/structure.md）；`.kiro/hooks/<id>.json`。
- 完成由谁判：**阶段关卡由人点**（推论，证据是官方 Quick Spec 的原话反证："runs all three phases automatically **without approval gates between them**"——若常规 Feature Spec 没有 gate，这句就没有对立面；具体点击位置与 gate 数量**未逐条验证**）。执行阶段 task 完成 = tasks.md 打勾 + IDE 里的实时状态。
- 审查/签收/驳回：有"批准"，但**批准粒度是一个文件**，没有对象指纹，没有"作废旧批准"的语义（除了重新生成）。hooks 能做 `PreToolUse` 拦截（"Gate dangerous operations - block tool execution unless preconditions are met"），这是**运行时门**，不是交付审查。
- 交接：steering 文件注入 + `AGENTS.md` 兼容；团队 steering 可用 MDM/GPO 下发；云会话读不到本地 `~/.kiro/steering`，要先 Configuration Sync 上传。
- 状态：IDE/云会话状态（本地 + SaaS 面：cloud sessions、Crew、Web、Mobile 需登录订阅）。
- 许可/热度：闭源商业 IDE（订阅制），官网文档更新频繁；无 OSS star。
- **"这不就是 X 吗"**：X = **IDE 里的三份规格文档 + 阶段审批弹窗 + 事件钩子**；它的权威是"IDE 认为你批准了"，不在仓库里。
- URL：https://kiro.dev/docs/specs/ ；https://kiro.dev/docs/steering/ ；https://kiro.dev/docs/hooks/ ；https://kiro.dev/blog/introducing-kiro/（2025-07-14，"spec-driven development" 原话："That's what Kiro helps you do with spec-driven development."）

### 2.4 Tessl

- 现状（**重要：它已经不在 SDD 这一类里了**）：docs 首页自我描述为 "an open platform for managing agentic development across your organization… software factory"，六个组件 = Registry & package manager / Governance（RBAC、install policy、audit trail、Snyk 评分）/ Evals / Observability / Context and Findings / Tessl Agent。另有 Tessl Review（对 agent 写的 PR 做 code review 的 GitHub App）。
- 真相载体：skills/plugins（`SKILL.md` 类），加上 registry 上的版本；项目配置（`.tessl-code-review.yml` 等）。
- 完成由谁判：人 merge PR + CI 阈值（"fail the build when a skill scores below your threshold"）、eval 结果。
- 审查/签收/驳回：有 review（评分/意见），**是产品化的评审服务**，不是可重算的判决事件。
- 交接：registry 安装/版本/回滚 + policies。
- 状态：SaaS（Organization/workspace/project、RBAC、audit trail 在平台侧）。离线不成立。
- 许可/热度：商业 SaaS，docs 有 llms.txt/llms-full.txt（对 agent 友好）。
- **"这不就是 X 吗"**：X = **skills 的 npm + 企业策略网关 + PR 评审机器人**。它 2025 年那套"spec 即真相"的叙事已经让位给"上下文/技能供应链治理"。
- URL：https://docs.tessl.io/ ；https://docs.tessl.io/index.md ；https://docs.tessl.io/llms.txt

### 2.5 BMAD-METHOD

- 真相载体：story 文件（`create-story` 产出）+ `sprint-status` 追踪文件；角色/工作流为 yaml/xml（`src/modules/bmm/agents/*.agent.yaml`、`workflows/4-implementation/create-story/instructions.xml`）。
- 完成由谁判：**状态值**。一手 commit 7d6aae1b7896f6d5d43654bd561abaab6ae94ac2（2025-12-12）写明：`backlog → ready-for-dev → in-progress → review → done`，handoff 序列 `create-story → (可选 validate) → dev-story`，并把 legacy `drafted` 迁到 `ready-for-dev`；`validate-create-story` 是可选且"doesn't change status"。
- 审查/签收/驳回：**有 review 这个状态，但没有判决事件**：谁都能把 status 改成 done，没有对象指纹，没有"作废旧结论"。
- 交接：workflow 序列 + story 文件 + agent persona（"multiple-agent discussions without handing over judgment"）。
- 状态：文件 + sprint-status（可改写、可手工编辑）。离线成立（本地 uv+Python）。
- 许可/热度：README badge 写 MIT，GitHub API 返回 NOASSERTION（许可证文件与 badge 不一致，**未验证到底哪个生效**）；55,630 stars；v6.12.4（2026-10-14）；v6.12=stable，V7 preview alpha（README 称 v7 ETA mid-November 2026，需 skills 支持的宿主）。
- **"这不就是 X 吗"**：X = **角色扮演 + 状态机 + 一堆可改写的 markdown**。它是这批里唯一有显式状态机的，但状态机跑在可改写的文件上。
- URL：https://github.com/bmad-code-org/BMAD-METHOD ；https://github.com/bmad-code-org/BMAD-METHOD/commit/7d6aae1b7896f6d5d43654bd561abaab6ae94ac2

### 2.6 agent-os（buildermethods）

- 真相载体：`agent-os/product/{mission,roadmap,tech-stack}.md`、`agent-os/standards/index.yml`（可检索的团队规范库）、每个 spec 一个 `agent-os/specs/YYYY-MM-DD-HHMM-{slug}/`，内含 `plan.md`、`shape.md`、`standards.md`、`references.md`、`visuals/`。
- 完成由谁判：没有机制。`shape-spec` 在 plan mode 跑、用 AskUserQuestion 收 scope，Task 1 永远"Save spec documentation"。
- 审查/签收/驳回：无。
- 交接：standards 注入（用户确认注入哪几条）+ plan.md。
- 状态：文件。离线成立。
- 许可/热度：MIT，5,634 stars，v3.0.0（2026-01-20）、v2.1.1（2025-10-28）；仓库只有 5 个 command markdown + 一个安装脚本（体量极小）。
- **"这不就是 X 吗"**：X = **可检索的团队规范 + 一次性 spec 目录 + 注入提示词**。它的价值主张是"不要每次重新解释标准"，与"判决"无关。
- URL：https://github.com/buildermethods/agent-os

### 2.7 cc-sdd（gotalab）

- 真相载体：`requirements.md`（EARS + 验收标准）/ `design.md`（含 File Structure Plan）/ `tasks.md`（带 `_Boundary:_`、`_Depends:_`），学习沉淀写进 `tasks.md` 的 `## Implementation Notes`。
- 完成由谁判：**结构化判决字符串**——`kiro-verify-completion` 返回 `VERIFIED / NOT_VERIFIED / MANUAL_VERIFY_REQUIRED`；`kiro-validate-impl` 返回 `GO / NO-GO / MANUAL_VERIFY_REQUIRED`；`kiro-debug` 返回 `ROOT_CAUSE / CATEGORY / FIX_PLAN / NEXT_ACTION`。
- 审查/签收/驳回：**有，且最接近 deed 的流程**：每个 task 一个全新 implementer（TDD，RED→GREEN，feature flag 后），独立 reviewer 做 `git diff`、grep TODO、跑测试、查 task boundary；被拒 2 轮触发 debugger（每任务最多 2 轮 debug）。但官方自己写了限制："A skill installation alone does not prove independent review"、"Recorded progress is not a guarantee of interruption recovery on every host"。
- 交接：tasks.md 的 notes 注入下一个 implementer 的 prompt；路由由 `/kiro-discovery` 写 `brief.md`（必要时 `roadmap.md`）决定。
- 状态：tasks.md + 宿主 agent 的会话。离线成立。
- 许可/热度：MIT，3,774 stars，v3.1.0（2026-09-23）；17 skills × 8 agents（Claude Code / Codex stable；Cursor / Copilot / Devin / OpenCode / Gemini CLI / Antigravity beta）；自称 "Kiro-inspired"。
- 理念原话（**和 deed 有半句同调，但落点相反**）："cc-sdd treats the spec as a contract between parts of the system, not a master command document handed to the agent. Code remains the source of truth." / "Agents write the spec, humans approve the contract at phase gates, code is what ships."
- **"这不就是 X 吗"**：X = **同一会话里两个角色（写的人 / 判的人）轮流跑，判决是字符串**。它没有把"被审的是哪一份"变成数据，也没有把"驳回"变成可作废的事件。
- URL：https://github.com/gotalab/cc-sdd ；https://github.com/gotalab/cc-sdd/blob/main/docs/guides/skill-reference.md

### 2.8 spec-workflow-mcp（Pimzino）

- 真相载体：spec 目录下 requirements / design / tasks 三份文档 + 实现日志；审批在 dashboard 里点。
- 完成由谁判：人（dashboard 上 approve），进度条从 tasks 完成度算。
- 审查/签收/驳回：**有完整审批流**——官方卖点原话 "Approval Workflow - Complete approval process with revisions"、"Implementation Logs - searchable logs of all task implementations with code statistics"；驳回=要求 revision。
- 交接：MCP server 把 spec 与日志喂给任何接 MCP 的 agent（11 语言）。
- 状态：**MCP server 本地文件 + 常驻进程 + Web dashboard（默认 5000 端口）+ VSCode 扩展**。要进程在线，不在 git 里。
- 许可/热度：GPL-3.0，4,302 stars，最后 push 2026-07-03，**无 GitHub release**；README 顶部作者留言 "taken a small break from this repo for personal reasons"（维护状态弱）。
- **"这不就是 X 吗"**：X = **本地小 SaaS：一个 dashboard + 一个数据库 + 审批按钮**。它把"审批"做成了 UI 动作，而不是仓库里的事实。
- URL：https://github.com/Pimzino/spec-workflow-mcp

### 2.9 GitHub Copilot Workspace

- 状态：**已归档的实验**。官方手册仓库 `githubnext/copilot-workspace-user-manual` 于 2025-09-02 归档（1,082 stars）；`github/copilot-workspace-user-manual` 与 `githubnext/copilot-workspace` 均 404。
- 真相载体：服务端 session（Task → Specification → Plan → Implementation 四段产物，Plan 是文件级操作清单，Implementation 是 repo 的内存表示，输出 PR 式 diff）。
- 完成由谁判：人（merge PR）；理念 "iterative - check, review, refine and iterate"、"collaborative - share sessions… publish links to sessions on issues and pull requests"（Session Sharing）。
- 审查/签收/驳回：无独立判决对象；讨论在 issue/PR 里。
- 交接：分享 session 链接（状态在 GitHub 服务端）。
- 状态：SaaS，必须在线。
- 二手旁证（**未验证**，不作事实）：2025-05 起并入 Copilot coding agent，coding agent 2025-09-25 GA。
- **"这不就是 X 吗"**：X = **托管在 GitHub 服务端的一次性规划会话**。它证明"过程机制"这条路走过，但走成了 SaaS，最后被并进 coding agent。
- URL：https://github.com/githubnext/copilot-workspace-user-manual

### 2.10 AGENTS.md（agents.md / opencode）

- 真相载体：仓库里的 `AGENTS.md`——"a README for agents: a dedicated, predictable place to provide context and instructions"；示例含 dev environment tips / testing instructions / PR instructions。
- 完成由谁判：没有人，也没有状态。它是**纯上下文注入**。
- 交接：任何支持它的宿主自动读（opencode 官方："Add an AGENTS.md file to give OpenCode persistent project guidance"，并支持 `CLAUDE.md` 作为 fallback；"Commit project instruction files so everyone working in the repository receives the same guidance"）。
- 状态：无（就是文件本身）。离线成立。
- 许可/热度：MIT，25,664 stars（openai/agents.md），2026-09-10 仍有 push。
- **"这不就是 X 吗"**：X = **约定文件名 + 提示词注入点**。它解决"agent 该知道什么"，不解决"谁说了算"。
- URL：https://github.com/openai/agents.md ；https://opencode.ai/docs/rules/

### 2.11 CLAUDE.md / Claude Skills（`.agents/skills`、`.claude/skills`）

- 真相载体：`CLAUDE.md`（项目记忆）+ `SKILL.md` +`frontmatter`（可按需加载的参考文档）。
- 完成由谁判：无状态。skills 是可调用能力的封装。
- 机制要点（官方原话）："a skill's body loads only when it's used, so long reference material costs almost nothing until you need it"（progressive disclosure）；custom commands 已并入 skills，旧 `.claude/commands/` 仍工作；`disable-model-invocation` 控制谁能调用。
- 交接：同一宿主里靠上下文与 skills；跨宿主靠文件形状约定。
- 状态：无。离线成立。
- **"这不就是 X 吗"**：X = **按需加载的提示词包 + 可被禁用的调用权**。它连"任务状态"都不表达。
- URL：https://code.claude.com/docs/en/skills.md

### 2.12 Cursor rules（含 Skills / Hooks / Agent Review）

- 真相载体：`.cursor/rules/` 下 `.mdc`（Project Rules，版本控制，按 glob/手动/相关性注入）、User Rules、Team Rules（dashboard，Team/Enterprise）、`AGENTS.md` 作为简单替代。`.md` 直接放 `.cursor/rules` 会被忽略（无 frontmatter）。
- 完成由谁判：无状态机制；文档原话 "Large language models don't retain memory between completions. Rules provide persistent, reusable context at the prompt level"。
- 审查/签收/驳回：Cursor 另有 Agent Review / Bugbot / Security Review（文档侧栏条目，**具体语义未验证**）。
- 状态：规则文件 + 平台侧 dashboard。
- **"这不就是 X 吗"**：X = **带 glob 作用域的提示词文件**。
- URL：https://cursor.com/docs/context/rules

---

## 3. 要害：spec-driven 的共同假设，以及 deed 是否在同一个假设里

**假设 A（真相）**：真相是一份**人维护、会被改写的规格文档**；代码是它的实现；文档是"主"，代码是"从"。
**假设 B（完成）**：完成 = 有人读产物并判断"符合 spec"；判断写成文档里的一句话（verdict / status / 勾）。
**假设 C（状态）**：状态就是文档当前的内容；没有"投影"这个概念——状态与文档是同一份东西。
**假设 D（历史）**：历史不重要；文档被覆盖，考古交给 git。
**假设 E（交接）**：下一个 agent 再读一遍同一份文档（+ 同一份上下文文件），就完成交接。

这五条在这批工具里几乎无例外（cc-sdd 的 reviewer 是唯一半个例外，但它把判决落回 `tasks.md` 的字符串）。

**deed 不在同一个假设里**：

| 假设 | 这批工具 | deed |
|---|---|---|
| A 真相 | 人写的规格文档 | 一条条有人署名、有对象指纹的事件；文档只是**被审对象**，不是权威 |
| B 完成 | 读产物的人/agent 写一句话 | 规则从账本算"能不能放行"；判决本身是事件，必须回答"交出去的那一份"（指纹不符就拒） |
| C 状态 | 文档当前内容 | **投影**，可丢弃重算，不落清单文件 |
| D 历史 | 交给 git，不重要 | 只追加、不改写不删除；修正靠后续事件表达 |
| E 交接 | 再读一遍文档 | **下一句命令**（下一步谁动什么），不需要重读 |

一句话判据：**SDD 是"规格即真相"，deed 是"署名即真相"**。前者优化"建对东西"，后者优化"谁在什么时候对哪一份说了什么，以及现在能不能放行"。

所以 deed 属于**另一个类目**，只是它选的落点（仓库里的纯文本 + 可重算 + 零依赖 + 一行一事实）在这个类目里是少见的。

---

## 4. 越界发现（名单外，但证据更硬）

这一节比上面更重要：deed 的机制在别的行业**已经有名字，也已经有人实现过**，只是没人把它搬到 agent 工作里。

### 4.1 GitHub 分支保护：已经实现了"结论只认被审的那一份"和"交付者不能判自己交付的"

GitHub 官方文档（`github/docs` 仓库源文件）原话：

> "you can choose to dismiss stale pull request approvals when commits are pushed that affect the diff in the pull request. GitHub **records the state of the diff at the point when a pull request is approved. This state represents the set of changes that the reviewer approved.** If the diff changes from this state (for example, because a contributor pushes new changes … ), the approving review is dismissed as stale, and the pull request cannot be merged until someone approves the work again."

> "requiring an approval from someone other than the last person to push … with this option, 'stale' reviews are not dismissed, and the pull request remains approved as long as someone other than the person who made the most recent changes approves it. … If you are concerned about pull requests being 'hijacked' …, it is safer to dismiss stale reviews."

> "any pull request that affects code with a code owner must be approved by that code owner before the pull request can be merged"

这就是 deed 的 `review.brief`（记路径+sha256）与"交付过这一段的 `by` 不能判这一段"的**托管层实现**。差异：GitHub 的真相在服务端、粒度为 PR、必须在线、判决与 diff 状态绑定但不留可重算的历史投影；deed 在仓库里、粒度为段、可离线重算。

### 4.2 in-toto Statement：deed 的"证据"就是这个格式

一手规格（`in-toto/attestation` `spec/v1/statement.md`）的 schema：

```jsonc
{ "_type": "https://in-toto.io/Statement/v1",
  "subject": [{ "name": "<NAME>", "digest": { "<ALGORITHM>": "<HEX_VALUE>" } }],
  "predicateType": "<URI>",
  "predicate": { ... } }
```

原话："**Subjects are assumed to be immutable**"、"**Subject artifacts are matched purely by digest**, regardless of content type"。

deed 的 `evidence = {path, sha256, by}` 与 `review.brief = {path, sha256}` 是同一个想法的手写版。差异：in-toto 是给供应链（构建、扫描）的**签名信封**，没有"谁能判、驳回、重做"，也没有"下一步谁动"。

### 4.3 21 CFR Part 11：审计追踪 + 电子签名 + 权限校验，是这套机制的法定原型

eCFR 现行条文（Title 21 Part 11 §11.10）：

> "(e) Use of secure, computer-generated, time-stamped **audit trails** to independently record the date and time of operator entries and actions that create, modify, or delete electronic records. **Record changes shall not obscure previously recorded information.** Such audit trail documentation shall be retained…"

> "(g) Use of **authority checks** to ensure that only authorized individuals can use the system, electronically sign a record, access the operation…, alter a record…"

配套 §11.200 规定电子签名必须包含签署人姓名、日期时间与签名含义。这套"只追加 + 谁签 + 谁能签"的法定语言，比任何 SDD 工具都更接近 deed 的不变式。药品行业的合规口径叫 **ALCOA+**（Attributable, Legible, Contemporaneous, Original, Accurate + complete, consistent, enduring, available）——deed 的 `by` + sha256 + 只追加账本，逐条对得上。

### 4.4 A2A 协议：反面证据——"跨 agent 不共享内部状态"

A2A v1.0.0 的目标原话是让 agent 协作 "**without needing access to each other's internal state, memory, or tools**"；Task 有 TaskStatus/TaskState（可验证的终态名：`TASK_STATE_COMPLETED`、`TASK_STATE_FAILED`、`TASK_STATE_CANCELED`、`TASK_STATE_REJECTED`，其余取值**未验证**——proto 源文件 404，表格由 `proto_enum_to_table("TaskState")` 渲染），状态在**每个 agent 自己的服务端**，靠 streaming 与 push 通知扩散。

这解释了一件事：主流协议把"状态"留在各自家里；deed 反其道而行，把状态放进**共享仓库**。这是一个明确的取舍，不是落后。

### 4.5 其它顺手挖到的

- **Tessl 已经退出 SDD 叙事**（见 2.4）：从"spec 是真相"转成"skills 供应链 + 治理 + 评审机器人"。这条路线的演化方向本身就是证据：**规格文档留不住人，能留住的只有流程中的"证据与责任"**。
- **Copilot Workspace 死了**（2025-09-02 归档）：服务端 session 式的"过程机制"没有独立存活。
- **BMAD 是这批里唯一有显式 story 状态机的**（backlog → ready-for-dev → in-progress → review → done），但状态落在可改写文件上——这正好是 deed 要反对的形态。
- **cc-sdd 的 review 循环最像 deed 的流程**（独立 reviewer + 被拒 2 轮后 debugger），但结论是字符串、对象是"当前工作区"，不是被封存的那一份。

---

## 5. 最接近 deed 的 3 个东西，各自差在哪一步

### ① cc-sdd v3（gotalab）——差在"判决没有对象"

- 同：每个任务一个 implementer、一个独立 reviewer、被拒→返工→再判，甚至有"最多 2 轮"的硬约束；也承认"人批准契约"。
- 差：判决是 `VERIFIED / NO-GO` 这样的**字符串**，落在 `tasks.md` 或会话里；没有把"被审的是哪一份"记成数据，因此**无法拒绝一份已经变过的产物**，也无法作废旧结论。它的 reviewer 与 implementer 是同一宿主里的两个角色，不是"另一个人"。
- 判据一句话：cc-sdd 审"当前工作区"，deed 审"交出去的那一份"。

### ② GitHub 分支保护 + required reviews + dismiss stale approvals

- 同：结论绑定被审的 diff 状态、新提交作废旧批准；要求批准人不是最后推代码的人（职责分离）；CODEOWNERS 决定谁有权判。机制上与 deed 几乎逐条同构。
- 差：**真相与状态在 GitHub 服务端**（不在仓库里、不可离线、不能自己重算投影）；粒度是 PR 而不是"一件要交付的东西 + 段"；没有"用户签收只认原话"这一层；历史是 GitHub 的事件流，不是随仓库提交的纯文本。
- 判据一句话：GitHub 把这条机制做成了**托管服务的一个开关**，deed 把它做成了**仓库里的一本账**。

### ③ in-toto / SLSA attestation

- 同：claims 绑定 **subject digest**，subject 假设不可变，按 digest 匹配（"matched purely by digest"）。这就是 deed 的 sha256 证据与 review.brief。
- 差：in-toto 只回答"这个产物是由这次构建/扫描产生的"，**不回答"谁有权判、判了没有、被驳回怎么重做、下一步谁动"**；没有状态投影，没有会话/段的分层，也不给"卡在哪"。
- 判据一句话：in-toto 是**证据层**，deed 是**议事层**（证据只是它的一个字段）。

> 备选第 4：BMAD 的 story 状态机（差在状态是可变文件、review 只是状态值）；第 5：spec-workflow-mcp 的 dashboard 审批（差在要常驻进程/本地 DB，状态不在 git）。

---

## 6. 这个类目现在被叫什么（英文词 + 谁在用）

分三层回答，因为 deed 不在最上面那一层。

**① 这批工具自己用的名字：`spec-driven development`（SDD）**
- 使用者：GitHub（spec-kit README/文档）、AWS（Kiro 官方博客 2025-07-14 原话 "spec-driven development"）、OpenSpec、cc-sdd、agent-os、BMAD（自称 "Agile AI Driven Development"，相邻但不同词）。
- 分析师口径：Thoughtworks Technology Radar 有独立条目 "Spec-driven development"（页面标题可验证；**ring 等级未验证**，站点客户端渲染抓不到正文）。德媒 heise 有 "Fünf Tools für Spec-driven Development im Überblick" 的横评。
- 相关但不同的自造名：AWS 的 **`AI-DLC`（AI-Driven Development Life Cycle）**，三阶段 + "humans providing business context, validating plans, and making critical decisions"；Tessl 现在用 **`agentic development` / `software factory`**；Claude/Cursor 一侧用 **`context engineering`**、**`skills`**。

**② deed 真正的类目，在软件行业里的现成名字**
- **`audit trail` + `electronic signature` + `separation of duties`**（法规语言：21 CFR Part 11；合规口径：ALCOA+）。谁在用：制药、医疗器械、金融合规、SOX 404 变更管理。
- **`attestation` / `provenance`**（供应链语言：in-toto、SLSA、sigstore）。谁在用：Google、OpenSSF、SLSA 采用方。
- **`protected branch` + `required reviews` + `dismiss stale approvals`**（托管平台语言：GitHub、GitLab approval rules）。谁在用：几乎所有用 GitHub 的团队。
- **Deed 需要的那个组合名，目前没有人在用**（未验证：没有搜到把"agent 工作的审计追踪/签收台账"作为产品类目的既有词）。这是定位机会，也是 README 该占的位置。

**③ 可以直接拿去用的英文定位句（三选一）**
1. "An append-only **audit trail for agent work**, committed with your repo: who claimed what, on which bytes, and who was allowed to sign it off."
2. "**Review and sign-off ledger** for one human and several agents working in the same repository — recomputable, offline, no service."
3. "Spec tools tell agents **what to build**. deed records **what was handed over, who judged it, and what happens next**."

第 3 句最锋利：它把 deed 与整整一类工具的关系一句话切开，同时解释了为什么"议事与执行机制"太弱——那句话没有对手。

---

## 7. URL 清单（按证据类型分组）

**仓库与版本（GitHub API，2026-11-23）**
- https://github.com/Fission-AI/OpenSpec
- https://github.com/github/spec-kit
- https://github.com/bmad-code-org/BMAD-METHOD
- https://github.com/buildermethods/agent-os
- https://github.com/gotalab/cc-sdd
- https://github.com/Pimzino/spec-workflow-mcp
- https://github.com/openai/agents.md
- https://github.com/githubnext/copilot-workspace-user-manual （archived）

**工具一手文档**
- https://openspec.dev
- https://kiro.dev/docs/specs/
- https://kiro.dev/docs/steering/
- https://kiro.dev/docs/hooks/
- https://kiro.dev/blog/introducing-kiro/
- https://docs.tessl.io/ ｜ https://docs.tessl.io/index.md ｜ https://docs.tessl.io/llms.txt
- https://github.com/bmad-code-org/BMAD-METHOD/commit/7d6aae1b7896f6d5d43654bd561abaab6ae94ac2
- https://github.com/gotalab/cc-sdd/blob/main/docs/guides/skill-reference.md
- https://code.claude.com/docs/en/skills.md
- https://cursor.com/docs/context/rules
- https://opencode.ai/docs/rules/

**越界证据（机制原型）**
- https://raw.githubusercontent.com/github/docs/main/content/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches.md
- https://raw.githubusercontent.com/in-toto/attestation/main/spec/v1/statement.md
- https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-21?part=11 （21 CFR Part 11）
- https://a2a-protocol.org/v1.0.0/specification/ ｜ https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md
- https://builder.aws.com/content/3KjWpM4sqd5f0zjUtE67OfUa7rk/ai-driven-development-life-cycle-ai-dlc-on-aws-a-new-approach-to-software-engineering （2026-10-15）
- https://aws.amazon.com/blogs/devops/open-sourcing-adaptive-workflows-for-ai-driven-development-life-cycle-ai-dlc/
- https://www.thoughtworks.com/radar/techniques/spec-driven-development

---

## 8. 未验证 / 拿不准（明确列出，不当事实用）

1. Thoughtworks Radar 里 "Spec-driven development" 的 ring 等级（Adopt/Trial/Assess/Hold）——客户端渲染，正文抓不到。
2. BMAD 许可证：badge 写 MIT，API 返回 NOASSERTION。
3. Copilot Workspace 并入 Copilot coding agent 的具体时间线与 coding agent GA 日期——只有二手来源（aiwiki.ai、blog.rottenwifi.com）。
4. A2A TaskState 的完整取值集合（proto 文件 404，只能确认三个终态名）。
5. Cursor "Agent Review" / "Bugbot" / "Security Review" 的判决语义与是否留存"被审的那一份"。
6. `.agents/skills` 作为跨宿主约定路径的正式程度（本次只验证到 `.claude/skills` 与 SKILL.md 规范）。
7. 任何"stars 排名"这类横向结论都受时间影响，仅代表 2026-11-23 快照。
