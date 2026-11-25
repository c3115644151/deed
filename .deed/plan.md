# 这一期要做成什么
把操作面收成一个清单文件：写清单、deed submit 一次记账；要不要审看规模。

## 段 S02.1
<!-- 已完成（3 条）：交过的，往下沉 -->
- [x] T21 清单一个文件：deed plan 出草稿、deed submit 整批落账
  标准：清单里 ? 领号并写回清单；勾上 = 交付，sha256 由工作区快照自己算；取消勾选 = 撤回；~~ = 放弃；任何一行不合格整批拒且账本零新增
  交付：node --test test/cli.test.mjs 77/77、test/plan.test.mjs 6/6；npm test 138/138；deed plan 出草稿、deed submit 领号并写回清单（T21..T23 就是这么落的）；坏行整批拒且账本零新增；只加条目的一次 submit 不再刷新基线（新用例 adding an entry does not swallow the changes waiting to be delivered）
- [x] T22 要不要审看规模：文件数、字节数、跨了几个顶层目录
  标准：规模三条进 needsReview（默认 5 个文件、20000 字节、跨三个以上顶层目录要审）；没称过字节的交付不按大改动算
  交付：node --test test/rules.test.mjs 16/16：2 份小文档免审、6 个文件要审、单份 30000 字节要审、跨三个顶层目录要审；test/cli.test.mjs 的 a delivery weighs what it moved 通过
- [x] T23 三条审查观察的治本：名字措辞、免审期的整体审、禁词检查守 AGENTS.md
  标准：seal 不带 --by 的报错说「没有写名字」；一期各段全免审时不需要整期结论；docs 测试同时守 README 与 AGENTS.md 的粘块并扫禁词
  交付：node --test test/docs.test.mjs 4/4（README 粘块、AGENTS.md 尾段、禁词表）；test/rules.test.mjs 的 a period whose segments all sat out review needs no conclusion on the period 通过

## 段 S02.2
<!-- 已完成（11 条）：交过的，往下沉 -->
- [x] T35 材料交出去之后，下一步说「落结论」而不是「另出一份」
  标准：段或整期的在案结论已经旧了、但新材料是改动之后发出且还没人回答时，deed state 与面板给的下一步是「落结论」（带 --verdict pass），不再是「另出一份」；材料旧了才叫另出
  交付：core/rules.mjs 新出 freshBrief / freshWholeBrief：材料发出去之后这一段（或这一期）没再动过、也还没人回答，才算新鲜。原来「结论过期」与「不合格还在案」两个分支只看到手上有材料、没看它是不是改动之后发的；现在两处都先问新鲜度，整期材料那一步同样。面板与 state 同源，不用改。核：node --test test/rules.test.mjs 17/17——新增 a brief handed out after the last change is answered, not replaced，同一场景先断言「重审」、材料发出后断言「落结论」且命令带 --verdict pass，另断言整期材料被回答后不再算新鲜；npm test 148/148 跑在这一份字节上
- [x] T34 doctor 按文件最后写入时刻查「先做后记」
  标准：deed doctor 对每条现行交付钉的文件查最后一次写入时刻，早于那条任务被记下的时刻就列出来（只报事实，不算坏账）；没有 git 的目录跳过不报错；clone 出来的工作副本 mtime 全是检出时刻，安静不报
  交付：整期审退回 T34 的三件事补完：HANDOFF 的现状段改到账本当前状态（两段都判过、整期审不合格在案），材料指针不再写死文件名、改成看 .deed/review 下最新的那一份，这两种指针都不会过期；T34 只留这一条记录，钉的是已提交的字节（b8ccd22），先跑测试再写字、写完没再动文件。这一份字节上 npm test 147/147、node --test test/cli.test.mjs 86/86；下一份整期材料重出后再由审查者判
- [x] T24 一批交付要说明改动属于整批
  标准：同一批里的多条交付记同一个批号；清单说清这一批几条；单条一批不写批号
  交付：批号改成 { at, size }：时刻是这一批落账的同一刻，size 是这一批原本几条（撤回同批一条后清单仍说得出「共 N 条（其中 M 条已撤回）」，不再拿剩下的条数现算）。核：node --test test/cli.test.mjs 86/86，含新用例 taking one delivery back does not shrink the batch it belonged to 与 one submit that delivers several entries says the changes belong to the batch（断言 batch.size === 2）
- [x] T27 批号要记下这一批几条，撤回后数目不变
  标准：submit 落多条交付时事件里带这一批的条数；清单在撤回同批一条后仍说得出原本几条、几条已撤回；单条一批不写同批行
  交付：task.done 的 batch 改记 { at, size }（core/events.mjs 校验 task.done 的 batch 必须是 at + 不少于 2 的 size；core/fold.mjs 把旧字符串批号归一成 { at, size: null }，task.undo 把批号带进 undone）；cli/brief.mjs 用 batchInfo 记账，撤回后仍说「这一批共 N 条（其中 M 条已撤回）」，单条一批不写这行。核：test/cli.test.mjs 86/86，含 plan-batchmark 与 plan-batchundo
- [x] T28 整期结论判了不合格，签收也要挡住
  标准：一期存在未作废的整体审不合格时 signBlockers 挡住签收并给出重出或推翻的命令；state 与面板说法一致
  交付：signBlockers 增一条——一期若有一条未作废的整体审不合格，签收被挡，说明要重出一份通过的或由人推翻（给 judge --overturn 命令）。免审的一期也一样挡。核：新增用例 a standing whole-period failure still blocks the signature 通过
- [x] T29 免审那句提示排到检查之后
  标准：一期还有段没封或缺目的时 review --all 只报缺什么，不打印「各段都免审」；全免审且三项检查都过才打印
  交付：deed review --all 的「各段都免审」提示挪到「目的／未封段／待交付」三项检查之后——先报缺什么，才说需不需要整期结论。核：新增用例 the exempt notice waits until the checks it talks about are through 通过（段没封时 exit 1 报「还有段没封」，且不打印那句）
- [x] T30 tick 的 agent 轮不许抄用户原话
  标准：tick --who agent 时 --said 与最近一条 user 轮的 --said 逐字相同就拒绝并说明该记什么；user 轮不受影响
  交付：tick --who agent 时把 --said 与最近一条 user 轮逐字比，相同就拒并说明该写自己说的话；user 轮不受影响。核：新增用例 an agent turn cannot repeat the user's words as its own 通过（被拒的那轮不落账）
- [x] T32 同一批 submit 不许既新增又交付
  标准：一次 submit 里同一条既 ? 又勾上交时整批拒，说明先落承诺再做；分两批则通过
  交付：submit 见到「新条目（?）与勾上（[x]）同一次」就整批拒，说明先把条目写成任务、做完再勾；整批零写入。核：新增用例 an entry that is new cannot be ticked in the same submit 通过
- [x] T33 清单把已判过的条目画成未勾选
  标准：deed plan 重出的草稿里已封段中判过的条目保持勾上；再 submit 不会给已判过的条目重复落交付
  交付：cli/plan.mjs 的草稿把 done 与 accepted 都画成 [x]，判过的条目不再显示成未勾。核：新增用例 the draft keeps judged entries ticked 通过
- [x] T26 面板：没声明路径的条目不再印成没内容
  标准：submit 建的条目 files 为空但交付记下了路径时，卡片说的是交付记下几个，不再写未声明路径；同批交付有标记
  交付：面板：submit 建的条目 files 为空、但交付记下了路径时，卡片印「没声明路径 · 交付记下 N 个」；同批交付带「同批」标记。核：npm test 的 board 9/9 通过；7317 页面重开看过
- [x] T25 门槛说不用审的一期，出整体审材料前先说明不需要
  标准：deed review --all 在一期各段都免审时先打印一句「不需要整期结论」，仍允许出一份
  交付：deed review --all 在一期各段都免审（needsWhole 为假）时先打印「这一期的各段都免审……不需要整期结论」，仍允许出一份。核：新增用例 a period with nothing to review is told it needs no whole conclusion 通过；npm test 140/140
<!-- 撤回或放弃（1 条）：不做了的，沉到最后 -->
~~ T31 doctor 用提交时刻查承诺晚于工作
  标准：deed doctor 对每条现行交付钉的文件查最后一次提交时刻，早于该任务的承诺时刻就列出来（只报事实，不算坏账）；没有 git 的目录跳过不报错
  理由：提交时刻总在任务被记下之后，拿它比永远看不出「先做后记」；改成按文件最后写入时刻查，另立一条

## 段 S02.3
<!-- 已完成（2 条）：交过的，往下沉 -->
- [x] T37 退回一条交付时，它碰过的路径也跟着退回
  标准：重放里 rework 把一条交付退回未做时，那条交付记下的 changed 路径不再留在任务上（退回之后这一段碰过的路径只由还在的交付算出来）；新账本与旧事件重放两条路都成立；有测试钉住「退回之后同一个免审批次不再被判要审」
  交付：rederive 现在把交付记下的 files 也算碰过：touched = [...(proof.changed ?? []), ...(proof.files ?? []).map(one => one.path)]，手工 --digest 的交付（changed 为空）因此不再让门槛失明。test/fold.test.mjs 三条断言：退回当场 task.changed 为空且 sizes 归零；退回后再交只剩新路径；只带 --digest 的交付照样判要审。test/rules.test.mjs 的免审夹具改成交付钉住自己那条 exempt 路径（原来钉 core/fold.mjs，属于夹具与场景不符）。跑的是这一份字节：node --test test/rules.test.mjs test/fold.test.mjs = 38/38；npm test 150/150（fold 21 · rules 17）。
- [x] T36 HANDOFF 的现状段与下一步跟着账本走
  标准：HANDOFF 第 8 行的段内容与实际条目一致（S02.2 是 T24..T35，已由 reviewer:s2-r7 于 11-23 21:18 判过）；下一步段只写还没发生的事——T34 已交付、材料已发，不得再列为待办；材料指针仍是「看 .deed/review 下最新的那一份」，不写死文件名
  交付：第 8 行的段内容改成在案结论 R10 · reviewer:s2-r11 · 21:55 退回 T36（R9 已被它作废、T37 通过），并写明两条一起重新交付、等新材料的结论；S02.2 那半仍是 T24..T35、r7 21:18 判过。验证行改 150/150（86 条 CLI + 其余 64），跑的是这一份字节：npm test 150/150（fold 21）、docs 4/4。下一步段只写还没发生的事：材料指针仍是「.deed/review 下最新的那一份」。

## 段 S02.4
<!-- 已完成（3 条）：交过的，往下沉 -->
- [x] T40 称不出规模的交付默认按要审
  标准：交付记了路径却没称字节时，门槛判这一段要审而不是按 0 字节放行；有测试钉住这条默认值
  交付：core/rules.mjs：needsReview 增一条——交付自己记下的文件没称过字节就是「说不清多大」，按要审算（只声明过、这次没交付到的路径不算）；sizeOf 另报 unknown。cli/deed.mjs：task done 记 --digest 时当场称每一份（pinSizes → bytes），那几份常常这次没动过、不在工作区差里。docs/DESIGN.md §6/§12.4 与 §12.3 同步。测试：test/rules.test.mjs 旧「没称过不算大」改成「没称过不算小」并断 true，免审夹具的交付带上字节；test/cli.test.mjs 新增「重钉一份这次没动的文件也当场称」。跑的是这一份字节：node --test test/cli.test.mjs test/rules.test.mjs test/fold.test.mjs = 126/126；npm test 152/152。
