# 软件工程里「可追、可审、可签」的既有传统与工具

> 目的：给 deed 找那个 X —— 它其实是哪个既有类目的第 N 个实现，以及它到底多做了什么。
> 纪律：只认一手材料（官方文档 / 规范 / 源码 / 法规原文）。每条结论跟 URL。拿不准写「未验证」。版本与抓取时间写在行内。

---

## 0. 结论先行

这一类传统按「钉住什么」分四层，各自只覆盖「谁说了 / 谁做了 / 谁能判 / 下一步谁动」的一部分：

1. **钉产物**：in-toto layout+link、SLSA provenance、Sigstore/Rekor、Trillian、Fossil manifest。回答「这是谁用什么造的、输入是什么、能不能验」，不回答「谁判的、下一步谁动」。
2. **钉决策文档**：ADR（Nygard 2011）、adr-tools、log4brains、Rust RFC 的 FCP、KEP 的 kep.yaml、PEP 的 Resolution。回答「当时为什么这么定、谁签的字」，判决是**文档里的一个字段或一次评论**，不是账本里的事件。
3. **钉流程节点**：Gerrit review label / submit requirement / attention set、GitHub branch protection / environments / required reviewers、Camunda user task、NIST SP 800-53 CM-3 的 CCB、21 CFR Part 11 的审计 trail 与签名-记录绑定。这一层是**唯一**把四件事同时钉住的，但载体一律是**服务端数据库或企业 GRC 系统**；判决绑定的是平台自己算的 id（patch set 序号 / diff state），不是人能离线复算的内容指纹。
4. **钉机制**：event sourcing（Fowler 2005）、Temporal event history、jj operation log。回答「状态能不能从事件重算」，不含任何裁决语义。

**有没有现成工具四合一并给出「下一步谁动」？** 有，只有 Gerrit：Attention Set 原文写着 it maintains an "Attention Set" with users that are currently expected to act on the change —— 且是**算出来的**，不是人填的。但它给的是「该谁看」，不是「该跑哪条命令」；账本在服务端，不随仓库走，不可离线复核。

**deed 的判决机制的既有名字**：separation of duties（NIST SP 800-53 Rev.5 AC-5）/ four-eyes principle / 双人复核 / no self-approval；「判决只能回答被钉住指纹的那一份」的等价物是 21 CFR 11.70 的 signature–record linking + GitHub 的 dismiss-stale-approvals + Gerrit 的 outdated votes。**原则不新，新意在载体。**

---

## 1. 钉产物：供应链证明与透明日志

### 1.1 in-toto（spec v1.0.0，2023-06-02）
- 规范原文：让 "what steps were performed, by whom and in what order" 透明；可验证 "a step ... was intended to be performed ... performed by the right actor"。
- 结构：layout 事先规定每一步的授权者与阈值（threshold），link 元数据记录每次实际执行；**判定 = 拿 link 去对 layout**。
- 四件事命中：谁做了（link 的 byproducts/by）、谁能做（layout 授权）。**不命中**：谁说了、下一步谁动。
- 与 deed 差哪一步：in-toto 的「证据」是执行元数据，不是「做完的标准」；它的判决是**校验器跑出来的结论**，不是一条被记录、可被作废的判决事件。
- 源：https://raw.githubusercontent.com/in-toto/docs/master/in-toto-spec.md

### 1.2 SLSA（v1.0 定稿 2023-04；当前 1.2）
- Build track：L1 provenance exists / L2 signed provenance by hosted build platform / L3 hardened build platform；provenance 回答 "what entity built the artifact, what process they used, and what the inputs were"。
- v1.0 移除了 Source 方面，只留 Build track —— 版本会变，这条要写进任何对外叙事里。
- 四件事命中：谁做了、产物是什么。完全不命中最关键的「谁能判」。
- 判定权在**消费方策略**（谁信哪个 builder），SLSA 自己不给判决。
- https://slsa.dev/spec/v1.0/levels （页头写 "Version 1.2 is the current version"，v1.0 页标 Status: Retired）
- https://openssf.org/press-release/2023/04/19/openssf-announces-slsa-version-1-0-release/

### 1.3 Sigstore / Rekor
- 文档原文：Rekor aims to provide an immutable, tamper-resistant ledger of metadata generated within a software project's supply chain；可查 inclusion proof，可按公钥或 artifact 检索条目。
- 演进（说明这条线的维护成本）：2026-06-27 官方博文说 sigstore.dev 公共实例**继续用 Rekor v1**，v2 已铺开但有 breaking change，暂不做默认；2026-11-16 又宣布削减公共日志支持的 entry types。
- 四件事命中：谁做了、产物指纹、记录不可篡改。**不命中**：谁能判（没有「判决」概念，只有「签名在不在」）、下一步谁动。
- https://raw.githubusercontent.com/sigstore/docs/main/content/en/logging/overview.md
- https://blog.sigstore.dev/rekor-evolution/ （2026-06-27）

