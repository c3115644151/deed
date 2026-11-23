import { spawnSync } from "node:child_process";
import { digest } from "../../core/digest.mjs";
import { ROOT, parse, load, fail, guard, list } from "../session.mjs";

export default function gate(argv) {

  // The gates belong to the host: deed knows the list and the order, nothing
  // about what a pass means. Running them is the only thing promised here.
    const { flags, words } = parse(argv, "gate");
    guard(() => {
      const config = load().doc.config ?? {};
      const declared = Object.entries(config.gates ?? {}).filter(([, commands]) => Array.isArray(commands) && commands.length > 0);
      const wanted = words.length > 0 ? words.map((name) => [name, config.gates?.[name]]) : declared;
      if (wanted.length === 0)
        fail(
          "这个工作区没有门：先在 .deed/config.json 的 gates 里写上命令（例如 { \"gates\": { \"commit\": [\"npm test\"] } }），再用 deed init --force --why \"加门\" 把它记进账本",
        );
      for (const [name, commands] of wanted) {
        if (!Array.isArray(commands) || commands.length === 0)
          fail("门 " + name + " 没写命令：账本里的 gates." + name + " 是空数组（改文件后用 deed init --force --why 收进账本）");
        for (const command of commands) {
          console.log("门 " + name + " · " + command);
          const done = spawnSync(command, { cwd: ROOT, shell: true, stdio: "inherit" });
          if (done.status !== 0)
            fail("门 " + name + " 没过：" + command + "（退出码 " + (done.status ?? ("信号 " + done.signal)) + "）");
        }
        console.log("门 " + name + " 过 · " + commands.length + " 条命令");
      }
      if (flags.digest) fail("门不需要 --digest");
    });
};