- [x] T39 HANDOFF 第 8 行把 r11 指出的处数说对
  标准：第 8 行写的处数与账本 R10 的 findings 条数一致（是三处，不是两处），读者照它找不会少一处
  交付：第 8 行改成「`reviewer:s2-r11` 21:55 退回 T36 时指出三处…」，与账本 R10 的三条 findings 逐条对上（第 8 行的在案结论过时、门槛看不见只带 --digest 的交付、调用点数目写成三处）；同句补上 S02.3 已由 reviewer:s2-r12 22:11 放行封段、S02.4 三条等结论。验证行改 152/152（86 条 CLI + 其余 66），跑的是这一份字节：npm test 152/152。
- [x] T38 退一条交付的后路都有断言：撤回与推翻结论后点名重做，两处也会让路径归零
  标准：把 core/fold.mjs 的 task.undo 分支或 judge.rework 分支里的 rederive 删掉，test/fold.test.mjs 立刻红；不改变现有行为
  交付：test/fold.test.mjs 新增一条用例：撤回之后 task.changed/sizes 归零、人点名重做之后同样归零。变异核对：把 core/fold.mjs 的 task.undo 分支里的 rederive 删掉，用例在撤回那一半红；把 judge.rework 分支里的删掉，在重做那一半红；现有行为不变。这条字节上 node --test test/fold.test.mjs test/rules.test.mjs test/cli.test.mjs = 126/126，npm test 152/152。

## 段 S02.5
<!-- 已完成（2 条）：交过的，往下沉 -->
- [x] T41 HANDOFF 里的数与首句跟着这一份字节走
  标准：验证块里的条数与拆分在交付的这份字节上跑出来就是它写的数（CLI 与其余分开写清）；状态段首句与同段后半句不矛盾，说的是账本此刻的样子
  交付：HANDOFF.md 验证块改成 153/153、87 条来自 CLI 端到端、其余 66 条，cli 87/87；状态段首句改成「五段里四段已判过」，四段各自写了谁在哪一刻放行，并补上 S02.4 的四条发现与 S02.5 在做；下一步段重写（先出 S02.5 清单、再 deed review --all、然后停等签收）。跑的是这一份字节：node --test（全量）153/153、node --test test/cli.test.mjs 87/87、node --test test/docs.test.mjs 4/4。
- [x] T42 用 deed seal 封过的段，不再被后来的规模规则追溯判要审
  标准：封存那一刻的决定留在账本上，后来把门槛写细不回头改写它——needsReview 对已封存的免审段返回 false，needsWhole、signBlockers、面板标签三处跟着一致；有测试钉住这条
  交付：core/rules.mjs 的 needsReview 开头先看这一段是不是 segment.seal 封的（sealedBy 有值且 closedAt 非空），是就返回 false——规则只管还开着的段；needsWhole、signBlockers 的未钉检查、reviewState 都从它出，三处一起对齐；docs/DESIGN.md §6 与 §12.4 各写一句为什么。测试：test/rules.test.mjs 新增「a segment sealed before the gate got stricter is not pulled back into review」（两段都用只带 --digest、不称字节的老形状交付封成免审 → needsReview false、reviewState exempt、needsWhole false、签收无债、下一步签收）。跑的是这一份字节：node --test 153/153（rules 18/18）。变异核对：把那行守卫改成 false && …，那条用例红、其余 17 条不动。

## 段 S02.6
<!-- 已完成（1 条）：交过的，往下沉 -->
- [x] T43 整期审的判法说出本意，账本层的边界写清楚
  标准：needsWhole 不靠重算已封存段的规模来决定「这一期要不要整期审」——审过的段算数、deed seal 的段不算；docs/DESIGN.md 那两处话与代码一致，并写明账本层为什么不重查门槛；HANDOFF 的「没做的」列出这两条边界与理由
  交付：core/rules.mjs 的 needsWhole 改成 read(one) || owed(one)（read = 这一段有审查者的 pass，owed = 不是免审且门槛要审），不再拿已封存段的字节重量重算；docs/DESIGN.md §12.4 那段改成「规模规则只管还开着的段」并补一句「要不要整期审只看有没有人看过它」，§6 的规模那条跟着改，§8 新增「账本层不重查门槛」一段（fold 只拒自相矛盾的事件，该审的段封不了由 sealBlockers 挡，拿今天的门槛核历史行会把合法历史判成坏账）；HANDOFF 新增这一轮一节、「没做的」列上这两条边界与其理由、下一步改到 S02.6 与 deed review --all。测试：test/rules.test.mjs 新增「a segment a reviewer read counts for the whole review, whatever its deliveries weigh later」（一段很小被 pass 封住、一段 deed seal 封住 → 前段 needsReview false 而整期审仍要有结论）。跑的是这一份字节：node --test 154/154（rules 19/19）、node --test test/docs.test.mjs 4/4（它在改完 HANDOFF 之后跑的）。变异核对：把 read 那行改成 false && …，rules 立刻 2 条红（17 过 2 败），还原 19/19。

## 段 S02.7
<!-- 已完成（2 条）：交过的，往下沉 -->
- [x] T44 整期审那条用例站在顶层，父用例自己的收尾留在父用例里
  标准：test/rules.test.mjs 里「a segment a reviewer read counts…」是顶层 test；它上面那条 seal 用例在 :293 之后自己收口（signBlockers 与 nextAction 断言都在同一个 test 里）。变异核对：把 read 那行改成 false && …，只有这一条用例红（18 过 1 败），不是把父用例一起带红。
  交付：test/rules.test.mjs 里那条 seal 用例在 :293-295 自己收口（signBlockers 与 nextAction 断言都在同一个 test 里），「a segment a reviewer read counts…」提到顶层、夹具自己建（:297-315）；原来收尾断言被挤在新用例之后，一次变异会把两条用例一起带红。跑的是这一份字节：node --test 154/154、node --test test/rules.test.mjs 19/19。变异核对（TEMP 副本把 core/rules.mjs 的 read 改成 false && …）：18 过 1 败，红的只有新用例，父用例不再跟着红。
- [x] T45 文档只说 deed seal 封过的段不再重算规模，被 pass 封的段照样重算
  标准：docs/DESIGN.md 的 §6 规模那条与 §12.4 边界段都改写成「`segment.seal` 封过的段不再重算规模」，并说清被审查者 pass 封的段照样重算、结局由结论决定（reviewState / needsWhole 按「有没有人看过」短路）。
  交付：docs/DESIGN.md §6 规模那条改成「`segment.seal` 封过的段不再重算规模」，并说清被审查者 pass 封的段照常重算、结局由结论决定（reviewState 认有效的 pass，needsWhole 认有没有人看过）；§12.4 的边界段同改，另加一段说「needsReview 的返回值不等于结局，要读结局读 reviewState 与 signBlockers」。跑的是这一份字节：node --test 154/154、node --test test/docs.test.mjs 4/4。

## 段 S02.8
<!-- 已完成（2 条）：交过的，往下沉 -->
- [x] T46 seal 那道守卫有称过字节的夹具，不靠「没称字节」那条路顺带被覆盖
  标准：test/rules.test.mjs 里 seal 封段的用例含一段交付称过 92160 字节、被 `segment.seal` 封住，断言 needsReview 为 false；变异：删掉 core/rules.mjs 的 sealedBy/closedAt 守卫，这一条必红。
  交付：test/rules.test.mjs 的 seal 用例里，第一条交付改成 changed=[docs/a.md] + bytes {docs/a.md: 92160}（第二条 100 字节），用例注释写明「没有那道守卫它就该被审」，所以这条守的是守卫本身而不是「没称字节一律要审」。跑的是这一份字节：node --test 154/154、node --test test/rules.test.mjs 19/19。变异核对（TEMP 副本删掉 core/rules.mjs 的 `if (segment?.sealedBy && segment.closedAt !== null) return false;`）：18 过 1 败，红的正是这条。
- [x] T47 文档写清那道守卫的两个条件
  标准：docs/DESIGN.md §12.4 那句「segment.seal 封过的段返回 false」改成同时说明 sealedBy 与 closedAt 两个条件都在才豁免，并说明手改账本造出半个封存不在守卫范围（属「不许做」）。
  交付：docs/DESIGN.md §12.4 改成「判的是 sealedBy 与 closedAt 两个都在（账本上真写下过一次封存），不是一句 why」，并说明手改账本造出半个封存不在守卫里、属于「不许做」而不是「挡得住」。跑的是这一份字节：node --test 154/154、node --test test/docs.test.mjs 4/4。

## 段 S02.9
<!-- 已完成（3 条）：交过的，往下沉 -->
- [x] T50 seal 用例的门槛与内核默认值解耦
  标准：test/rules.test.mjs 的 seal 用例用自己声明的 review.size（bytes 1000）跑，92160 靠这条声明判「大」，不再依赖默认的 20000；把这条声明去掉后用例仍然红得起来（守卫删掉时），改大内核默认值不会让它无声失效。
  交付：seal 用例改用自己声明的门槛 `const tight = { ...config, review: { ...config.review, size: { bytes: 1000 } } }`，92160 靠这条声明判「大」，不再依赖内核默认的 20000；断言把 config 换成 tight。跑的是这一份字节：node --test 155/155、node --test test/rules.test.mjs 20/20。这条用例现在守两件事（92160 + tight 时只有封存守卫能为它豁免；以及 closedAt 缺失不算封过），所以变异时可能因为任一半而红：把 92160 改回 100 并删掉守卫，它仍然 19 过 1 败，红的是 closedAt 那半。
- [x] T48 守卫的两半各有测试看着：pass 封的段照样重算，seal 少了 closedAt 就不算封过
  标准：test/rules.test.mjs 里有 pass 封段 + 92160 字节断言 needsReview 为 true 的用例；seal 用例断言 sealedBy 在、closedAt 缺时不算封过。变异核对：守卫只留 closedAt → 红的；只留 sealedBy → 红的；整条删掉 → 红的。
  交付：test/rules.test.mjs 新增「a segment a reviewer passed is still weighed, so the exemption is only for a seal」（pass 封段 + 92160 字节 → needsReview true、reviewState 仍是 pass）；seal 用例补断言「{ ...first, closedAt: undefined } 不算封过」。跑的是这一份字节：node --test 155/155、node --test test/rules.test.mjs 20/20。变异核对（TEMP 副本）：守卫只留 closedAt → 19 过 1 败（红的是新用例）；只留 sealedBy → 19 过 1 败（红的是 seal 用例）；整条删掉 → 19 过 1 败。三处各有用例看着。
- [x] T49 守卫读的是真值，文档与它逐字一致
  标准：core/rules.mjs 的守卫写成 sealedBy 与 closedAt 都是真值（不再是 closedAt !== null）；docs/DESIGN.md §12.4 那句话写成「两个都是真值……不是这个字段存在就算」，并说明半个封存照常按门槛重算。
  交付：core/rules.mjs 的守卫改成 `if (segment?.sealedBy && segment.closedAt) return false;`（原来 `closedAt !== null` 把 undefined 也算在，半个封存会被豁免）；docs/DESIGN.md §12.4 那句写成「判的是 sealedBy 与 closedAt 两个都是真值……不是这个字段存在就算」，并说明半个封存照常按门槛重算。跑的是这一份字节：node --test 155/155、node --test test/docs.test.mjs 4/4、node --test test/rules.test.mjs 20/20。