### 1.4 Trillian / Tessera
- Trillian README：实现 Verifiable Data Structures 白皮书 + RFC 6962（Certificate Transparency）的 Merkle 树，提供 append-only Log mode；**已进入 maintenance mode**，官方建议新日志用 Tessera（c2sp.org/tlog-tiles）。
- 意义：deed 的「只追加」若要做多方共信、防服务端作弊，业界答案是 Merkle 日志（要运维）。deed 选了「随 git 提交的纯文本 + git 自身的排序」，等于把防篡改外包给 git 与 clone 拓扑 —— 这是它与 Rekor 家族最大的机制分歧。
- https://raw.githubusercontent.com/google/trillian/master/README.md

### 1.5 Fossil（内容寻址 + manifest 时间线）
- artifact 以内容哈希（SHA1/SHA3-256）为身份；每个 check-in 的 manifest 列出全部文件 artifact ID，manifest 的哈希即该 check-in 的 ID；timeline 就是 manifest 哈希序列。
- 与 deed 的「证据 = 文件 sha256 + by」同源，但 Fossil 的哈希是**存储身份**，deed 的哈希是**判决标的**（判决只回答这个哈希）。差一步：Fossil 不为「谁判」留位置。
- https://fossil-scm.org/home/doc/trunk/www/concepts.wiki

---

## 2. 钉决策文档：ADR / RFC / KEP / PEP

### 2.1 ADR（Michael Nygard，2011-11-15）
- 五个部件：Title / Status / Context / Decision / Consequences（原文）。状态机 proposed / accepted / deprecated / superseded，**用新 ADR 取代旧 ADR**，不改写旧的。
- 四件事命中：谁说了（作者）、为什么（Context）。**弱命中**：谁能判（acceptance 在评审里发生，但「谁批的」不写进 ADR 本体，除非人肉写进 Status 行）。不命中：下一步谁动。
- adr-tools（Nat Pryce）：ADR 存 doc/adr 下的 Markdown；adr new -s 9 会把 ADR 9 标 superseded（**判决 = 改另一个文件里的一个字段**，由工具代劳）。
- log4brains：docs-as-code 的 ADR + 静态站 + 时间轴，协作决策借 PR 完成。
- 差哪一步：ADR 系列是「文档当账本」，一条决定一个文件；没有会话/段/验收的分层，也没有任何东西从这些文件**算出**「能不能放行」。
- https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- https://raw.githubusercontent.com/npryce/adr-tools/master/README.md
- https://raw.githubusercontent.com/thomvaill/log4brains/master/README.md

### 2.2 Rust RFC：FCP 就是「团队签字的判决 + 期限」
- 原文：提案进入 "motion for final comment period (FCP)"，带 disposition（merge/close/postpone）；**Before actually entering FCP, *all* members of the subteam must sign off**；FCP 持续十天（ten calendar days）。
- 四件事命中：谁说了（讨论串）、谁能判（subteam sign-off）、判决（disposition）+ 期限。**不命中**：谁做了（实施在另一个仓库/PR 里）、下一步谁动（没有算出来的「该谁」）。
- 与 deed 差哪一步：RFC 的判决写在 GitHub 评论与标签上，**判决不绑定被审内容的内容指纹** —— 提案被改了，FCP 的签字不会自动失效（没有 stale 概念）。deed 的 review.brief 干的就是这件事。
- https://raw.githubusercontent.com/rust-lang/rfcs/master/README.md

### 2.3 Kubernetes KEP：谁能批写在文件里，状态是字段
- kep.yaml 模板字段：status（provisional / implementable / implemented / deferred / rejected / withdrawn / replaced）、reviewers、approvers、stage（alpha/beta/stable）、milestone、feature-gates、metrics（PRR）。
- 特点：**评审人与批准人是文件里的数据**，所以「谁能判」是可计算的；状态迁移靠改这个文件（PR）。
- 差哪一步：状态是**当前值**而不是事件序列 —— 你无法从仓库回答「什么时候、被谁、基于哪一版内容改成 implemented」，除非翻 PR 历史，而 PR 历史不带判决语义。
- https://raw.githubusercontent.com/kubernetes/enhancements/master/keps/NNNN-kep-template/kep.yaml

### 2.4 Python PEP（PEP 1）
- 原文：PEP Review & Resolution —— "content review and acceptance of the PEP is ultimately the responsibility of the Steering Council, which is formally initiated by opening a Steering Council issue"；旧称 BDFL-Delegate 现已改叫 **PEP-Delegate**（治理模型变更的痕迹）。
- 四件事命中：谁说了、谁能判。**不命中**：下一步谁动（要人去看 SC issue 的状态）。
- 差哪一步：与 Rust 同病 —— 决议是 GitHub issue 的关闭状态，不是账本里的事件。
- https://raw.githubusercontent.com/python/peps/main/peps/pep-0001.rst

---

## 3. 钉流程节点：代码评审门禁（这一类最接近 deed）

