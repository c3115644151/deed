import { checkAll, projectState } from "../../core/checks.mjs";
import { treeOf } from "../../lib/tree.mjs";
import { ROOT, guard, load, parse } from "../session.mjs";
import { checkGates, checkLedger } from "../ledger.mjs";

const MARK = { pass: "✓", fail: "✗", na: "—" };

export default function check(argv) {
  // 体检：三件事共用这一个入口——项目状态（默认）、账本能不能重放（--ledger）、
  // 宿主配置的门（--gates）。它不改任何东西；账本坏了或门没过时退出码是 1，
  // 因为这两样是"这个工作区还成不成立"，不是"通过了几条"。
  const { flags, words } = parse(argv, "check");
  guard(() => {
    if (!flags.ledger && !flags.gates) {
      // 账本读不动的时候，后面的检查都没有输入：先把它当作一条事实交进去，
      // 表里的第一条会红，剩下两条显示"前置没成立"，而不是假装通过率是 k/n。
      let doc = null;
      let ledger = { ok: true };
      try {
        doc = load().doc;
      } catch (error) {
        ledger = { ok: false, why: String(error?.message ?? error).split("\n")[0] };
      }
      const tree = treeOf(ROOT);
      const standing = projectState(doc, tree, ledger);
      console.log(
        standing.declared
          ? "项目 · " + standing.shape + " · " + standing.passed + "/" + standing.total + " 条通过"
          : "项目 · 没有声明（工作区模式：三种状态照常，项目级的检查不适用）",
      );
      for (const one of checkAll(doc, tree, ledger))
        console.log("  " + MARK[one.verdict] + " " + one.title + " · " + one.detail + (one.verdict === "fail" ? "\n      修法：" + one.fix : ""));
      if (!ledger.ok) {
        console.log("\n账本读不动：先处理那一行（deed check --ledger 给出文件、行号与唯一修法），再谈这个工作区是不是项目。");
        process.exitCode = 1;
        return;
      }
      if (standing.missing.length > 0)
        console.log("\n未通过 " + standing.missing.length + " 条；它们不挡三种状态，只挡对应的项目级能力。");
      return;
    }
    if (flags.ledger) checkLedger(ROOT);
    if (flags.gates) checkGates(ROOT, words, load().doc.config ?? {});
  });
}
