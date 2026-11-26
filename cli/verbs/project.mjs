import { projectState } from "../../core/checks.mjs";
import { nextAction } from "../../core/rules.mjs";
import { treeOf } from "../../lib/tree.mjs";
import { ROOT, parse, load, transact, fail, guard } from "../session.mjs";

// "core=core:,app=cli:core+lib" → [{role:"core",dir:"core",mayImport:[]},{role:"app",dir:"cli",mayImport:["core","lib"]}]
// 左边的"格"可以省：省了就等于目录名——但目录名和范式不一样时（cli 是 app），必须写清它认领哪一格。
const layersOf = (text) =>
  String(text)
    .split(",")
    .map((one) => one.trim())
    .filter(Boolean)
    .map((one) => {
      const [head, may] = one.split(":");
      const [role, dir] = head.includes("=") ? head.split("=") : [head, head];
      if (!dir || !dir.trim()) throw new Error("分层要写成 格=目录:可以依赖的格（用 + 连）：" + one);
      return {
        role: (role ?? "").trim() || dir.trim(),
        dir: dir.trim(),
        mayImport: (may ?? "").split("+").map((x) => x.trim()).filter(Boolean),
      };
    });

export default function declare(argv) {
  // 工作区可以是项目，也可以只是干活的地方。声明是账本事实：可以改，旧的留在历史里。
  const { flags } = parse(argv, "project");
  guard(() => {
    const { doc } = load();
    const before = doc.project ?? null;
    const shape = flags.shape ?? before?.shape;
    if (!shape) fail('声明成项目要说清是哪一类：deed project --shape software|document|data|work|free');
    const background = flags.background ?? before?.background ?? "";
    const layers = flags.layers === undefined ? before?.layers ?? [] : layersOf(flags.layers);
    const extras =
      flags.extras === undefined
        ? before?.extras ?? []
        : String(flags.extras).split(",").map((one) => one.trim()).filter(Boolean);
    const ev = { k: "project.declare", shape, background, layers, extras, by: "agent" };
    transact(flags, () => ev);
    const after = projectState({ ...doc, project: { shape, background, layers, extras } }, treeOf(ROOT));
    console.log("项目 · " + shape + " · " + after.passed + "/" + after.total + " 条通过");
    if (background.trim() === "") console.log('  背景还空着：deed project --background "这个项目是什么、为谁、不做什么"');
    if (layers.length === 0) console.log('  分层还空着：deed project --layers "core=core:,app=cli:core+lib"');
    if (after.missing.length > 0) console.log("  未通过：" + after.missing.join("、"));
    const { doc: now } = load();
    const step = nextAction(now, now.config);
    console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
  });
}