## 段 S02.10
<!-- 已完成（3 条）：交过的，往下沉 -->
- [x] T53 seal 用例显式断言两个字段都在
  标准：test/rules.test.mjs 的 seal 用例里有 assert.equal(first.sealedBy, "agent") 与 assert.notEqual(first.closedAt, null)，不再是只靠豁免断言转述。
  交付：test/rules.test.mjs 的 seal 用例补上显式断言：assert.equal(first.sealedBy, "agent") 与 assert.notEqual(first.closedAt, null)，不再只靠 needsReview 的豁免断言转述；旁边那句注释也从「这种半个封存只有手改账本造得出来」改成说清真来路（整期审的 fail 分支留着 sealedBy、把 closedAt 清成 null）。跑的是这一份字节：node --test 157/157、node --test test/rules.test.mjs 21/21。变异核对：守卫改成只看 sealedBy → 2 条红（seal 用例外加新用例），只看 closedAt → 1 条红，整条删 → 1 条红。
- [x] T51 文档说出半封存的真实来路，并有用例钉住它
  标准：docs/DESIGN.md §12.4 不再说「这种形状只有手改账本能造出来」，改成 real 路径（整期审 fail 退回 deed seal 封过的段里的一条，core/fold.mjs 的 fail 分支把 closedAt 清成 null、sealedBy 留着）确实会造出它；test/rules.test.mjs 有一条用例按这条路径折出来，断言 needsReview 为 true。变异：把守卫改成只看 sealedBy，该用例必红。
  交付：docs/DESIGN.md §12.4 删掉「这种形状只有手改账本能造出来」，改成真来路：整期审不合格、把 deed seal 封过的段里的一条点回来时，core/fold.mjs 的 fail 分支留着 sealedBy、把 closedAt 清成 null；test/rules.test.mjs 新增「a whole-period rework reopens a sealed segment, and that half-seal is weighed again」按这条路径折出来（T1 在 core/a.mjs 上交付、段被 segment.seal 封、再落一条 scope=session 的 fail 点名 T1），断言 sealedBy 还在、closedAt 为 null、needsReview 为 true。跑的是这一份字节：node --test 157/157、node --test test/rules.test.mjs 21/21。变异核对：把守卫改成只看 sealedBy → 2 条红（含这条新用例）；只看 closedAt → 1 条红；整条删 → 1 条红。
- [x] T52 submit 不替人写一条没有内容可指的交付
  标准：清单勾上但这一批既没改动也没有可指的文件时，deed submit exit 1 并说清怎么办（先真的动过，或 deed task done --digest 手工指）；账本一条不落。测试：这种形状 submit 被拒且 kinds 不变。
  交付：cli/deed.mjs 的 submit 在落 task.done 前检查 pins：这一批既没量到改动、也没有文件可指时 exit 1，报「先真的动过再勾，或者用 deed task done --evidence \"…\" --digest <文件> 手工指那份内容」，一个字都不落。test/cli.test.mjs 新增「a submit with nothing to point at refuses to write the delivery」（先落一条新条目，再勾上但不改任何文件 → submit exit 1、事件条数不变）。跑的是这一份字节：node --test 157/157、node --test test/cli.test.mjs 88/88。

## 段 S02.11
<!-- 已完成（4 条）：交过的，往下沉 -->
- [x] T57 撤回记下被撤那条记了哪份字节
  标准：task.undo 落到账本的那条带上 undoes（被撤那条的 files 或 digest/path），撤回行在审查清单里显示「它当时记下的是 <路径> <sha 前 12 位>」；没记下内容时显示「它当时没有记下任何内容」。测试断言账本里 undoes 的 path 与清单里的那句话。
  交付：reviewer:s2-r21 判未达成，理由是主路线而不是动词路线：清单里把勾去掉 + 理由，submit 落的 task.undo 原始行没有 undoes。现在两条入口共用一个 undoesOf（cli/deed.mjs），落账那一行自己带着被撤的 path 与 sha256；core/events.mjs 的形状校验与 core/fold.mjs 的优先读各有用例（原先两处变异全绿）。node --test 137/137（cli 67、fold 23）；变异三处：删 submit 的 undoes 字段 / 关掉形状校验 / 去掉优先读，各自红一条且原样还原。
- [x] T56 空交付在 verify 里看得见，即使后来被覆盖或撤回
  标准：deed verify 报出每一条指不到任何内容的交付（files 与 changed 都空）与每一条没记下被撤内容的撤回，即使它已不是现行交付、或已被重交盖住；文案说清「后来重交过，不挡放行」，不改变退出码。test/cli.test.mjs 有两条来路各一条断言。
  交付：node --test 134/134；变异：bareHistory 里撤回那条来路清空，bare-history 用例红一条。实测：verify exit 0 并打出「空交付 · T1 · … 那时没记下文件 … 不挡放行」与「空交付 · T2 · … 撤回时没记下内容 …」。
- [x] T55 只删不钉的交付不被 submit 误拒
  标准：工作区差里有删除、没有可钉的现存文件时，deed submit 照常落交付（files 为空、changed 记下那条路径），不再报「没有量到任何改动」；确实什么都没动时仍然拒。测试：只删一份文件的场景 submit exit 0 且 changed 里有它；空场景仍被拒且零写入。
  交付：node --test 134/134；变异：submit 的拒绝条件退回只看 pins，删除用例红一条（报「没有量到任何改动」）。实测：只删 gone.md 的那一批 submit exit 0，事件里 files 为空、changed 有 gone.md。
- [x] T54 面板跟着命令自己起，不占终端，30 分钟没人连就退
  标准：任意一条 deed 命令执行前探测面板，不在就用后台进程拉起并把 URL 打印在那一行；下一条命令不再重复起；30 分钟没有请求自己退出；DEED_NO_PANEL=1 时一条都不起；deed panel 看状态、--stop 立即停；它不写账本。测试要真起一次、再确认第二次不起，并把这两种行为各用一条用例管住（去掉自动起那几行要红）。
  交付：node --test 134/134（这一份字节）；变异：关掉 dispatcher 里的 ensurePanel 那一行，panel 用例红一条。实测：init 后第一条 tick 打印「面板 · http://127.0.0.1:2770」，第二条 state 不再打印，deed panel 报出端口与 pid，--stop 停掉后 state 又起 2990。

## 段 S02.12
<!-- 已完成（3 条）：交过的，往下沉 -->
- [x] T58 27 条被覆盖掉的用例回到文件里，跑得通
  标准：test/cli.test.mjs 里 8b3e6dc 有过的 27 条用例都在，逐条通过；用例数从 65 回到 94 以上。
  交付：从 8b3e6dc 取出 test/cli.test.mjs 的 27 块原样贴回，node --test test/cli.test.mjs 94/94（65 → 94），再补两条删除用例 → 96/96；跑的是这一份字节：node --test 166/166。
- [x] T59 删掉的文件不算小改动，只删东西的交付也不再欠「记下一个文件」
  标准：交付那一刻不给删掉的路径记 0 字节（bytes 里没有它），门槛对动过却称不出的路径判要审；只删东西的交付在签收清单上不欠「记下文件」。task done 与 submit 两条入口都有用例，删掉守卫就红。
  交付：cli/deed.mjs 两条交付入口（task done 与 submit）都不再给删掉的路径记 0 字节；core/rules.mjs 的 needsReview 增一条「动过却称不出的路径 → 要审」；unpinned 改成看现行交付，只删东西的交付不再算悬空（签收差里不再出现「记下一个文件」）。跑的是这一份字节：node --test 166/166（test/cli.test.mjs 96/96）。变异五处各自红并原样还原：done 记 0 / submit 记 0 / 守卫拿掉 / unpinned 退回 digest+path / pointsAtNothing 忽略 changed。
- [x] T60 「什么也没指着」只有一处定义，audit 与规则共用
  标准：core/rules.mjs 导出 pointsAtNothing，cli/audit.mjs 不再自带一份；删掉一个文件算「指着它动过的那条路径」，不算空交付。改动被用例管住（把它改回只看 files/digest 要红）。
  交付：core/rules.mjs 导出 pointsAtNothing（files 空、且没有 digest+path、且 changed 空），unpinned 用它判现行交付；cli/audit.mjs 删掉自带的那份、改为 import。跑的是这一份字节：node --test 166/166；变异：把 pointsAtNothing 的 changed 那半去掉，删除用例红一条（还原后 96/96）。

## 段 S02.13
<!-- 已完成（2 条）：交过的，往下沉 -->
- [x] T61 注释与设计不再跟代码说反话
  标准：core/rules.mjs 里那条说「称不出的按 0 字节，假装它大就会把所有老交付拉去审」的注释改成讲真话（0 只用于求和，说不清多大的由守卫判要审）；docs/DESIGN.md 里空交付那句把撤回那条来路归还给 bareHistory。
  交付：core/rules.mjs 的 task_size 上面那条注释改成讲真话（求和时说不清的按 0，放不放行由 needsReview 的守卫说）；docs/DESIGN.md 里空交付那句把「撤回时没记下被撤的内容」归还给 cli/audit.mjs 的 bareHistory。跑的是这一份字节：node --test 167/167。
- [x] T62 pointsAtNothing 的语义有一条直接用例
  标准：test/rules.test.mjs 里有用例直接断言 pointsAtNothing 对五种形状的回答（什么都没指、老形状、只删了一条路径、钉了内容、钉了一组内容）；把那半守卫改回只看 files/digest 会红。
  交付：test/rules.test.mjs 新增一条用例，直接断言 pointsAtNothing 对五种形状的回答（{}、files/changed 都空、只有 changed、有 digest+path、有一组 files），把那半守卫改回只看 files/digest 时它变红（跑过：rules 22 条里 1 条红，还原后 22/22）。跑的是这一份字节：node --test 167/167。

## 段 S02.14
<!-- 已完成（1 条）：交过的，往下沉 -->
- [x] T63 空交付的形状在文档里写全，空输入也有回答
  标准：docs/DESIGN.md 的空交付那句写清「钉了内容就不算空」；pointsAtNothing(null) 返回 true 且有用例断言；改回去要红。
  交付：docs/DESIGN.md 的空交付那句补上「钉了内容就不算空」（哪怕那条路径后来没了）；pointsAtNothing 收下空输入（还没交付时也算什么都没指），test/rules.test.mjs 加一条断言；去掉空输入那一半时 rules 22 条红 1 条（还原后 22/22）。跑的是这一份字节：node --test 167/167。

## 段 S02.15
<!-- 已完成（1 条）：交过的，往下沉 -->
- [x] T64 HANDOFF 的现状段跟上账本，r26 的两条观察记在「没做的」里
  标准：HANDOFF 现状段说的是账本此刻的样子（14 段已判过、等整期审）；「没做的」列出那两处（三处判空的调用点没有用例、半个指纹的字面口径）。
  交付：HANDOFF 现状段改成账本此刻（14 段全判过、整期审已过期待重出），「没做的」加两条（三处判空的调用点没有用例、半个指纹的字面口径），下一步改成先整期审再签收。只动 HANDOFF.md，跑的是这一份字节：node --test 167/167。

## 段 S02.16
<!-- 已完成（1 条）：交过的，往下沉 -->
- [x] T65 HANDOFF 里那句用回了通行词
  标准：docs 的禁词检查 4/4 通过，全量测试不再有红；HANDOFF 那句说的是同一件事。
  交付：HANDOFF「没做的」两处改用通行词（「没有用例看着」「字面上却算记下了内容」），node --test test/docs.test.mjs 4/4；全量 node --test 167/167。

