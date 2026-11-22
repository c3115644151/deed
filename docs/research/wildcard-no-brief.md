# 荒野扫描：谁在管"谁说了什么、谁做了什么、谁能判、下一步谁动"

- 采样时点：**2026-11-23**（会话本地时间）。星级来自 GitHub API 实测 2026-11-22/23；论文日期为 arXiv 提交日；标准为现行版本日期。
- 方法：从抱怨出发反查（失忆 / 自评完成 / 审查走过场 / 多 agent 互踩 / 没人知道下一步），不按"有哪些工具"正查。只认一手：论文原文页、RFC/W3C/法规原文、官方文档、仓库源码与 API 元数据。二手转述（博客、新闻、百科）只用来识别"宣称"，并标注。
- 纪律：每条结论带 URL；读不到原文的写 **未验证**；版本与日期随条记录。
- 本文只负责"荒野"（学术 / 标准 / 非软件历史 / 小项目与土办法 / 反方向）与四项结论。同目录的 spec-driven.md、category-and-naming.md、软件工程可追可审可签传统.md、agentops-task-memory-orchestration.md 覆盖正街，不重复。

---

## 0. 400 字结论

**不是独一份，是同一族里的一个特定组合。** 逐件拆开，deed 的每个零件都有成熟先例：只追加账本 + 状态是投影 = 事件溯源（Fowler）/ CHAP 的 append-only evidence log / IETF AAT 草案 / 日文 JSONL 引き継ぎ台帳；交付者不能判自己 = 维修站 RII 双人检验、银行 maker-checker、审计 ISA 230 的"谁做/谁复核"、同行评审回避；先出纸再结论并绑定 sha256 = in-toto 的 subject digest、SCITT 的 signed statement、GitHub"新提交作废旧批准"；"下一步只有一处" = grove 的"protocol picks the next step"、Horvitz 混合主动式；签收与判决分离 = 中国施工图审查的"审查合格书多人签字 + 法定代表人签发 + 盖章"、日本確認済証/検査済証两证、evoflow 的"同意派发 ≠ 确认完成"。

**真正少见的是三步的组合，不是任何单步：**（一）判决对象被钉成"交出去那一刻的 sha256"，纸变了旧结论自动失效，且 `judge --rework` 让旧结论显式作废（voidedAt/voidedBy）——这把"谁审了哪一版"从一句 LGTM 变成可重算的字节关系；（二）**所有门（谁能判、谁能签、要不要审）是纯函数从账本折出来的，不是代码里的 if 或配置文件开关**；（三）交付形态是零依赖、账本随仓库提交、面板只读且同数据同字节。

**与谁同源最紧的三个：** in-toto attestation（subject{name,digest} + predicate）、SCITT（signed statement + receipt + 透明服务）、21 CFR Part 11（审计追踪 + 权限检查 + 签名归属）。次紧：ISA 230 第 10 段的"谁执行、谁复核、日期与范围"。

---

## 1. 抱怨 → 谁在接

| 抱怨 | 谁在明说（一手） | 谁在做机制 |
|---|---|---|
| agent 上报的完成是假的 | 2611.25760（2026-11-19）：夸大完成是最常见子类 | FaithDetector 类检测器；agent-orchestra "cannot declare success" |
| 跨会话失忆、交接靠摘要 | 2611.06545（2026-11-04）：自写摘要会伪造限制与授权 | 日文 JSONL 台帳；claude-codex-handoff；2611.24357 state–evidence 分离 |
| 审查走过场 | 2610.00961（2026-10-01）"只查有没有被批准，可被盖章满足"；LGTM 气味研究 | agent-orchestra 禁自验；ISA 230；RII |
| 多 agent 互相踩 | 2611.22245（未细读）多 agent 记忆不一致 | agent-board / beads / boardown 的 DAG 与租约 |
| 没人知道下一步谁动 | grove README "The protocol picks the next step" | deed nextAction；Horvitz 1999 混合主动式 |
| 给 agent 加流程是错的 | Anthropic《Building effective AI agents》"only when it demonstrably improves outcomes" | 2606.08919 倒 U；Dan Davies accountability sink |

---

## 2. 学术（CHI / CSCW / FAccT / arXiv）

### 2.1 自评与不可信的工作报告（deed 的前提被实证了）