### 3.1 Gerrit（文档页脚版本串 v3.15.0-rc4）
- Review label：Code-Review 取值 -2/-1/0/+1/+2；**"Votes that are not copied to the new patch set, are called outdated"** —— 判决按 patch set 存活，patch set 变了旧票自动失效。copyCondition 控制什么条件下复制旧票。
- 不能自判：label.Label-Name.ignoreSelfApproval（已弃用）原文："If true, the label may be voted on by the uploader of the latest patch set, but their approval does not make a change submittable. Instead, a non-uploader who has the right to vote has to approve the change." 新写法是 submit requirement 的 submittableIf 用 label:My-Label=MAX,user=non_uploader。
- 能不能放行是**算出来的**：submit requirements 把「需要哪些标签、谁投的、够不够」写成谓词，运行时求值。
- **Attention Set** 原文："Code Review is a turn-based workflow going back and forth between the change owner and reviewers. For every change Gerrit maintains an 'Attention Set' with users that are currently expected to act on the change."
- 四件事：**4/4**。谁说了（comment）、谁做了（patch set uploader）、谁能判（label 权限 + submit requirement + non-uploader 约束）、下一步谁动（attention set）。这是公开工具里唯一四件齐全的。
- 差在哪一步（三条，deed 的全部意义藏在这里）：
  1. 真相在 Gerrit 服务端 DB；账本不随仓库提交，clone 下来拿不到判决史。
  2. 判决绑的是 **patch set 序号**（平台自己算的 id），不是人能离线复算的内容指纹；diff 等价性由平台定义。
  3. 对象是 change/diff，不是「要交付的东西」；没有讨论/执行/验收这种会话生命周期，也没有「用户签收」这一事件（submit 是合并，不是验收）。
- https://gerrit-review.googlesource.com/Documentation/config-labels.html
- https://gerrit-review.googlesource.com/Documentation/config-submit-requirements.html
- https://gerrit-review.googlesource.com/Documentation/user-attention-set.html

### 3.2 GitHub：stale approval 与 prevent self-review
- 分支保护原文："GitHub records the state of the diff at the point when a pull request is approved. This state represents the set of changes that the reviewer approved. If the diff changes from this state ... the approving review is dismissed as stale, and the pull request cannot be merged until someone approves the work again."
  → **这就是 deed「结论只能回答被钉住指纹的那份纸」的等价物，而且只是产品里的一个复选框选项**（dismiss stale pull request approvals）。
- Environments：Required reviewers 最多 6 人/团队，"Only one of the required reviewers needs to approve the job"；可选 **Prevent self-review**（不许批准自己触发的 workflow）；另有 wait timer、禁止绕过保护规则。
- 四件事：4/4（谁说了 = review body、谁做了 = commits、谁能判 = required reviewers/rulesets、下一步谁动 = requested reviewers）。
- 差在哪一步：全是**当前设置的求值**，settings 可变且无历史；没有账本，撤销审批等于删状态而不是追加一个「作废」事实；完全在线、依赖平台。
- https://raw.githubusercontent.com/github/docs/main/content/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches.md
- https://raw.githubusercontent.com/github/docs/main/content/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments.md

### 3.3 OPA / 合规即代码
- OPA 自我描述："a general-purpose policy engine that unifies policy enforcement across the stack"；declarative language + API to offload policy decision-making；CNCF graduated。
- 位置：把「谁能判 / 什么条件下放行」变成**可求值的代码**，与 deed 的 core/rules.mjs 同构（判据是代码，不是人填的表）。
- 差在哪一步：OPA 只做求值，判决结果默认**不入账本**（另有把 decision 上报远端的机制，本次未验证细节）；没有「判决是事实、可被后续事件作废」这一层。
- https://www.openpolicyagent.org/docs

---

## 4. 钉机制：事件溯源 / 事件日志 / 重放

### 4.1 Event Sourcing（Fowler，2005-12-12）
- 原文：所有状态变更存为事件序列；**"Complete Rebuild: We can discard the application state completely and rebuild it by re-running the events"**；Temporal Query 可重建任意时点状态。
- 与 deed 的 fold 同构：状态是投影，可丢弃重算。deed 的「不导出清单文件」正是这条原则的极端化 —— 能重算的就不落盘。
- 差在哪一步：ES 讲的是应用状态；它不谈「谁能判」「判决绑哪一份内容」。deed = ES 的骨架 + 一套裁决语义。
- https://martinfowler.com/eaaDev/EventSourcing.html

### 4.2 Temporal
- Workflow Execution 持久化 Event History；Replay 时 "the Commands that are generated are checked against an existing Event History"；worker 崩溃后 "picks up where the last recorded event occurred"。
- 与 deed 的差别：重放的目的是**恢复执行**（确定性约束），不是回答「这轮能不能放行」。没有任何审批/签收语义。
- https://docs.temporal.io/workflow-execution.md

