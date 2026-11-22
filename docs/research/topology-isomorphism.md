# deed 的架构同构：这类拓扑叫什么、有谁做过、在什么规模上会坏

调研基准：2026-11-23（本机实测 + 当日抓取的一手页面）。领域：架构同构（拓扑层，不比对字段/命令/事件名）。
方法：一手材料优先（规范、官方文档、论文原文、源码注释）；每条结论带 URL；读不到原文的只有元数据或摘要，标「未验证」。deed 的事实取自 design/DESIGN.md 与 core/、cli/ 源码；性能数字为本机实测，非论文值。

## 0. 一句话判定

deed 的拓扑不是新的：它是「单写者全序日志 + 确定性重放 + 写前重折校验」这一族的一个实例，1970 年代的状态机复制、2005 年的 event sourcing、2015 年的 reconcile loop 都属于这族。deed 真正的主张不在拓扑，而在**位置**：它把「谁追认了哪一份具体内容」这一簇事实从 SaaS 票据、ADR 文档、PR 审批、会议纪要里搬进仓库，并让判据成为账本的纯函数——于是这一簇第一次变得**可重算**。所以它可能是**治理/记录这一层**的一次新实现，而不是一个新层；而这一层今天没有统一名字，也没有统一载体，这正是它的架构缺陷来源。

## 1. 把 deed 的拓扑写成一句可判定的话

四个部件，缺一不可：

    L          追加日志（唯一系统记录 system of record）
    fold       L → D，纯函数，不读时钟/网络/环境
    rules      D → 许可集（谁能对哪一段做哪个动作）
    gate       追加前必须 fold(L+e) 成功且 e 落在 rules(D) 内

于是三条等式：

    state = fold(L)
    next  = rules(fold(L))
    append(e) ⇔ fold(L+e)↓ ∧ e ∈ rules(fold(L))

第四部件的方向很关键，它把 deed 与多数日志系统区分开：

- **append-then-project**（先追加再消费）：Kafka、etcd watch、CT log、Temporal 的 event history 都是这个方向；日志是**传输/审计**的载体，写入不被语义校验。
- **project-then-append**（先投影再追加）：deed 是 cli/deed.mjs:105 先 fold(events)、:110 再 fold([...events, stamped])，追加只有在两次折叠都成立时发生。日志因此成为**判定**的载体。

由这一条可以推出 deed 的一个结构性能力，后面反复要用：**它能拒绝**。CRDT op-log 与多数 event store 只能收敛或只能追加，拒绝发生在日志之外（应用层）。deed 的拒绝发生在日志之内（gate），代价是每次写要把全账本折两遍。

## 2. 这类拓扑在文献里的名字：五个家族，没有一个统一术语