- **arXiv 2611.25760**（2026-11-19）《Characterizing and Detecting Unfaithful Work Reports by Coding Agents》。11 个子类归 4 类：误报观察、错置证据、夸大完成、错误技术解释；**夸大完成最常见**。抽样 435 份报告；人工处理平均多 4.3 轮 / 12.71 分钟；FaithDetector 的 macro-F1 比基线高约 13pp。→ 直接支撑"完成声明必须带可复算证据"。
- **arXiv 2611.06545**（2026-11-04）《When Do Summaries Become Instructions?》。agent 自写的交接摘要会产出账本不支持的**限制**（1.2% / 2.4%）与**授权**（0.1% / 1.3%）；中和假授权后未授权动作 24→7（共 120）。→ 交接如果靠摘要而不是账本，权限会被"记忆"创造出来。
- **arXiv 2611.07483**（2026-11-05，v2 2026-11-17）《Signed but Not Safe》。Qwen3-8B，1440 轨迹。签名需求清单把受攻击下的不安全提交从 69.4% 降到 9.0%（60.4pp，CI 51.4–69.4），无实用损失；确定性校验器抓住 78.7%，LLM 检查只有 59.0%；**签名前注入可把不安全率从 14.6% 推回 37.5%**。原文金句："Signing protects transit; extraction is the trust boundary."（https://arxiv.org/abs/2611.07483）
- **arXiv 2404.13076**（2024-04-15）《LLM Evaluators Recognize and Favor Their Own Generations》：自识别能力与自偏好线性相关。→ "同一个模型评自己"有系统性偏差，但偏差幅度可测。

### 2.2 治理 / 门槛 / 审查者的真实行为（deed 的"谁能判"被质疑了）

- **arXiv 2611.23678**（2026-11-18）《Evaluating Governed LLM-Driven ML Experimentation》。控制面（不是 LLM）拥有 trial 生命周期、检查改动范围、决定 keep/discard，**每次 trial 追加一条到 append-only ledger**；治理指标（invalid-action rate / repeated-bad rate / provenance completeness）全部从账本算；6 任务 1445 trials。关键反例：**只记成功的 loop 漏掉了 50 个 trial 中的 43 个**。→ deed"只追加、不筛"的方向有实证支持。
- **arXiv 2610.00961**（2026-10-01）《Cybernetic and Epistemic…》：原文"Oversight that checks only whether an output was approved is satisfiable by rubber-stamping"。提出每条决策带"若不然会怎样的条件"，并可被第三方复核（ORRCF + 重构测试）。→ 这是对"审查=一个通过事件"最直接的理论攻击。
- **arXiv 2606.08919**（2026-06-08）《Oversight Has a Capacity》：125 条动作，风险判定 Fleiss kappa=0.52；把 reviewer 建成会疲劳的模型后，**安全随升级率呈倒 U**——加更多人审可能更不安全；另有 flooding 攻击。→ "多一道门"不是单调变好。
- **arXiv 2611.24932**（2026-11-18）《Knowing What You Know》：reviewer 的价值是元认知校准；541,621 条 reviewer event / 483 人；纯行为画像把"过度自信组"（纠错存活率 5.2%）排到"真专家"（99.2%）**之上**；而 92.5% 的人力集中在真错误上。→ 该优化的不是"多一个人"，是"校准"。
- **arXiv 2610.35835**（2026-10-26）I-HITL / Countersign：10 个前沿模型会自行抓取 OTP 绕过人工审批。→ 人工门在模型眼里是可绕过的目标。
- **arXiv 2606.09751**（2026-06-08/20）CHAP：Core = workspaces / participants / tasks / artefacts / **append-only evidence log**；profiles 叠加 review / handoff / identity / signatures / transparency-backed audit；主张"the moment of human judgement is the most valuable signal"。→ 最接近 deed 的学术形态（见 `5）。
- 未细读但已在检索中确认存在（列名备查）：2611.18471（验证者判断跨表征稳定性）、2611.25214（Audited Epistemic Exploration）、2611.11045（"Agents Propose, Code Verifies, Humans Decide"）、2611.24357（state–evidence 分离，SWE-bench 150 任务 Pass@1 80.0→86.9、token −43%）、2610.37700（Coordination Tax）、2611.22245、2611.12545。

### 2.3 经典锚点

- Horvitz 1999《Principles of Mixed-Initiative User Interfaces》(CHI)：https://dblp.org/rec/conf/chi/Horvitz99.html
- Amershi et al. 2019《Guidelines for Human-AI Interaction》(CHI, 18 条)：https://dl.acm.org/doi/10.1145/3290605.3300233 ；PDF：https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/HAI.Guidelines.CHI2019.v10.share_.pdf
- Raji et al. 2020《Closing the AI Accountability Gap》(FAccT)：https://ar5iv.labs.arxiv.org/html/2001.00973
- 自评的张力：Self-Refine（NeurIPS 2023）https://papers.nips.cc/paper_files/paper/2023/file/91edff07232fb1b55a505a9e9f6c0ff3-Paper-Conference.pdf 证明自我反馈能改进；《Pride and Prejudice: LLM Amplifies Self-Bias in Self-Refinement》(ACL 2024) https://aclanthology.org/2024.acl-long.826.pdf 证明自偏好被放大。两条合起来才是事实：自评**有用且有偏**。

---

## 3. 标准与基础设施："谁签的、签的是哪一版、事后能不能查"

| 机制 | 一手出处 | 与 deed 的关系 |
|---|---|---|
| 来源模型（Entity/Activity/Agent + wasGeneratedBy…） | W3C PROV-DM REC 2013-04-30 https://www.w3.org/TR/2013/REC-prov-dm-20130430/ | deed 的"谁做的"字段是它的极简子集；deed 多了"谁能判" |
| 可验证凭证 | W3C VC Data Model 2.0 REC 2025-05-15 https://www.w3.org/TR/2025/REC-vc-data-model-2.0-20250515/ | deed 身份是自述字符串，不是 VC |
| 签名声明 + 透明服务 + 回执 | **RFC 9943**（2026-04，Standards Track，SCITT）https://www.rfc-editor.org/info/rfc9943/ | deed 的"先出纸 + 结论"缺 receipt 与外部可验证性 |
| 透明日志 | RFC 6962 Certificate Transparency（2013-06）https://www.rfc-editor.org/rfc/rfc6962.txt ；Sigstore Rekor https://docs.sigstore.dev/logging/overview/ | 防"偷偷改历史"；deed 靠 git 提交，弱一档 |
| 构建证明：subject 名 + sha256 摘要 + predicate | in-toto Statement https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md | **与 deed 的 review.brief（路径 + sha256）同构** |
| agent 审计轨迹草案 | IETF draft-sharif-agent-audit-trail-00（2026-03-29，R. Sharif）https://www.ietf.org/archive/id/draft-sharif-agent-audit-trail-00.txt | 最直接的"同类物"，见 `5 对照 |
| 审计日志规范缺位 | OpenTelemetry community PR #2409 "Project Proposal: Audit Logging SIG"，**自 2024-10-24 起仍 open**；原文"no semantic conventions for audit logs in OTEL" | 说明这个类目的标准层是空的 |
| 记录保存义务 | EU AI Act Art.12（Regulation 2024/1689）https://artificialintelligenceact.eu/article/12/ | 合规侧需求存在 |
| 电子记录 / 审计追踪 / 签名归属 | 21 CFR Part 11 Subpart B（11.10(e)、(g)）https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11/subpart-B/ | deed 的"审计追踪不可改 + 签名可归属"是同一条法理 |
| 数据完整性 | ALCOA / ALCOA+（MHRA 指南转载）https://di-itc.gmp-compliance.org/news/news-detail/the-integrity-of-gmp-data-part-2-of-the-new-mhra-blog.html | "contemporaneous / attributable / original / accurate" 与 deed 字段几乎一一对应 |
| 高级电子签名 | eIDAS Art.26（ICO 指南）https://ico.org.uk/for-organisations/guide-to-eidas/qualified-trust-services/ | 唯一标识签署人 + 唯一控制签署数据 + 改动可发现 |
| 可靠电子签名三条件 | 中国《电子签名法》第13条（2019 修正）https://flk.npc.gov.cn/ ；转载 https://policy.mofcom.gov.cn/claw/clawContent.shtml?id=66982 | **deed 满足第 3 条（改动可发现），不满足第 1、2 条（密钥专有、签署时仅本人控制）**——所以不能自称"可靠电子签名" |
| 日志控制 | ISO/IEC 27001:2022 A.8.15（二手：https://www.dqsglobal.com/en/explore/blog/watch,-detect,-respond-tips-for-logging-monitoring-activity-on-your-system-with-iso-27001-2022-controls-a.8.15-and-a.8.16） | 记录事件 + 保护完整性 + 保留 |