### 4.3 Camunda 7 的 history event stream
- 原文："In addition to maintaining the runtime state, the process engine creates an audit log providing audit information about executed process instances. We call this event stream the history event stream"。
- 关键：**审计日志与运行时状态分开存**，且 history 是可选组件（可关）。→ 这是「过程账本」在 BPM 里的正统形态，但它是配件，不是权威。
- 差在哪一步：真相是 runtime 表，事件流是旁路；deed 反过来 —— 账本是唯一权威，状态才是旁路（可丢）。
- https://docs.camunda.org/manual/latest/user-guide/process-engine/history/

### 4.4 jj（Jujutsu）operation log
- 原文："Jujutsu records each operation that modifies the repo in the 'operation log'"；每个 operation 含一个 view 快照（bookmark/tag/ref 指向、heads、工作副本、每个 workspace 的 commit）；支持 jj undo / jj op revert / jj op restore；设计动机是 lock-free 并发（并发命令不互相破坏）。
- 意义：**版本控制内部已经有过「操作账本 + 快照投影 + 可回到任意点」**这套东西。它是 deed 在载体形态上最近的近亲（本地、纯数据、可离线）。
- 差在哪一步：没有裁决层（谁判、判什么、能不能作废）；**未验证** operation log 是否随 remote 共享（文档语境内看是本地仓库状态）。
- https://raw.githubusercontent.com/jj-vcs/jj/main/web/docs/src/content/docs/operation-log.md

---

## 5. 我以为同类、查完发现不是的三个

1. **git notes**：看着像「给提交附加事实的只追加层」，实际是可变注释 —— 原文 "Adds, removes, or reads notes attached to objects"；add 遇已有 notes 会 abort，但 -f 直接覆盖，另有 edit / remove / prune；存放 refs/notes/commits（独立引用）。→ **可变元数据**，不是账本。
   - https://raw.githubusercontent.com/git/git/master/Documentation/git-notes.adoc
2. **Conventional Commits 1.0.0 + changelog 工具化**：只钉「提交意图的语法」（type/scope/footer，footer 沿用 git trailer 格式），不钉人、不钉判决、不产生下一步。changesets 把「发布意图」写成仓库里的 Markdown、发布时消费 —— 形态像 deed（决策随仓库提交），但**没有裁决与验收**。
   - https://www.conventionalcommits.org/en/v1.0.0/ （页面未给发布日期，未验证）
   - https://raw.githubusercontent.com/changesets/changesets/main/README.md
3. **DORA 指标**：只测结果分布（change lead time、deployment frequency、failed deployment recovery time、change failure rate；官方页已说明从「四个键」演进到**五指标模型**）。四件事一件都不钉；它回答「这个组织靠不靠谱」，不回答「这一个会话现在能不能放行」。
   - https://dora.dev/guides/dora-metrics-four-keys/

---

## 6. 审计/合规传统：deed 的判决原则在这里有母本

### 6.1 separation of duties → four-eyes principle
- NIST SP 800-53 Rev.5 **AC-5 Separation of Duties**：Identify and document duties；Define system access authorizations to support separation of duties；"Separation of duties is enforced through ..."。
- 同族的工程化说法：no self-approval / 双人复核 / four-eyes。产品化实例：Gerrit 的 ignoreSelfApproval、GitHub Environments 的 Prevent self-review。
- **结论：deed 的「交付者不能判自己交付的段」= AC-5 的一个实例，原则零新意。**
- https://csf.tools/reference/nist-sp-800-53/r5/ac/ac-5/

### 6.2 NIST CM-3：变更控制就是「判决也是事实」
- 控制语句原文包含：Review proposed configuration-controlled changes "and approve or disapprove such changes"；**"Document configuration change decisions associated with the system"**；"Implement approved configuration-controlled changes"；"Retain records of configuration-controlled changes"；"Monitor and review activities"；由组织定义的 configuration change control element（CCB）协调。
- 四件事：**4/4**（谁说了 = 变更申请、谁做了 = 实施记录、谁能判 = CCB / 变更权威、下一步谁动 = CCB 议程与指派的实施人）。
- 差在哪一步：载体是 GRC 系统（ServiceNow / Archer 之类）的记录，不是仓库文本；「下一步谁动」靠人开会，不靠一个纯函数算。
- https://csf.tools/reference/nist-sp-800-53/r5/cm/cm-3/
- SOX（2002 §404 管理层对内控的评估）在工程侧落在 ITGC 的 change management 控制上，与 CM-3 同构；**SOX 法条原文本次未取证，标注未验证**。

