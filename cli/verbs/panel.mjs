import { panelNow, restartPanel, startPanel, stopPanel } from "../panel.mjs";
import { ROOT, parse, reject, guard } from "../session.mjs";

// 一条命令只说一件事：那一条页面在哪。没有第二个工作区就有第二条页面的说法，
// 也没有"改开在别处"——一条账本一条页面，这个号被占着就是被占着。
export default function panel(argv) {
  const { flags } = parse(argv, "panel");
  guard(() => {
    if (flags.stop) {
      const one = stopPanel(ROOT);
      if (one.stopped) console.log("面板已停 · 端口 " + one.port);
      else console.log("面板本来就没在跑");
      return;
    }
    // 按原端口重启：请旧的退场，再在原格上起新的。地址不变。
    if (flags.restart) {
      restartPanel(ROOT)
        .then((one) => {
          if (one.running) {
            console.log("面板 · http://127.0.0.1:" + one.port + (one.pid ? " · pid " + one.pid : ""));
            return null;
          }
          reject(one.blocked.why + "（端口 " + one.blocked.port + "）");
          return null;
        })
        .catch((err) => reject(err?.message ?? String(err)));
      return;
    }
    panelNow(ROOT)
      .then((now) => {
        if (now.running) {
          console.log("面板 · http://127.0.0.1:" + now.port + " · pid " + now.pid);
          return null;
        }
        if (now.blocked) {
          reject(now.blocked.why + "（端口 " + now.blocked.port + "）");
          return null;
        }
        return startPanel(ROOT).then((one) => {
          if (one.running) {
            console.log("面板 · http://127.0.0.1:" + one.port + (one.pid ? " · pid " + one.pid : ""));
            return null;
          }
          reject(one.blocked.why + "（端口 " + one.blocked.port + "）");
          return null;
        });
      })
      .catch((err) => reject(err?.message ?? String(err)));
  });
}