## 段 S02.17
<!-- 已完成（1 条）：交过的，往下沉 -->
- [x] T66 整体审以段为单位：材料列各段的结论，打回点名段
  标准：整期材料只列每段的结论（谁、何时、判定、发现、退回的段），不重列段里的条目；整体审的 --rework 只认段号，被点名的段整段重开，段里的条目保持交付；DESIGN §12.6 与 HELP 说同一件事；node --test 全绿
  交付：整期材料改成每段一行（谁判的、什么时候、判定、几条发现、退回的段）+ 各段发现 + 延后/放弃/待裁，段里的条目不重列；整体审的 --rework 只认段号，被点名的段整段重开、旧结论留史作废、条目保持交付，点条目在 core/fold.mjs 就被拒；这条规则落在事件含义第 9 版，旧行照旧读；DESIGN §12.6 与 §8、HELP 两行、HANDOFF 同口径。跑的是这一份字节：node --test 169/169（96 CLI），docs 4/4；变异四处各自红并还原。

## 段 S02.18
<!-- 已完成（14 条）：交过的，往下沉 -->
- [x] T95 清单上能写一行 搬：，没做的条目搬到下一段
  标准：这一段送审之后不再收新活；十三条没做的条目一次搬进 S02.19，一批搬运只开一段；交付过的条目写 搬： 被拒；test/fold.test.mjs 与 test/cli.test.mjs 各有一条删掉它就红的用例
  交付：预备段只有一个：core/fold.mjs 的 livePrep 让搬第二批仍落在同一个预备段（不再排除条目自己那一段），settle 把搬出来却没接住活的空段从重放里去掉，segmentOf 在等结论时也取同一个预备段；真账本重放从 20 段变 19 段、S02.20 消失、T96..T99 回到 S02.19（17 条未做）；node --test 191/191（test/fold.test.mjs 28/28）；变异：把搬运改回每次都开新段 → test/fold.test.mjs 新用例红
- [x] T86 T86 交接文件与账本一致
  标准：HANDOFF 的条目数、测试条数、在案结论、没做的清单（含删旧命令）与这一份字节一致；docs 的禁词检查通过
  交付：交接文件与这一份字节对齐：测试条数 190/190 与单文件 107/107、在案结论（reviewer:s2-r10 退回 T77/T85，两条已重交）、层级口径（S02.18 就是那一段，这份审查即整体审，不另起整期审）、以及不再在文里抄会变的清单序号。改完本文件之后 node --test → 190/190、test/docs.test.mjs → 5/5。
- [x] T85 T85 免审段在整期清单里印出自己为什么免审
  标准：整期与段清单里免审段那行印出账本里写下的理由（sealedWhy）；reason 为空时不印空括号；有用例
  交付：空理由不印括号，而且用例真看着它：上一份交付里的变异说法在这些字节上不成立——把 cli/brief.mjs 的守卫改成无条件拼括号，输出是「（undefined）」，旧断言只拦「（）」所以照样绿。现在断言同时拦「（）」与「undefined」，同一变异 → tests 1 / pass 0 / fail 1；还原后 pass 1。这一份字节上 node --test → tests 190 / pass 190 / fail 0。
- [x] T77 声明的端口长期被占时，退回的那一格算得出来，重启后地址不变
  标准：声明端口被占时退到它 +1、+2…的第一格空号；停了再起仍落同一格；号让出来之后搬回声明号；三条都有用例。
  交付：面板的落点算得出来、也守得住：board/serve.mjs 撞上 EADDRINUSE 就挨着往后试（+1、+2…最多九格），不再抽一个系统号；cli/panel.mjs 用 listen 探号（TIME_WAIT 里 connect 不上去但占不住），声明号空不出来就守住这个工作区上一次在听的那一格。跑的是这一份字节：node --test → tests 190 / pass 190 / fail 0；test/cli.test.mjs 107/107。变异：把 serve 的挨格走查删掉、跑同一条用例 → tests 1 / pass 0 / fail 1；还原。用例的起点号每跑一次现挑一格，不再写死 7433。
- [x] T78 放弃也算结清：被点名的条目改主意不做了，pass 落得下来，并且落的时候点名说它被放弃、理由是什么
  标准：旧账本里在案 fail 点名的条目若被 drop，pass 能落；落时 stdout 印出该条目与原因；panel 段头对已封段印「开了 N 分钟」、对开着的段不印；node --test 全绿
  交付：重钉：board/render.mjs 在被整期审退回之后没有再改，这条钉子把段重开时失去覆盖的字节重新盖上。这一份字节上 node --test 188/188，其中 board/board.test.mjs 13/13 里有「段开了多久只在封了的段印」的断言，test/fold.test.mjs 26/26 里有「被点名但已放弃的条目算结清」的用例
- [x] T67 命令面一动词一个文件，开关只留一张表：拼错的开关被拒
  标准：cli/verbs/ 里每个动词一个文件；cli/spec.mjs 是唯一那张表，解析与 --help 都从它出；不认的开关 exit 1 并猜最接近的一个；全量测试全绿
  交付：重钉：cli/spec.mjs 自上一轮之后没有再改，这条钉子把被整期审退回时失去覆盖的字节重新盖上。当场能复核的三句：deed task --digset a.md → exit 1，stderr「deed: deed task 不认 --digset 这个开关：是不是 --digest？」；deed state --digset → exit 1「deed: deed state 不认 --digset 这个开关；deed state 不收开关」；deed verify --nope → exit 1「deed: deed verify 不认 --nope 这个开关；deed verify 不收开关」
- [x] T84 T84 放弃的结清看得见也留得下
  标准：pass 落下来时把放弃的条目与理由记进 review.log（gaveUp），不再只在当场 stdout；段清单里 dropped 条目印出理由；下一步在「被点名的都放弃了」时指向审查者的 pass 而不是 judge --overturn；有用例断言这三处
  交付：落 pass 时带着理由进账本（review.log 的 gaveUp）；段清单里 dropped 印 状态：dropped · 理由：…；fail 之后被点名的都放弃时，state 给「它们改主意不做了」与 deed review --segment … --by（不再指 judge --overturn）。node --test test/cli.test.mjs → 104/104（跑的是这一份字节）
- [x] T69 删掉迁移壳、按名字落账、把自造词换掉
  标准：judge 只剩 --overturn，--pass/--rework 不认；ask resolve/withdraw 走 signer；仓库与文档里不再有「材料」这个绰号（「过程材料」除外）
  交付：重新记下 cli/brief.mjs 这一刻的字节：盖住这条路径的那枚交付随 T73 一起被放弃了（T73 被 T76 换掉），账本里它一度没有现行交付。跑的是这一份字节：node --test test/docs.test.mjs → tests 5 / pass 5 / fail 0。
- [x] T76 讨论屏回到轮次为主轴，题在右边攒线索
  标准：轮次平铺在主轴（一条不折、不过滤）；开着的题在右边，把窗口里用户说的话攒在自己名下；裁过的题收成一行；这条屏由用例管住。
  交付：讨论屏回到轮次为主轴：五条轮次平铺在主轴上（一条不折），开着的题在右栏、把窗口里用户说的话攒在自己名下（用例断言「攒到 1 句」），裁过的题收成一行。node --test board/board.test.mjs → tests 13 / pass 13 / fail 0。
- [x] T75 state / verify / doctor 也过开关表：拼错的开关一样 exit 1
  标准：这三个动词带任何不认的开关都 exit 1 并猜最接近的一个（与其余动词同一句文案）；有用例覆盖
  交付：三个只读动词也过开关表：state/verify/doctor 带 --digset 各 exit 1，文案「deed: deed state 不认 --digset 这个开关；deed state 不收开关」。跑的是这一份字节：node --test test/cli.test.mjs → tests 102 / pass 102 / fail 0。
- [x] T74 结论块：ask resolve 的裁定里认「边界：」「弃：」两行，落成账本原来就有的那句话，不进清单也不进任何门
  标准：ask resolve 接受裁定文本里的「边界：…」「弃：…」行并当场报记下几条；空内容的行 exit 1 并说清；这些行从账本算出来（不新增事件、不加字段），state 与验收屏、整期审清单都列得出来；rules 与 board 与 cli 各有用例
  交付：结论块落地：core/rules.mjs 的 edges(session) 从已裁的题里逐行认「边界：」「弃：」（半角全角冒号都认）；ask resolve 当场报记下几条；state 在签收差之前列这两行；验收屏左列加「定过的边界与不做」。跑的是这一份字节：node --test → tests 182 / pass 182 / fail 0；test/rules.test.mjs → 25/25；test/cli.test.mjs → 102/102；board/board.test.mjs → 13/13。
- [x] T71 一段的成本看得见：几条任务、几份清单、几次重交、开了多久
  标准：数从账本算（不读时钟，封段时刻减开段时刻）；state 的段行与面板的段头都显示；不参与任何门
  交付：core/rules.mjs 的 costOf 给出 {tasks, briefs, undos, minutes}，minutes 是封段时刻减开段时刻（读账本不读时钟，只回答为什么慢，不参与任何门）；test/rules.test.mjs 断言 {tasks:2,briefs:2,undos:1,minutes:8}；这一份字节上 deed state 在 S02.18 段行下印「花了 · 重交 6 次」（0 份清单不印）；跑 test/rules.test.mjs+test/cli.test.mjs+board/board.test.mjs+test/docs.test.mjs 138/138。
- [x] T68 事件含义变成一张表，写盘时带 v：没带 v 的旧行按第 1 版读
  标准：MEANING 与 meaningOf 在 core/events.mjs；写盘方显式带 v；doctor 逐行检查仍按每行自己的版本；有用例钉住旧行按旧标准读
  交付：node --test 175/175；这一份字节上重跑 test/version.test.mjs 5/5（旧行按它当年那版读，含义超前时说「升级 deed」）；写盘时版本号只有一处给：cli/session.mjs:104 与 :140 的 validateEvent({... , v: EVENT_VERSION })。
- [x] T72 出清单时说清这是这一段的第几份，第 3 份起提醒先看前一份哪里不够
  标准：deed review 出清单时打印序号；第 3 份起多一句提醒；不拦、不要求解释
  交付：node --test 175/175；演示账本上连出三份清单：第一份印「S01.1 的第 1 份」，第二份「的第 2 份」且没有提醒，第三份「的第 3 份」并多一句「先看上一份的审查者点了哪几条」；整期同理印「这一期的第 N 份」；只打印，不拦。
<!-- 撤回或放弃（2 条）：不做了的，沉到最后 -->
~~ T73 讨论屏按题分组：一条题带着它那段时间的轮次、状态与结论下屏
  标准：讨论屏按题分组渲染，题头写状态与轮数，组里是它那段时间的轮次，组尾是结论；重叠的轮次只出现一次；裁定过、撤过的题仍在屏上；成不了题的轮次单独一段；board 测试有用例断言这五件事
  交付：node --test (DEED_NO_PANEL=1) → tests 178 / pass 178 / fail 0，exit 0；node --test board/board.test.mjs → tests 12 / pass 12 / fail 0；新用例把一份账本渲成 HTML，断言「裁定过的题仍在屏上」「结论跟着题留着」「还开着的题标成等你定」「题头写 2 轮」「重叠的一轮只出现一次」「还没成题 · 1 轮」，删掉 shown 去重那一行该用例即红。
  理由：被 T76 换掉：讨论屏不再按题分组，轮次回到主轴，题在右栏攒线索
