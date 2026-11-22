# 历史：一个新层如何进入开发工具链并成为标准

抓取时点：2026-11-23（Asia/Shanghai）。作者：subagent layerprecedent。
口径：一手优先（邮件列表、实现者写的书、项目官方博客、规范正文、文档仓库 raw markdown、发布公告）；厂商营销页只用于识别宣称。
标注：**【史实】**＝读到原始出处；**【判断】**＝由史实推出的架构结论；**【未验证】**＝日期/细节未逐条复核。

---

## 0. 结论（300 字，给 lead）

deed 不是 VCS、CI、IaC、GitOps 中任何一层的另一种实现：那些层的事实（内容、构建、资源、部署）它一条都不拥有，只引用外部证据（命令输出 + 文件 sha256）。它申请的是"意图 / 进度 / 决定 / 授权"这一层。今天这层不存在，只有四块碎片：issue tracker 管进度、ADR 管决定的理由、PR review 管批准、HANDOFF.md 管交接；四者里只有 PR review 持有"授权绑定内容"这一事实，而且只对 diff 成立。

历史给出的判据有五条：事实缺口、载体、可重算、平台默认、中立化。deed 满足前三条（账本在仓库里、fold 是纯函数、事故类型反复），不满足后两条（没有平台把决定账本设为默认，没有中立规范）。所以它处在 GitOps 2017-08 的位置，不是 K8s 2019 的位置：**是"层候选"，不是"已成立的层"**。

最先被替代的不是 issue tracker，是 HANDOFF.md / 会话交接文档；其次是 ADR；PR 审批不会被替代，会被吸收成一个事件类型。

---

## 1. 我按什么看每个案例

每个案例回答同一组问题，答案决定它和 deed 的关系：

1. **占哪一层**：它拥有哪个别人不拥有的事实？
2. **拒绝拥有什么**：它明确不碰的事实是什么？（拒绝清单比功能清单更能定位层）
3. **接口**：它靠什么嵌进现有工作流——仓库里的文件？提交信息里的一行？HTTP 头？socket？钩子？插件？
4. **触发条件**：它成为标准靠什么外部条件（不是"做得好"）：某类事故反复发生 / 某个平台的默认选择 / 某种监管或生态压力。

---

## 2. 九个案例

### 2.1 VCS：CVS → SVN → git

**占的层**：内容的历史——哪个字节在什么时候被谁改成什么。

**CVS 的模型缺口（这是"层"的起点，不是功能缺点）**：CVS 的版本号按文件计，数据模型里没有"一次变更"这个对象；重命名不可追；历史只在服务器上。所以"这次提交动了哪三个文件、能不能整体回滚"在 CVS 里**无处安放**。

**SVN**【史实】："In early 2000, CollabNet, Inc. … began seeking developers to write a replacement for CVS"，目标是 "retaining the basic ideas of CVS, but without the bugs and misfeatures"，2000 年 2 月动工（https://svnbook.red-bean.com/en/1.8/svn.intro.whatis.html）。SVN 的新对象是**全局修订号**（一次提交=一个 rN）；接口是工作副本 + 客户端 + DAV/HTTP + 钩子（pre-commit/post-commit）；拒绝拥有构建、发布、评审。

**git**【史实】：2005-04-06 Linus 在 LKML 写 "Kernel SCM saga.."："we've been trying to work out a conflict over BK usage … the kernel team is looking at alternatives"（https://lkml.iu.edu/hypermail/linux/kernel/0504.0/1540.html）。触发条件是**供应商撤权**，不是技术优劣——这是"外部事故"型触发的原型。

**它为什么成为标准**【判断】：触发（撤权）只解释了 git 的诞生；git 成为标准靠另外两条——(a) 每个克隆都有完整历史，事实可离线重算，接口是 .git 目录 + 传输协议，不需要中心服务器；(b) 2008 年之后 GitHub/GitLab 把托管 + fork + PR 做成默认路径（平台默认）。

**对 deed 的直接教益**：SVN 赢 CVS 靠"同一工作流 + 零迁移成本 + 少缺陷"，不是靠更强；git 赢 SVN 靠"把真相放到每个人本地"。**层的胜负在载体，不在功能。**

---

### 2.2 CI：Hudson/Jenkins → GitHub Actions

**占的层**：把构建与测试从"事后动作"变成每次变更的固定步骤。

