# AGENTS

维护 deed 的入口。权威顺序：用户指令 > 本文件 > `docs/DESIGN.md` > `README.md`；代码与测试是事实。

## 这是什么

一个工作区的放行协议：谁有资格说「一件事过去了」、凭什么、下一步谁动。底座是只追加的账本，规则从账本算，下一步只有一处。

## 开发约定

- 行为先写 `docs/DESIGN.md`（唯一权威），再动代码。
- 零运行时依赖，Node ≥ 22 纯 ESM；层只往下依赖：`core → {}`、`lib → core`、`board → {core,lib}`、`cli → {core,lib,board}`。
- 写操作先重放后追加（`lib/record.mjs`）；规则只在 `core/rules.mjs` 算，面板和文档不另立判断。
- 改 `core/`、`lib/`、`cli/`、`board/` 跑全量 `npm test`；改面板真开一次页面看。数字要能复核。
- 改文件用定位替换，别整文件覆盖。结论靠验证，不靠叙述。
- 加动词三处一起改：`cli/spec.mjs`、`cli/verbs/<动词>.mjs`、`cli/deed.mjs`。

## 文档

`README.md`（对外入口）、`docs/DESIGN.md`（行为权威）、`docs/INSTALL.md`；辅助 `docs/research.md`、`docs/deed-architecture.html`（由 candidate.json 重出，别手改）。新增文档先问三条：哪一格的事实、谁读了会改变哪个动作、多久过期（见 `docs/README.md`）。过程材料不进仓库，只留结论。

## 边界

- 只写自己的 `.deed/`；宿主规则文件只读，缺规则只提示不代写。账本随工作区提交（不含密钥与隐私）。
- Shell 是 Windows PowerShell 5.1，跨平台命令用 node 直调。
- 发版、推公共分支、开源、发 npm 要用户明确同意。

## 记账

这个仓库自己也用 deed：`.deed/` 是账本，进度从 `deed state` / 面板读，不靠手写交接。给工作区的操作规则用 `deed init --print-agents` 打印，是否粘贴由仓库主人决定——deed 不替任何仓库写规则文件。