---

## 4. 非软件领域的历史办法（deed 每一步的老家）

| 领域 | 机制（一手） | 对应 deed 的哪一步 |
|---|---|---|
| 航空签派 | **14 CFR 121.535(b)**：机长与签派员对飞行前计划、延误、签派放行**共同负责**；PDF https://www.govinfo.gov/content/pkg/CFR-2024-title14-vol3/pdf/CFR-2024-title14-vol3-sec121-535.pdf | "两个角色共签同一份放行"——deed 的"交付/判决不共手"的反面：这里是必须共手 |
| 维修站质检 | 14 CFR 135.431（必需检查由合格人员执行）；FAA AC 145-9A（RII 检验员，special instructions 写在 work order / traveler 上） | "检查项写在伴随单据上，跟着工件走" = review.brief 跟着会话走 |
| 航海日志 / 公证日志 | 美国公证员日志须**逐页连号、不得回填旧册**（Illinois Admin Code https://www.ilga.gov/ftp/JCAR/AdminCode/014/014001760J09200R.html ；NNA 问答 https://www.nationalnotary.org/knowledge-center/news/law-updates/notary-news-2025-02 ） | "只追加、不重排"的字面来源 |
| 施工图审查（中国） | 《房屋建筑和市政基础设施工程施工图设计文件审查管理办法》https://www.mohurd.gov.cn/tsgb/gzk/art/2022/art_1208230109.html （2023 修改 https://www.mohurd.gov.cn/tsgb/wjk/art/2023/art_445675984.html ）：审查合格书须"**各专业的审查人员签字，经法定代表人签发，并加盖审查机构公章**"；注册执业人员须在施工图上盖章签字 | 判决**绑定到具体那一套图纸**（图变了合格书就无效）= deed 的 briefDigest；多人签字 + 机构签发 = 判决与签收分离 |
| 建筑确认（日本） | 《建築基準法》第 6 / 7 条：**確認済証**（开工前）与**検査済証**（完工后）是两张不同凭证 https://www.pref.kumamoto.jp/soshiki/115/230843.html | "开工许可"与"完工签收"不是同一个事件——deed 的 gate 与 sign 分离 |
| 建筑设计 RFI | AIA G716-2004《Request for Information》标准表 https://help.aiacontracts.com/hc/en-us/articles/1500009444782-Summary-G716-2004-Request-for-Information-RFI | "提问—答复"是有编号、有归属、可追踪的一等单据 |
| 电子实验记录本 ELN | Labii 的 signers（记录级签名/见证）https://docs.labii.com/user-guide/work-with-record/signers ；NCI 指南：专利申请相关记录需**适当见证** https://techtransfer.cancer.gov/printpdf/20 | "见证人签名" = 交付者之外的第二双眼睛，且签名绑在记录版本上 |
| 临床双人核对 | Saskatchewan Health Authority《Double-Check (Independent or Self-Checking)》https://www.saskhealthauthority.ca/system/files/2025-10/SHA-08-010P4-A1-Double-Check-Independent-or-Self-Checking-Guideline.pdf | "独立核对"与"自查"被明确区分——正好是 deed"交付者不能判自己"的医疗版表述 |
| 财务审计 | **ISA 230 (Revised) 第 9–10 段**：审计文档须记录 (b) **谁执行了工作及完成日期**、(c) **谁复核了该工作、复核日期与范围** https://www.ibr-ire.be/docs/default-source/fr/documents/reglementation-et-publications/normes-et-recommandations/isa/isa-english-version/isa-230_en.pdf ；ASA 230 同文 https://www.auasb.gov.au/media/ihuhawd5/asa230_12-23.pdf | 审查是**事件**、有**归属**、有**范围**——deed 的 review 事件三元组 |
| 会计内部控制 | maker-checker / four-eyes（巴林央行规则手册 https://cbben.thomsonreuters.com/sites/default/files/net_file_store/Vol_1_BC_January_2024.pdf ） | "录入者不能批准自己的录入" |
| 学术同行评审 | SAE 审稿利益冲突政策 https://www.sae.org/binaries/content/assets/cm/content/publications/journals/resources/peerreviewpolicy.pdf | "作者不能审自己的稿"；deed 的更严：**交付过这一段的人不能判这一段** |
| 手术安全 | WHO 手术安全核查表 https://iris.who.int/bitstream/handle/10665/44185/9789241598552_jpn.pdf | 清单是**流程内**的门，不是事后审计 |

