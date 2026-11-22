# deed 的类目与命名：这一行现在怎么叫它，以及"这不就是 X 吗"的候选清单

调研时间基准：2026-11-23（会话本地时间）。所有判断以该日为准；工具演进很快，每条尽量带日期与版本。
方法：优先官方文档 / 仓库源码 / 论文 / 规范；厂商博客与营销页只用来**识别宣称**，不当事实。凡未读到原始出处的，标"未验证"。

---

## 0. 一句话判定（先给结论，后面是证据）

这一行的类目词都在描述**"agent 怎么干得更好"**（context、harness、orchestration、spec、loop）；deed 描述的是**"人怎么敢放行"**。它落在 assurance / change control 这一支，而不是 orchestration / context 那一支。行业里已有两个现成名字可以挂靠：**AI change provenance（变更溯源与变更控制）** 与 **work ledger for agents（工作台账）**。deed 的独有动作是：把"谁有权判"的判据也放进账本，并且**判决必须回答"交出去的那一份"**（指纹绑定）。这一点我查到的所有同类都停在门外。

---

## 1. 现成的类目词：谁在用、指什么、能不能装下 deed

| 类目词 | 谁在用（可核） | 指什么 | 能否装下 deed | 缺口 |
|---|---|---|---|---|
| **spec-driven development** | GitHub Spec Kit（2025-09，https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/ ）、AWS Kiro（2025-07，https://www.computerweekly.com/blog/CW-Developer-Network/AWS-launches-Kiro-IDE-for-real-agentic-development-at-scale ）、Backlog.md、OpenSpec | 先写规格 → 设计 → 任务 → 实现，规格是流程中心 | 装得下"承诺"，装不下"判决" | 规格是**输入**，不是**证据**；没有"谁交了哪一版 / 谁判的 / 指纹变了旧判决是否作废" |
| **context engineering** | Anthropic 2025-09-29 官方文（https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents ）；Karpathy 2025-06 在 X 起势（转引：https://github.com/parallel-web/parallel-llms-txt/blob/3261592d314c7afc76b0cc039ddba787e364dd79/public/articles/what-is-context-engineering.md ，原始推文未验证） | 让样本里的 token 配置最可能产出目标行为 | 只装下"agent 记得什么" | 把失忆当**预算问题**；deed 把它当**事实来源问题**（能重算的才不落盘） |
| **harness engineering** | Mitchell Hashimoto 2026-02-05 博文、OpenAI 官网 https://openai.com/index/harness-engineering/ （中文转述：https://www.163.com/dy/article/KRM8S4CN0514BQ68.html ，日期未核）；morphllm 2026 词条 https://www.morphllm.com/harness-engineering | 围绕模型的运行环境：工具、约束、反馈回路、规则文件 | 装得下 deed 的外围设施（doctor、只读宿主规则、零依赖） | harness 的判据在 agent 内部或 CI；deed 的判据是账本投影。二者可叠加，不是同义 |
| **loop engineering** | 小众。2026 年出现 "Loop Engineering Is Dead"（https://development-wiline-website.wiline.com/blog/ai-news/loop-engineering-graph-engineering-what-survives ） | 单 agent"目标→选工具→执行→回灌"的循环设计 | 装不下 | 单体循环；deed 是多主体（人+若干 agent）的跨会话机制 |
| **agent orchestration** | Gas Town（Yegge 2026-01-01，https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04 ）、LangGraph / CrewAI / OpenAI Agents SDK / Claude Agent SDK、swarmgit（PyPI） | 派活、调度、并行、合并队列 | 不装，而且**故意**不装（deed 不做自动派活） | 正交。但外部第一反应几乎一定把它归到这里 |
| **agent operating system** | AIOS 论文 2024-03（https://arxiv.org/abs/2403.16971 ）；A2A / AG-UI 语境 | OS 级调度、资源、模块管理 | 装不下 | deed 无调度器、无运行时、无常驻进程 |
| **agentic SDLC** | PyPI 包 agentic-sdlc（https://pypi.org/project/agentic-sdlc/1.0.0/ ）、大量咨询/厂商博客 | 把 SDLC 各阶段交给 agent | 语义最宽，名义上装得下 | 已被厂商稀释成"我们有 AI 全流程"；没有机制含义，读者无法据此预期行为 |
| **AI governance for coding agents** | acc（noru，v0.8.0，https://github.com/noru-tech/agent-change-control ）；@tedix/agent-governance；EU AI Act 第 12 条 record-keeping（https://artificialintelligenceact.eu/article/12/ ） | 控制点、留痕、职责分离、可审计 | 装得下，且是**最接近**的公共类目 | 治理工具默认"真相在平台/CI"，不默认"真相在仓库内、参与者自己写的账本" |
| **workflow-as-code / process-as-code** | process-as-code（https://github.com/dkharlanau/process-as-code ）、Temporal | 流程定义为可执行、可版本化的契约 | 装不下 | deed 不执行流程，只记账+算判据；流程引擎要重放执行，deed 只重放事实 |
| **ritual / ceremony** | Scrum 的 ceremony（站会 / 评审 / 回顾）；中文解释见 https://www.chandao.com/blog_zentaosoft/81333.mhtml | 有固定形式的定时活动 | 概念上可比（review / sign 是仪式），机制上不装 | ceremony 没有账本，靠日历和人对齐；deed 把仪式**变成事件** |
| **work ledger（工作台账）** | **已经有人在用**：Hive ADR-0004 "Beads work ledger"（https://github.com/hivecommons/hive/blob/v5/src/docs/adr/0004-beads-work-ledger.md ）；Beads / Gas Town 的 data plane | 每个 agent 一本 git 支撑的 JSON 台账，claim / close 工作项 | **最接近的现成名字** | 他们的 ledger 是调度队列，真相可变、可压缩；不是判据来源 |
| **blackboard architecture** | 1980s Hearsay-II 传统；2026 年回潮：SE-Blackboard（IEEE，https://ieeexplore.ieee.org/document/11527206/references ）、arXiv 2510.01285 | 共享黑板 + 独立知识源协作 | 装得下"共享状态" | 没有权限模型：谁都能写黑板，谁都能读，没人"判" |
| **verification（验证债 / verification debt）** | Sonar 调查经 VMblog 新闻稿（https://vmblog.com/news/sonar-data-reveals-critical-verification-gap-in-ai-coding-96-dont-fully-trust-output-yet-only-48-verify-it/ ，原始方法未验证）；Karate Labs 博文（营销页，https://karatelabs.io/blog/ai-verification-debt ） | 生成变便宜后，验证成为瓶颈 | 这是**问题命名**，不是产品类目 | 命名了痛，没有给出"谁能判"的机制 |