**Hudson→Jenkins**【史实】：2011-01-29 投票结果 "214 votes to rename, and 14 for the status quo"，起因是 Oracle 申请 Hudson 商标（https://www.jenkins.io/blog/2011/01/29/jenkins/）。一个层被商标事件改名而照常运转，这本身就是"层与实现可分"的证明。

**Jenkins 的架构位置缺陷**【判断】：job 定义活在 Jenkins 自己的配置里，不在仓库里——所以它不可 review、不可复现、不可 diff；插件与升级是运维负担。它拥有"构建怎么跑"，但这份事实没放进被版本化的载体。

**Actions**【史实】：2019-11-11 GA，"GitHub Actions are free for all public repositories"（https://github.blog/changelog/2019-11-11-github-actions-is-generally-available/）。真相 = 仓库里的 workflow YAML；接口 = 仓库文件 + 平台事件（webhook）+ marketplace action；拒绝拥有源码托管与评审。

**触发**【判断】：载体（repo 内 YAML）+ 平台默认（代码所在平台自带 CI，public 免费）。独立 CI 服务器在开源侧被挤到边上，不是因为不能跑，是因为"多一个要登录、要维护、要装插件的服务"。

**教益**：CI 的真相从服务器搬进仓库文件那一刻，它才从"一个工具"变成"默认路径"。

---

### 2.3 IaC：Chef/Puppet → Terraform

**占的层**：基础设施的期望状态。

**史实骨架**：Puppet 2005、Chef 2009、Salt 2011、Ansible 2012（https://lab.sub.uni-goettingen.de/config-management.html）；Terraform 0.1 于 2014 年 7 月发布，"cloud-agnostic infrastructure as code"（HashiCorp 官方叙述，页面本次抓取 429 限流，引文取自搜索摘要，**【未验证】逐字**；首 commit 2014-05-21 见第三方 lore 页，同标未验证）。

**新事实**：跨云资源图 + state + plan。接口 = HCL 文件 + **provider 插件**（加一朵新云是外挂，不是改核心）+ plan/apply 的可审 diff；拒绝拥有云 API 的实现与运行中的应用。

**触发**【判断】：云 API 数量爆炸使"核心支持所有云"不可维护 → 插件化（载体判据的变体：接口稳定，实现可插）；plan 把"将发生什么"变成可审对象，这是 IaC 独有的贡献。

**反证（层的独立性）**：2023 年 Terraform 改 BSL 后出现 OpenTofu 分叉（https://opentofu.org/；日期未逐条核）。**没有中立化（判据 5）的层，会在许可证事件里被撕开；层本身仍活着，换的是实现。**

---

### 2.4 GitOps：Weaveworks 2017 → OpenGitOps

**占的层**：部署的期望状态及其历史。

**原文**【史实】（2017-08-07，archive 抓取 https://web.archive.org/web/2018id_/https://www.weave.works/blog/gitops-operations-by-pull-request）：

- "Git as the Source of Truth"
- "Operational changes are made by pull request (plus build & release pipelines)"
- "Diff tools detect any divergence and notify us via Slack alerts; and sync tools enable convergence"
- "Rollback and audit logs are also provided via Git"

**接口** = 被 Git 托管的期望状态仓库 + 集群内控制器（pull）+ 对账循环；**拒绝拥有** = 运行时实现与"实际状态"（它只负责发现漂移并收敛）。

**触发**【史实+判断】：K8s 让"期望状态"成为可计算对象（原文："Declarative means that configuration is guaranteed by a set of facts instead of by a set of instructions"）；事故类型 = 有人绕过 Git 直接改集群——文章自己举的例子：新同事直接部署了新版本，diff 工具报警。

**标准化路径**【史实】：CNCF GitOps WG → OpenGitOps 四原则（https://github.com/open-gitops/documents/blob/main/PRINCIPLES.md）：

1. Declarative
2. Versioned and Immutable
3. Pulled Automatically
4. Continuously Reconciled

**四原则里一个工具名都没有**——这是"层成立"的文本标志。任何实现（Flux、Argo CD、自写控制器）都能对着这四条被检验。

