# 文档索引与规矩

对着什么找什么，一篇就够。下面五份是**权威**，其余都不是：

| 文件 | 说什么 | 谁改 |
| --- | --- | --- |
| [`../README.md`](../README.md) | 对外唯一入口：它是什么、怎么装、怎么接、站在哪一格 | 定位变了才改；改前先在这里对齐 |
| [`../AGENTS.md`](../AGENTS.md) | 维护者规则：谁能改什么、提交前跑什么 | 维护者 |
| [`DESIGN.md`](DESIGN.md) | 行为权威：事件形状、重放规则、规则表、不变式 | 改行为先改它，再动代码 |
| [`INSTALL.md`](INSTALL.md) | 装、接、升级、卸、常见故障 | 命令或产物变了就改 |

辅助清单两件：

- [`research.md`](research.md)：对照与出处，「站在哪一格」那一节的底稿。
- [`deed-architecture.html`](deed-architecture.html)：架构图（单文件、可交互）；同目录的 `deed-architecture.candidate.json` 是它的图源，`architecture.png` 是它的一张截图，给 README 用。


## 一条规矩：新增文档先问

这个仓库**不再累加文档**。要新起一份之前，先回答三个问题：

1. 它说的是哪一格的**事实**？如果这格已经有主人（见上表），它应该并进那份，而不是并排一份。
2. 它会被谁读？读完会**改变哪一个动作**？答不出动作的，是过程材料，不进仓库。
3. 它会多久过期？跟着代码走的写进 DESIGN 或注释；跟着环境走的写进 INSTALL；一次性的留在 issue、聊天或本地临时目录。

三条都过了再新建，并在这一页登记一行。调研、截图、对话记录、临时脚本都不进文档区：它们是过程材料，用完就该消失，
需要留的只是结论（写进上面那五份之一）。

## 图的规矩

`deed-architecture.html` 是单文件、离线、可交互的**成品**，不是手改的：它由图源 `deed-architecture.candidate.json`
（archify 的 architecture spec）重出，重出来的字节与仓库里那份逐字节相同。改图就改 spec，别改 HTML——手改的部分下次重出就没了。

```
node "%USERPROFILE%\.dsh\skills\archify\bin\archify.mjs" finalize architecture \
  docs\deed-architecture.candidate.json docs\deed-architecture.html \
  --quality showcase --out-dir .tmp\arch-regen
```

archify 是维护机上装的工具，不在这个仓库里，也不是运行时依赖。四门（validate / deliver / check / browser-check）
全 pass 才算改完；回执落在 `--out-dir`（`.tmp/` 已忽略），不进仓库。

改图时：

- spec 里只用它自己的元件与卡片，成品自带内联字体与脚本（离线打开不能有半张图缺字）。
- 重出后在浏览器里真开一次：1440 宽无横向溢出，暗色主题下文字对比度够。
- 重出后重拍 `architecture.png`（README 引用它），两张图说的是同一件事。
- 节点上写的名字必须是代码里真有的：事件类型、命令、文件。代码删了，图也要删。
