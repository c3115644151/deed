# 这一期要做成什么
把操作面收成一个清单文件：写清单、deed submit 一次落账；要不要审看规模。

## 段 S02.1
- [x] T21 清单一个文件：deed plan 出草稿、deed submit 整批落账
  标准：清单里 ? 领号并写回清单；勾上 = 交付，sha256 由工作区快照自己算；取消勾选 = 撤回；~~ = 放弃；任何一行不合格整批拒且账本零新增
  交付：node --test test/cli.test.mjs 77/77、test/plan.test.mjs 6/6；npm test 138/138；deed plan 出草稿、deed submit 领号并写回清单（T21..T23 就是这么落的）；坏行整批拒且账本零新增；只加条目的一次 submit 不再刷新基线（新用例 adding an entry does not swallow the changes waiting to be delivered）
- [x] T22 要不要审看规模：文件数、字节数、跨了几个顶层目录
  标准：规模三条进 needsReview（默认 5 个文件、20000 字节、跨三个以上顶层目录要审）；没称过字节的交付不按大改动算
  交付：node --test test/rules.test.mjs 16/16：2 份小文档免审、6 个文件要审、单份 30000 字节要审、跨三个顶层目录要审；test/cli.test.mjs 的 a delivery weighs what it moved 通过
- [x] T23 三条审查观察的治本：名字措辞、免审期的整体审、禁词检查守 AGENTS.md
  标准：seal 不带 --by 的报错说「没有写名字」；一期各段全免审时不需要整期结论；docs 测试同时守 README 与 AGENTS.md 的粘块并扫禁词
  交付：node --test test/docs.test.mjs 4/4（README 粘块、AGENTS.md 尾段、禁词表）；test/rules.test.mjs 的 a period whose segments all sat out review needs no conclusion on the period 通过

<!-- 勾上 = 交付（写 交付：一行）；取消勾选 = 撤回（写 理由：）；? = 新条目；~~ = 放弃（写 理由：）。改完 deed submit -->