**小结**：以上 13 个词里，只有 3 个（governance、work ledger、change control / provenance）能装下 deed 的"判决"部分；能同时装下"判决 + 下一步"的一个都没有。

---

## 2. 人们现在到底在抱怨什么（可直接当卖点素材的引用）

### 2.1 "人在环里"是幻觉

Hacker News，Ask HN，id 48173182，"6 months ago"（相对 2026-11 ≈ 2026-05）：

> "Agents, in most cases, impersonate the human operator, by design, with no way to enforce, disclose, or control it. I believe this is causing an illusion of human in the loop."
> "All commits, pushes, PRs, and PR comments are all going to appear as the developer whether they wrote them or not."
> "we allow AI to review and approve its own code with an illusion of a human in the loop without leaving any traces."

出处：https://news.ycombinator.com/item?id=48173182

这段是 deed 最硬的靶子：deed 的 sign（只认原话）、"交付过这一段的 by 不能判这一段"、"结论只回答交出去的那一份"逐条对应上面三句。注意作者还点出一个 deed 没覆盖的洞：**agent 用人的 OAuth 身份行动**——这属于身份层，deed 不解决，别在 README 里暗示解决了。

### 2.2 审查走过场（中文一手人话）

V2EX 1179436「你愿意阅读同事用 AI 生成的代码吗?」：