~~ T70 面板守住工作区写的端口，代码换过就自己换进程，不必有人记得重启
  标准：端口取自门槛（默认 7317）；被占时退回系统给的号并说清；记号里带面板代码的指纹，对不上就换进程；地址在重启前后一致
  交付：panel 端口与回落这条线在现行字节上重交一次：board/render.mjs 这一轮改过（讨论屏）。回落与搬回的行为在 cli/panel.mjs:63-71 与 cli/deed.mjs:59，用例在 test/cli.test.mjs 的「a panel says when the declared port was taken, and goes back to it when the port is free」。
  理由：被 T77 换掉：退回的号不再抽系统给的，改成声明号 +1 起的第一格空号，重启后也落在同一格

## 段 S02.19
<!-- 已完成（9 条）：交过的，往下沉 -->
- [x] T105 数由工具采：交付前跑一遍，把 tests/pass/fail 写进账本，我抄不了旧数字
  标准：deed submit --run "命令" 在落账前真跑一遍，抓 tests/pass/fail 与退出码写进那条交付（evidence.run）；清单与面板上的数从账本读，不从我的文本读；证据文本里出现 N/N 而与采到的数不一致时整批拒；有用例（先交出 3/3、再把测试加成 4 条 → 记录里的 3/3 被拒）
  交付：跑：node --test 207/207 全过（其中 cli 117 条，含 the numbers a run reports 那条）；这一轮的字节上 --run 采到的 tests/pass/fail 照旧核，记录里的数与之不符整批拒；task done 不吃 --run，只走 task done 的记录仍标只是说法
- [x] T106 说法要能跑出来：交付记录里的现象必须配一条命令与它的期望
  标准：交付记录里写「某操作之后会怎样」时必须带一行「命令 + 期望」，落账时真跑一遍，输出不符就整批拒；不带期望的说法在清单上只算「说法」，不算可核事实；有用例（写一条不成立的期望 → exit 1 并指出是哪一条；成立的期望 → 落账且记录里留下命令与输出）
  交付：跑：node --test 207/207 全过（其中 cli 117 条，含把要看到的话写成一行、记账前真跑那条）；没配命令的交付在清单上仍标只是说法
- [x] T107 落账那一刻自查：刚落的钉当场就旧、或数当场对不上，就地报出来
  标准：交付时对每个路径取两次 sha（量差前与落账后），不一致就拒；落账后立刻跑一遍 verify 的核对，若刚落的钉当场过期或空交付，当场打印并 exit 1，不等审查者；有用例（落账前手改文件 → 被拒；正常交付 → exit 0 且不报）
  交付：cli/verbs/task.mjs:49-95 两处：量差之后、记账之前 requireUnchanged 真拒并印「记账之前再核一遍 · N 条没有变」；记账之后 auditDelivered 核刚落的那一条，空交付印「空交付 · T1 · 谁也没指着」、字节变了印「字节变了 · T1 · 路径 · 记下 …，记账这一刻是 …」，两者都 exit 1；核过印「记账之后核对 · 1 条都对得上当时那份内容」
- [x] T109 面板的指纹盖住它加载过的全部模块：改了 core/ 也要换进程
  标准：buildNow 走 board/、core/、lib/ 三个目录里的每一份 .mjs（不列名单，新加的模块自动进去）；改 core/fold.mjs 之后下一条命令会把旧面板换掉；有用例断言 core/fold.mjs 在名单里，且指纹不等于只盖面板自己那三份的值
  交付：node --test 194/194（跑在交付的这份字节上，DEED_NO_PANEL=1）；buildNow 现在盖住 board/、core/、lib/ 三个目录共 13 份 .mjs，实录：改了 core/fold.mjs 之后账本重放是 19 段，而旧面板进程（build 指向前一份）仍在按老 fold 渲染出第二十段，7317 与 7318 两个端口的页面都还印着 S02.20；换成新进程之后页面只剩 S02.1…S02.19 十九个段头，S02.20 只还在两条文字里（一轮的 said 与 T95 的交付记录）；变异核对：把 TREES 缩回 ["board"]，test/cli.test.mjs 那条用例红（107 条过 1 条败）
- [x] T110 清单里写着哪一节，不等于新条目落进那一段
  标准：一段在等结论时草稿末尾多印一节「下一段」，写在那里的 ? 落进下一段；submit 领号那一行印出它落进哪个段；这两种印法各有用例，把 stub 那半删掉就红
  交付：跑：node --test 207/207（跑在交付的这份字节上，DEED_NO_PANEL=1，含 test/plan.test.mjs 的三种「下一段」与 test/cli.test.mjs 里断言落点那条）；deed submit 对 task.add 打印的落点取自落账后的那一段（cli/verbs/submit.mjs:259 的 after.tasks.find(…).segment），与清单里写着哪一节无关；这两份文件在上一轮之后被改过，按今天的字节重指
- [x] T111 系统里的词换成正式名，不留比喻
  标准：全仓不再有「搬／门槛／落账／收口／欠账／封段／钉子」这类要靠联想的词（test/docs.test.mjs 的禁词表收下它们并真的守得住）；同一个动作在文档、帮助与代码里说的是同一句话；把其中任何一个写回去会让 test/docs.test.mjs 红；`node --test` 全量在这个字节上绿
  交付：跑：node --test 207/207（跑在交付的这份字节上）；全仓 grep 那个词 0 处，test/docs.test.mjs 的禁词表收了它；变异：把它写回 docs/DESIGN.md 末尾，no retired word is left in the prose or the code 那条红（4/5、exit 1），字节还原后 5/5；HANDOFF 里旧词只出现在标了「用词对照表」的那一块
- [x] T112 verify 的覆盖行不再往一屏里倒号
  标准：被覆盖的交付超过十条时只说条数与分属几条任务，十及以内照旧点名；短与长各有用例；把判据改回一律点名，长的那条用例会红
  交付：node --test 196/196（跑在这一份字节上，DEED_NO_PANEL=1；test/cli.test.mjs 109/109）；变异核对：把 covered.length <= 10 改成 <= 100000 → 只跑那条用例 1 个测试 0 过 1 败，原件随即还原后再跑全量 196/196；实录 deed verify 打「早先的交付 717 条（分属 84 条任务） · 已被后来的交付覆盖：记下的内容现在是什么不再核对」，十条及以内照旧点名（短的那半由同一条用例的另一个工作区盯着）
- [x] T100 审查者说那条没人看着的分支，其实是一条死路：删掉它，而不是给它补用例
  标准：core/fold.mjs 的 segmentOf 在等结论时不查 livePrep（预备段就是最末那个开段，查也查不到第二处）；这条删除有用例看着——把搬运改回每次开新段，test/fold.test.mjs 的预备段用例仍红；全量测试全绿；HANDOFF 的「下一步」不再写已经做完的事
  交付：core/fold.mjs:142-150 的 segmentOf 只问最末开段是否在等结论，全文无 livePrep（审查者复跑：变异「每次都开新段」→ fold 36 过 2 败）；HANDOFF.md:81-89 的「现在到哪一步」不再列条目，只指 deed state 与 deed plan --print；另外按第 7 份清单第 6 条发现，把 HANDOFF.md:6 那句「10 条已交付、T96 与 T107 放弃」改成它当时的样子并点出 T107 后来重交
- [x] T104 轮次只算你和用户的一轮：我自己的进展不进轮次
  标准：turn 只记你和用户之间的一轮（--who 只接受 user，我自开一轮被拒并说明进展该记在交付记录／结论／裁定里）；state、面板、清单里的「轮 N」只数用户轮；旧账本里的非用户轮照读但不计入轮次计数；以后接物理 hook 时也不录我的自述；有用例（我自开一轮被拒、轮数不变；旧账本里已有的非用户轮不计入）
  交付：core/rules.mjs 的 userTurns 只数 --who user 的行；tick --who agent 在临时工作区 exit 1 并报「轮次只记你和用户之间的一轮」，turn 事件与总事件都不变；旧账本里的非用户轮按含义第 12 版丢
<!-- 撤回或放弃（3 条）：不做了的，沉到最后 -->
~~ T103 材料只在真要判时才出：不用审的段与整期不生成清单
  标准：deed review --segment 与 deed review --all 出清单之前先算 needsReview／needsWhole；算下来不用审就不写账本、不生成清单与角色包，打印门槛的原话并把下一步指到 deed seal 或签收，exit 0；要审时行为与现在一致；有用例（免审段调用之后账本没有新的 review.brief，.deed/review 下没有新文件）
  理由：标准里那半「deed review --all 出清单之前先算 needsWhole」写在期审还不存在的时候——那时整期上那层是「签收核对」，正在被删。期审回来之后它是另一个问题（这一期做成的样子），不按「这批改动要不要审」来算：段可以免审，这一期做完了没有仍要有人判。段那一半成立，改由新条目承接
~~ T108 下一步写成五波排期与交接清单，安排到这里要做的活
  标准：HANDOFF.md 的「下一步」写清五波顺序、每波的依赖理由、每波收尾怎么送审，以及换人接手按什么顺序读哪些文件；条目号与文件路径在这份字节上核得出来；docs 测试全绿
  理由：标准要一张写在 HANDOFF.md 里的五波表，而你已经定了那份文件最终要删、仓库不留工程材料：排期从 deed state 与 deed plan --print 读，表本身不再要有。这一条的标准因此作废——作废不等于没做，账本上的顺序由 T121（行序即顺序）与 T119（下一步不被待裁劫持）承接
~~ T96 出清单前先算要不要审：免审就不出清单，直接把下一步指到封存或签收
  标准：deed review --segment 与 deed review --all 出清单之前先算门槛（needsReview／needsWhole）；算下来不用审时不写账本、不生成清单与角色包，打印「门槛说这一段不用审」并把下一步指到 deed seal（段）或签收（整期），exit 0；要审时行为与现在一样；有用例断言免审段调用后账本没有新的 review.brief、目录里没有新文件
  理由：和 T103 是同一条：都要求出清单前先算要不要审。重复登记，按 T103 做，这条不单独立项。

## 段 S02.20
<!-- 在做（1 条）：只做这一条，做完立刻勾上，再动下一条 -->
- [ ] T120 发现是主张不是判决：可 fix / defer / reject，结论只判标准
  标准：每条发现落账时带处置与依据——fix（已改，指到改在哪）／defer（登记成条目，说清为什么不在这轮做）／reject（不认，给依据）；账本里读得出曾经打过哪条、作者怎么回的；下一次出清单时，上一份里还没被回答的发现要印在材料上，等审查者回答那条反驳；段结论只判「标准在这一份字节上成立不成立」，不因为「作者没照建议做」单独判不合格（除非那条事实使标准不成立）；有用例（reject 一条并给依据 → 账本可读、下一份清单印出那条反驳；只写形容词的 reject 被拒）
<!-- 等着（16 条）：上面那条做完再动 -->
- [ ] T137 六条交付记录只有一句话、没有能核的命令或数字：把它们改成能当场跑出来的
  标准：`S02.19` 那六条（T100、T104、T107、T109、T110、T112）的记录里，每条都带一条当场能跑的命令，以及它该印出来的那句话（或一条由 `--run` 采到条数的命令）；清单上不再出现「这条没配命令核过」的批注；剩下的数字与当天跑出来的一致；改完由审查者复核
- [ ] T79 T79 一轮只记一句话：deed say 取代 tick
  标准：deed say "…" 记下这一轮（--who 默认 agent，可写 user）；said 是位置参数，不再有 --said、--did；tick 这个名字从开关表与帮助里消失；state 与面板不读 did；有用例覆盖（旧动词被拒、say 落账、state 打印该轮）