### 6.3 21 CFR Part 11：判决绑定被签记录、不可剪切复用、双人要素 —— deed 机制的最强外部等价物
- 11.10(e)："Use of secure, computer-generated, time-stamped audit trails to independently record ..."；**"Record changes shall not obscure previously recorded information"**（= 只追加，修正靠新记录）。
- 11.10(f)："operational system checks to enforce permitted sequencing of steps and events"（= 状态机与顺序约束，对应 deed 的「只有轮次能开会话」这类硬规则）。
- 11.50：签名须含签名人姓名、时间、含义（review/approval/responsibility/authorship）。
- **11.70 Signature/record linking**："Electronic signatures ... shall be linked to their respective electronic records to ensure that the signatures **cannot be excised, copied, or otherwise transferred** to falsify an electronic record by ordinary means." → 判决必须与被判物绑定、不可剪切搬运：这就是 review.brief 指纹校验的法规版本。
- 11.100(a)：每个电子签名唯一于一人、不可重用或转授。11.200(a)(3)："attempted use ... by anyone other than its genuine owner requires **collaboration of two or more individuals**"。
- 差在哪一步：法规只要求「做得到」，不规定载体；deed 的贡献是把这套要求实现成仓库里可 diff 的文本。
- https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-21?part=11

### 6.4 取证学的 chain of custody（越界发现里最贴的一支）
- NIST SP 800-86 p.28 原文："a clearly defined chain of custody should be followed ... This involves **keeping a log of every person who had physical custody of the evidence, documenting the actions that they performed on the evidence and at what time**"；同页要求用 message digest 比对证明未篡改。
- 结构：**只追加的交接日志 + 「现在谁持有」是日志的投影 + 指纹证明未被换过**。这三件与 deed 的「账本 / 卡在哪（谁欠谁）/ 证据 sha256」逐条对应。
- 差在哪一步：保管链只记 custody 与 action，没有「谁能判」「判决作废」；它是证据管理，不是议事机制。
- 本地副本：C:\Users\NUC\Desktop\deed\.tmp\research\_src\nist800-86.pdf（121 页）
- https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-86.pdf

---

## 7. 四件事 × 载体：一张对照表

图例：✔ 命中；◐ 部分/弱；✘ 无。「指纹」= 判决是否绑定内容哈希；「重算」= 状态能否从事件重算出同一结果；「离线」= 能否不连服务端复核。