> "正在审阅代码的我突然不想看了, 让 AI 审核扫一遍没问题就行. 功能能跑就行."

出处：https://global.v2ex.co/t/1179436

V2EX 1178235「有用 AI 写线上代码的么」：

> "AI 写的代码，线上跑半年多了，个人经验是，AI 写的代码必须要 review 和测试，要不然容易踩坑。"
> "看同事的 AI, 没注释, 还拆了很多小方法, 各种类调用, 有点过度设计的感觉, 阅读性有点差"

出处：https://global.v2ex.co/t/1178235

### 2.3 跨会话失忆 → 人们用"交接文档"当记忆

smzdm 长文（转述上百条评论，2026）：

> "几百行的时候它全看得见，几万行以后它只看得到你喂给它的那几个文件，上下文一断就开始瞎改"
> "1.6万赞的 Codex 帖带火了一个收尾习惯：关会话前，先让它写「交接文档」存进 HANDOFF.md"

出处：https://post.smzdm.com/p/a26x9dnd/

80aj（2026-06-11）：

> "在发现AI理解出现明显偏差时，不要继续纠缠，而是应立即要求AI撰写一份详细的「交接文档」…这份文档充当了外部记忆"

出处：https://www.80aj.com/2026/06/11/ai-coding-context-reset/

这条是 deed 最好的对照组：**整个中文实践圈的解法是"写一份交接文档"**。文档的问题是：谁写的、写的是哪一版、下一班的人凭什么信。deed 用账本 + 证据指纹回答这个"凭什么"。README 里直接对打 HANDOFF.md 会比讲抽象机制有效。

阿里云开发者文章「为什么你的 Coding Agent 每次都在从零开始？」给的解法是"记忆层 / 实体卡片 / 记忆图谱"（https://developer.aliyun.com/article/1758959 ）——同一条痛，另一种解法（检索），可以并列引用。

### 2.4 有人已经把"日志=记忆"讲出来了

deja-vu 文档（中文）：

> "会话期间，智能体的记忆就是上下文窗口；会话结束，窗口被丢弃。留下来的是一份会话记录，由工具自己写…第三条路把日志本身当成记忆。"

出处：https://github.com/vshulcz/deja-vu/blob/0e5680e41bd3ad4b883273ad0fc4d55001527682/docs/zh/guide/forgetting.html

类似产品：lerim（"Your coding agents forget everything after each session"，https://pypi.org/project/lerim/0.1.51/ ）。它们把日志当**记忆**；deed 把日志当**权威**。这一步之差就是类目之差。

### 2.5 多 agent 互相踩

dos-kernel 文档标题即抱怨：

> "Two Claude Code agents on one branch keep clobbering each other"
> 解法："Lease the file regions and decide admission before each write — disjoint agents run, colliding ones wait."

出处：https://github.com/anthony-chaudhary/dos-kernel/blob/ecf0c119006a4c1d0245e53f542f9aa32142a725/docs/answers/two-claude-code-agents-on-one-branch.md

注意：这类解法是**运行时锁**（lease / admission），deed 是**事后可算的账**。别把 deed 说成"防冲突"，它不是。

### 2.6 "agent 说 done，谁说了算"

一篇直接命中 deed 主题的文章："When an AI Agent Says 'Done,' Who Decides?"（https://jvsmanagement.com/definition-of-done-ai-agents/ ），把 Definition of Done 扩展到 agent。这是**同名问题的公开讨论**，可作为"这个词已经有热度"的证据，但它没给机制。

### 2.7 配置层没人管（量化证据）

arXiv 2606.26924（2026-06）《A Deterministic Control Plane for LLM Coding Agents》摘要：

> 10,008 个公开仓库、6,145 个 agent 配置文件；"10.1% of tracked paths are SHA-256 exact duplicates across independent repositories"；"58% single-commit"；不到 1% 的 agent 配置声明了权限边界。

出处：https://arxiv.org/abs/2606.26924

