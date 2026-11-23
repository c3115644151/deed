// 心跳：轮次是事实的容器。漏记一轮，这一轮做的事就挂不到"当时那句话"上——
// 事实仍然有效，但回看时说不清它是在哪句话之后落下的。
//
// 账本看不见自己漏掉的东西：没发生的事没有事件。所以这里只能看两件外围的事：
// 宿主每轮跑不跑 deed tick（读它的配置，事实），以及账本冷了多久（读本机时钟，
// 只当提示）。两件都只说，不替谁判失职——跑长任务、人离开一会儿都很正常。
import fs from "node:fs";
import path from "node:path";

// 认得的宿主。只列表里写着"怎么跑一条命令"的那种配置；认不得的一律算未接，
// 因为"可能装了"和"确认装了"在账本里没有区别。
const HOOK_FILES = [".claude/settings.json", ".claude/settings.local.json", ".codex/config.toml"];

export function hookNotice(root) {
  const hits = HOOK_FILES.filter((one) => {
    const file = path.join(root, one);
    if (!fs.existsSync(file)) return false;
    try {
      return fs.readFileSync(file, "utf8").includes("deed tick");
    } catch {
      return false;
    }
  });
  if (hits.length > 0) return "已接（" + hits.join("、") + " 每轮会跑 deed tick）";
  return "未接：认得的宿主配置里没有跑 deed tick 的钩子，轮次现在靠 agent 自己想起来";
}

// How long the ledger has sat still. A clock is the only place "now" can come
// from -- the ledger holds the past and nothing else -- so this reads it here
// and nowhere else: fold and the board still never touch a clock.
export function silenceNotice(lastAt, stamp, now = new Date()) {
  if (!lastAt) return null;
  const then = new Date(lastAt);
  if (Number.isNaN(then.getTime())) return null;
  // 向下取整：说"32 分钟前"时，账本至少静了 32 分钟；不会把 30 秒说成 1 分钟。
  const minutes = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 60000));
  const gap = minutes < 1 ? "刚刚" : minutes < 60 ? minutes + " 分钟前" : Math.floor(minutes / 60) + " 小时前";
  return "账本最后一条 " + stamp(lastAt) + "（" + gap + "）";
}
