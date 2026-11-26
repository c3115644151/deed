# deed · DSH 适配器

把 DeepSeek Harness 里真实发生的事交回工作区的账本。它只做三件机械的事，一个判断都不做：

| 做什么 | 怎么记 | 账本里读得到什么 |
|---|---|---|
| 原文交来 | `user/message` 且 `source.kind === "user"` → `deed say --from dsh:<会话>:<消息号>`（文本走 stdin） | 人的话仍是 `by:"user"`，通道写着 `via:"hook"`，同一个消息号只记一次 |
| 惯例 | 系统提示词段（`deed:convention`）：这一轮留下什么判断就记成要点 | 账本上不写一行——它是环境规则，不是人说的话 |
| 审查 | `task.done`／`turn/start` 时问 `deed review --due`；要清单就先 `deed review --auto` 出清单与角色包，然后起一个审查者（同一个段复用同一个，期审每次新开） | `review.brief` 记 `via:"auto"`；结论由审查者自己敲 `deed review --verdict` 记账 |

## 边界（在代码里，不在文档里）

- 钩子里任何异常都吞掉，写不进去就丢：适配器不能把这一轮带下来。
- 不读也不改宿主配置，不替人装东西。
- 不写三道人闸（签收、判决、议题出口）：那些只有人在面板上按。
- 卸载即无残留：只写工作区自己的 `.deed/`（诊断日志在 `.deed/tmp/dsh.log`，本来就不进仓库）。

## 装上

```powershell
# 1. 链接到 profile（不复制、不改 pnpm 锁）
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\deed-dsh" `
  -Target "<deed 仓库>\adapters\dsh"
# 2. profile 的加一层（cordis.patch.yml 末尾）
#  - insert:
#      - id: deed-dsh
#        name: deed-dsh
# 3. 重启 DSH 生效
```

拆掉：删掉那两行、删掉那个 Junction、重启。工作区里只会多出 `.deed/tmp/dsh.log`。

## 已知边界

- 适配器按顺序找 CLI：配置里的 `deed`（绝对路径）→ 工作区自带的 `cli/deed.mjs` → 适配器旁边那个（同一个仓库）→ PATH 上的 `deed`。用的是 `node`（PATH 或 `DEED_NODE`），不是 `process.execPath`——在宿主进程里那是宿主自己。
- 子代理的 API 名字随构建不同（本机是 `startContinuable`，另一些是 `startActivation`/`start`），适配器按能力挑。
- 子代理继承父会话的工作目录与 AGENTS.md 指令链：审查者会看到工作区自己的规则。要干净的房间只能靠另一个 profile 或以后给子代理换 `cwd`（这一版没有这个口子）。
- headless 一次性运行会在父轮次结束时退出，来不及等审查者收工；要看完整效果在桌面端或 web 里跑。