**与 deed 的关系**【判断】：GitOps 对"部署"做的事，正是 deed 想对"进度与授权"做的事：不可变、版本化、从声明重算。差别是 **GitOps 有 reconciler（自动收敛），deed 只有 state（告诉人/agent 下一步）**。deed 是 reconciler 读的那块数据面，不是 reconciler 本身——这是它的边界，也是它轻的原因。

---

### 2.5 容器与编排：Docker → OCI / K8s

**史实骨架**：Docker 2013-03-15 PyCon lightning talk "The future of Linux Containers"（https://pyvideo.org/pycon-us-2013/the-future-of-linux-containers.html）；镜像 = 内容寻址的层 + registry 分发。

**中立化**【史实】：OCI "launched on June 22nd 2015 by Docker, CoreOS and other leaders"，"Docker is donating its container format and runtime, runC"（https://opencontainers.org/about/overview/）。触发是**单一厂商拥有格式 = 生态风险**（判据 5）。

**接口分离**【史实】：K8s 1.5（2016-12-19）引入 CRI，"a plugin interface which enables kubelet to use a wide variety of container runtimes, without the need to recompile"，kubelet 与 runtime 之间是 **Unix socket + gRPC**（https://raw.githubusercontent.com/kubernetes/website/326befd8147414ecc4c9394682f53fdac2e91ead/content/en/blog/_posts/2016-12-00-Container-Runtime-Interface-Cri-In-Kubernetes.md）。2022 年 v1.24 移除 dockershim（https://kubernetes.io/blog/2022/02/17/dockershim-faq/）——层照常运转，实现被换掉。

**教益**：接口一旦是 **socket / proto / 文件** 而不是某个产品，层就独立了。deed 的接口目前是 CLI 输出（一行"下一步"）+ 仓库里的 JSONL，形态是对的。

---

### 2.6 代码评审：Gerrit → GitHub PR

**占的层**：一次变更"能不能进主干"的判决，以及判决所依据的那一版内容。

**Gerrit**【史实】：Shawn Pearce 为 Android 写，"started the Gerrit Code Review project, which is used for all Android development"（https://sfconservancy.org/blog/2018/jan/30/shawn-pearce/）；2009-02 LWN 公告称其为 "a web based code review system"（https://lwn.net/Articles/319656/）。

**接口（本报告最重要的证据之一）**【史实】：refs/for/<branch> 推送 + **提交信息 footer 里的 Change-Id**。Gerrit 文档原文："Gerrit allows attaching those 2 commits to the same change, and relies upon a Change-Id line at the bottom of a commit message to do so … even across cherry-picks and rebases."（https://gerrit-review.googlesource.com/Documentation/user-changeid.html）

→ 新的"评审对象"没有新建数据库，它**寄生在 git 已有的载体（提交信息的一行）**上。

**GitHub PR**【史实，GitHub 官方文档】：branch protection 把"批准"变成可执行状态机：

- "GitHub records the state of the diff at the point when a pull request is approved. This state represents the set of changes that the reviewer approved. If the diff changes from this state … the approving review is dismissed as stale, and the pull request cannot be merged until someone approves…"
- "You can require that the most recent reviewable push must be approved by someone other than the person who pushed it."
（https://github.com/github/docs/blob/main/content/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches.md）

**这条是 deed 的直接前身**：批准 = 事件；对象 = 内容指纹；内容变 = 作废；批准人 ≠ 推送者。**同一族机制已经在商业平台上落地，只是对象只有 diff 一种。**

**触发**【判断】：fork/pull 模型（邮件补丁没有"待审/已批"状态）+ 平台默认（仓库在哪，评审就在哪）。Gerrit 要自建服务器、要 Change-Id 纪律，所以在开源侧让位给 PR；但在需要严格门禁的组织（Android、OpenStack）里仍是标准——**判据 4 缺位不等于层失败，只等于它没成为默认。**

---

### 2.7 依赖锁定：lockfile

**占的层**：依赖解析结果的事实（"这次装出来的到底是哪棵树"）。

**史实**【史实】：Yarn 2016-10-11 发布，目标是 "manage dependencies consistently across machines or in secure offline environments"（https://classic.yarnpkg.com/blog/2016/10/11/introducing-yarn/）。npm 文档："package-lock.json … describes the exact tree that was generated, such that subsequent installs are able to generate identical trees, regardless of intermediate dependency updates. This file is intended to be committed into source repositories…"（https://github.com/npm/cli/blob/latest/docs/lib/content/configuring-npm/package-lock-json.md）

