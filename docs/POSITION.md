# 定位判断书

2026-11-23。这份文件回答三问：**deed 占哪一层、它拥有什么与不拥有什么、同类是谁又差在哪一步**。
结论先行；每条判断后面挂着出处（原文在 `docs/research/`；代码行为以仓库为准）。
它不改行为——DESIGN 才是行为权威。它管的是"对外怎么定义自己"，README 从这里取叙事。

## 一、结论三句

1. **deed 不是新的一层，是既有「过程记录层」里最后一格的载体替换。** 那一格是**授权**：谁判的、判的是哪一份字节、判过之后改动是否作废。今天这一格没有主人——它散在 PR 审批、会议、邮件、口头决定里，而这些东西**不能被重算，也不能被拒绝**。
2. **层名该叫追认（assent）。** 一句话：*desired state 说系统该是什么样，assent 说人已经允许它是什么样。* 类目名 `decided state` / `decision & authorization ledger`。
3. **最薄的一环是"账本随仓库 + 身份自述"。** 有 push 权限的人能重写历史并让它自洽；`--by` 是自述不是鉴权。deed 现在给的是**协作纪律，不是防篡改**——这句话必须摆在 README 正面上，塞进"已知代价"等于骗人。

## 二、四路证据，合并后只剩一个故事

| 谁 | 问的什么 | 给出的判断 |
|---|---|---|
| stackmap | 这类事实今天落在谁身上 | 「跨会话的进度与授权」其实是**四格**：谁提过（intent）/ 做到哪（progress）/ 谁定的（decision）/ 谁准的（authorization）。四格分居 issue tracker、ADR/spec、PR 审批、HANDOFF.md 与会话记录。缺口不是缺工具，是**四格没有共同的可复核载体**，于是判据分叉 |
| topology | 这种拓扑在文献里叫什么 | 状态机复制（Schneider 1990）+ event sourcing（Fowler 2005）+ reconcile loop。**没有统一专名**；最狠先例是 Fossil（2006）：票据变更即 artifact，当前状态 = 按时序重放 |
| layerprecedent | 新层怎么成为标准 | 五条判据：事实缺口 / 载体 / 可重算 / 平台默认 / 中立规范。**deed 3/5**：满足前三，缺后二 → 位置在 GitOps（2017-08）与 OTel（2019-05）之间，是**层候选**，不是已成立的层 |
| 两个陌生人（只读 GitHub 真跑） | 这是啥、用不用 | 「把一个工作区里的对话变成只追加的账本，再从账本算出谁该动手，并用命令挡住不合法的流程动作」；值钱的三样：下一步由数据算且只有一处、证据钉字节且能判过期、审查的纸与结论强绑定。**PR 流程给不了这三样。** |

共同指向：**deed 的价值不在"记下来"，在于"拒绝"。** 陌生人替它总结得比原 README 好——「OpenSpec 的产物是给人读的规格文档；deed 的产物是一个状态机：动作要么被账本接受，要么一个字都不写」。

## 三、它拥有哪一格，不拥有什么

**拥有（四件，缺一件就不成立）**

- **承诺**：任务 = 一句话 + 做完的标准 + 触及路径。
- **交付**：谁交的、当时的内容钉在 sha256 上（`--digest`），树变了就过期。
- **判决**：结论只回答**已交出去的那份**（`review.brief` 记路径与 sha256）；交付过这一段的 `by` 不能判这一段。
- **授权**：签收、打回、用新结论作废旧结论——作废本身也是账本事实，不留删除痕迹。

**不拥有（每条都有理由，不是没做）**

- 进度管理：谁负责哪个需求、什么时候交付，属于 issue tracker。
- 规格与设计：什么是"对"的，属于宿主文档（OpenSpec/Spec Kit 那一层）。
- 执行：真去改代码的是 agent，deed 不派活（派活是宿主能力，接不上就由 `doctor` 说"派活未接"）。
- 身份鉴权：不建账号、不签发证书；`--by` 是自述，deed 只保证"谁说过什么"能追，不保证"说的人是谁"。
- 策略执行：不拦网络、不拦命令，只管账本收不收这条事实。
- 多工作区视图：故意不做（一份账本一个工作区）。

## 四、对照表（替质疑者先说，再给分界）