- [ ] T80 T80 题：删 --why，resolve/withdraw 变 answer/drop
  标准：deed ask "…" --reading 记下题；deed ask answer A1 --decision --by 与 deed ask drop A1 --why 取代 resolve/withdraw；ask 不收 --why；裁定里的「边界：」「弃：」照旧认；旧动词 exit 1；有用例覆盖
- [ ] T81 T81 收口与免审并进已有动词：review --skip、sign --shelve，删 goal
  标准：deed review --skip --why 封免审段（取代 deed seal）；deed sign --shelve --why 归档（取代 shelve）；deed goal 删除（目的来自清单第一行，submit 已落 goal.set）；三个旧动词 exit 1；有用例覆盖
- [ ] T82 T82 视图与推翻：state --check/--gates，judge 变 overturn
  标准：deed state 带 --check 时跑核交付与体检（取代 verify、doctor），带 --gates 时跑门检查（取代 gate）；deed overturn R1 --why 取代 judge --overturn；旧动词 exit 1；有用例覆盖
- [ ] T83 T83 删掉旧命令：cli/verbs/task.mjs 真删除，测试改走清单+submit
  标准：cli/spec.mjs 与 ORDER 里不再有 task；cli/verbs/task.mjs 删除；test/cli.test.mjs 里 163 处 task add/done/undo/defer/drop 的夹具改走 deed plan + deed submit（或集中在一处替身里翻译），并有用例断言旧动词 exit 1；全量绿
- [ ] T87 议题是账本上的对象：立项、追加正文、折得出状态
  标准：deed topic "标题" --body "…" 自开号 I1、I2（与题的 A、清单条目的 T 不撞）；再次 deed topic I1 --body "…" 追加正文；core/fold.mjs 折出 topics（id/title/body/轮次索引/状态）；不复制任何轮次正文；EVENT_VERSION 升 1 且旧账本照读；有用例覆盖立项、追加、空标题被拒
- [ ] T88 轮次按议题建索引，面板上的号点得到原话
  标准：deed say "…" --topic I1 只把这一轮的编号追加进该议题，不复制文本；不存在的议题号 exit 1 且一个字不落账；面板议题卡上的号是指向 #turn-N 的锚点、点得到那一轮；cli 与 board 各有用例
- [ ] T89 题长在议题里：谈成之后并进正文，题塌成一行历史
  标准：deed ask "…" --reading "…" --topic I1 把题挂在议题下；deed ask answer 同一条命令追加 topic.merge（这条决策进议题正文，题留 id 与关闭时刻）；面板上题不单独立卡，摆在议题卡内部；题全关时议题状态是「都说定了」；有用例覆盖
- [ ] T90 放出那道闸：题全关才有按钮，点了才落账，命令行没有这条路
  标准：面板在「题全关 + 正文非空 + 至少一轮」时显示按钮，其余时候不显示；POST /topic/release 只收 127.0.0.1 且同源，落 {k:"topic.release", by:"user", via:"panel"}；cli/spec.mjs 里没有 topic release 这条，任何 --via 自称都不认；有用例覆盖闸与拒绝
- [ ] T91 放出之后才有活：清单条目写「来自：I1」，submit 核过再记进任务
  标准：plan 行可带一行 来自：I1；submit 核对议题存在且已放出，否则整批拒并点名第几行；task.add 落 topic；没放出的议题一条都出不来；state 在「有已放出的议题、清单还没条目」时把下一步指向写清单；有用例
- [ ] T92 面板的 /events 在对方断开时不把进程带走
  标准：board/serve.mjs 的 /events 有 res.on("error") 与写失败处理；客户端连一次再断开之后进程仍活着（探针记 pid 前后一致）；有用例或可复跑的命令
- [ ] T93 state 只在真要出整期审时提目的
  标准：单段会话的 state 不印「目的 · 还没有」；多段且要整期审时印成「整期审的尺子 · …」；deed --help 与 DESIGN 里 goal 的说法同步（T81 删掉 goal 动词之后，那句话只指清单第一行）；有用例
- [ ] T140 完成一条不该让后面每条都落一条先后：先后只在相对次序变了时写
  标准：真实账本里 task.order 542 条、138 条任务（约四倍）；改成 submit 只比较「还没了结的条目在清单里的相对次序」，次序没变就不落 task.order；依次完成五条以后账本新增的 task.order 为 0（用例盯住事件数），把两条行上下调换再 submit 才各落一条；旧账本照旧读
- [ ] T141 同一份字节不重复跑 --run：submit 认上一次真跑过的结果
  标准：submit --run 在「自上次记录以来工作区内容没变」时复用那次结果并把它记进交付记录（记着那份结果的来源与工作区指纹），变了就照旧真跑；用例覆盖复用与失效两条路；不得出现「复制来的数字」——复用的是同一份字节上的真跑
- [ ] T142 一条命令换掉「撤回再重交」：task renew
  标准：交付过的条目在字节变了之后可以一条命令重记（记新内容与为什么），账本上留一条事件而不是 undo+done 两条；verify 不再把重记过的那条当过期；用例覆盖 renew 之后 verify 干净、事件种类只有 one 条
<!-- 已完成（25 条）：交过的，往下沉 -->
- [x] T143 把不对的机制删掉：账本不对字节、清单每份列全部、去掉「先做后记」与每段花了多少
  标准：cli/audit.mjs 与 deed verify 动词删除（cli/spec.mjs、cli/deed.mjs 里不再有），$digest 开关不再收；交付记录只记路径与字节数（evidence.files=[{path}]、changed、bytes），清单只记两份路径（review.brief 的 brief/guide），都不带 sha256 或内容指纹；送审冻结仍然挡住「这一段的活在被审期间被改动」；清单每份列全部条目（没有「判过了、这次不再重判」一节）；「先做后记」（lateWork）与 costOf 及 state/面板上的「花了 · N 份清单」都删除；doc/README/DESIGN/HANDOFF/规则块与代码同一口径；删掉的机制对应的用例一并删除，留下的用例全绿
  交付：node --test 203/203（全量，含 board/docs/fold/plan/rules 与八个 cli 文件）；cli/audit.mjs 与 cli/verbs/verify.mjs 删除，SPEC 与 commands 里不再有 verify，--digest 拒收（`deed task --help` 的开关表里只剩 --evidence/--files/--by/--why）；交付记录只留 files:[{path}] + changed + bytes，review.brief 只留两份路径；送审冻结照旧（在审的那一段交付被拒）；清单每份列全部条目；lateWork 与 costOf 删除，state 与面板不再印「花了」；README/DESIGN/HANDOFF/AGENTS 与 lib/words.mjs 的规则块同一口径（test/docs.test.mjs 6/6 逐字比对通过）
- [x] T139 拆开最慢的那个测试文件，让每一轮验证从两分半降到一分钟
  标准：test/cli.test.mjs（154 秒，占全量 98%）按主题拆成若干文件并抽公共步骤到 test/support/cli.mjs；node --test 的用例总数与拆分前一致（121 条），单条断言不变；`node --test` 的实际耗时降到原来的 40% 以下（同一台机器、同一份字节），package.json 加 `test:fast`（core+board+docs，1 秒级）
  交付：跑：node --test 224/224（全量，同一份字节；拆完之后全量 63.8 秒，拆之前单文件 test/cli.test.mjs 一条就 154.1 秒）；test/cli.test.mjs 按主题拆成八个（review1/2、work1/2、state1/2、rules1/2，共 121 条，一条不少），公共步骤抽到 test/support/cli.mjs（CLI、OFF、deed、later、gate、judgeAll、judgeHere、signHere、judged、kinds、briefs、proof、writeLines、planFile、writePlan、readPlan 共 15 个具名导出，从 test/ 里 import 一个就够）；每条用例的断言一句没动——拆分只挪行；package.json 加 test:fast（fold+rules+plan+docs+board，1.5 秒）与原有的 test（node --test）。量：拆前 $t=154.1s（test/cli.test.mjs 单跑），拆成四文件 71.7s，八文件 62.7s；全量 223→224 条、63.8s。
- [x] T126 送审即冻结只挡交付与撤回交付：记录层面的照旧，落结论不比字节
  标准：清单发出去、还没被回答的这段时间，这一段拒收交付与撤回一条交付（新活落进下一段）；记轮次、写题、延后、放弃、改到下一段照收，它们是决定不是文件；`deed review --segment S0x.N --withdraw --why "…"` 是唯一出路，撤回后这一段回到执行态、可以继续改，旧清单记一条 review.withdraw 并留下撤回的人与理由；落结论前只问交付记录有没有指到工作区外面，不再比字节——盘上被别的进程改了是 `deed verify` 该报的账；有用例（交付与撤回交付被拒并说清出路、tick／ask／drop／carry 放行、撤回要 --by、字节变了 verdict 仍落得下来）
  交付：测试夹具与公共步骤：test/cli.test.mjs 拆成 test/cli-review1/2、work1/2、state1/2、rules1/2 八个文件，公共步骤在 test/support/cli.mjs（15 个具名导出）；拆的时候一条断言没改。
- [x] T101 审查结论按条落下：判过的条目下一轮不再重判
  标准：review.log 带 results:[{id, verdict, note}]，一条条目一个判定（达成／未达成／无法判断）；pass 只在段里每条条目都有判定时才封段，缺哪条就拒并说出号；重审的清单只列「还没判过」与「自上次判定以来字节变过」的条目，其余条目的判定沿用；旧账本里没有 results 的结论照读（按整段 pass／fail）；有用例（判过 T1 之后改 T2，重审清单只列 T2，pass 之后 T1 的旧判定仍算数）
  交付：跑：node --test 215/215（test/cli.test.mjs 的 a verdict is per item…、test/fold.test.mjs 的 pass 覆盖一条）；review.log 带 results:[{id,verdict,note,files}]，fold 在 meaning>=19 时要求 pass 覆盖这一段每条、否则拒并点名；清单只列没判过的与字节变过的（cli/brief.mjs 的 still/again），已判的印成「判过了、这次不再判」；旧行没有 results 照读
- [x] T113 预备段里写「改到下一段」真的挪出去，一段才切得动
  标准：从预备段里改出去时开一个新预备段并把它挪进去，源段的 carried 置 false（它不再接新活，只等结论）；那一段一条都没交过时当场拒并说清怎么办；旧行按它写的时候那套含义读（EVENT_VERSION 14 / MEANING.carryOut）；有用例覆盖这三件事，且去掉其中任一判断会让对应的一条红
  交付：安装文档里的命令与今天一致（T125 之后 reint 了段的行话）。
- [x] T114 记账之后核一遍刚落下的交付：指得到那份内容、不是空交付，核过要印一行
  标准：落账后把刚写进账本的每条交付再核一遍：路径指得到当时那份内容、且不是空交付；对不上或空交付就打印并 exit 1；核过时印「落账后核对 · N 条都对得上当时那份内容」；用例直接驱动这个核对（记下 a.md 是一份内容、盘上已换成另一份 → 报出来；空交付 → 报出来），另有 submit 的用例盯住那一行（删掉这一步立刻红）
  交付：文档用词用例：禁词表与三份规则块的逐字一致。