**接口** = 一个提交进仓库的 JSON；**拒绝拥有** = registry 的内容（它不拥有包，只锁定解析结果）。

**触发**【判断】：registry 可变 + 传递依赖漂移 → "同一个 package.json 在不同时间装出不同树"反复发生；供应链事故把"可复现"从 nice-to-have 变成硬需求。

**边界（对 deed 关键）**：lockfile 只保证**可复现**，不保证**可信**；可信要 attestation/SLSA（另一层）。同理，deed 只保证**可追**，不保证"说的人是谁"——deed README 已把这一点写成已知代价（身份是约定不是鉴权）。

---

### 2.8 可观测性：日志 → trace

**占的层**：一次请求的因果链（request 作为一等对象）。

**接口**【史实】：W3C Trace Context——"standard HTTP headers and a value format to propagate context information"，首个 Recommendation 2020-02-06，本版 2021-11-23（https://www.w3.org/TR/trace-context/）。加 OTLP 与 SDK；拒绝拥有后端存储与查询（vendor 自由）。

**触发**【史实】：OpenTracing 与 OpenCensus 于 2019-05 合并为 OpenTelemetry（https://www.cncf.io/blog/2019/05/21/a-brief-history-of-opentelemetry-so-far/）；2026-05 毕业公告直接称其为 "de facto observability standard"（https://www.cncf.io/announcements/2026/05/21/cloud-native-computing-foundation-announces-opentelemetrys-graduation-solidifying-status-as-the-de-facto-observability-standard/）。驱动力是微服务使"每服务一行日志"无法回答跨进程因果，加上 APM 私有 agent 的锁定。

**教益**：**层的接口可以是一个 HTTP 头。**载体越靠近下层已有协议，越难被替换。

---

### 2.9 反例：ADR（文档型"决定层"）

**史实**【史实】：Nygard 2011 定义 ADR 为仓库里的短文本，"numbered sequentially and monotonically. Numbers will not be reused. If a decision is reversed, we will keep the old one around, but mark it superseded"（https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions）。

**架构位置缺陷**【判断】：它拥有"决定的理由"，拒绝拥有"决定是否仍然有效"——superseded 是手写状态，不是从事实算出来的；ADR 也不绑定它授权的代码状态，所以"决定所依据的那一版"无处可查。这正是 deed 判据 3（可重算）反面的标准案例。

---

## 3. 五条判据（触发条件抽象）

| # | 判据 | 含义 | 历史证据 | 不满足的后果 |
|---|---|---|---|---|
| 1 | **事实缺口** | 现层的数据模型里没有那个对象，事故反复且无法表达 | CVS 无"一次变更"；日志无"一个请求"；diff 无"决定/交接" | 只能靠文档与口头约定补，判据分叉 |
| 2 | **载体** | 新事实能装进下层已有的运输工具：仓库文件 / 提交信息一行 / HTTP 头 / socket / 钩子，不需要新服务器 | yml、Change-Id、lockfile、traceparent、CRI socket | 要自建服务 → 只能进大组织，进不了默认路径（Gerrit、Jenkins） |
| 3 | **可重算** | 新层是下层事实的投影，不存第二份真相 | git 从对象算 tree；K8s 从 spec 算集群；trace 从 span 算 | 第二份真相会腐化（Jenkins job 配置、APM 私有 agent、HANDOFF.md） |
| 4 | **平台默认** | 占默认路径的平台把它设成默认（免费 / 一键 / 无需安装） | Actions 对 public repo 免费；PR 评审在仓库所在平台；Docker Hub | 停在"工具"，随时被平台自带的差版本挤掉 |
| 5 | **中立化** | 接口由中立规范或基金会持有，单一厂商不能关闸 | OCI、OpenGitOps、W3C、OpenTofu（反向证明） | 许可证/商标事件就能把层撕开（Terraform BSL、Hudson 商标） |

**顺序**：1 → 2 → 4 → 5；3 决定哪个实现活到最后。
Gerrit/Jenkins 有 1、2、3 缺 4；Terraform 有 1、2、4 缺 5；GitOps/OTel 走完 1–5，于是名字从产品变成类目。

---

## 4. 用判据检验"意图 / 进度 / 决定 / 授权"