这篇同时是"这不就是 X 吗"的头号对手（见 3.7 与第 5 节）。

### 2.8 信任缺口（数字要打问号）

Sonar 调查经 VMblog 新闻稿转述：96% 不完全信任 AI 生成代码功能正确，仅 48% 总是检查后提交（https://vmblog.com/news/sonar-data-reveals-critical-verification-gap-in-ai-coding-96-dont-fully-trust-output-yet-only-48-verify-it/ ）。
**未验证**：只读到新闻稿，没读到 Sonar 原始报告与问卷方法，引用时必须写"厂商新闻稿转引"。

---

## 3. 十个"这不就是 ___ 吗"

每个给：质疑者为什么有道理 / 真正的分界在哪。写 README 时这十条就是 FAQ。

### 3.1 这不就是 GitHub 的 required review + dismiss stale approvals 吗？
- 有理：GitHub 原生就能"推送新提交后作废旧批准"，和"指纹不符旧判决作废"形状一样；acc 的规则里也有 stale approval 这一类。
- 分界：GitHub 绑定的是 **commit**，不是**承诺的纸**；作废是**状态变更**（批准消失），不产生"这个判决因证据变化而无效"这一**事实**，也无法回答"当时判的是哪一版、判词是什么"。deed 的 review.brief 把"路径+sha256"写成事实，judge --rework 是**追加**一个作废事件，旧结论仍然可读。

### 3.2 这不就是 Jira / Linear 的 workflow + Definition of Done 吗？
- 有理：讨论 / 执行 / 验收就是三段状态机；DoD 就是"做完的标准"；Jira 也有 audit log。
- 分界：Jira 的状态是**被写的字段**，任何人（含 agent）可改，改完只剩一条日志；deed 的状态是**算出来的投影**，没有状态文件可改，只能追加事件。这是"谁能改"与"只能追加"的区别，不是 UI 的区别。

### 3.3 这不就是 ADR / 决策日志吗？
- 有理：只追加、纯文本、进仓库、按时间、可 diff——形态完全一致。
- 分界：ADR 记"决定了什么"，不记"谁交了什么、谁判了、判的是哪一版"，也没有**执行权**（ADR 不能拦交付）。deed 的账本要被规则读，用来决定"能不能放行"。

### 3.4 这不就是 event sourcing / CQRS 吗？
- 有理：append-only log + projection + 纯函数 fold，就是 ES 的标准形状。
- 分界：ES 通常**持久化投影/快照**（read model、checkpoint）；deed 拒绝落盘派生状态，并要求"同数据同字节"（fold 不读时钟、不读环境）。在 ES 里这是可选优化，在 deed 是**不变式**。且 ES 不规定"谁能判"。

### 3.5 这不就是 Temporal 的 durable execution 吗？
- 有理：都回答"崩了以后从哪继续"。
- 分界：Temporal 重放的是**代码执行的确定性**（需要 side-effect 记录、要 worker）；deed 重放的是**人机承诺的状态**，零运行时、不调度、不重试。反证：Gas Town 明确把自己的 NDI 定位成"Temporal 确定性重放的替代品"——那才是同类，deed 不是。

### 3.6 这不就是 Beads / Gas Town 吗？
- 有理：Beads 自称 "persistent, structured memory for coding agents"，有 claim / close、audit trail、git 支撑、离线；Hive 的 ADR 干脆叫它 "work ledger"。
- 分界：Beads 是**可变行 + compaction**——"语义记忆衰减"把已关闭任务摘要掉，历史被改写；deed 一行一事实、只追加、永不摘要化。Beads 判"工作是否 ready / closed"，deed 判"这一版承诺是否被独立的人审过"。

### 3.7 这不就是 acc（agent-change-control）吗？
- 有理：four-eyes、独立人、离线确定性、digest、in-toto、stale approval、"一个人类判断、两个登录"——几乎逐条对上。这是目前最危险的对比。
- 分界：acc 的真相在 **forge**（GitHub / GitLab API 快照，bounded pages，自述 "best-effort snapshot, not an atomic historical archive"，见其 "What does acc not do" 一节）；deed 的真相在**仓库内的账本**（随工作区提交，参与者写）。acc 判 PR，不判"会话 / 段"，没有签收、没有下一步、不能凭账本重算整段历史（只能重扫窗口）。换句话说：acc 是看完以后打分，deed 是边干边记账。

