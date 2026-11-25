import { checkAll, projectState } from "../../core/checks.mjs";
import { treeOf } from "../../lib/tree.mjs";
import { ROOT, guard, load, parse } from "../session.mjs";

const MARK = { pass: "✓", fail: "✗", na: "—" };

export default function check(argv) {
  // 只读：体检层看的是账本与盘上的目录，不写任何东西。
  parse(argv, "check");
  guard(() => {
    const { doc } = load();
    const tree = treeOf(ROOT);
    const standing = projectState(doc, tree);
    console.log(
      standing.declared
        ? "项目 · " + standing.shape + " · " + standing.passed + "/" + standing.total + " 条通过"
        : "项目 · 没有声明（工作区模式：三种状态照常，项目级的检查不适用）",
    );
    for (const one of checkAll(doc, tree))
      console.log("  " + MARK[one.verdict] + " " + one.title + " · " + one.detail + (one.verdict === "fail" ? "\n      修法：" + one.fix : ""));
    if (standing.missing.length > 0)
      console.log("\n未通过 " + standing.missing.length + " 条；它们不挡三种状态，只挡对应的项目级能力。");
  });
}