| 判据 | 是否满足 | 证据 |
|---|---|---|
| 1 事实缺口 | **是** | agent 以人的身份提交、审批、评论——"illusion of human in the loop"（HN Ask，https://news.ycombinator.com/item?id=48173182，"All commits, pushes, PRs, and PR comments are all going to appear as the developer whether they wrote them or not"）；批准后内容又变（GitHub 用 stale-approval 机制解决，说明这是长期痛点，但只覆盖 diff）；交接文档漂移（80aj 2026-06-11："这份文档充当了外部记忆"，https://www.80aj.com/2026/06/11/ai-coding-context-reset/） |
| 2 载体 | **是** | .deed/log/YYYY-MM.jsonl 在仓库里，由 git 运输；零运行时依赖；接口是 deed state 的第一行"下一步 · 谁 · 命令" |
| 3 可重算 | **是（有一处弱）** | fold 是纯函数，状态是投影；但 --by 是自述，身份的强度受限于下层——这不是实现缺陷，是层的边界（身份属于宿主/git/OIDC） |
| 4 平台默认 | **否** | 没有任何主流平台把"决定/授权账本"设为默认；GitHub 的默认化止于"diff 的批准"与 rulesets，对象仍是 ref |
| 5 中立化 | **否** | 没有中立格式或规范；JSONL 与 15 种事件是 deed 私有语义；无基金会/规范组织 |

**结论**：3/5。位置相当于 **GitOps 2017-08（有实践、有工具、无默认、无规范）到 OTel 2019-05（两套实现合并、规范草拟）之间**。它不是"已经成立的新层"，是"正在申请成为层"。缺的两条（4、5）都不由 deed 自己决定——要平台或中立组织采纳。

**一个必须说清的边界**【判断】：deed 没有 reconciler。GitOps 的第 3、4 条原则（Pulled Automatically / Continuously Reconciled）在 deed 里退化成"人/agent 每次去问 state"。这既是它轻的原因，也是它不能被叫作 "GitOps for decisions" 的原因——它提供数据面与判据，不提供收敛循环。

---

## 5. 最先被替代的是什么（具体 + 证据 + 阻力）

**排序：HANDOFF.md → ADR →（PR 审批被吸收）→ issue tracker。**

### 5.1 第一：HANDOFF.md / 会话交接文档

理由三条：

1. **读者是 agent**：它不介意形式，只介意"下一步是什么"。deed 的 state 恰好就是这个输出，替换成本一条命令。
2. **它没有可验证性**：无 schema、无署名、无时效、无"写的是哪一版"。80aj 把它定义为"外部记忆"，同文也承认 /compact 会丢细节——即文档方案自己知道自己在漏。
3. **它已经饱和**：smzdm 转述的 1.6 万赞 Codex 帖把"关会话前写交接文档"变成习惯（二手转述，**【未验证】原文**）。习惯一旦普适，替代它的东西只需要"更省事"，不需要"更强"。

**阻力**【判断】：平台自己也在用文档（AGENTS.md、steering、memory 文件），惯性大；deed 要在"每轮 tick"这一层赢，而不是在"文档更好"这一层赢。

### 5.2 第二：ADR

证据：Nygard 原文把 superseded 写成手改标记；ADR 不绑定它授权的代码状态。deed 的 review.brief + briefDigest 正是补这个洞的最小机制。

**阻力**【判断，也是对 deed 的批评】：人要读**理由**，账本擅长记"谁判了什么"，不擅长记"为什么"。ADR 的叙事价值 deed 现在没有对应物；先被替代的会是"ADR 的状态字段"，不是"ADR 的正文"。

### 5.3 不被替代、被吸收：PR 审批

它已经是同族事件（对象 + 指纹 + 不可共手，GitHub 文档原文见 §2.6）。正确做法是**引用** GitHub 的 review id / commit sha 作为外部事实（deed 的 --evidence + --digest 已经能钉住外部产物），而不是自己做一套 PR。把它当竞争对手会输给平台默认（判据 4）。

### 5.4 最后、且只丢一格：issue tracker

issue tracker 拥有"分派 / 优先级 / backlog / 谁负责哪个需求"——deed 明确拒绝拥有（AGENTS.md："它不是项目管理系统，不管谁负责哪个需求"）。但它的 **status 是手改字段，不是从事实算出来的**；"这个工作现在等谁"这一格会被 nextAction 抢走。**这一格正是 issue tracker 与 deed 的边界线，也是最容易被误认为"deed 要做 Jira"的地方。**

