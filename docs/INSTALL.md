# 装、接、升级、卸

deed 只有一个程序和一叠纯文本。装=让 `deed` 这个命令能在任意目录跑；接=在某个工作区里建一次 `.deed/`。
这两件事分开：**换程序不迁数据**，数据永远是工作区里的 `.deed/`。

## 需要什么

- Node ≥ 22（`package.json` 的 `engines`），纯 ESM，运行时零依赖。
- 一个 git 仓库（不必是 git 仓库也能跑，但没有 git 就少了「这一交付实际动了哪些路径」的便利）。
- 没有 npm 包（名字还没定），所以下面的装法都不来自 registry。

## 装上

三种，按「这个程序要活多久」选。

### 一、就地用（最短）

```bash
git clone https://github.com/c3115644151/deed.git
cd deed && npm test          # 204 条，确认这台机器上跑得动
node cli/deed.mjs state      # 就地可用，不装任何东西
```

适合只看一眼、或把它当某个工作区的子目录（`tools/deed/`）。

### 二、装成全局命令（agent 常驻的机器推荐）

```bash
cd /path/to/deed
npm link                     # 之后在任意目录敲 deed
deed help
```

`npm link` 建的是符号链接：更新仓库就更新命令，不必重装。Windows 上需要管理员或开启开发者模式（建 symlink 的权限）。

### 三、拷一份进别人的仓库（vendor）

```bash
mkdir -p tools && cp -r /path/to/deed tools/deed
node tools/deed/cli/deed.mjs help        # 用相对路径调用，不占全局
```

适合「这个仓库自带它、clone 下来就能用」。代价是升级要手动同步（`git subtree pull` 或重新拷）。
不接管 `node_modules`、不写 `postinstall`、不需要构建步骤。

### 打一个包带走

```bash
npm pack                     # 产出 deed-0.8.0.tgz（private 只挡发布，不挡打包）
npm i -g ./deed-0.8.0.tgz    # 装到这台机器上
```

## 接进一个工作区

```bash
cd /path/to/your/repo
deed init --review "src/**,apps/**" --exempt "docs/**,*.md"
```

`deed` 把**当前目录**当工作区（往上找到 git 根或文件系统根为止）。`init` 只做一件事：在这个工作区里建

```
.deed/config.json     审查设置（要审/免审的路径、门命令、端口）与它们的镜像
.deed/log/2026-11.jsonl   账本，按月份片，只追加
.deed/plan.md         这一期的清单草稿（deed plan 出，deed submit 记账）
.deed/review/         审查清单（发出去时才有文件）
.deed/workspace.json  上一次交付的内容指纹（第一次交付时才有）
.deed/log/lock        写锁，只在写的那一瞬间存在
```

**不写**你的 `AGENTS.md`、**不改** `.gitignore`、**不装**任何 git 钩子。

可选参数：

| 参数 | 作用 |
| --- | --- |
| `--said "…"` | 你开局那句话，作为第一轮的事实落进账本 |
| `--review "src/**,…"` | 要审的路径；默认为空，表示「没声明就等于要审」 |
| `--exempt "docs/**,…"` | 免审的路径 |
| `--port 7317` | `deed serve` 的端口（面板自己起来时用系统给的空端口） |
| `--print-agents` | 只打印一段可粘贴的规则，不改工作区 |

### 已经接过一次之后

再 `init` 不会覆盖你改过的审查设置；改审查设置要 `--force` 加 `--why`：

```bash
deed init --force --exempt "docs/**,*.md" --why "文档改动不必审"
```

为什么必填：**审查设置的每一次改动都进账本**，下一个人能看到是谁、什么时候、为什么放宽了审查。
`.deed/config.json` 只是账本的镜像；手改文件不改任何判断（规则只读账本），`deed verify` 会报「审查设置对不上」，
`deed init --force --why "…"` 是把它收进账本的唯一方式。

### 让 agent 知道规矩

```bash
deed init --print-agents
```

把输出原样粘进 `AGENTS.md`（或 `CLAUDE.md`）。deed 不替你写那个文件：它属于管理这个仓库的人。
没粘不报错，但 `deed doctor` 每次提一句「接入 · …」，`deed serve` 的页面顶上挂着同一句，直到有人写进去。

### 门（可选）

审查设置里的 `gates` 是一张「名字 → 命令数组」的表，`deed gate` 按顺序跑、第一条不过就停。
想用它结束提交，就在 `config.json` 里写，再用 `deed init --force --why "加门"` 记进账本：

```json
{ "gates": { "commit": ["npm test"] } }
```

## 升级

```bash
cd /path/to/deed && git pull && npm test
```

`npm link` 装的会立刻生效；vendor 的要重新拷。升级前后都跑一次 `deed doctor`：

- **账本比 deed 新**（每条事件都记着事件含义的版本 `v` 与写它的版本 `w`，先比 `v`）：`doctor`／`state`／`verify`／面板都说「升级 deed 就能读」。**别删也别挪**，那一行是有效事实，不是坏账。
- **deed 比账本新**：安全，事件类型只做加法，老事件照样折。

账本是纯文本，崩了也不丢：`.deed/log/*.jsonl` 可以直接 `git diff` 看，`deed verify`／`doctor` 是唯一的核对手段。

## 卸

```bash
npm unlink -g deed        # 或删掉 vendor 的那份目录
```

`.deed/` 可以留着：它是这个工作区的历史。真要清掉，先 `deed verify` 确认没有未签收的任务，再整目录删。
deed 没有守护进程、没有常驻的全局状态。面板跟着命令起来：每条命令执行前探测一次，不在就用后台进程拉起，URL 打在那一行输出里；30 分钟没人连就自己退，`deed panel --stop` 立即停，`DEED_NO_PANEL=1` 一条都不起。它不写账本，也不占终端。审查设置里写的那个号被别的程序先占了，它退到系统给的空号，由拉它起来的那条命令说清「哪个号被占着、改开在哪」——那句话不由子进程说，它不接管道，说了也到不了你眼前。要端口固定、前台看日志，仍可 `deed serve --port 7317`。

## 常见故障

| 症状 | 原因与修法 |
| --- | --- |
| `deed: 未知事件：x`，且写着「账本比 deed 新」 | 账本是更新的 deed 写的。升级 deed，不要动那一行 |
| `deed doctor` 报「账本坏了 · 第 N 行」 | 那一行不是任何版本的 deed 写的。整行挪进 `.deed/log/rejected/`，并写下为什么 |
| `deed: 已经有进程在写`（等 10 秒后） | 另一个进程正持有锁。看 `.deed/log/lock` 里的 pid：进程还在就等，没了直接重跑 |
| `deed verify` 报「过期」 | 交付记录记下的文件被改过，且之后没人重新记过它。在清单里重新勾一次再 `deed submit`，或在审查里点名退回 |
| `deed verify` 报「对不上」 | 发出去那份清单或角色包被改过、丢了、或没被账本记过。另出一份、重新审 |
| `deed verify` 报「审查设置对不上」 | `.deed/config.json` 被手改。用 `deed init --force --why "…"` 收进账本，或把文件改回去 |
| `seal`／`review` 报「没有写名字」 | 管道里跑必须写 `--by "谁"`；账本不替任何动作填名字 |

## 它不碰的东西

CI 配置、issue tracker、PR 流程、你的 `.gitignore`、你的 `AGENTS.md`、平台账号。
deed 只写 `.deed/` 一个目录，只读工作区里的文件（算指纹用）。