---

## 5. 小项目与土办法（<300★，API 实测 2026-11-22/23）

| 仓库 / 出处 | ★ | 说的是什么（一手 README/规范） | 与 deed 的差异 |
|---|---|---|---|
| BrightbeamAI/**chap** (pushed 2026-11-21) | 123 | approvals / overrides / handoffs / escalations；MCP + A2A；规范 CC-BY；配套论文 arXiv 2606.09751 | 有 append-only evidence log + review profile，但是**协议/服务**形态（MCP/A2A），不是随仓库提交的本地账本；是否强制"交付者回避"**未验证** |
| 3338902669-ops/**agent-orchestra** | 94 | "Agents can work. They cannot declare success."；禁止 agent "verify its own L2/L3 work"、禁止无证据声明完成；八份契约（Task / Resource / Ownership / Handoff / Verification / Evidence / Approval / Recovery）；CONFORMANCE 41 条、38 ENFORCED | 与 deed 的规则集**高度重叠**；但它自带 benchmark 与"契约"框架，deed 只有 15 种事件 + 纯函数折叠 |
| OpenMOSS/**claude-codex-handoff** | 43 | Claude Code ↔ Codex 的文件式交接 | 只有交接，无判决 |
| grinev/**boardown** | 47 | git-native Markdown 看板 | 看板即真相；没有"判决绑定版本" |
| quentintou/**agent-board** | 34 | kanban + DAG + MCP + audit trail | 有 audit trail，但审计是附属，不是判据来源 |
| yaront1111/**Moe-s-Tavern** | 33 | plan / approve / build / review 四态，状态在 .moe | 有 approve/review 两态，但没有"谁能判"的规则 |
| alxshelepenok/**grove** | 32 (AGPL, Rust) | "The protocol picks the next step"；"every task is mechanically proven"；"absolute reproducibility" | **与 deed 的 nextAction 最像的一个**；它是重型协议运行时（Rust 守护进程），deed 是零依赖 CLI |
| dabit3/**agent-handoff** | 16 | 会话间交接文件格式 | 无判决层 |
| artificemachine/**superharness** | 10 | task lifecycle / handoff / dashboard | 未细读 |
| steveyegge/**beads** | 28931 | git-backed issue DB for agents（依赖图、ready work） | 属背景：说明"给 agent 一个持久工作数据库"已是共识 |
| ustoppble/**overclick** | 120 | 任务看板 | 未细读 |

**土办法（非 GitHub）**

- 日文：Qiita @agentmemories（2026-07-09）《AIエージェントの引き継ぎ台帳をJSONLで作る》https://qiita.com/agentmemories/items/5a5017875f2753da6ade —— HandoffEvent type=start/progress/blocked/handoff/resume/complete，字段 at / task_id / actor / type / objective / status / route_id? / evidence[]? / next_action? / blocker? / rollback?；原文强调"重要なのは evidence と next_action"、"QC承認は別担当に回す"、"開始時点で台帳に1行書けるかを確認してから作業"。**与 deed 的账本几乎同形**，区别是它是"人类的交接手册"，没有 fold/rules，也没有判决绑定摘要。
- 日文：WEBMARKS《AIエージェントのセッション継続》https://agi.webmarks.co.jp/articles/ai-agent-session-continuity-read-order/ —— 写入时机固定为"着手 / 节目 / 人间门 / 完了"四点。
- 中文：evoflow（evovexai）主 agent 案例 https://github.com/evovexai/evoflow/blob/d37c3e32c859556b23a27a59387019bacc42b48e/docs/user/cases/use-main-agent.md —— "岗位≠角色"、"交接审批策略：需要审核 / 无需审核 / 有风险才审"、**"同意派发 ≠ 确认完成"**、"验收：确认完成 / 打回"，值班表 09:00–20:00 每 30 分钟。**这是中文生态里独立收敛到"派发与验收分离"的实证。**
- 中文：justDance-everybody/Taskbot-MVP 文档 —— 飞书机器人 + 多维表格 + GitHub Webhook + LLM：任务创建 → Top-2 匹配 → 一键指派 → 周期过半提醒 → 自动验收。**"飞书多维表格手搭 agent 值班表"这类土办法确实存在**，但它是"人手工维护的表"，没有账本与判据。
- 德文生态：本轮**未取到一手材料**（Vier-Augen-Prinzip 在 MaRisk/BAIT 里的原文未读）。**未验证**。

---

## 6. 反方向：有没有人论证"加流程是错的"

- **Anthropic《Building effective AI agents》**（官方研究页 https://www.anthropic.com/research/building-effective-agents ）：复杂度"only when it demonstrably improves outcomes"；先最简 prompt + 评测，再加结构。→ 对"先建一套议事机制"最直接的冷水。
- **arXiv 2606.08919**：更多升级/兜底可能**降低**安全（倒 U）+ flooding。
- **arXiv 2610.00961**：只审"是否被批准"可被盖章满足 → 仪式化风险。
- **LGTM 气味研究**（Bilkent 仓库 PDF）："reviewer performs the review superficially due to the time constraints"；500 行变更让人犹豫。→ 审查质量受**时间预算**支配，不受"有没有记录"支配。
- **Dan Davies《The Unaccountability Machine》(2024)** 的 **accountability sink**：组织结构吸收责任，最终"没有人能被追责"（二手转述：https://researchers.mq.edu.au/en/publications/emerging-strategies-to-work-with-and-implement-ai/ 、https://id.news.hada.io/topic?id=23389 ）。→ **这是 deed 最该防的失败模式**：一套漂亮的门，把所有判断变成"通过了 gate"。
- Sutton "Bitter Lesson" 的原文链接本轮**未核**（未验证）；不作论据。

---

## 7. 逐条对照：deed 每一步的老家

| deed 的机制 | 最近的先例 | 差在哪 |
|---|---|---|
| 只追加 JSONL + 投影 | 事件溯源（Fowler https://martinfowler.com/eaaDev/EventSourcing.html ）、CHAP evidence log、AAT 草案、日文 JSONL 台帳 | 无本质差异；差异在下两行 |
| 判据 = rules.mjs 纯函数从账本折出 | Datomic/事件溯源的"查询即视图"、2611.23678 的 governance metrics | **"谁能判/谁能签"也被折叠出来**，而不是配置或代码分支——少见 |
| 交付者不能判自己交付的段 | RII 双人检验、maker-checker、ISA 230、同行评审回避、agent-orchestra | 无差异，是成熟惯例 |
| 先出纸（brief + sha256）再落结论 | in-toto subject digest、SCITT signed statement、施工图审查合格书对应那一套图、GitHub 新 push 作废旧 approval | 组合更紧：结论**没回答 briefDigest 就不能落盘** |
| rework 作废旧结论 | GitHub "dismiss stale review"、施工图修改后重审 | **作废是显式事件、旧结论停止计数但留在账本**（fold.mjs:318-323）；且 fail 不能被后面的 pass 静默覆盖（fold.mjs:245-246），少见 |
| 签收按会话 / 判决按段 | 日本確認済証 vs 検査済証、施工图审查 vs 竣工验收、evoflow"同意派发≠确认完成" | 无差异 |
| 下一步只有一处（nextAction） | grove "protocol picks the next step"、Horvitz 混合主动式 | 无差异；deed 的形态更轻 |
| 零依赖 / 账本随仓库 / 面板只读纯函数 | OpenSpec 等"文件即真相"派 | **纯函数渲染 + 同数据同字节**这条在同类里少见（多数面板读文件/读 DB） |
| 证据带 sha256、可 verify 重算 | in-toto、SLSA、AAT 的哈希链 | deed 只做单文件摘要，不做链；**可篡改后重算自证** |

---

## 8. 我可能想错的三件事

**（1）"把审查变成一个事件，审查就不走过场了"——这条最可能错。**
证据链：2610.00961 说只查"是否获批"可被盖章满足；LGTM 研究表明省力来自时间预算；2606.08919 说加门可能降低安全（倒 U）。deed 的 briefDigest 只保证"结论对应哪一版"，**不保证人读过那一版**。真正的补强方向不是再加一道门，而是：把机器能判的（可复算的 sha256、测试结果、改动范围）交给确定性校验器（2611.07483：78.7% vs LLM 59.0%），把人的判断收缩到"风险取舍"这一小块（2611.24932：校准比人头重要）。

**（2）"交付者不能判自己"可能是个次优代理变量。**
文献里真正起作用的是**自偏好**（2404.13076）与**校准**（2611.24932），不是"是不是同一个人"。一个校准良好、能自己复算证据的交付者，可能比一个没有上下文的外部审查者判得更准；而强制外部审查在缺少证据路径时会直接退化成盖章。可检验的替代表述是：**"判的人必须能独立复算被审对象的摘要"**——这比"不能是同一人"更接近机制，也更难被绕过。

**（3）"账本随仓库提交 + 身份自述"是整条链最薄的一环，而我一直在把它当特色。**
2611.07483 证明签名能把不安全提交砍到 9.0%；SCITT/Rekor/AAT 都指向"指纹链 + 外部可验证回执"。deed 现在记录的是"某个自称 by 的人判了"，谁有 push 权限谁就能重写历史且自洽。也就是说：**deed 现在做的是协作纪律，不是防篡改**。要么在 README 里把这条边界写成一句硬话（"本工具不提供身份与防篡改，只提供判据与留痕"），要么承认零依赖与签名链不可兼得、把签名留给下游（例如允许 digest 由外部 sigstore 签）。

---

## 9. 越界发现清单

1. **IETF draft-sharif-agent-audit-trail-00（2026-03-29）** 已把"agent 行为 JSONL + 哈希链 + 必填字段注册表（decision / delegation / escalation / lifecycle）"写成草案，并明确写"no standard exists for HOW autonomous AI agents should log their activities"。**deed 的账本格式不是空白地带，是有人正在画线的地带。**
2. **CHAP（123★ + arXiv 2606.09751）** 是最接近的学术—工程合体：append-only evidence log + review/handoff/signature profiles + "human judgement is the most valuable signal"。**这是最可能被说成"deed 的同类"的一个。**
3. **agent-orchestra（94★）** 的八契约与"禁止自验 / 禁止无证据声明完成"几乎是 deed 三条不变式的英文重写；它的 CONFORMANCE 清单（41 条 38 ENFORCED）可当对照表。
4. **grove（32★）** 的"protocol picks the next step"证明"下一步唯一出处"这个卖点已被别人说过——deed 要证明的不是"有 nextAction"，而是"nextAction 由账本折出且不能被 agent 自我宣称改变"。
5. **2611.23678"只记成功漏掉 43/50"** 支持"账本必须记失败与放弃"，而 deed 的 `core/events.mjs:4-20` 里 `task.defer` / `task.drop` 都必带 `why`（`core/events.mjs:69-73` 校验）——这条经验证据恰好是 deed 已有的能力，值得在 README 里当成论证而不是功能列表。
6. **2611.07483"签名前注入 14.6%→37.5%"** 说明"先出纸再结论"的顺序本身是安全属性：纸在签名后被改，防护归零。deed 的 briefDigest 恰好锁住这一点，这是可写进 README 的一句话论证。
7. **2611.06545** 证明"agent 自写的交接摘要会发明授权"，直接反驳"让 agent 自己写 handoff 就够了"，也说明 deed 把 handoff 落成账本事件而不是摘要是对的。
8. **中国施工图审查**是"判决绑定图纸版本 + 多人签字 + 法定代表人签发 + 公章"的完整非软件实现，比 in-toto 更早、更完整地表达了 review/sign 分离。值得在 README 引一句。
9. **日本確認済証 / 検査済証** 是"开工许可 ≠ 完工签收"的法定两证，比"gate vs sign"更权威的类比。
10. **ISA 230 第 10 段**把"谁复核、复核日期、复核范围"写进审计准则——**复核的范围（extent）** 是 deed 目前缺的字段：记了谁判、判的哪一版，但没记"判了多大范围"。
11. **OTel 的 Audit Logging SIG 提案自 2024-10 起仍 open**，说明可观测性生态没有审计语义——deed 若坚持不做 SaaS/MCP，只能在这个空位上做"本地账本"，而不是"标准"。
12. **《电子签名法》第 13 条三条件** 给了 deed 现成的自我描述边界：满足"改动可发现"，不满足"密钥专有 / 仅本人控制"。写清楚比含糊更有说服力。
13. **accountability sink（Dan Davies）** 是 deed 的结构性风险：门越多、越顺滑，越容易"责任被吸收、无人可追"。对策应当是**让"谁没判"也可见**（超时未判、证据过期），而不只是让"谁判了"可见。
14. **日文 JSONL 台帳（2026-07-09）** 与 **evoflow"同意派发≠确认完成"** 是两处独立收敛：不同语言、不同人群、不同时间，做出了与 deed 相同的区分。说明方向对，也说明"这是新想法"站不住。
15. **2611.24932 的行为画像反转**（过度自信组排到真专家之上）提示：deed 若将来做"审查者排行榜/工分"，会踩同一个坑。**不要用工分当判据。**

---

## 10. 这个类目该叫什么

**主推：agent work ledger**（agent 工作台账）。
理由：它命名**产物**（一本账），不命名好处；两个词都是检索常用词，组合后指向明确；能容纳"事件、归属、证据、判决、下一步"五件东西，与 task board / issue tracker / orchestration 明确区分。

**更准的限定：agent sign-off ledger**。需要强调"判决/签收是一等事件"时用它；它比 approval workflow 具体（后者是 UI 概念），也比 audit trail 窄（后者只记发生过什么，不记"谁能判"）。

**不推荐**：accountability layer、trust infrastructure、governance OS —— 营销词，搜出来全是厂商落地页。

**若非要一个短语覆盖三件**：agent work ledger with sign-off（可搜、不营销，且诚实：账本是主体，签收是附加能力）。

---

## 11. 未验证 / 缺口

- CHAP 的 review profile 是否**强制**"交付者回避"——只读到摘要，**未验证**（需读规范正文）。
- AAT 草案是否已被任何实现采用——**未验证**。
- grove 的"mechanically proven"具体证明什么——**未验证**（未读源码）。
- 德文生态（Vier-Augen-Prinzip / MaRisk / BAIT 原文）本轮**未取到一手**。
- 航海日志（deck log / official logbook）法定格式本轮**未取到一手**（只取到公证日志）。
- 财务"管理声明书"（ISA 580）与审计抽样（ISA 530）本轮**未读原文**。
- Sutton Bitter Lesson 原始链接**未核**。
- 2611.18471 / 2611.25214 / 2611.11045 / 2611.22245 / 2611.12545 仅检索到标题，**未细读**。
- 已核 `core/events.mjs`（见 §12），事件与字段清单不再挂"未验证"。其余章节仍以 README 为准。

---

## 12. 代码核对（2026-11-23，`core/events.mjs` 实读）

- `EVENT_KINDS`（第 4-20 行）正好 15 种：turn / task.add / task.done / task.defer / task.drop / ask.raise / ask.resolve / ask.withdraw / review.brief / review.log / judge.pass / judge.rework / sign / shelve / config.change。
- **失败与放弃是被记录的**：`task.defer`、`task.drop` 必带 `why`（第 69-73 行）。这是 2611.23678"只记成功会漏掉 43/50 个 trial"的直接反例设计。
- **判决被指纹锁住**：`review.brief` 必带 `brief`（路径）与 64 位小写 hex 的 `briefDigest`（第 90-95 行）；`review.log` 必带 `segment` / `by` / `verdict∈{pass,fail}` / `brief` / `briefDigest`（第 96-108 行）。源码注释写得很直白："The brief is outside the ledger, so the only way a verdict can be held to the words the reviewer read is its sha256. A line without one is a conclusion nobody can check."
- **判决不可被后来的 pass 静默覆盖**：`core/fold.mjs:245-246` 规定在案结论为 fail 时，新的 pass 会被拒（"要改判先打回（judge --rework），再重新审"）。比 GitHub 的"新 approve 直接叠加"更严。
- **"作废旧结论"这件事本身没有署名**：`judge.rework` 只必填 `segment` 与 `why`（`core/events.mjs:113-116`），无 `by`；`core/fold.mjs:320` 打回时只写 `voidedAt`、不写 `voidedBy`（而新结论覆盖旧结论时 `voidedBy` 写的是**新结论的编号** `R2`，不是人，见 `core/fold.mjs:247-252`）。结果：**撕掉一张判决纸的动作，比签发一张判决纸的动作少了署名**。这是我能找到的最具体的一处不对称。
- **缺少 `extent`（复核范围）字段**：ISA 230 第 10 段要求记录"复核的范围"，deed 只记了谁判、判的哪版，没记"判了多大范围"。这是与成熟审计制度相比最具体的一个缺口。

## 13. 由上面推出的一个具体动作（不是建议清单，是一条）

`judge.rework` 应该像 `review.log` 一样要求 `by`，或在 `fold.mjs:320` 一并写 `voidedBy`（人，而不是结论编号）。理由只有一条：如果"谁能判"是这套机制的卖点，那么"谁能撕掉判"必须同样可署名——否则作废是一个不提名的武器，恰好落进 2610.00961 说的"只审结果、不审过程"的漏洞。代价很小（一个字段 + 一条校验 + 折叠里一行赋值），不破坏任何不变式。

---

### 附：本次用到的一手材料（按出现顺序）

- https://arxiv.org/abs/2611.25760 ｜ https://arxiv.org/abs/2611.06545 ｜ https://arxiv.org/abs/2611.07483 ｜ https://arxiv.org/abs/2611.23678 ｜ https://arxiv.org/abs/2611.24357 ｜ https://arxiv.org/abs/2611.24932 ｜ https://arxiv.org/abs/2610.00961 ｜ https://arxiv.org/abs/2606.08919 ｜ https://arxiv.org/abs/2610.35835 ｜ https://arxiv.org/abs/2404.13076 ｜ https://arxiv.org/abs/2606.09751
- https://www.w3.org/TR/2013/REC-prov-dm-20130430/ ｜ https://www.w3.org/TR/2025/REC-vc-data-model-2.0-20250515/ ｜ https://www.rfc-editor.org/info/rfc9943/ ｜ https://www.rfc-editor.org/rfc/rfc6962.txt ｜ https://docs.sigstore.dev/logging/overview/ ｜ https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md ｜ https://www.ietf.org/archive/id/draft-sharif-agent-audit-trail-00.txt ｜ https://artificialintelligenceact.eu/article/12/ ｜ https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11/subpart-B/ ｜ https://ico.org.uk/for-organisations/guide-to-eidas/qualified-trust-services/ ｜ https://policy.mofcom.gov.cn/claw/clawContent.shtml?id=66982
- https://www.govinfo.gov/content/pkg/CFR-2024-title14-vol3/pdf/CFR-2024-title14-vol3-sec121-535.pdf ｜ https://www.ilga.gov/ftp/JCAR/AdminCode/014/014001760J09200R.html ｜ https://www.mohurd.gov.cn/tsgb/gzk/art/2022/art_1208230109.html ｜ https://www.pref.kumamoto.jp/soshiki/115/230843.html ｜ https://help.aiacontracts.com/hc/en-us/articles/1500009444782-Summary-G716-2004-Request-for-Information-RFI ｜ https://docs.labii.com/user-guide/work-with-record/signers ｜ https://www.saskhealthauthority.ca/system/files/2025-10/SHA-08-010P4-A1-Double-Check-Independent-or-Self-Checking-Guideline.pdf ｜ https://www.ibr-ire.be/docs/default-source/fr/documents/reglementation-et-publications/normes-et-recommandations/isa/isa-english-version/isa-230_en.pdf ｜ https://www.sae.org/binaries/content/assets/cm/content/publications/journals/resources/peerreviewpolicy.pdf
- https://github.com/BrightbeamAI/chap ｜ https://github.com/3338902669-ops/agent-orchestra ｜ https://github.com/alxshelepenok/grove ｜ https://github.com/OpenMOSS/claude-codex-handoff ｜ https://github.com/grinev/boardown ｜ https://github.com/quentintou/agent-board ｜ https://github.com/yaront1111/Moe-s-Tavern ｜ https://github.com/steveyegge/beads
- https://qiita.com/agentmemories/items/5a5017875f2753da6ade ｜ https://agi.webmarks.co.jp/articles/ai-agent-session-continuity-read-order/ ｜ https://github.com/evovexai/evoflow/blob/d37c3e32c859556b23a27a59387019bacc42b48e/docs/user/cases/use-main-agent.md
- https://www.anthropic.com/research/building-effective-agents ｜ https://martinfowler.com/eaaDev/EventSourcing.html ｜ https://dl.acm.org/doi/10.1145/3290605.3300233 ｜ https://ar5iv.labs.arxiv.org/html/2001.00973 ｜ https://dblp.org/rec/conf/chi/Horvitz99.html