### 3.8 这不就是 in-toto / SLSA 供应链证明吗？
- 有理：sha256 subject + "谁" + 可验证，形态一样；acc 直接输出 in-toto Statement。
- 分界：供应链证明证明"这些字节由哪条流水线产出"；deed 的指纹证明"人要审的是这一版文件"，并且拒绝的是**判决本身**（指纹不符 → 结论无效）。这是评审语义，不是构建语义；deed 也没有签名链与信任根。

### 3.9 这不就是 LangSmith / Langfuse 的 trace 吗？
- 有理：都记录"发生过什么"，都是事件流，都能回放。
- 分界：trace 是**给人看的事后面板**，不产生权限；deed 的账本是**给规则读的**（谁能判、能不能放行），面板只读。一个是可观测性，一个是权限。

### 3.10 这不就是区块链 / 不可篡改账本吗？
- 有理："只追加 + 哈希"就是区块链的叙事；deed 的证据用 sha256。
- 分界：没有共识、没有多方互不信任、没有链式哈希（deed 只有文件 sha256，不是 hash chain），单工作区不需要拜占庭容错。deed 要的是"人能读、能 diff、能提交"，正好和链相反。

---

## 4. 类目名候选（英文短语，可搜索，不像营销词）

1. **append-only work ledger**
   - 优点：已经有人用过（Hive ADR-0004），搜索可命中；"append-only" 自带机制含义，不容易被读成又一个 agent 框架。
   - 风险：ledger 在工程语境常指数据库 / 分布式账本，会被误读成 infra；金融 / 区块链撞词。
2. **AI change provenance / change control for agents**
   - 优点：已有公开规范在用这个名（AI Change Provenance 0.4，https://github.com/noru-tech/agent-change-control/blob/main/spec/ai-change-provenance.md ），企业 / 审计侧听得懂，SEO 有基础。
   - 风险：已被 acc 占住，且其语义是"变更（PR）级"；deed 要挂靠就得解释"我们把它从 change 扩到 commitment / session"，否则像子集。
3. **evidence-bound review**（或 evidence-gated delivery）
   - 优点：精准描述"结论必须回答交出去的那一份"；没有营销味；可与上面任一类目组合。
   - 风险：听起来像审计产品；只覆盖审查，漏掉"下一步谁动"。
4. **separation of duties for coding agents**（口语：four-eyes for agents）
   - 优点：搜索量真实（银行 maker-checker、SOX SoD 的人会搜这个）；一句就懂。
   - 风险：acc 的副标题就是 "Enforcing the four-eyes principle for coding agents"；听起来是"一个控制"，不是一个工作区机制。
5. **agent lab notebook / ELN for agents**
   - 优点：ELN（电子实验记录本）是成熟品类词，天然包含"只追加、可归属、见证签字、可辩护"（https://en.wikipedia.org/wiki/Electronic_lab_notebook ）；买家词汇现成。
   - 风险：容易被读成"笔记 / 文档工具"；ELN 行业带强合规预期（21 CFR Part 11），会拉高对签名与验证的期待，deed 目前给不出。

**建议**：类目用 1 或 2（描述"这是什么"），卖点用 3（描述"别人做不到的那一步"）；4 用来做对比页；5 留给跨界叙事（若要做研发 / 合规市场）。

---

## 5. 要害：谁已经在用"账本 / 台账"讲 agent 协作，他们停在哪一步

