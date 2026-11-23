# 出处：它站在哪一格，凭什么这么说

这一页是 [`../README.md`](../README.md) 「它站在哪一格」那一节的底稿：每条判断的来源、替质疑者先说的三条反驳，以及可以拿去用的句子。
措辞在这里可以松，判据必须能复核。

## 一、层的位置

工具链里记录「发生过什么」的地方分四格：

| 格 | 回答的问题 | 今天的载体 | 能不能重算／能不能被拒 |
| --- | --- | --- | --- |
| intent | 谁提过、为什么 | issue tracker 的正文、ADR | 不能重算；能被悄悄改 |
| progress | 做到哪 | issue 状态、任务清单、聊天 | 不能重算；状态位是手改的 |
| decision | 谁定的 | ADR、RFC、会议纪要 | 不能重算；多数靠人记 |
| authorization | 谁准的、准的是哪一份字节 | PR 审批、邮件、口头 | 不能重算；**平台一换就没了** |

deed 只认领第四格，并把它和前两格钉在一起。**它不新开一层**：这一格本来就在，只是没有载体。

成熟度 3/5：有形态（只追加账本 + 纯函数投影）、有先例（下表的四件套）、有可复算的判据；
缺的是平台默认（没人替你装）与中立规范（没有标准可引）。所以只说「层候选」。

## 二、同一件事别人做到哪一步

| 系统 | 钉住了什么 | 停在哪 | 出处 |
| --- | --- | --- | --- |
| Gerrit | vote 绑 patch set（换 patch set 后旧票 "called outdated"）、`ignoreSelfApproval`、submit requirements 谓词、Attention Set | 真相在服务端 DB；对象是 diff；无签收 | gerrit 文档 submit-requirements / attention-set |
| GitHub 保护分支 | stale approval 处置、"approval from someone other than the last person to push"、CODEOWNERS | 账在平台；粒度 PR；dismiss stale 是可选开关 | GitHub Docs, About protected branches |
| Fossil | 票据变更即 artifact、当前状态 = 重放、内容寻址 | 票据状态是它的私事 | fossil-scm.org 文档 |
| NIST SP 800-53 CM-3 | 变更控制记录四件（申请／评估／批准／实施） | 记录在 GRC、靠开会、不可重算 | CM-3 控制描述 |
| 21 CFR Part 11 | 11.10(e) 不可擦除、11.10(f) 顺序强制、11.70 签名与记录绑定 | 是法规不是工具 | eCFR 21 CFR 11.10 / 11.70 |
| in-toto / SLSA | `subject[{name,digest}]`、"matched purely by digest"、"Subjects are assumed to be immutable" | 管供应链，不产下一步 | in-toto Statement v1、SLSA provenance |
| Beads | git、离线、纯数据、claim/close | Compaction 改写历史；v1.4.0-rc.4 迁到 Dolt | beads 仓库与 ADR |
| git-appraise | 评审即 git 对象、离线、pull 自动合并 | 无状态投影、无「这一份」绑定；已归档 | google/git-appraise |
| cc-sdd | 独立 implementer + 独立 reviewer | 判决是 `tasks.md` 里的字符串 | cc-sdd 仓库 |
| OpenSpec / Spec Kit | 规格、任务、阶段关卡 | 真相是可反复改写的人维护文档 | openspec / spec-kit 文档 |
| acc (agent-change-control) | four-eyes、离线、digest、stale approval | 真相是 API 快照（"best-effort snapshot, not an atomic historical archive"）；判决不绑交出去的那一份 | noru / agent-change-control |
| CHAP (arXiv 2606.09751) | 只追加的协作协议，★123 | 是协议不是工作区载体 | arXiv |
| jj op log / Temporal | 载体形态最像：操作日志可重放 | 没有裁决层 | jj 文档 / Temporal 文档 |

最少见的组合只有三件：判决钉在被交出去那一版的 sha256 上（`review.log` 没有 `briefDigest` 直接拒绝入账）；
新结论显式作废旧结论，fail 不能被后来的 pass 静默覆盖；谁能判、谁能签是纯函数从账本折出来的。

## 三、替质疑者先说的三条反驳

**「票据换个存储就完了」**（Beads v1.4.0-rc.4 从 git JSONL 迁到 Dolt，理由是并发 claim、图查询、表达删除）。
它描述的规模是多机、多用户、图查询；deed 只服务单工作区、单人加几个 agent，不需要图查询。
删除在 deed 里不是删行，是**再加一条事实**（`shelve`／`drop`）。这条取舍进 DESIGN，不进 README 叙事。

**「这只是流程引擎的子集」**（Temporal 的 durable execution、jj 的 op log 都能重放）。
重放是它们的手段，不是它们的目的：它们回答「怎么把一段流程跑完」，不回答「谁有权判、下一步该谁动」。
deed 的判据是纯函数、落在仓库里、离线可跑；流程引擎的判据在配置层和服务端。

**「CI gate 已经有了」**（GitHub checks／Jenkins gate 也能挡合并）。
CI gate 挡的是「这次构建过不过」，不记「谁承诺了什么、谁判的是哪一份字节、判过之后改动是否作废」。
而且它不识字：审查结论的主体是人，CI 的结论是机器。deed 的 `deed gate` 反而是**借用**它们的形状：按顺序跑、第一条不过就停。

## 四、能拿去用的句子

- 分界：**规格工具告诉 agent 该造什么；deed 记下交出去的是哪一份、谁判的、接下来谁动。**
- 载体差异：**判决与被判物同在随仓库提交的纯文本里；标的是人能复算的 sha256，不是平台的序号。**
- 边界：**deed 给的是协作纪律，不是防篡改**——有 push 权限的人能重写历史并让它自洽。
- 风险自陈：**只检查「有没有被批准」的监督，可以被盖章满足**（arXiv 2610.00961）；所以可复算的交给确定性校验（2611.07483：确定性校验 78.7% vs LLM 检查 59.0%），人的判断只留风险取舍。

## 五、名字这件事

「agent work ledger」最接近，「agent sign-off ledger」更准；中文圈「台账」被用过五次，全部停在门外（都是排期、持久化、旁路审计，没人拿它当判据来源）。
现在的 `deed` 是暂用名，正式名未定。

## 六、原始报告在哪

这一页之外还有 8 份未加工的调研原文（约 26 万字符），**已从工作区移除**，它们在 git 历史里：

```bash
git show 2b2cd19:docs/research/landscape-agent-ops.md      # 想看哪份就取哪份
```

理由：那些是过程材料，留着会变成第二个权威。要复活其中某一节，抄回这一页，不要新起一个文件。