| 系统 | 有哪几件 | 差在哪一步 |
|---|---|---|
| **Gerrit** | 4/4 齐全：vote 绑 patch set（"Votes that are not copied to the new patch set, are called outdated"）、`ignoreSelfApproval`、submit requirements 谓词求值、Attention Set 算"现在谁该动" | 真相在服务端数据库；对象是 diff 不是交付物；没有签收；离线不可用 |
| **GitHub 保护分支** | 有 stale approval（改动即作废）、"approval from someone other than the last person to push"、CODEOWNERS | 账在平台；粒度是 PR；**dismiss stale approvals 是可选开关**，有写权限者可单方面 dismiss；无签收；离线不可用 |
| **Fossil** | 同构最强：票据变更即 artifact、当前状态 = 重放、内容寻址 | 位置不同：票据的"当前状态"是它的私事，不回答"谁能判、下一步谁动" |
| **NIST SP 800-53 CM-3** | 变更控制记录 4/4（申请/评估/批准/实施） | 记录在 GRC 系统里、靠开会推进、**不可重算**、不随代码走 |
| **21 CFR Part 11** | 11.10(e) 不可擦除、11.10(f) 顺序强制、11.10(g) 权限校验、**11.70 签名必须与对应电子记录绑定，不能被切除、复制或转移** | 是法规不是工具；合规认证不提供（deed 不声称合规） |
| **in-toto / SLSA** | 证明的形态逐条对上：`subject[{name,digest}]`、"Subjects are assumed to be immutable"、"matched purely by digest" | 管供应链，不产"下一步"；没有判决与签收 |
| **jj op log / Temporal** | 载体形态近亲（只追加、可重放） | 没有裁决层：能重算事实，不能说"这条不许过" |
| **Beads** | 形态最像（git、离线、纯数据、claim/close） | **Compaction 会改写历史**；v1.4.0-rc.4 已把真相从 JSONL 迁到 Dolt（并发 claim、图查询、表达删除） |
| **git-appraise** | 评审即 git 对象、离线、pull 自动合并（Google，已归档） | 无状态投影、无"这一份"绑定、无下一步 |
| **cc-sdd v3** | 独立 implementer + 独立 reviewer | 判决是 `tasks.md` 里的 `VERIFIED/NO-GO` 字符串：审的是当前工作区，**判决没有对象** |
| **OpenSpec / Spec Kit** | 规格、任务、阶段关卡 | 真相是一份可反复改写的人维护文档；完成 = 文档里的勾；历史交给 git |
| **acc / agent-change-control** | four-eyes、离线、digest、stale approval | 真相是 API 快照，自述 "best-effort snapshot, not an atomic historical archive"；判 PR；**没有"结论绑定交出去的那一份"** |
| **CHAP（arXiv 2606.09751）** | 只追加账本 + 投影 | 面向审计留痕，不回答授权与下一步 |

一句话分界，可印在 README 顶：**编排器决定 agent 干什么，deed 决定人敢不敢放行。**
对规格工具：**Spec 工具告诉 agent 该造什么；deed 记下交出去的是哪一份、谁判的、接下来谁动。**

## 五、三种反驳，先说出口

- **A「这不就是票据换了一种存储？」**（Fossil，证据最强）——结构说对了，位置说错了：Fossil 的票据状态是它的私事，deed 的那一格今天没有主人。
- **B「这只是一个约束式流程引擎的子集？」**——不是。deed 的规则是**资格函数**（谁能判、够不够），不是过程约束（先做 A 再做 B）；两者可共存。
- **C「这不就是 CI 的 gate？」**——现在是。一旦`gates` 复杂到承载判定逻辑，C 就赢了；deed 要守住的是"gate 只说行不行，不说为什么算行"。

## 六、诚实的两条结构缺口

1. **缺 observe**：k8s / GitOps / Borg 都同时持 desired **与 observed**；deed 只有 desired（账本说"判过了"，没人核对工作区现在还是不是那一份）。这不是规模问题，是**结构性缺一条观测通道**——brief 的 sha256 只绑交付时点，文件被改即假命中。补法：`verify` 已有雏形（重算任务书指纹），下一步应扩成"账本 vs 工作区"的常规核对。
2. **身份自述**：见结论第 3 条。真正的补法不是自建账号，而是**引用外部身份**（git 签名 / OIDC），deed 只记"我引用了哪一条"。

## 七、层成熟度：3/5，先被替代的是 HANDOFF.md

- 判据 5（平台默认 / 中立规范）不满足 → 别在 README 里自称"新层"，写成"与 desired state 并列的那一格"就立得住。
- 最先被替代的排序：**HANDOFF.md / 会话交接文档**（读者是 agent，只关心"下一步是什么"，正好是 `deed state` 第一行；无 schema、无署名）→ ADR 的 `status` 字段 → PR 审批被**吸收成事件类型**（不是被替代）→ issue tracker 只丢"现在等谁"一格。
- 接口史实：活得久的接口都是"一个文件 / 一个头 / 一行提交信息 / 一个 socket"。所以 deed 最强接口不是 15 种事件，是 **`deed state` 的第一行**。

## 八、名字

- 正式：**Decision & Authorization Ledger**（决定与授权账本）；口语 `decision ledger`；层名 **assent**（追认）。
- 构造法：**decisions as events**（不是 `as code`——它不执行）。
- 禁用：agent governance（含策略执行/RBAC）、work ledger（Beads 占用）、agent OS、orchestration、memory layer、AI governance platform、event sourcing（手法不是层名）。
- 现在的自我描述「一个工作区的议事与执行机制」正落在**最弱**的一格，要换掉。

## 九、README 该怎么写（等用户点头再动）

顺序：①它回答什么问题（人怎么敢放行）→ ②一句话分界 → ③对照表（第四节）→ ④三条值钱的机制（下一步只有一处 / 证据钉字节 / 纸与结论成对）→ ⑤代价与不许声称的事（不防篡改、不声称合规、单工作区、无鉴权）。
禁句：新层、取代 issue tracker、AI 治理平台、合规、不可否认。

## 十、等用户裁定的三件

1. 名字与层名是否照第八节定档（`deed` 保留为工具名，类目用上面的词）。
2. README 是否按第九节重写（会动 DESIGN §1 的自我描述）。
3. **这个仓库要不要自己用自己**：根目录建 `.deed/`，进度从手写 HANDOFF 换成账本——两个陌生人都点了这一条，但账本进主仓是不可逆的对外形态。
