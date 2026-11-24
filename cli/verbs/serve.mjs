import { start } from "../../board/serve.mjs";
import { ROOT, parse, load, fail, guard } from "../session.mjs";

export default function serve(argv) {
    const { flags } = parse(argv, "serve");
    guard(() => {
      const { doc } = load();
      // Serving a directory that never took the hook would create .deed just to
      // render an empty board, leaving a workspace that looks initialised.
      if (!doc.config) fail("这个目录还没接 deed：" + ROOT + " 里没有账本审查设置，先 deed init");
      const port = Number(flags.port ?? doc.config.board.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535)
        fail("端口要写成 0–65535 的整数：" + String(flags.port) + "；例如 deed serve --port 7317");
      start(ROOT, port);
    });
};