> 一句话：**先死的是"给下一个 agent 看的交接文档"，不是"给人看的 issue"。**

---

## 6. 这个层如果成立，名字该是什么

历史命名法（从案例里归纳，不是偏好）：

| 层 | 名字构造 | 点出的对象 | 点出的载体/动作 |
|---|---|---|---|
| VCS | version **control** | 版本 | 控制 |
| CI | **continuous** integration | — | 持续 |
| IaC | infrastructure **as code** | 基础设施 | 代码 |
| GitOps | Git + **Ops** | 运维 | Git |
| Observability | — | 系统内部状态 | 可观察 |

规则：**层名 = 对象 + 载体/动作；不含工具名；能被别人拿去实现。**

deed 的对象是**承诺、判决、授权**；载体是**只追加账本**；动作是**从账本算下一步**。

- 正式名候选：**Decision & Authorization Ledger（决定与授权账本）**，口语 **decision ledger**。
- 按 "X as code" 构词：**decisions as events**（不是 as code——它不执行，只记录与重算；"as code" 会误导成"可执行流程"）。
- 不采用：**agent governance**（含策略执行与 RBAC，deed 不做）；**work ledger**（Beads/Gas Town 已占用，指调度队列，真相可变）；**process-as-code**（暗示可执行流程）。

（类目与命名的完整比对归另一份调研；这里只给历史给出的构词约束。）

---

## 7. 层与层的边界表

