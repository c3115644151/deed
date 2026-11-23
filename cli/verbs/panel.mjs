import { panelNow, startPanel, stopPanel } from "../panel.mjs";
import { ROOT, parse, reject, fail, guard } from "../session.mjs";

export default function panel(argv) {
    const { flags } = parse(argv, "panel");
    guard(() => {
      if (flags.stop) {
        const one = stopPanel(ROOT);
        if (one.stopped) console.log("面板已停 · 端口 " + one.port);
        else console.log("面板本来就没在跑");
        return;
      }
      panelNow(ROOT)
        .then((now) => {
          if (now.running) {
            console.log("面板 · http://127.0.0.1:" + now.port + " · pid " + now.pid);
            return null;
          }
          return startPanel(ROOT).then((one) => {
            if (!one.running) fail("面板起不来：直接跑 deed serve --port 7317 看它报什么");
            if (one.fellBack) console.log("deed: 端口 " + one.asked + " 被占着；面板改开在 " + one.port);
            console.log("面板 · http://127.0.0.1:" + one.port);
            return null;
          });
        })
        .catch((err) => reject(err?.message ?? String(err)));
    });
};