| 家族 | 标准名字 | 代表出处（一手） | 谁在用 |
|---|---|---|---|
| 状态机复制 | state machine replication / deterministic replay | Schneider 1990（**未取得原文，标未验证**） | Raft/Paxos 上层状态机、数据库 WAL 重放 |
| 事件溯源 | event sourcing / projections / read model / CQRS | [Fowler, Event Sourcing, 2005-12-12](https://martinfowler.com/eaaDev/EventSourcing.html) | EventStoreDB、Axon（**未取原文**）、银行核心 |
| 期望态收敛 | reconcile loop / level-triggered reconciliation / desired state | [k8s controller 文档](https://raw.githubusercontent.com/kubernetes/website/main/content/en/docs/concepts/architecture/controller.md)、[OpenGitOps 四原则](https://raw.githubusercontent.com/open-gitops/documents/main/PRINCIPLES.md) | k8s、Argo/Flux、Borg/Omega |
| 约束式流程 | constraint-based / declarative process model；workflow enactment service | [Declare（Pesic/van der Aalst, EDOC 2007，仅摘要页）](https://scholar.archive.org/work/hdrhdo4zpfectjjaj32rk5xcnq) | Declare、CMMN（**未验证**） |
| 追加不可变 + 可验证 | append-only log / transparency log / immutable log | [RFC 6962 CT](https://www.rfc-editor.org/rfc/rfc6962.txt)、[Datomic 事务模型](https://docs.datomic.com/transactions/model.html) | Certificate Transparency、Rekor、Datomic、Fossil |

三点判断，逐条给依据：

1. **「append-only system of record」不是术语。** Fowler 的原话是分类式的，不是命名式的：「The official system of record can either be the event logs or the current application state.」——即"谁当系统记录"是一个选择，不是一个模式的专名。上一轮若谁用了这个短语，那是自造词。
2. **「declarative process runtime」也不是文献标准词。** 流程界的标准词是 WfMC 的 enact-ment service 与 Declare 的 constraint-based workflow（WfMC 参考模型 PDF 抓取失败，返回 HTML，**未取得原文**）。「declarative」在 K8s/GitOps 语境里指的是"期望态声明"，与流程界的"声明式流程"只是词同义不同。
3. **最贴切的一手命名其实来自 jj：** 「operation log」+「view snapshot」，并且它自己写明了动机——操作日志是为了**无锁并发**（[jj operation-log.md](https://raw.githubusercontent.com/jj-vcs/jj/main/docs/operation-log.md)：*"One benefit of the operation log (and the reason for its creation) is that it allows lock-free concurrency"*）。deed 走的是相反取舍：用锁换取"日志即判定"，所以不需要 operation 合并。

结论：**给 deed 的拓扑找一个现成名字是找不到的**；能说的是它是这五族的交集，交集处没有专名。这一点必须写进最终答复，别硬凑术语。

## 3. 同构清单（13 个）：谁拥有哪个事实、怎么坏

判断同构与否只用三个问题：它的**唯一系统记录**是什么？状态是不是这个记录的纯函数？"下一步做什么"是不是由规则从状态算出来？

| 系统 | 唯一系统记录 | 状态 | 下一步由谁算 | 与 deed 的结构差异 |
|---|---|---|---|---|
| git 对象 DAG + refs | objects（内容寻址的不可变节点） | tree/commit 图 | 无人算；规则外置（钩子/评审） | refs 可变、可强推，故不是账本；无资格函数 |
| Nix 纯求值 + store | derivation 图 + store path | 输出闭包 | 求值器（纯函数） | 事实是"输入→产物"，不是"人→追认"；有非纯逃逸舱 |
| k8s etcd + reconcile | etcd 当前态（历史被 compact） | 对象 spec/status | controller（level-triggered） | 观察外部现实；日志非系统记录 |
| Borg / Omega | cell state（Paxos 存储） | 期望态 + 观测态 | scheduler | 派活（谁执行），deed 不派活 |
| Bazel 远程缓存 | ActionCache（按 action digest）+ CAS | 缓存命中 | 构建图 | 判定不可内容寻址（同一内容可判不同） |
| 事件溯源/CQRS | 事件日志 或 当前态（二选一） | 投影 | 应用层 | deed 强制选日志侧，且写前校验 |
| DBSP / IVM | 变更流 T | DB[t]=Σ(i≤t)T[i] | 增量维护算子 | deed 全量重算，无增量 |
| Datomic | datoms + 事务日志 | 索引（派生） | 应用层（事务是声明式） | 日志在 DB 内；有 excision 逃逸舱 |
| CRDT op-log（Automerge/Yjs） | op set | 收敛副本 | 无（无拒绝能力） | deed 用锁消除收敛需求 |
| jj op log | operation log | 每个 op 一个 view 快照 | 命令自身 | 日志默认不 push；无资格函数 |
| Fossil | artifact 集合（内容哈希命名） | 重放 ticket change | 无 | **先例最近**：ticket 变更即 artifact |
| SQLite WAL | WAL 帧（临时） | 页 | 无 | checkpoint 主动丢弃历史 |
| Erlang/OTP supervisor | 无（只有子进程树） | 运行态 | 重启策略 | 控制回路无账本；有限流阀 |
| 区块链 / CT | 追加日志 + Merkle 树 | 派生 | 共识/审计 | deed 无 Merkle，可验证性只到 diff |

### 3.1 逐条要点（只说结构，不说机制）

**git**：objects 不可变、refs 可变，是这份设计里最锋利的一句对照——「refs are mutable. Therefore, the meaning of a ref can change.」（[Mary Rose Cook, git from the inside out](https://maryrosecook.com/blog/post/git-from-the-inside-out)）。deed 的账本没有"可变指针"位置：状态由重算得出，任何改写都是新事件，所以 deed 结构上免疫"历史被 rebase 抹掉"。反面代价：git 有 gc，deed 没有。

**Nix**：论文标题即主张「The Purely Functional Software Deployment Model」（[Dolstra 博士论文 p.1](https://edolstra.github.io/pubs/phd-thesis.pdf)，本机 PDF 281 页，p.22 贡献节："a purely functional deployment model, which we implemented in the Nix system"）。store path 是输入哈希：「Store path digests are supposed to be opaque.」（[nix.dev store-path](https://nix.dev/manual/nix/latest/store/store-path)）。同构点在"状态是纯函数"，差异在**参数量级**：Nix 的纯是"输入→产物"，输入可以逐字节哈希；deed 的纯是"事件→许可"，输入是人写的事件，判据依赖规则而非哈希。所以 Nix 那套"内容寻址即身份"在 deed 里只能局部用（review.brief 的 sha256 就是这一处），不能推广。

**k8s / GitOps**：controller 的定义句是「a control loop is a non-terminating loop that regulates the state of a system」，并且「these … have a spec field that represents the desired state. The controller(s) … are responsible for making the current state come closer to that desired state」（[controller.md](https://raw.githubusercontent.com/kubernetes/website/main/content/en/docs/concepts/architecture/controller.md)）。GitOps 把它写成原则：「Continuously Reconciled — Software agents continuously observe actual system state and attempt to apply the desired state」（[PRINCIPLES.md](https://raw.githubusercontent.com/open-gitops/documents/main/PRINCIPLES.md)）。**结构与 deed 的关键差异只有一个词：observe。** reconciler 有观测通道（实际态），deed 没有观测通道（工作区当前态）。这一差异决定了 §4 里"与现实不一致"这条失败模式在 deed 上必然发生，且在 reconciler 上是可修复的。

**Borg/Omega**：期望态在 Paxos 存储里，「A single elected master per cell serves both as the Paxos leader」（[Borg 论文 p.4](https://research.google.com/pubs/archive/43438.pdf)，本机 PDF 已存 .tmp/research/_src/borg-2015.pdf），操作幂等使失败客户端可无害重提交。Omega 的贡献是「shared representation of desired and observed cell state stored in a central persistent store」（p.12）——又一次出现 desired **and observed**。deed 只有 desired 一侧。

**Bazel**：ActionCache 服务「Retrieve a cached execution result」，键是 action digest（[remote_execution.proto](https://raw.githubusercontent.com/bazelbuild/remote-apis/main/build/bazel/remote/execution/v2/remote_execution.proto)）。它对照出 deed 的一个限制：内容寻址只能保证"同样的输入给同样的产物"，不能保证"同样的交付物给同样的判决"——判决的输入包含"谁判、什么时候判、此前发生过什么"，这些不是内容。所以 deed 不能把判决做成缓存，只能做成事件。

**事件溯源**：Fowler 给了完整重建的成本认识，并给了标准解法：「since an application state is purely derivable from the event log, you can cache it anywhere you like」（Event Sourcing 一文）——即 snapshot + 尾部重放。deed **没有快照**，这是它相对这一族最明显的欠账，也是 §5 判据 1 的根。

**DBSP/IVM**：形式最强的一手句是「DB[t]=Σ(i≤t) T[i] = I(T)[t]」（[DBSP 论文](https://ar5iv.labs.arxiv.org/html/2203.16684)）。它说的是"快照是变更流的累积"，并给出增量算法避免重算。deed 的 fold 正是 I(T)[t] 的朴素 O(n) 求值。**所以"fold 慢"的正确修法不是换存储，而是增量**——这条判据写进 §5。

**Datomic**：「A Datomic database is information, specifically a set of atomic immutable facts.」；datoms 分 additions/retractions；「A Datomic transaction is declarative.」（[transactions/model.html](https://docs.datomic.com/transactions/model.html)）。两个可借的结构事实：单写者 transactor（与 deed 的 .deed/log/lock 同构，只是 deed 用文件锁、上限 10 秒）；以及 excision——Datomic 专门为"必须删除"留了逃逸舱，说明**纯追加系统在合规压力下都要留一个洞**。deed 今天没有这个洞（DESIGN.md 明说"账本只追加，坏账不自愈"）。

**CRDT op-log**：Automerge 的文档模型是"文档=不可变变更集"（[automerge.org docs](https://automerge.org/docs/reference/documents/)）。结构差异一句话：CRDT 用因果投递把"并发写"变成"可合并"，deed 用锁把"并发写"变成"排队"。**因此 deed 不需要 CRDT，也不需要它的代价（tombstone 膨胀、无拒绝能力）。** 判据：只有出现"离线多写者必须合并"才需要 CRDT；deed 的单元是单工作区，这一条件结构上不成立。

**jj**：每个 operation 记录 view 快照，「Each operation object contains a snapshot of how the repo looked at the end of the operation」，支持 undo、op revert、op restore，代价是「Divergent operations」。这是"操作日志 + 投影"最完整的民用实现，但它记录的是**仓库状态**，不是**人的决定**，也没有资格函数；而且 op log 默认不随 push 走（本地历史，**细节未逐一验证**）。这三点正是 deed 与它的全部差异。

**Fossil（最重要的对照）**：「A ticket is created by a ticket change artifact. Each subsequent modification of the ticket is a separate artifact.」以及「The current state of a ticket is found by replaying all ticket change artifacts with the same ticket ID in timestamp order.」（[bugtheory.wiki](https://fossil-scm.org/home/doc/trunk/www/bugtheory.wiki)）。artifact 的 id 是内容哈希，「universally unique name」（[concepts.wiki](https://fossil-scm.org/home/doc/trunk/www/concepts.wiki)）。**这条把"deed 的拓扑是新的"彻底否掉：2006 年就有人在 VCS 里用追加 artifact + 重放做票据状态，而且顺带解决了同步（同步算法对这些 artifact 无特殊知识）。** deed 与 Fossil 的差别只剩三项：判据在数据上（core/rules.mjs 从账本算）、交付物绑指纹（review.brief 的 sha256）、交付与判决不共手（硬规则 10）。

**SQLite WAL**：官方文档专设一节「Avoiding Excessively Large WAL Files」，检查点把页写回主库并可截断 WAL（[wal.html](https://www.sqlite.org/wal.html)）。它证明存在第二类"追加日志"：**日志为了崩溃恢复而追加、为了空间而丢弃**，历史不是记录。deed 属第一类（历史即记录），所以**不能借用 checkpoint 式解法**来治膨胀；要治只能靠裁剪语义（快照 + 归档旧月），那是策略问题不是存储问题。

**Erlang/OTP supervisor**：sup_flags 的 strategy/intensity/period 是重启限流（[supervisor 文档](https://www.erlang.org/doc/apps/stdlib/supervisor.html)）。它没有账本，只有控制回路，所以同构只在"限流阀"这一处：deed 的"锁最多等 10 秒、超时即失败"是同构的限流阀，作用是防止一个坏写者把所有人拖住。这条对照给 deed 的锁上限一个理论位置：它不是性能补丁，是 supervisor 的 intensity。

**区块链 / CT**：CT 的定义句「publicly auditable, append-only, untrusted logs」，配 Merkle Hash Trees / Audit Paths / Consistency Proofs（[RFC 6962](https://www.rfc-editor.org/rfc/rfc6962.txt)）。同构只在"追加 + 可验证"，差异是**验证的接收者**：CT 的可验证是给不信任的第三方看的（对数级证明），deed 的可验证是给同一个仓库读代码的人看的（diff 级）。所以 deed 不需要 Merkle，也不该为它付出永久增长的代价。

## 4. 失败模式总表：哪些在 deed 的规模下真的会发生

"deed 规模"的界定（用于本节所有判定）：单工作区、单写者、人类节奏的事件（一轮几条到几十条）、账本随仓库提交、单事件 ≈186 字节（实测样例 .tmp/drift/.deed/log/2026-11.jsonl：6 行 / 1117 字节）。

| 失败模式 | 别处的证据 | 在 deed scale 会不会发生 | 判据 / 机制 |
|---|---|---|---|
| 日志膨胀 | Temporal 硬限：「Event History is limited to 51,200 Events or 50 MB and will warn you after 10,240 Events or 10 MB」（[limits.md](https://docs.temporal.io/workflow-execution/limits.md)）；SQLite 用 checkpoint 截断；Kafka 用 compaction（**未取得原文**） | **会，但慢**。186 B/事件、一天几十条 ⇒ 一年 ~ 数万事件 / 数 MB。真正先撞的是重算成本不是体积 | 体积阈值不敏感；折叠成本阈值见 §5 判据 1 |
| 投影重算成本 | Fowler 的 Complete Rebuild + snapshot 解法；DBSP 的增量式 | **会，且是第一个真撞的**。实测 1.9µs/事件线性到 20k，之后超线性；每次写要折两遍 | 实测见 4.1；阈值 200ms |
| log 与外部现实不一致 | k8s/GitOps/Borg 都显式带 **observed** 一侧（desired and observed） | **会，且是最高频**。deed 只有 desired：账本说"这段交付过"，工作区文件可能已被改（brief 记了 sha256 但没有核对时点）；workspace.json 基线会漂移 | 结构性缺口（缺观测通道），与规模无关；只在 review.brief 一处做了内容绑定 |
| 权限模型缺失 | 21 CFR 11.10(g)「authority checks to ensure that only authorized individuals can use the system, electronically sign a record」（[govinfo](https://www.govinfo.gov/content/pkg/CFR-2024-title21-vol1/xml/CFR-2024-title21-vol1-sec11-10.xml)）；NIST AC-5 职责分离（**页面 JS 渲染，未取得正文**） | **会，且任何规模都成立**。deed 身份是自述（事件里的 s），无签名、无密钥；硬规则 10 是 SoD 的一条具体实例，但只覆盖"交付 vs 判决" | 判定式：账本可被无资格者追加即成。机制上靠"工作区是人信任的"，不靠账本 |
| 语义演进 | Temporal 的 51,200 事件上限正是"无限历史 + 语义演化"的产物 | **会，但不是规模问题**。deed 用 v（事件语义版本）+ w（写者版本）区分"账本比程序新"与"坏行"，事件类型只增不减 | 判据：一次"需要删事件类型"的需求即触发 |
| 删除/更正要求 | Datomic excision（专为删除留的逃逸舱）；21 CFR 保留期语义 | **会**，只要出现一次"必须删掉某条历史"（隐私、合规、误写敏感信息） | 一次要求即破；deed 现有唯一修法是人工把整行移到 .deed/log/rejected/，那已不是纯追加 |
| 单写者瓶颈 | Datomic transactor；Borg 每 cell 单 master | **暂不会**。人类节奏下锁竞争 < 1%；10 秒上限是限流阀不是瓶颈 | 判据：锁等待占比 > 5%，或出现跨机写同一工作区（文件锁结构性失效） |
| 无法表达"否" | CRDT 只能收敛 | **不发生**（gate 在日志之内），代价是每次写折两遍 | — |
| 缓存假命中 | Bazel 非 hermetic action 的经典问题 | 局部会发生：brief 的 sha256 只在交付时点绑一次，之后文件被改就是假命中 | 判据：出现"brief 与工作区不一致"的核对需求 ⇒ 需要观测通道（§5 判据 7） |
| 历史被改写 | git refs 可变，「the meaning of a ref can change」 | **不发生**（追加） | — |

### 4.1 折叠成本的实测（判据 1 的底数）

合成事件流（turn/task.add/task.done 混排），本机 Windows / Node，三次取平均：

| 事件数 | 字节 | fold 耗时 | µs/事件 |
|---|---|---|---|
| 1,000 | 110 KB | 1.9 ms | 1.9 |
| 5,000 | 554 KB | 9.7 ms | 1.9 |
| 20,000 | 2,227 KB | 37.5 ms | 1.9 |
| 50,000 | 5,585 KB | 303.1 ms | 6.1 |
| 100,000 | 11,181 KB | 1,003.1 ms | 10.0 |

读法：

- 20k 事件之前严格线性（1.9 µs/事件）；之后超线性，因为对象图变大、GC 压力上升。
- transact 每次写折两遍（cli/deed.mjs:105 + :110），所以**写延迟 ≈ 2 × fold**。
- 按月分片**不降低折叠量**：cli/deed.mjs:276 是 fs.readdirSync(dir).sort() 读全部月片再合并（state 必须见全账本）。分片只减小单文件、便于 diff，不改变 O(n)。
- 这是**下限**：合成事件没有 review/shelve 的分支，真账本每事件 switch 分支更多、session.tasks.find 线性查找更贵。

## 5. 什么时候该换实现：八条判据

只给判据与阈值，不给建议。阈值里凡带"实测"的，都是本机单线程、合成事件流的数字。

| # | 判据 | 阈值 | 现在的位置 | 触发后"换的是哪一件事"（形态，不指产品） |
|---|---|---|---|---|
| 1 | 单次写延迟（2×fold + 解析 + 落盘） | > 200 ms（人类交互预算） | 30k–50k 事件之间：线性 1.9µs 外推 ⇒ ≈50k；超线性 6.1µs 外推 ⇒ ≈30k（即 3–6 MB 账本） | 换"重算"这一件事：快照 + 尾部重放（Fowler 的解法），或增量（DBSP 的解法）。**不是换存储** |
| 2 | 读延迟（deed state / 面板首屏：折全账本再渲染） | > 1 s | 同 #1 的量级（面板还要渲染） | 同上；面板侧另需"投影缓存 + 字节一致性校验"（AGENTS.md 不变式 3 要求同事实同字节） |
| 3 | 锁竞争 | 等待占比 > 5%，或出现跨机写同一工作区 | ≈0（人类节奏） | 换"串行化"这一件事：单写者进程（transactor 形态），文件锁只保留为本地互斥 |
| 4 | 跨工作区查询需求 | 出现一次即为真 | 无（deed 无全局索引） | 换"索引层"：日志必须出仓库，或加派生物——并显式接受"两份事实"的风险 |
| 5 | 删除/更正历史的要求 | 出现一次即破纯追加 | 无逃逸舱（Datomic 有 excision，deed 没有） | 需要设计删除语义（tombstone / redaction / 分片退休），这已不是存储问题而是记录政策 |
| 6 | 需要删改事件类型 | 出现一次 | 事件类型只增不减 | 需要"快照 + 兼容读法"（Temporal 用 continue-as-new / patching 对同一问题，**细节未取原文**） |
| 7 | 账本与工作区不一致的核对需求 | 出现一次（今天只在 review.brief 一处） | 缺观测通道 | 需要"观测通道"（refresh 形态），即把 desired-only 变成 desired+observed |
| 8 | 账本提交噪声 | 纯账本提交占提交历史 > 20% | 未测 | 说明账本频率与代码频率不匹配 ⇒ 这是"把日志搬出仓库"最强的判据（可测、且早于 #1 出现） |

### 5.1 "该把日志搬出仓库"的联合判据

仓库内 JSONL 作为载体的合理性依赖三个性质：**可 diff、可随代码审查、体量小到能每次全折**。三条判据任一成立，这个载体就不再正确：

1. 判据 1/2/3 任一触发（重算或串行化代价超过交互预算）；
2. 出现跨工作区查询需求（判据 4）——仓库内日志不是索引层；
3. 出现删除/保留期要求（判据 5）——纯追加在仓库里无法表达"必须忘记"。

搬出去之后的形态是**单写者 + 快照 + 只读分发**（Datomic transactor、EventStoreDB、SQLite+WAL 都是这个形态的实现，任一可选）。**但搬家的判据里必须包含一条反向项**：账本可 diff、可随代码 review 的收益是否已被判据 8 证明为噪声。若判据 8 未触发（账本提交不占主导），搬出去只换来延迟变好、失去审查——那是不划算的换法，尽管技术上"更正确"。

## 6. 层与层的边界表

| 层 | 拥有的事实 | 拒绝拥有 | 暴露接口 | deed 若越界会怎样 |
|---|---|---|---|---|
| VCS（git） | 内容与历史的版本 | 谁的判断有效 | commit/tree/blob/ref | 判决写进 commit message ⇒ 不可重算（ADR 的同一种病） |
| 构建（Nix/Bazel） | 输入→产物的确定性与缓存 | "这次该不该做"（人的决定） | derivation / action digest | deed 试图做内容寻址判定 ⇒ 假命中（§4） |
| CI | 什么条件下跑什么 | 结果是否合格（退出码只是信号） | pipeline / job | deed 的 gates 命令是宿主语义挂在这里——边界正确，但 deed 不拥有它 |
| IaC（Terraform） | 资源期望态 + drift 检测 | 谁批准 | plan/apply/state | deed 无 drift 检测 ⇒ 缺观测通道 |
| 部署（GitOps） | 集群实际态收敛到仓库期望态 | 人是否同意 | 同步状态 / 漂移 | deed 若声称收敛 ⇒ 它没有 apply 能力 |
| 配置（声明式/k8s） | spec 与 status 分离 | 历史 | API 对象 | deed 若把历史塞进 status ⇒ 与 k8s 的 compact 冲突 |
| 票据（Jira / Fossil tickets） | 工作项状态机 + 讨论 | 判据（状态转移靠人点按钮） | ticket / transition | deed 若只要状态 ⇒ 它比票据更弱（票据有 UI/通知/查询） |
| ADR | 决定的记录 | 决定是否仍然成立（不可重算 ⇒ **判据分叉**） | 一份 md | deed 若只记决定不记判据 ⇒ 退化成 ADR |
| PR review | 变更对话 + 批准事件 | 批准的持久性（force push 后失效） | review / approve | deed 若绑 commit 而不绑交付物 ⇒ 假批准 |
| 会议纪要 / HANDOFF.md | 当下该做什么的说明 | 可重算（人手同步副本 ⇒ 必然漂移） | 一份 md | deed 若输出一份 md 而不输出账本 ⇒ 变成 HANDOFF |
| **追认层（deed 主张）** | **某一份具体内容被某个有资格的人追认** | 内容本身、调度、真理、执行 | fold(log) / rules(doc) / append(event) | 越界到上表任一行 ⇒ 该行已有的失败模式立刻接管 |

这张表的用法：**deed 的合法性只由最后一行的"拥有"列决定**。它拥有的事实只有一个，比任何一行都窄；宽出来的部分是它主动拒绝的，不是它没做。

## 7. 这个层如果成立，它该叫什么

这一层命名要遵守既有分层史的形式：左边是对象，右边是机制或风格（file→VCS、build→CI、infra→IaC、deploy→GitOps、config→declarative）。对象是什么？

- 不是「决定」（decision）：ADR 已占，且决定不需要追认；
- 不是「工作项」（issue/task）：票据已占，且 deed 明说不做项目管理；
- 不是「权限」（authorization）：IAM 已占，且 IAM 答的是"能不能访问"，deed 答的是"这一份算不算完"；
- 是「**追认**」（assent / ratification）：某一份具体内容，被某个有资格的人，认作完成/驳回。

所以：

- **主名：assent 层；机制名 assent ledger（追认账本）。** 判定句：这个层拥有的事实只有"追认"，因此它的名字必须来自追认，而不是授权、流程或追踪。
- **可检索的别名**：commitment ledger（文献侧最近的近亲，承诺有生命周期：建立/履行/违背——[Singh, AI & Law 1999](https://dl.acm.org/doi/10.1023/A%3A1008319631231)，**未读全文**）；records governance / change authorization（合规侧，21 CFR Part 11 与 ITIL CAB 的实际叫法）；decision ledger（ADR 的近亲，但会与 ADR 混）。
- **不推荐**：authorization layer（撞 IAM）、workflow engine（暗示派活与执行）、event sourcing（实现手法不是层名）、append-only system of record（非术语，见 §2）。

一句话：**它是"追认层"的一次仓库内实现；不是新层，是这一层第一次变得可重算。**

## 8. 三种反驳读法，以及哪一种证据更强

| 读法 | 主张 | 支持证据 | 判据（何时这条读法胜） |
|---|---|---|---|
| A：不是新层 | 只是票据的另一种存储 | Fossil 2006 已用 artifact + 重放实现 ticket 状态，且内容寻址（§3） | 若"判据在数据上 / brief 绑指纹 / 交付与判决不共手"三项都不被视为层特征，A 胜 |
| B：是约束式流程引擎的子集 | Declare 已能从约束推下一步 | Declare 用约束替代流程图规定允许的活动序列（摘要页） | 若 deed 的 rules 被理解为"活动序列约束"，B 胜；但 deed 的 rules 是**资格函数**（谁-对-哪一段-做哪个动作），不是过程约束，二者可共存 |
| C：是 CI 的 gate 层 | gate 命令属于宿主 | CI 拥有"什么条件下跑什么" | 若 deed 的 gates 变复杂到承载判定逻辑，C 胜；今天 gate 只回退出码 |

我的判定：**A 的证据最强**（拓扑无新意，先例在 Fossil），但 A 只说对了"结构"，没说对"位置"——票据/ADR/PR/纪要这一簇今天**没有唯一系统记录**，事实分散在四个载体里，判据分散在人脑里，这才是"判据分叉"的架构成因。deed 的贡献是把这一簇的事实搬进仓库并使之可重算。所以：**新在位置，不在结构。**最终答复按这一句写，不要把"新层"说成结论。

## 9. URL 清单（按用途分组）

一手，已核实原文：
- k8s controller 定义与 desired/current：https://raw.githubusercontent.com/kubernetes/website/main/content/en/docs/concepts/architecture/controller.md
- k8s 声明式 apply（"retains writes made to live objects"）：https://raw.githubusercontent.com/kubernetes/website/main/content/en/docs/tasks/manage-kubernetes-objects/declarative-config.md
- OpenGitOps 四原则（Versioned and Immutable / Continuously Reconciled）：https://raw.githubusercontent.com/open-gitops/documents/main/PRINCIPLES.md
- Fowler Event Sourcing（system of record 二选一、Complete Rebuild、cache anywhere）：https://martinfowler.com/eaaDev/EventSourcing.html
- jj operation log（view 快照、无锁并发、divergent ops）：https://raw.githubusercontent.com/jj-vcs/jj/main/docs/operation-log.md
- Datomic 事务模型（immutable facts、datoms、declarative tx）：https://docs.datomic.com/transactions/model.html
- DBSP（DB[t]=Σ(i≤t)T[i]）：https://ar5iv.labs.arxiv.org/html/2203.16684
- Borg 论文 PDF（declarative spec、Paxos cell state、desired+observed）：https://research.google.com/pubs/archive/43438.pdf（本机 .tmp/research/_src/borg-2015.pdf）
- Fossil 票据重放与 artifact：https://fossil-scm.org/home/doc/trunk/www/bugtheory.wiki ；https://fossil-scm.org/home/doc/trunk/www/concepts.wiki
- SQLite WAL 与 checkpoint：https://www.sqlite.org/wal.html
- RFC 6962 CT（append-only untrusted logs、Merkle）：https://www.rfc-editor.org/rfc/rfc6962.txt
- 21 CFR 11.10(e)(f)(g) 审计跟踪/序列/权限：https://www.govinfo.gov/content/pkg/CFR-2024-title21-vol1/xml/CFR-2024-title21-vol1-sec11-10.xml
- Temporal workflows（event history = complete ordered log）：https://docs.temporal.io/workflows.md
- Temporal limits（51,200 events / 50 MB）：https://docs.temporal.io/workflow-execution/limits.md
- Bazel RE API（ActionCache / CAS）：https://raw.githubusercontent.com/bazelbuild/remote-apis/main/build/bazel/remote/execution/v2/remote_execution.proto
- git 内部（objects 不可变、refs 可变）：https://maryrosecook.com/blog/post/git-from-the-inside-out
- Erlang supervisor（strategy/intensity/period）：https://www.erlang.org/doc/apps/stdlib/supervisor.html
- Nix 论文（纯函数式部署模型）：https://edolstra.github.io/pubs/phd-thesis.pdf（本机 .tmp/research/_src/nix-thesis.pdf）
- Nix store path（digest 不透明）：https://nix.dev/manual/nix/latest/store/store-path

次级（元数据/摘要层，未读全文）：
- Schmidt & Simone, Coordination mechanisms, JCSCW 5(2-3) 1996, 155-200：https://dl.eusset.eu/items/be74279c-6cc5-4ba4-8f90-80e9cd16b0b1/full
- Singh, An ontology for commitments in multiagent systems（AI & Law 1999）：https://dl.acm.org/doi/10.1023/A%3A1008319631231
- Declare（Pesic/Schonenberg/van der Aalst, EDOC 2007）：https://scholar.archive.org/work/hdrhdo4zpfectjjaj32rk5xcnq
- Automerge 文档模型：https://automerge.org/docs/reference/documents/
- ADR 谱系：https://adr.github.io/

未验证（本报告内按此标注即视为不确定）：
- Schneider 1990 状态机复制原文；Kafka compaction 原文（站点为重定向壳）；NIST SP 800-53 AC-5 正文（JS 渲染）；WfMC 参考模型 PDF（抓取返回 HTML）；Axon / CMMN；GitHub "dismiss stale approvals" 具体行为；jj op log 是否随 push 传输的细节；Yjs 论文。

## 10. 与本项目的关系（一句话）

fold 慢是**增量问题**不是存储问题；账本与工作区不一致是**观测通道缺失**不是规模问题；身份自述是**权限模型缺失**不是实现偷懒。三件事分别落在 §5 判据 1、7、4-5 上，且第一件已在 30k–50k 事件的位置。