| 谁 | 用的词 | 停在哪一步 |
|---|---|---|
| Hive（ADR-0004） | **beads work ledger**，"git-backed JSON ledger per agent" | 停在**调度队列**：ledger 回答"哪些工作 ready / 谁 claim 了 / 何时 close"，真相可变，判据是"能否开工" |
| Gas Town / Beads（Yegge，2026-01） | data plane（Beads 与 etcd 类比）、persistent memory | 停在**调度与持久化**：GUPP"钩子上有活就必须跑"，没有任何"谁能判"的规则 |
| Rel(AI)Build（arXiv 2606.26924，2026-06） | **hash-chained audit logs** + phase state machine + requirement→file→test 追溯 | 停在**旁路审计**：日志是给合规看的记录，判据在 harness 配置层；论文自述 "conformance tests… developer outcomes remain future work" |
| acc（noru，v0.8.0） | change control / AI Change Provenance | 停在**事后扫描**：真相在 forge 快照，判据在 CI，账本不在仓库里 |
| ai-agent-ledger（PyPI 0.2.1） | **ledger / chain of custody**，"re-check every digest, chain link and signature" | 停在**证据核验**：能查"这条链是否被改过"，不产出状态、不回答下一步 |
| agent-whiteboard（miller46） | **append-only event log** + materialized state + compact() | 停在**存储层**：把派生状态 state.json 落盘并允许压缩——正是 deed 拒绝的"能重算的不落盘" |
| deja-vu / lerim | "把日志本身当成记忆" | 停在**上下文**：日志只服务 agent 记得什么，不服务"谁有权判" |
| AxonIQ / Akka | "event sourcing for agentic systems"、"tamper-proof record" | 停在**卖基础设施**：判据留给用户自己写 |
| 龙门客栈（中文，OpenClaw 生态） | **账房先生记功**、工作量积分 | 停在**激励 / 统计**：分是算出来的，但没人凭分拦交付（https://lethechen.github.io/openclaw-longmen-inn/ ） |
| 中文实践圈的 HANDOFF.md | 交接文档 = 外置记忆 | 停在**文档**：不可验证（谁写、哪一版、有无篡改） |

**结论**：账本隐喻被用过至少 5 次（work ledger、audit log、chain of custody、event log、记功），但每一次都停在"记下来给人看 / 给调度用 / 给合规交"。**没有一个人把账本当作"谁有权判、这一版是否被审过"的判据来源。** 这就是 deed 的空位；README 应当直接占这句话，而不是说自己"是议事机制"。

---

## 6. 越界发现（怎么走过去的、那边有什么）

按线索走，走出了"编码 agent"三个域：

1. **从 acc 的 four-eyes → 银行内控**：maker-checker / dual approval，"第一人创建、第二人授权"（Citi 的 dual approval 说明 PDF：https://businessaccess.citibank.citigroup.com/basprod/citiiwt/images/Dual_Approval.pdf ）；再往上是 SOX 的 segregation of duties（https://www.zluri.com/blog/what-are-sox-controls ）。
   → 这一支的成熟说法是 **"maker 不能是 checker"**，比 deed 现在口语化的"交付者不能判自己交付的段"更容易被非工程读者接受，术语可直接借。
2. **从 acc 的 hash-chained audit log → 药监 / GMP 数据完整性**：21 CFR 11.10(e) 要求 "secure, computer-generated, time-stamped audit trails" 独立记录创建 / 修改 / 删除（https://ecfr.io/Title-21/Section-11.10 ）；ALCOA+ 原则（attributable, legible, contemporaneous, original, accurate；MHRA 2015 解释：https://mhrainspectorate.blog.gov.uk/2015/07/14/good-manufacturing-practice-gmp-data-integrity-a-new-look-at-an-old-topic-part-2/ ）。
   → deed 的账本天然满足 A/L/C/O/A 中的四项，**唯一缺口是"不可否认"**（没有签名）。这条既是最强的类比，也是最容易被专业读者挑刺的地方：别声称合规。
3. **从"验收 / 签收"→ 航空维修放行**：FAA 的 "Approval for Return to Service" 要求记录里含"签名、执照号、执照种类"（https://www.faa.gov/sites/faa.gov/files/2022-01/Approval%20for%20Return%20to%20Service.pdf ）。
   → "放行"（release / return to service）是一个有 80 年历史的词，比"验收"重。deed 的 sign 可以借 release 这个词。