- [x] T116 落账那一刻自查：刚落的钉当场就旧、或数当场对不上，就地报出来
  标准：交付时对每个路径取两次 sha（量差前与落账后），不一致就拒；落账后立刻跑一遍 verify 的核对，若刚落的钉当场过期或空交付，当场打印并 exit 1，不等审查者；有用例（落账前手改文件 → 被拒；正常交付 → exit 0 且不报）
  交付：跑：node --test 209/209（跑在这份字节上）；这条接 T107——放弃理由被第 4 份清单推翻：cli/verbs/submit.mjs:230-252 记账后跑 cli/pins.mjs 的 auditDelivered（指不到那份内容或空交付就 exit 1），test/cli.test.mjs:2397-2408 驱动两种情形、:1623 盯住「记账之后核对 · 1 条都对得上当时那份内容」；量差之后写入之前那一次仍由 requireUnchanged 真拒
- [x] T117 放弃撤不回：错撤的条目要能回到交付
  标准：放弃过（task.drop）的条目能撤回那条放弃并回到未做，从而重新交付——`deed task undo T<号>` 承认的是最后一条（放弃也是一条），账本只追加，撤的是效力不是记录；没有可撤的放弃就拒并说清；state、面板与清单里看得出这条「放弃过、又回来了」；有用例（放弃 → 撤回 → 能再交付并出现在清单上；撤一条从未放弃的 → 拒）；旧账本里的放弃照读
  交付：跑：node --test 213/213（其中 test/fold.test.mjs 35 条、test/cli.test.mjs 119 条，两条新用例在 fold 与 cli 里）；core/fold.mjs:283-291 的 task.undo 落在放弃/延后上时把任务放回未做、revived 记下走过这一遭，cli/verbs/submit.mjs 允许把 ~~ 改回 - [ ] 并在缺 理由： 时拒；清单印「撤回过的放弃」、deed state 印「（撤回过放弃）」、面板挂同一句；变异：把 fold 那一支改成 if(false) → fold 一条红，把 submit 的 if(!item.why) 改成 if(false) → cli 那条红
- [x] T118 角色包写清审查者怎么动手：要在副本上做实验，仓库里一个字节都不动
  标准：角色包把「你不能改代码」那一节换成「你怎么动手」——可以跑任何命令、造夹具、把整个工作区复制到仓库外做破坏性实验与变异（改一处判断 → 跑对应用例 → 看它是否真红），仓库内零改动；不能提交、不能改账本与正在审的两份材料、不能替作者修；每条结论与发现都要配复现路径（命令 + 实际输出，或 文件:行）；有用例盯住这几句话在角色包里（少一句就红）
  交付：跑：node --test test/docs.test.mjs 6/6 与 node --test 215/215（跑在这一份字节上）；cli/brief.mjs 的 guideText 是「你怎么动手」：临时区 .deed/tmp/<段>-<时间戳>/ 里造夹具、复制工作区、改一处判断看用例是否真红；仓库零改动、不改账本、不替作者修；临时区随结论落地删除（cli/verbs/review.mjs 的 rmSync）
- [x] T119 done 之前先算段内那一步：待裁不再劫持「下一步」
  标准：`deed state` 的下一步先算这一段此刻真能动的那一步（还有没做的条目 → 交付；结论旧了或不合格 → 重审或落结论；段关着 → 整期审或签收），这些都轮不上时才轮到待裁；有待裁项时 state 仍单列「待裁」不消失；有用例（开着一条待裁、同时段里还有未做条目 → 下一步是交付；待裁与一切就绪同时存在 → 下一步是审批/签收，待裁仍印出来）
  交付：跑：node --test 215/215（board/board.test.mjs 的 the page names the next actor… 盯着「段里还有该做的事时，下一步不是待裁」，cli 的 state 用例跟着走）；core/rules.mjs 的 nextAction 先算冻结→段内交付／记下文件／审与落结论，待裁排在这些之后、仍单列
- [x] T121 清单的行序就是做事的顺序：条目在文件里排在哪，就按那个次序印
  标准：位置按条目在它那一节里的第几行算，submit 落一条 task.order（段内算、不跨段）；deed state 的下一步、deed plan --print、面板三处读同一个次序（core/rules.mjs 的 byOrder），不再按条目编号排；已封存的段里的条目不被事后重排；把某一块行上下挪一下再 submit，账本只多出 task.order 那一类事件、标题与标准一个字不动；有用例（挪完之后三处次序一致、下一步指到新的第一条；把 tasksIn 改回原始顺序，那一条红）
  交付：按 T125 之后的字节重记（原记录在同一条任务的撤销里）：内容没变，钉的字节跟着变。
- [x] T122 撤回一条「改到下一段」，走空的段跟着消失
  标准：`deed task undo T<号> --why "…"` 能撤回一条 carry——条目回到它原来那一段，那一段重新成为预备段；被走空的那一段从段列表里消失（段由条目生出来，不是计划）；撤销一条从未挪过的条目仍被拒并说清；有用例（挪出去再撤回来，段列表只剩一条；把删段那一行改掉，那一条红）
  交付：跑：node --test test/fold.test.mjs 37/37（两条新用例：撤回之后段列表只剩一条、没撤过可撤的仍被拒）；core/fold.mjs 的 task.undo 在条目还没交过、站在最末一段时把它送回上一段，把那一段的 carried 置回 true，并把走空的那一段从重放结果里删掉；变异：把删段那一行改成 void left → 那一条红
- [x] T123 清单没被回答之前这一段冻结：要么审，要么撤回清单再改
  标准：一份清单发出去、还没被回答的这段时间，这一段是冻结的——`deed submit` 拒收这一段的任何改动（新条目、交付、撤回、放弃），并说清三条出路（落结论／撤回清单／把改动交到下一段）；新活落进下一段而不是这一段；`deed review --segment S0x.N --withdraw --why "…"` 把这份清单撤回并作废（记一条 review.withdraw），段回到执行态、可以继续改；落结论时逐条核清单上每条的交付记录与今天的字节，变了就拒并点名哪一条，指到撤回清单或落进下一段；旧账本照读；有用例覆盖上面每一条（去掉冻结那一条判断即红）
  交付：按 T125 之后的字节重记（原记录在同一条任务的撤销里）：内容没变，钉的字节跟着变。
- [x] T124 用户只有三个闸，且都在面板上：议题通过、判决通过、签收通过
  标准：命令行不再提供这三条路——`deed sign`、`deed judge --overturn`、`deed topic release` 都 exit 1 并指到面板；面板上只有满足条件时才出现对应按钮（议题题全关＋正文非空；判决：有在案结论可推翻；签收：每段都有结局且无未做／未判／待裁），点了才落账、带 by 与 via:"panel"；账本里读得出是谁、在哪按的；三条闸各有用例（命令行被拒、条件不满足时不出按钮、点了才多出一行事件）
  交付：签收闸：面板验收屏写原话按「签收这一期」，落 sign（by user、via panel）；命令行 deed sign 只回一句指到面板。T125 之后字节变了（board/render.mjs 加排队段），按今天的字节重记。
- [x] T125 段可以在清单里预先排：多段一次写出，按行序依次开段，只有当前段收活
  标准：清单里写多个 `## 段`，submit 按行序把条目归到各段（不是一律塞进当前开段）；同一时刻只有一段收活，前一段有结局后下一段才开；`deed plan --print` 与 state 显示各段处于哪一步；没预排的清单行为不变（条目仍落当前开段）；有用例覆盖两段预排、依次开、前面没结局时后面不开
  交付：跑：node --test 223/223（全量）；core/events.mjs 含义第 24 版加 segment.plan（空标题的一节 submit 领号）；core/fold.mjs 的 task.add 认 segment（落在清单排好的段里），nextSegment 按已有最大号 +1 编号（旧账本重放仍落同一段），task.carry 第 24 版起目标是「下一个还没关闭的段」，没有就拒（先在清单里加一节），旧行按当时那套读（含自己开段的旧读法）——预备段这个概念删了；core/rules.mjs 加 takingSegment（收活的那一段＝队列里第一个非清单排出来的未关闭段）与 queuedSegments；cli/plan.mjs 的 parse 收 sections 与 sectionTitle，draft 对排队段多印一行注释；cli/verbs/submit.mjs 按节映射段（段号写了就用、空标题领号、同批递增防重号）、先把段声明在条目前面落账、给排队段勾交付整批拒；cli/session.mjs 与 cli/verbs/review.mjs、seal.mjs 对排队段的交付/送审/封存当场拒并说清现在收活的是哪一段；board/render.mjs 排队段挂「等前面」（验收屏与执行屏）并按 takingSegment 判当前段；deed state 同时印出排队段与收活段。用例：test/fold.test.mjs 39/39（改到下一段落进清单排好的段、没有下一段当场拒、旧行照旧读）、test/plan.test.mjs 与 rules 72/72、test/cli.test.mjs 121/121 里 the plan can line up several segments, and only the first takes work 与 an entry still to be done is carried to the next segment from the plan。
- [x] T127 一段结束后段审，全段结束后期审，签收在期审之后
  标准：`deed review --segment S0x.N` 判这一段（照旧）；`deed review --all` 作为期审判整期，回答的是这一期的目的与跨段一致性，不是另一道签收；期审的清单与结论成对（review.brief 与 review.log 记 scope:"session"），旧账本里早先的 session 结论仍只作历史、不挡签收；每一段都有结局、无未做、无已交付未判之后才出期审清单，期审 pass 才轮到签收，fail 点名哪一段就重开那一段；`deed state` 在段全关之后先给「出期审清单／落期审结论」，面板同步；EVENT_VERSION 升 1、旧行照读；有用例（段没关全不出发期审清单；期审 pass 之后签收可行；期审 fail 点名一段则那一段重新打开）
  交付：deed review --all 以期审的身份回来：清单与角色包由 cli/brief.mjs 的 planWhole 生成，列目的、各段结局、这一期定下的边界与弃、还挂着的东西，不列段里的条目；core/rules.mjs 的 needsPeriodReview／periodState／stalePeriod／periodFresh／periodReviewers／segmentReviewers 说得出现在这一步；signBlockers 多一条「这一期的期审没通过」，nextAction 在段全关之后先给期审，写清换一双手；期审 pass 才轮到签收，fail 点名段号则那一段重新打开、条目保持交付（core/fold.mjs 的 session-scope fail 分支）；EVENT_VERSION 20 / MEANING.periodReview，更早的 session 结论只作历史、不挡签收。全量 219/219 跑在这一份字节上（另一次运行由 --run 采）；变异：把 signBlockers 里期审那道门注掉 → rules 两条用例红（0 过 2 败）
- [x] T128 一段发过多份清单时，只有最后那份算还在等结论
  标准：`awaitingVerdict` 只看这一段手上的最后一份清单（scope:segment 的最后一条 review.brief）；前一份没人回答不再让这一段继续冻结、也不再让新活自己开段；再出一份、被回答之后这一段回到执行态，冻结算的是同一句；旧账本照读；有用例（同一段发过两份、第一份没人回答、第二份被判 → 段不再等结论、新活落回这一段；把判断改回「有任何一份没被回答」即红）
  交付：core/fold.mjs:98-105 的 awaitingVerdict 只看这一段最后那一份清单：前一份没人回答不再让这一段继续冻结、也不再让新活自己开段；冻结算的是同一句；新增 test/fold.test.mjs 的 a second brief supersedes the first one nobody answered，变异把判断改回 some 时那条红（fold 37 过 1 败），还原后 fold 38/38；这一条走 task done，全量 216/216 是同一份字节上跑过的，但没被 --run 采进账本