| 层 | 拥有的事实 | 拒绝拥有 | 接口（对上下层） | 默认化/规范化它的东西 |
|---|---|---|---|---|
| **VCS**（CVS/SVN/git） | 内容的历史；一次变更的边界 | 内容的意义；构建、发布、评审 | .git 目录 / 工作副本 / hooks / 传输协议 | 托管平台（GitHub/GitLab）把 fork+PR 设成默认 |
| **CI**（Jenkins/Actions） | 构建与测试怎么跑、跑过没有 | 源码托管；评审判决；部署后的状态 | 仓库内 workflow 文件 + 平台事件 + marketplace action | 代码托管平台自带 CI、public 免费 |
| **IaC**（Terraform） | 基础设施的期望状态与变更计划 | 云实现；运行中的应用 | HCL 文件 + provider 插件 + state + plan | 云厂商生态与 plan 工作流；无中立基金会（→BSL 分叉） |
| **GitOps**（Flux/Argo） | 部署的期望状态与其历史 | 运行时实现；实际状态本身（只发现漂移） | Git 仓库中的清单 + pull 控制器 + 对账循环 | OpenGitOps 四原则（CNCF WG） |
| **容器与编排**（Docker/K8s） | 镜像格式、调度与运行时边界 | 应用语义；CI/CD 流程 | 镜像/OCI spec；K8s API；CRI/CNI/CSI；registry API | OCI（2015）；CNCF |
| **代码评审**（Gerrit/GitHub PR） | 一次变更"能不能进"的判决 + 所依据的那一版 | 代码内容；构建结果 | refs/for/ + Change-Id 行；PR API/webhook；branch protection/rulesets | 代码托管平台把 required review 设成默认 |
| **依赖锁定**（lockfile） | 依赖解析结果（哪棵树） | 包的内容；包的可信度 | 提交进仓库的一个文件 | registry 生态 + 平台默认生成 |
| **可观测**（trace） | 一次请求的因果链 | 后端存储、查询、告警策略 | traceparent 头 + OTLP + SDK | W3C 规范；CNCF/OTel |
| **候选：意图/进度/决定/授权**（deed） | 谁承诺了什么、谁判的、判的是哪一版、下一步谁动 | 谁适合做；优先级与分派；代码内容；运行时；身份鉴权 | .deed/log/*.jsonl + 15 种事件 + deed state 的第一行"下一步" | **无**（缺判据 4、5） |

---

## 8. 三条从历史直接推出的架构后果

1. **接口要窄到一行。** 活得久的接口都是"一个文件 / 一个头 / 一行提交信息 / 一个 socket"。deed 最强的接口不是 15 种事件，而是 state 的第一行："下一步 · 谁 · 命令"。事件类型是给实现看的，第一行是给下一班看的。
2. **别自建身份。** lockfile 只保证可复现、不保证可信；deed 只保证可追、不保证"是谁"。把身份留给下层（git commit 签名 / OIDC），deed 只引用并记录"我引用了哪一条"。否则整层会被"自述身份"这个洞拖住，永远进不了判据 4。
3. **要判据 5，就得有"四原则"式的文本。** OpenGitOps 的四条里没有一个工具名，所以别人能照着实现。deed 若想成层，需要一份不含工具名的规范：事件的语义、fold 的判据、什么叫"同一事实只有一个主人"。否则它永远是"一个工具"，不是层。

---

## 9. URL 清单（按案例）

**VCS**
- LKML 2005-04-06 "Kernel SCM saga.."：https://lkml.iu.edu/hypermail/linux/kernel/0504.0/1540.html
- SVN Book, "Subversion's History"：https://svnbook.red-bean.com/en/1.8/svn.intro.whatis.html

**CI**
- Jenkins 改名公告（214:14）：https://www.jenkins.io/blog/2011/01/29/jenkins/
- GitHub Actions GA（2019-11-11，public 免费）：https://github.blog/changelog/2019-11-11-github-actions-is-generally-available/

**IaC**
- 配置管理工具年表（Puppet 2005 / Chef 2009 / Salt 2011 / Ansible 2012）：https://lab.sub.uni-goettingen.de/config-management.html
- HashiCorp 对 Terraform 0.1（2014-07）的自述：https://www.hashicorp.com/resources/the-story-of-hashicorp-terraform-with-mitchell-hashimoto （本次 429，引文取自摘要）
- OpenTofu：https://opentofu.org/

**GitOps**
- Weaveworks 原文（2017-08-07，archive）：https://web.archive.org/web/2018id_/https://www.weave.works/blog/gitops-operations-by-pull-request
- OpenGitOps 四原则：https://github.com/open-gitops/documents/blob/main/PRINCIPLES.md
- OpenGitOps 术语（desired state / drift / pull / reconciliation）：https://github.com/open-gitops/documents/blob/main/GLOSSARY.md

**容器与编排**
- Docker PyCon 2013 lightning talk：https://pyvideo.org/pycon-us-2013/the-future-of-linux-containers.html
- OCI 成立与 Docker 捐出 format/runC：https://opencontainers.org/about/overview/
- CRI 引入（2016-12-19，pinned raw）：https://raw.githubusercontent.com/kubernetes/website/326befd8147414ecc4c9394682f53fdac2e91ead/content/en/blog/_posts/2016-12-00-Container-Runtime-Interface-Cri-In-Kubernetes.md
- dockershim 移除 FAQ（v1.24）：https://kubernetes.io/blog/2022/02/17/dockershim-faq/

**代码评审**
- Gerrit Change-Id 机制：https://gerrit-review.googlesource.com/Documentation/user-changeid.html
- LWN 2009 Gerrit 公告：https://lwn.net/Articles/319656/
- SFC 悼文（Gerrit 与 Android）：https://sfconservancy.org/blog/2018/jan/30/shawn-pearce/
- GitHub branch protection（stale approval / most recent reviewable push）：https://github.com/github/docs/blob/main/content/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches.md

**依赖锁定**
- Yarn 发布（2016-10-11）：https://classic.yarnpkg.com/blog/2016/10/11/introducing-yarn/
- npm package-lock.json 文档（raw）：https://github.com/npm/cli/blob/latest/docs/lib/content/configuring-npm/package-lock-json.md

**可观测**
- W3C Trace Context：https://www.w3.org/TR/trace-context/
- OpenTelemetry 简史（CNCF）：https://www.cncf.io/blog/2019/05/21/a-brief-history-of-opentelemetry-so-far/
- OTel 毕业公告（"de facto observability standard"）：https://www.cncf.io/announcements/2026/05/21/cloud-native-computing-foundation-announces-opentelemetrys-graduation-solidifying-status-as-the-de-facto-observability-standard/

**决定/交接（反例与现状）**
- Nygard 2011 ADR：https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- 80aj 交接文档（2026-06-11）：https://www.80aj.com/2026/06/11/ai-coding-context-reset/
- HN "AI impersonation in code reviews"：https://news.ycombinator.com/item?id=48173182