4. **从"只追加 + 见证"→ 电子实验记录本（ELN）**：品类定义见 https://en.wikipedia.org/wiki/Electronic_lab_notebook ，核心是"contemporaneous、attributable、witnessed、legally defensible"。
   → 这是唯一一个**买家已经接受"日志就是法律记录"**的软件品类。若 deed 往研发 / 受监管行业讲故事，ELN 是最短路径，但也最容易被要求签名与验证。
5. **从"共享状态"→ 黑板架构**：1980s Hearsay-II 传统；2026 年有 SE-Blackboard（IEEE 11527206）与 LLM blackboard 论文（arXiv 2510.01285）。
   → 黑板解决"多方共享一块状态"，但不解决"谁有权写 / 判"。deed 与它的分界正好是**权限**，这是一句可以写进 README 的对照。
6. **从"派生状态"→ Kubernetes 的 etcd + reconcile**：Yegge 自己就拿 etcd 类比 Beads。
   → k8s 的"期望状态 vs 观察状态、控制器反复调和"是**已经普及的"从事实算状态"心智**。deed 的 fold 约等于 reconcile 的只读版；差别是 k8s 会把状态写回 etcd，deed 不写。
7. **（未深入，标未验证）** CRDT / 协作编辑的"只追加 op log + 收敛"——形似，但目标是并发合并，不是判定权限。

---

## 7. 给 README 的定位建议（基于以上证据，不是文案创作）

**类目句**（第一段就该出现"台账"和"放行"，不要出现"议事"）：

> deed 是一个工作区的**只追加台账**：谁承诺了什么、谁交了哪一版、谁判的、下一步谁动——全部从账本算出来，账本随仓库提交。

对照句（三选一，按受众）：

- 对工程读者：「不是又一个 agent 编排器。编排器决定 agent 干什么；deed 决定人敢不敢放行。」
- 对团队读者：「HANDOFF.md 是备忘录，deed 是台账。备忘录谁都能改，台账只能追加，而且判词必须回答交出去的那一份。」
- 对审计 / 管理读者：「把一个变更从'某人说做完了'变成'某个独立的人对某一版文件签了字'。」

**不要用的词**（已被占且会引来错误对比）：agent orchestration、agent OS、workflow engine、memory layer、AI governance platform。前三个把 deed 拉进它明确不做的领域，后两个把它的判据说成"平台"或"记忆"。

---

## 8. URL 清单（按出现顺序去重）