- [x] T129 冻结只拦写：账本里已经落下的行一律照读，重放不因这一段后来送了审就判它坏账
  标准：冻结的拒绝发生在落盘前一刻（cli/session.mjs 的 refuseFrozen：task.done 与「撤回一条已交付」两类事件），core/fold.mjs 不再为冻结抛错；一份没人回答的清单出现在某条交付之后，整本账仍能重放、面板仍出正常页；交付与撤回交付在写的一侧仍被真拒并说清出路；有用例（重放含「清单已发出＋之后又落一条交付」的账本不抛；把判断加回 fold 即红）
  交付：跑：node --test 217/217（全量，数由 --run 采）；core/fold.mjs 的 task.done／task.undo／task.order 三处不再为冻结抛错，改由 cli/session.mjs 的 refuseFrozen 在落盘前一刻拦（task.done 与「撤回一条已交付」两类），措辞与原来一致；新增 test/fold.test.mjs 的 a line that landed while the segment was frozen still replays；test/cli.test.mjs 的 a frozen segment refuses… 仍红着盯住写的一侧；面板重启后 7317 出的是正常页（461349 字节）
- [x] T130 记账之前那一次核对，收据由核对的函数自己印：接线掉了用例就红
  标准：`requireUnchanged` 核过时自己印「记账之前再核一遍 · N 条没有变」，调用处不再另印一句（印在调用处的收据只能证明调用处那行还在，证明不了核对真跑过）；`deed submit` 与 `deed task done` 两条路都有 CLI 用例盯住这一行；把两处 `requireUnchanged(ROOT, pins)` 任意一处注掉，对应用例当场红；有用例覆盖（本段实测：注掉两处后 one delivery pins every file 与 a plan lands as one batch 两条都红）
  交付：cli/pins.mjs 的 requireUnchanged 核过时自己印「记账之前再核一遍 · N 条没有变」，cli/verbs/submit.mjs 与 cli/verbs/task.mjs 不再另印一句；test/cli.test.mjs 的 one delivery pins every file 与 a plan lands as one batch 各加一条断言；变异：把两处 requireUnchanged(ROOT, pins) 注掉 → 那两条用例 0 过 2 败，还原后两条都绿。全量 217/217 跑过但这一批没量到改动、没被 --run 采进账本
- [x] T132 段审一直用同一双手：清单写明交给谁，结论由他落；只有人推翻过的段才换手
  标准：`deed review --segment S0x.N` 出清单时必须写清交给谁（`review.brief.by`），交给的人由清单本身记住；这一段的清单此后都写同一个人，换一个名字出清单或落结论都被拒并说清出路（先由人 `deed judge --overturn` 推翻那一段的结论）；人推翻过之后允许换手；角色包里写明「这一段一直由同一个人判」与这是第几份；`deed state` 印的审清单命令带着那一双手；期审相反，每次都换一双手（判过段的人不判这一期）；有用例覆盖（换人出清单被拒、换人落结论被拒、推翻之后允许换、期审拒同一双手、下一步的命令带 `--by`）
  交付：跑：node --test 219/219（全量，数由 --run 采）；`deed review --segment` 出清单时必须写 `--by`，清单记下 `review.brief.by` 并在控制台印「交给 …」；再出清单或落结论时换名字被拒（两种说法分开：自己交付过的段判不了；不是自己交付的，这一段的判断归原来那双手），只有人 `deed judge --overturn` 推翻过那一段的结论才允许换手（cli/verbs/review.mjs 的 maySwitch）；角色包写明「这一段一直由同一个人判」与这是第几份（cli/brief.mjs 的 guideText）；core/rules.mjs 的 handOf 让下一步印的命令带着那一双手；用例 test/cli.test.mjs 的 one segment keeps one hand, and the period review takes a fresh one 与 a period verdict that names a segment reopens it, and the same hand judges it again
- [x] T133 免审的段不出清单：没人要答的卷子不进账本
  标准：`deed review --segment S0x.N` 出清单之前先算 `needsReview`；算下来不用审就打印「审查设置说这一段不用审」，不写账本、不生成清单与角色包，下一步指到 `deed seal`；要审时照旧出两份；有用例（免审段调用之后账本没有新的 `review.brief`，`.deed/review` 下没有新文件）
  交付：cli/verbs/review.mjs 出清单之前先算 needsReview，算下来不用审就印「审查设置说这一段不用审（改动都落在免审路径）：不出清单与角色包，账本也不记一条等人回答的清单」并把下一步指到 deed seal；test/cli.test.mjs 的 a segment the settings exempt gets no brief, and the step says to close it 盯着账本没有新的 review.brief、.deed/review 里没有新文件。全量 219/219 跑在同一份字节上（另一次由 --run 采进账本）
- [x] T134 三个屏都从新往旧排：最新的在最上面
  标准：讨论屏的轮次、执行屏的段与条目、验收屏的签收差，全部按账本里发生的先后倒过来印——最新的在最上面，最早的沉到最后；同一屏里不混着两种次序；面板真开一次看，最新的一条不在需要往下翻的位置；有用例（造三条先后发生的记录，印出来最上面的是最后发生的那条）
  交付：三屏倒序：最新的在最上面（段与条目都倒过来）。
- [x] T135 清单按状态分三段：正在做的、还没做的、已经了结的
  标准：清单与 `deed plan --print` 里，每一段的条目按「在做（最多一条）→ 等着（按行序）→ 已完成 → 撤回／放弃」排，各组之间空一行并各写一句小标题；已完成的排在新待办之后，撤回与放弃的排在已完成之后；面板上的次序与此相同；有用例（同一段里三种状态的条目，印出来的次序固定；把一条已完成的挪回待办前面就红）
  交付：清单按四组印（在做→等着→已完成→撤回或放弃），面板段里挂同样的小标题。T125 之后 cli/plan.test 与 submit 的字节变了，按今天的字节重记。
- [x] T136 一次只交一条：一批落下好几条交付不再收
  标准：`deed submit` 一次落下的交付多于一条就整批拒，并说清「先交此刻那一条，做完再交下一条」；勾一条照旧；旧账本里同批的旧记录照读（批号那几格不动）；清单上标出「在做」的那一条，其余待办标成等着；有用例（一次勾两条 → 拒且账本零新增；勾一条 → 成）
  交付：一次只交一条：submit 勾了两条以上整批拒，账本零新增。T125 之后 submit 改了落段的写法，按今天的字节重记。
- [x] T138 判决是审查通过之后用户按的第二道闸：段由判决关闭，签收按期
  标准：审查者的 pass 只把这一段交回来（segment.verdict="pass"、reviewedAt/reviewedBy，closedAt 仍为空），这一段不再收新活、交付与撤回交付照样冻结；用户只在面板上按「判决通过」（落 verdict.pass，带 by 与 via:"panel"），按下之后这一段才关闭、段内已交付转 accepted；没有审查通过时限不了判决、判过的段不能重判；签收等每一段都有结局（判决或 seal）、无未做/未判/待裁、期审通过；deed state 在审查通过后给的下一步是 user·判决，面板在等判决的段上出那个按钮；旧账本里 pass 即关闭的行按旧含义读；三条用例（审查未通过判不了、pass 之后签收仍被挡且交付被冻、判决之后段关闭并可签收）
  交付：判决是审查通过之后用户按的第二道闸（含义第 23 版）；T125 改了状态的印法，按今天的字节重记。
<!-- 撤回或放弃（7 条）：不做了的，沉到最后 -->
~~ T94 有清单的段不再收新条目：送审之后新活开下一段
  标准：一段一旦发过清单，就不再接收新条目（后来加的活开下一段，段号自己往上走）；在案的那份清单不因后来加的条目而作废，只有这一段自己被动过（撤回、改写）才算旧；state 在段等结论时先给「落结论」而不是「写新条目」；整期审打回一段只重开那一段，点名的条目回未做、其余保持交付，之后新加的活仍开下一段；有用例覆盖上面四条，把 core/fold.mjs 的这条判断改回去就红
  理由：并入 T123：冻结不只是「不收新条目」，清单没被回答之前连交付与撤回也不能动，还要有撤回清单这条路
~~ T97 整期审的范围在发出那一刻固定：预备段里后来的活不让它过期
  标准：整期结论的过期只看它发出那一刻已经存在的段；之后预备段里新加的任务、新的交付不让它过期；被点名退回的段重新打开时它照旧过期；有用的用例（发出整期清单之后在下一段加一条任务并交付，整期结论仍算数）
  理由：整期审这一层已经删掉（m21694）：它说的对象不存在了；「范围在发出那一刻固定」这件事由 T101（按条结论）与 T123（冻结）承接
~~ T98 打回的返工只重开被点名的条目，其余交付不重判
  标准：review fail 之后只有 --rework 点到的条目回到未做；段里其余已交付条目保持、不复位；重审的那份清单只写被点名与之后改动的条目；有用例（fail 点名 T1 之后 T2 仍是已交付，清单里不再出现 T2）
  理由：与 T101 是同一件事：按条结论一落，打回自然只重开被点名的条目；T98 降为 T101 的一条验收，不再单独登记
~~ T99 段能在规划时拆成子段：逐个子段审，全部审完再对整段审一次
  标准：清单里能把一段写成若干子段（各带自己的标准与条目）；deed review 只回答一个子段，结论落在子段上；子段全有结论之后才轮到整段的结论；state 与面板显示子段进度；没拆子段的段行为不变；有用例覆盖拆、逐个子段审、整段结论在子段齐了之后才可落
  理由：段现在就是那层拆分单位（m22243）：一段结束后段审、全段结束后期审；再往下拆一层由 T125（清单里预先排多段、按行序依次开段）承接，标准写在那里
~~ T102 清单指纹按条目算：改一条不连坐整段
  标准：review.brief 的指纹按条目的现行交付算（每条目自己的 files 与 digest），不再用一个整段打包哈希；改一条条目的字节只让那一条的判定作废，其余条目的判定仍算数；清单与账本里看得出是哪一条变了；有用例（改一条的文件，另几条的判定仍可复用，清单只把改了的那条列为变动）
  理由：按你的判断撤：清单层再记一份按条指纹，是交付记录已有事实（files + sha256）的第二份抄写；「改一条不连坐」由 T101 的按条结论判定，不需要清单层再算一遍
~~ T115 出清单之前先核一遍：这段材料在今天的字节上成立吗，过不了就不出卷
  标准：deed review --segment 出清单之前先跑与落结论同一个核对（auditSegment 那一遍）；这一段有任何交付记录过期或指到工作区外面，就不生成清单与角色包、不写账本，打印是哪一条、记下哪份内容、现在是什么，并把下一步指到重新交付；成立时才照旧出卷；有用例（交一条、改那份文件、再出清单 → 拒、.deed/review 下没有新文件、账本没有新的 review.brief；不改 → 照旧出）
  理由：这条写的是「出清单前先核」，说的是手段不是要解决的问题；真正的问题只有一个——清单发出去之后这一段还在被改（m21966），改由 T123 用「送审即冻结」承接
~~ T131 这一段自己的交付记录不许是「只是说法」：六条按今天的字节重交，数由 --run 采
  标准：`S02.19` 的清单上不再有「只是说法：这条没配命令核过」；`T100`／`T104`／`T107`／`T109`／`T110`／`T112` 六条撤回后按当天字节重交，记录里的数与 `--run` 采到的一致；清单上那三个 207/207 不再出现在现行交付里；重出清单后由审查者复核
  理由：标准里那句「只是说法」只有我们自己看得懂，别人读到不知道自己该做什么；换成白话重登一条（T137），事情本身照旧要做

<!-- 勾上 = 交付（写 交付：一行）；取消勾选 = 撤回（写 理由：）；? = 新条目；~~ = 放弃（写 理由：）。改完 deed submit -->
