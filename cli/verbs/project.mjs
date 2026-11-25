import { projectState } from "../../core/checks.mjs";
import { nextAction } from "../../core/rules.mjs";
import { treeOf } from "../../lib/tree.mjs";
import { ROOT, parse, load, transact, fail, guard, signer } from "../session.mjs";

// "core:,lib:core,cli:core+lib" → [{dir:"core",mayImport:[]},{dir:"lib",mayImport:["core"]}]
const layersOf = (text) =>
  String(text)
    .split(",")
    .map((one) => one.trim())
    .filter(Boolean)
    .map((one) => {
      const [dir, may] = one.split(":");
      if (!dir) throw new Error("分层要写成 目录:可以依赖的目录（用 + 连）：" + one);
      return { dir: dir.trim(), mayImport: (may ?? "").split("+").map((x) => x.trim()).filter(Boolean) };
    });

export default function declare(argv) {
  // 工作区可以是项目，也可以只是干活的地方。声明是账本事实：可以改，旧的留在历史里。
  const { flags } = parse(argv, "project");
  guard(() => {
    const { doc } = load();
    const before = doc.project ?? null;
    const shape = flags.shape ?? before?.shape;
    if (!shape) fail('声明成项目要说清是哪一类：deed project --shape software|document|data|work|free --by "谁"');
    const background = flags.background ?? before?.background ?? "";
    const layers = flags.layers === undefined ? before?.layers ?? [] : layersOf(flags.layers);
    const ev = { k: "project.declare", shape, background, layers, by: signer(flags, "声明项目") };
    transact(flags, () => ev);
    const after = projectState({ ...doc, project: { shape, background, layers } }, treeOf(ROOT));
    console.log("项目 · " + shape + " · " + after.passed + "/" + after.total + " 条通过");
    if (background.trim() === "") console.log('  背景还空着：deed project --background "这个项目是什么、为谁、不做什么"');
    if (layers.length === 0) console.log("  分层还空着：deed project --layers \"core:,lib:core\"");
    const { doc: now } = load();
    const step = nextAction(now, now.config);
    console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
  });
}