1. https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/ — GitHub Spec Kit，2025-09
2. https://www.computerweekly.com/blog/CW-Developer-Network/AWS-launches-Kiro-IDE-for-real-agentic-development-at-scale — Kiro，2025-07
3. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents — 2025-09-29
4. https://github.com/parallel-web/parallel-llms-txt/blob/3261592d314c7afc76b0cc039ddba787e364dd79/public/articles/what-is-context-engineering.md — 词源转引（原始推文未验证）
5. https://openai.com/index/harness-engineering/ — OpenAI harness engineering（日期未核）
6. https://www.163.com/dy/article/KRM8S4CN0514BQ68.html — 中文转述 Hashimoto 2026-02-05 / OpenAI 2026-02-11（未核）
7. https://www.morphllm.com/harness-engineering — 厂商词条（宣称）
8. https://development-wiline-website.wiline.com/blog/ai-news/loop-engineering-graph-engineering-what-survives — loop engineering 小众用法
9. https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04 — Gas Town，2026-01-01
10. https://raw.githubusercontent.com/hhellbusch/my-ai-workspace/refs/heads/main/.planning/paude-integration/references/yegge-gas-town.md — Gas Town 结构摘要（二手，详细）
11. https://github.com/steveyegge/beads — Beads README（Dolt、compaction、claim/close）
12. https://arxiv.org/abs/2403.16971 — AIOS，2024-03
13. https://pypi.org/project/agentic-sdlc/1.0.0/ — agentic SDLC 包
14. https://github.com/noru-tech/agent-change-control — acc v0.8.0，four-eyes / AI Change Provenance 0.4
15. https://github.com/noru-tech/agent-change-control/blob/main/spec/ai-change-provenance.md — 规范
16. https://artificialintelligenceact.eu/article/12/ — EU AI Act 第 12 条 record-keeping
17. https://github.com/tedix-hq/tedix/blob/c32f89da1382f3c5842612cb8d386ed6458573ac/packages/agent-governance/README.md — @tedix/agent-governance
18. https://github.com/dkharlanau/process-as-code — process-as-code
19. https://www.chandao.com/blog_zentaosoft/81333.mhtml — Scrum ceremony 中文解释
20. https://github.com/hivecommons/hive/blob/v5/src/docs/adr/0004-beads-work-ledger.md — "beads work ledger"（关键）
21. https://ieeexplore.ieee.org/document/11527206/references — SE-Blackboard
22. https://vmblog.com/news/sonar-data-reveals-critical-verification-gap-in-ai-coding-96-dont-fully-trust-output-yet-only-48-verify-it/ — Sonar 数字（新闻稿转引，未验证）
23. https://karatelabs.io/blog/ai-verification-debt — verification debt（营销页）
24. https://news.ycombinator.com/item?id=48173182 — HN：AI impersonation in code reviews（≈2026-05）
25. https://global.v2ex.co/t/1179436 — V2EX：审查走过场
26. https://global.v2ex.co/t/1178235 — V2EX：AI 代码必须 review
27. https://post.smzdm.com/p/a26x9dnd/ — 上下文失忆 + HANDOFF.md 习惯
28. https://www.80aj.com/2026/06/11/ai-coding-context-reset/ — 2026-06-11 交接文档
29. https://developer.aliyun.com/article/1758959 — ContextDB / 记忆层（中文）
30. https://github.com/vshulcz/deja-vu/blob/0e5680e41bd3ad4b883273ad0fc4d55001527682/docs/zh/guide/forgetting.html — "把日志本身当成记忆"
31. https://pypi.org/project/lerim/0.1.51/ — lerim
32. https://github.com/anthony-chaudhary/dos-kernel/blob/ecf0c119006a4c1d0245e53f542f9aa32142a725/docs/answers/two-claude-code-agents-on-one-branch.md — 多 agent 互踩 + lease
33. https://jvsmanagement.com/definition-of-done-ai-agents/ — "When an AI Agent Says Done, Who Decides?"
34. https://arxiv.org/abs/2606.26924 — Rel(AI)Build / 确定性控制面（2026-06）
35. https://github.com/miller46/agent-whiteboard — append-only event log + state.json + compact()
36. https://pypi.org/project/ai-agent-ledger-py/0.2.1/ — chain of custody ledger
37. https://lethechen.github.io/openclaw-longmen-inn/ — 龙门客栈：账房先生记功
38. https://businessaccess.citibank.citigroup.com/basprod/citiiwt/images/Dual_Approval.pdf — maker-checker / dual approval
39. https://www.zluri.com/blog/what-are-sox-controls — SOX SoD
40. https://ecfr.io/Title-21/Section-11.10 — 21 CFR 11.10(e) audit trail
41. https://mhrainspectorate.blog.gov.uk/2015/07/14/good-manufacturing-practice-gmp-data-integrity-a-new-look-at-an-old-topic-part-2/ — ALCOA+（MHRA 2015）
42. https://www.faa.gov/sites/faa.gov/files/2022-01/Approval%20for%20Return%20to%20Service.pdf — FAA return to service
43. https://en.wikipedia.org/wiki/Electronic_lab_notebook — ELN
44. https://arxiv.org/abs/2510.01285 — LLM blackboard 论文（2025-10）
45. https://simonwillison.net/2026/Feb/7/software-factory/ — StrongDM "software factory"，2026-02-07
46. https://www.taskade.com/blog/ai-software-factory — Dan Shapiro "Level 5 dark factory"，2026-01（厂商博文转述，原始命名未验证）
