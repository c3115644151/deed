import path from "node:path";
import { currentSession, nextAction, configDrift } from "../../core/rules.mjs";
import { DEFAULT_CONFIG, changedPaths, ensureDirs, readConfigFile, writeConfig, writeSnapshot } from "../../lib/store.mjs";
import { BLOCK as AGENTS_BLOCK } from "../../lib/words.mjs";
import { ROOT, sameJson, parse, load, transact, fail, split, show, optionalBlock } from "../session.mjs";

export default function init(argv) {
    const { flags, words } = parse(argv, "init");
    // Printing the block is the only way deed helps a workspace describe it
    // without writing into files it does not own; it must therefore work before
    // init has touched anything, and must not touch anything itself.
    if (flags["print-agents"]) {
      console.log(AGENTS_BLOCK);
      return;
    }
    const p = ensureDirs(ROOT);
    const { doc: before } = load();
    const ledger = before.config;             // 账本里的门槛：规则只认这个
    const disk = readConfigFile(ROOT);        // 磁盘上的草稿：init 收下才算数
    const drift = configDrift(ledger, disk);
    if (ledger && !flags.force) {
      console.log("deed: 这个工作区已经接过钩子（.deed/config.json 在）");
      if (drift.length > 0)
        console.log("  注意：磁盘上的门槛和账本不一致（" + drift.map((one) => one.key).join("、") + "）；规则只认账本，deed verify 会报出来。");
      console.log("  要收下磁盘上的值：deed init --force --why \"为什么改\"");
      console.log("  要改门槛：deed init --force --review \"…\" --exempt \"…\" --why \"为什么改\"（改动会记进账本）");
      for (const line of optionalBlock(ledger ?? disk ?? DEFAULT_CONFIG)) console.log(line);
      return;
    }
    // 这一次没写的开关，就还是工作区原来那个：--force 不许悄悄清掉门槛或门。
    // 值从磁盘上的草稿、账本、默认值里依次取。
    const base = disk ?? ledger;
    const config = {
      review: {
        required: split(flags.review ?? (base?.review?.required ?? DEFAULT_CONFIG.review.required).join(",")),
        exempt: split(flags.exempt ?? (base?.review?.exempt ?? DEFAULT_CONFIG.review.exempt).join(",")),
      },
      gates: base?.gates ?? DEFAULT_CONFIG.gates,
      board: { port: Number(flags.port ?? base?.board?.port ?? DEFAULT_CONFIG.board.port) },
    };
    // 空门槛不是"没配置"：它的意思是"任何改动都要审"。deed 不替你猜目录名，
    // 所以第一次 init 之后要说清楚这层意思是哪来的、要免审该怎么声明。
    if (config.review.required.length === 0 && config.review.exempt.length === 0)
      console.log("  门槛是空的：任何改动都要审。要免审就声明你自己项目的路径：deed init --force --review \"…\" --exempt \"…\" --why \"为什么\"");
    if (!Number.isInteger(config.board.port) || config.board.port < 0 || config.board.port > 65535)
      fail("端口要写成 0–65535 的整数：" + String(flags.port) + "；例如 --port 7317");
    // A ledger with no threshold yet has nothing to compare against: the first
    // init records the baseline, and every change after it has to say why.
    for (const key of ["review", "gates", "board"]) {
      const from = ledger?.[key] ?? null;
      const to = config[key];
      if (sameJson(from, to)) continue;
      if (ledger && !flags.why) fail("改门槛要写清为什么：--why \"…\"（这一改会进账本，谁都能看到）");
      transact(
        {},
        () => ({
          k: "config.change",
          s: null,
          key,
          from,
          to,
          why: flags.why ?? "init 收下的门槛",
          by: flags.by ?? "user",
        }),
        undefined,
        true, // 门槛落盘之前这个目录还不算接过：init 是唯一的例外
      );
    }
    writeConfig(ROOT, config);
    writeSnapshot(ROOT, changedPaths(ROOT).now);
    console.log("deed: 建好 " + path.relative(ROOT, p.dir) + "/（账本、审查清单、配置）");
    console.log("  要审的路径：" + show(config.review.required));
    console.log("  免审的路径：" + show(config.review.exempt));
    const said = flags.said ?? words.join(" ");
    if (said) {
      const { doc } = transact(flags, () => ({ k: "turn", s: null, who: flags.who ?? "user", said }));
      console.log("  记下第一轮，会话 " + currentSession(doc).id + " 已经开出来");
    }
    const after = load().doc;
    const step = nextAction(after, after.config);
    console.log("  下一步 · " + step.who + " · " + step.what + "：" + step.text);
    console.log("  " + step.command);
    for (const line of optionalBlock(config)) console.log(line);
};