| 传统 / 工具 | 钉住的是什么 | 谁说了 | 谁做了 | 谁能判 | 下一步谁动 | 载体（真相在哪） | 指纹 | 重算 | 离线 |
|---|---|---|---|---|---|---|---|---|---|
| ADR / adr-tools / log4brains | 决策文档 | ✔ | ✘ | ◐ | ✘ | Markdown 在 repo | ✘ | ✘ | ✔ |
| Rust RFC（FCP） | 决策 + 期限 | ✔ | ✘ | ✔ | ✘ | GitHub 评论/标签 | ✘ | ✘ | ✘ |
| KEP（kep.yaml） | 状态字段 + 名单 | ◐ | ✘ | ✔ | ✘ | YAML 在 repo（当前值） | ✘ | ◐ | ✔ |
| PEP 1 | 决议 issue | ✔ | ✘ | ✔ | ✘ | GitHub issue | ✘ | ✘ | ✘ |
| in-toto | 执行证明 | ✘ | ✔ | ◐（layout 授权） | ✘ | 元数据文件 | ✔（材料哈希） | ✘ | ✔ |
| SLSA | 构建 provenance | ✘ | ✔ | ✘ | ✘ | attestation | ✔ | ✘ | ✔ |
| Sigstore / Rekor | 签名 + 透明日志 | ✘ | ✔ | ✘ | ✘ | 公共服务 + Merkle 日志 | ✔ | ✘ | ✘ |
| Trillian / Tessera | 日志本身 | ✘ | ✘ | ✘ | ✘ | 服务端 | ✔ | ◐ | ✘ |
| git notes | 可变注释 | ◐ | ✘ | ✘ | ✘ | refs/notes/*（可覆盖） | ✘ | ✘ | ✔ |
| Conventional Commits / changesets | 意图语法 / 发布意图 | ◐ | ✘ | ✘ | ✘ | commit + .changeset/*.md | ✘ | ✘ | ✔ |
| OPA | 判据（代码） | ✘ | ✘ | ✔ | ✘ | policy 文件 + 求值服务 | ✘ | ✔（纯求值） | ◐ |
| Gerrit | change / patch set | ✔ | ✔ | ✔ | ✔（Attention Set） | 服务端 DB | ◐（PS 序号，非哈希） | ✔ | ✘ |
| GitHub 保护规则 / Environments | PR / 部署 | ✔ | ✔ | ✔ | ✔（requested reviewers） | 平台设置（无历史） | ◐（diff state） | ✘ | ✘ |
| Camunda history / BPMN | 流程实例 | ◐ | ✔ | ✔（candidate group） | ✔（user task） | 企业 DB（history 可关） | ✘ | ✔ | ✘ |
| Temporal | 执行历史 | ✘ | ✔ | ✘ | ✘ | 服务端 + 客户端 | ✘ | ✔ | ✘ |
| Event Sourcing | 应用状态 | ✘ | ✘ | ✘ | ✘ | 事件存储 | ✘ | ✔ | ◐ |
| jj operation log | 仓库操作 | ◐ | ✔ | ✘ | ✘ | 本地 repo 元数据 | ✔（内容哈希的 commit） | ✔ | ✔ |
| Fossil | 内容寻址 + manifest | ◐ | ✔ | ✘ | ✘ | repo（SQLite） | ✔ | ✔ | ✔ |
| NIST CM-3 / CCB | 变更决策 | ✔ | ✔ | ✔ | ✔（人工议程） | GRC 系统 | ✘ | ✘ | ✘ |
| 21 CFR Part 11 | 记录 + 签名 | ✔ | ✔ | ✔（11.50 含义） | ✘ | 合规系统 | ✔（11.70 绑定） | ✘ | ✘ |
| NIST 800-86 保管链 | 证据交接 | ✘ | ✔ | ✘ | ◐（谁持有） | 纸质/工单日志 | ✔（digest） | ✘ | ✔ |
| DORA | 结果指标 | ✘ | ✘ | ✘ | ✘ | 度量平台 | ✘ | ✘ | ✘ |
| **deed** | 会话/段 + 承诺 + 判决 | ✔ | ✔ | ✔ | ✔（算出来的） | **repo 内纯文本 JSONL** | **✔（文件 sha256）** | **✔（纯函数 fold）** | **✔** |

这张表最有信息量的一行是**最后一行与 Gerrit 行的差**：四件事的覆盖度几乎一样，差的全在「载体 / 指纹 / 重算 / 离线」四列。

---

## 8. 必须回答的问题，逐条答

**Q1：这些传统各自「钉住」的是什么（人？产物？流程节点？）**
- 钉产物：in-toto、SLSA、Rekor、Trillian、Fossil。
- 钉文档：ADR、RFC、KEP、PEP。
- 钉流程节点：Gerrit、GitHub、Camunda、CM-3/CCB、Part 11。
- 钉人：只有 Part 11（签名唯一于人、不可转授）与 AC-5（职责划分）。**其余传统里「人」都是字段值，不是被制度化的主体。**
- 钉机制：ES、Temporal、jj。

**Q2：四件事里有几件落在同一条只追加记录上？**
- 落在同一条记录上的最多 3 件（谁做了 + 产物指纹 + 时间序）；Gerrit/GitHub 能把 4 件放进**同一个系统的可查询状态**，但那条记录不是「只追加的账本」，而是「当前快照 + 变更日志」。
- 唯一四件齐全且「下一步是算出来的」是 Gerrit 的 Attention Set。
- **没有任何公开工具**把「判决」写成一条**绑定了内容指纹、可被后续事件作废、存在仓库文本里**的事实。deed 的 review.brief / review.log / judge --rework 这一组，正是这个空位。

**Q3：deed 的「判决也是事实、判决只能回答被钉住指纹的那份纸、交付者不能判自己」在审计/评审传统里有没有等价物？叫什么？**
- 「交付者不能判自己」= **separation of duties**（NIST SP 800-53 AC-5）/ **four-eyes principle** / 双人复核 / no self-approval。产品实例：Gerrit ignoreSelfApproval、GitHub Environments 的 Prevent self-review。
- 「判决只能回答被钉住指纹的那一份」= **signature–record linking**（21 CFR 11.70）+ 工程侧的 **stale approval**（GitHub dismiss-stale-approvals；Gerrit outdated votes）。现成短语最接近的是 **approval invalidation on content change**。
- 「判决也是事实、作废靠新事实」= **audit trail 不可擦除**（21 CFR 11.10(e)）+ CM-3 的 document change decisions；工程侧对应 Gerrit「旧票标 outdated 而非删除」。
- **直接说结论：这套原则全部是既有的，deed 没有发明原则。** 它新在四件事的**载体与可复算性**：
  1. 判决与被判物同在**一份随仓库提交的纯文本**里（不需要服务端，clone 即可复核）；
  2. 判决的**标的是文件内容哈希**（人能自己 sha256sum 复算），而不是平台算的 patch set 序号或 diff state；
  3. **判据（谁能判/要不要审/能不能签）是纯函数从账本算出来的**，不落盘、可丢弃重算 —— 与 Gerrit submit requirements 同构，但后者的 requirement 存在 project config（另一个权威），deed 存在 core/rules.mjs 且输入只有账本；
  4. **判决可被后续事件作废且作废本身也是事件**（judge --rework），对应传统里的 stale/outdated 但不留删除痕迹；
  5. **离线、零依赖、同数据同字节** —— GitOps/docs-as-code 家族的极端化，也是它与所有平台的真正分界。

**Q4：这个类目在行业里现在叫什么名字？谁在用？**
- 现成、可搜索的近义词（按贴合度排）：
  1. **change control / change management record**（ITIL 4 change enablement、SOX ITGC、FDA GxP、ServiceNow/GRC 厂商）—— 语义最贴，载体最不贴。
  2. **audit trail / append-only audit log**（21 CFR Part 11、Camunda history、GxP 系统）—— 形态最贴（只追加），但没有裁决与下一步。
  3. **event-sourced process ledger / append-only project ledger**（Fowler 的 event sourcing 语汇 + Temporal/jj 的实现语汇）—— 机制最贴，行业里没有稳定的产品名。
  4. **docs-as-code / decision records**（log4brains、adr-tools、GitOps 圈）—— 载体最贴（in-repo Markdown），语义最浅。
  5. **attestation & transparency log**（SLSA/in-toto/Sigstore、CNCF）—— 只管产物，不管人判。
- 判断：deed 落在 **change control（语义）+ audit trail（形态）+ docs-as-code（载体）** 的交集，而这个交集在行业里**还没有名字**。对外叙事可用一句话定位：**in-repo, event-sourced change-control ledger（仓储内的、事件溯源式变更控制账本）**，再用「判决绑指纹、判据可重算、交付者不自判」三句作证据。别用「议事与执行机制」这种自造抽象词 —— 它在任何检索里都找不到对手，也就证明不了自己在跟谁比。

---

## 9. 越界发现（名单之外，按线索走过去的）

1. **从「判决要绑定被审对象」走到 21 CFR Part 11**：起点是 Gerrit 的 outdated votes 与 GitHub 的 stale approval —— 两者都在解决「内容变了，旧批准怎么办」。往法规方向追，落到 11.70（签名必须 linked to records，不可剪切搬运）。这是我能找到的**最强等价物**，且是法规原文，不是产品文案。那边还有 11.10(f)（顺序强制）与 11.200(a)(3)（双人协作），分别对应 deed 的阶段状态机与「交付者不能判自己」。
2. **从「只追加、不可擦除」走到会计与审计 trail**：11.10(e) 的 "Record changes shall not obscure previously recorded information" 就是「冲销更正」的法规表述；会计「更正靠红字冲销而不擦账」是同一条原则的另一支（**准则原文未取证，标注未验证**）。
3. **从「卡在哪 / 谁欠谁」走到取证学的 chain of custody**：deed 的「下一步谁动」在传统里最近的对应物不是 RACI，而是**保管链日志里「现在谁持有」这个投影**（NIST SP 800-86 p.28）。这条我一开始完全没想到，它比 RACI 精确：RACI 是静态分工，保管链是**随事件移动的持有关系**。
4. **从「仓库内的只追加账本」走到版本控制自己的操作日志**：jj 的 operation log（每 operation 一个 view 快照、可 undo/restore、为 lock-free 并发而设计）、Fossil 的 manifest 哈希 timeline。说明「账本 + 投影 + 可回退」在 VCS 内部已经实现过，deed 的账本形态在工程上不算异类。
5. **流程挖掘（process mining）是另一支**：从事件日志反推流程一致性、预测下一位处理人、给 recommended actions。目标最近，但方式是**事后 ETL + 专用日志 + 推荐**，不产生约束。**本次只取到搜索摘要与二手材料，未取证，标注未验证。**
6. **非软件领域的类比（全部未取一手原文，仅作类比，不进结论）**：公证人日志、航空维修技术记录本与独立检验双签、实验记录本的见证签名、学术同行评审的版本与回避规则、复式记账。共同形状都是「只追加 + 双人 + 绑定版本」，与 deed 同形。

**给 lead 的判断修正**：deed 更接近**审计 / 取证 / 变更控制**这一族（合规血统），而不是「代码评审工具」这一族。代码评审工具只是它在「判决绑内容」这一条上的实现参照。如果 README 想找对手，最锋利的对手不是 GitHub，而是 **NIST CM-3 的变更控制记录**：四件事全有，但记录在 GRC 系统、靠人开会推进、不可重算、不随代码走。

---

## 10. 最接近 deed 的 3 个东西，以及各自「差在哪一步」

**① Gerrit（v3.15 系）—— 差在「账本不在仓库里」**
- 相同：判决按被审对象存活（patch set 变了票失效）、不能自判、能不能放行是算出来的、下一步谁动是算出来的。四件事 4/4。
- 差：真相在服务端 DB，clone 拿不到判决史；绑定的是 patch set 序号而非内容哈希；对象是 diff 不是「要交付的东西」；没有验收/签收。
- 一句话：**deed 是「把 Gerrit 的判决语义搬进仓库纯文本，并把对象从 diff 换成会话」**。

**② NIST SP 800-53 CM-3 的变更控制记录（CCB）—— 差在「载体与自动推进」**
- 相同：变更申请（谁说了）、实施记录（谁做了）、变更权威的批准（谁能判）、指派的实施人（下一步谁动），且要求保留记录、记录决定、不擦旧记录。
- 差：记录在 GRC 系统；下一步靠议程与人；判据不落成可求值的函数；与代码/仓库零连接。
- 一句话：**deed 是 CM-3 的一个 in-repo、可重算、零依赖的实现**。

**③ jj operation log（或 Temporal event history）—— 差在「没有裁决层」**
- 相同：只追加的事件序列 + 快照投影 + 可重算/可回到任意点 + 纯数据（jj 侧还能离线）。
- 差：没有「谁能判」「判决」「判决作废」「签收」任何一层；重放目的是恢复执行，不是回答「能不能放行」。
- 一句话：**deed = 事件溯源的骨架 + 一套裁决语义 + 一个「下一步谁动」的纯函数**。

---

## 11. URL 清单

决策文档：
- ADR（Nygard, 2011-11-15）https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- adr-tools https://raw.githubusercontent.com/npryce/adr-tools/master/README.md
- log4brains https://raw.githubusercontent.com/thomvaill/log4brains/master/README.md
- Rust RFC README https://raw.githubusercontent.com/rust-lang/rfcs/master/README.md
- KEP 模板 kep.yaml https://raw.githubusercontent.com/kubernetes/enhancements/master/keps/NNNN-kep-template/kep.yaml
- PEP 1 https://raw.githubusercontent.com/python/peps/main/peps/pep-0001.rst

供应链证明与日志：
- in-toto spec v1.0.0（2023-06-02）https://raw.githubusercontent.com/in-toto/docs/master/in-toto-spec.md
- SLSA levels（v1.0 retired / 当前 1.2）https://slsa.dev/spec/v1.0/levels
- SLSA v1.0 发布 https://openssf.org/press-release/2023/04/19/openssf-announces-slsa-version-1-0-release/
- Rekor 文档 https://raw.githubusercontent.com/sigstore/docs/main/content/en/logging/overview.md
- Rekor v1/v2 现状（2026-06-27）https://blog.sigstore.dev/rekor-evolution/
- Sigstore 博客索引（2026-11-16 公共实例收敛）https://blog.sigstore.dev/
- Trillian README（maintenance mode → Tessera）https://raw.githubusercontent.com/google/trillian/master/README.md

评审门禁与流程：
- Gerrit config-labels https://gerrit-review.googlesource.com/Documentation/config-labels.html
- Gerrit submit requirements https://gerrit-review.googlesource.com/Documentation/config-submit-requirements.html
- Gerrit attention set https://gerrit-review.googlesource.com/Documentation/user-attention-set.html
- GitHub 受保护分支（stale approvals）https://raw.githubusercontent.com/github/docs/main/content/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches.md
- GitHub Environments（required reviewers / prevent self-review）https://raw.githubusercontent.com/github/docs/main/content/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments.md
- OPA 文档 https://www.openpolicyagent.org/docs

机制与工具：
- Event Sourcing（Fowler, 2005-12-12）https://martinfowler.com/eaaDev/EventSourcing.html
- Temporal workflow execution https://docs.temporal.io/workflow-execution.md
- Camunda 7 history https://docs.camunda.org/manual/latest/user-guide/process-engine/history/
- jj operation log https://raw.githubusercontent.com/jj-vcs/jj/main/web/docs/src/content/docs/operation-log.md
- git-notes 文档 https://raw.githubusercontent.com/git/git/master/Documentation/git-notes.adoc
- Fossil 概念 https://fossil-scm.org/home/doc/trunk/www/concepts.wiki
- Conventional Commits 1.0.0 https://www.conventionalcommits.org/en/v1.0.0/
- changesets https://raw.githubusercontent.com/changesets/changesets/main/README.md
- DORA 指标 https://dora.dev/guides/dora-metrics-four-keys/

合规 / 审计（越界发现）：
- NIST SP 800-53 Rev.5 AC-5 https://csf.tools/reference/nist-sp-800-53/r5/ac/ac-5/
- NIST SP 800-53 Rev.5 CM-3 https://csf.tools/reference/nist-sp-800-53/r5/cm/cm-3/
- 21 CFR Part 11（eCFR 当前文本）https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-21?part=11
- NIST SP 800-86（保管链，p.28）https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-86.pdf

---

## 12. 未验证 / 薄弱处（诚实清单）

- SOX 2002 §404 的法条原文本次未取证（只用 NIST CM-3 作为其工程侧的等价取证）。
- ITIL 4 的 change enablement 词条在一手材料里是付费出版物，未取证；「change authority」概念通过 CM-3 与厂商文档间接确认。
- process mining 的「推荐下一步」只取到搜索摘要/二手材料，未取证。
- 非软件领域的类比（公证、航空维修双签、实验记录本、同行评审、复式记账）全部未取一手原文，仅作形状类比。
- OPA decision log 的上报细节未验证。
- jj operation log 是否随 remote 共享，未验证。
- Conventional Commits 1.0.0 页面未给发布日期。
- NIST SP 800-86 的出版日期未逐页核对（URL 属 Legacy 系列）。
- GitHub「作者不能批准自己的 PR」这点在本次抓取的文档页里没有直接文字（未验证；Environments 的 Prevent self-review 是明确文档化的）。
