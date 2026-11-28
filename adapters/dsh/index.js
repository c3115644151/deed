/**
 * deed 的 DSH 适配器：把客户端里真实发生的事交回工作区的账本。
 *
 * 它只做三件机械的事，一个判断都不做：
 *   1. 原文——人说的话由这个钩子交给 `deed say`，agent 不必转述；同一个消息号只交一次。
 *   2. 惯例——每个模型步骤都看着「这一轮留下什么判断就记成要点」这段环境规则（系统提示词段，
 *      不是冒充用户说的话）。
 *   3. 审查——两个时候各问一句 `deed review --due`：一轮开头，以及账本动过之后的那次节拍
 *      （作者交完最后一条就再没有"下一轮开头"，只靠轮次开头会让该审的那一步一直挂着）。
 *      有该审的就起一个审查者（同一个段复用同一个，期审每次新开），材料是清单与角色包；
 *      结论由那个审查者自己敲命令落账，这里不代写。
 *
 * 边界（写在代码里，不是写在文档里）：
 *   - 钩子里任何异常都吞掉：适配器不能把这一轮带下来。
 *   - 不读也不改宿主的配置，不替人装东西。
 *   - 不写三道人闸（签收、判决、议题出口）：那些只有人在面板上按。
 *   - 卸载即无残留：只写工作区自己的 .deed/。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pollVerdicts } from "./verdicts.mjs";

export const name = "deed-dsh";
export const inject = ["sessions"];

// 每一轮开始前递到眼前的一句：不是常驻系统段，而是跟着"用户这一轮开口"发生的一次询问。
// 这样每一轮都经过一次"这轮有没有值得留下的判断"，而不是靠 agent 自己想起来。
const CONVENTION = [
  "<system-reminder>",
  "deed · 这一轮开始前的一句（环境规则，不是用户说的话）：",
  "1. 这一轮结束时，把你真正留下的判断记成要点：deed point \"一句话\"；没有就跳过。",
  "2. 原文已经由钩子交来（你和用户两边都记了），不要转述谁说了什么。",
  "3. 你的进展写进交付记录（deed submit）或结论（deed review），不记成轮次。",
  "</system-reminder>",
].join("\n");

const REVIEW_TIMEOUT_MS = 30 * 60 * 1000;

// 热重载发生的时候，钩子里还没有任何事件，拿不到工作区路径。记下最近一次见过的那一个，
// 只为在重载那一刻留一行日志——否则"到底重载了没有"只能靠猜。
let lastRoot = null;
let pendingInfo = null; // 只写一次：这次重载之后的第一行日志里带上 hmr 的实况

// 一段消息里的纯文本：reasoning、工具块、图片都不算"说了什么"。
const textOf = (content) =>
  (content ?? [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();

const clip = (value, max = 400) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > max ? text.slice(0, max) + "…" : text;
};

/** 工作区里有没有接过 deed：没有 .deed/ 就不用管这个会话。 */
const boundRoot = (root) => {
  try {
    return fs.existsSync(path.join(root, ".deed"));
  } catch {
    return false;
  }
};

/**
 * 走哪条命令跑 deed：工作区里有 cli/deed.mjs 就用它，否则用 PATH 上的 deed。
 * 注意不能用 process.execPath —— 这个进程是宿主自己（Electron/DSH），不是 node；
 * 拿它去跑脚本等于把宿主再启动一遍。NODE 由环境给，默认 PATH 上的 node。
 */
const NODE = process.env.DEED_NODE || "node";

// 适配器自己躺在 deed 仓库里（adapters/dsh/），所以它的兄弟就是 CLI：
// 装上之后仍然指得到同一个程序，不用先全局安装、也不用把路径抄进配置。
const SIBLING = path.join(import.meta.dirname, "..", "..", "cli", "deed.mjs");

/**
 * 走哪条命令跑 deed。顺序：配置里写的 → 工作区自带的 cli/deed.mjs →
 * 适配器旁边的 CLI（同一个仓库）→ PATH 上的 deed。
 */
const deedInvocation = (root, config) => {
  const exists = (file) => {
    try {
      return Boolean(file) && fs.existsSync(file);
    } catch {
      return false;
    }
  };
  if (typeof config?.deed === "string" && config.deed.trim() !== "")
    return { command: NODE, prefix: [path.resolve(config.deed.trim())] };
  const local = path.join(root, "cli", "deed.mjs");
  if (exists(local)) return { command: NODE, prefix: [local] };
  if (exists(SIBLING)) return { command: NODE, prefix: [SIBLING] };
  return { command: "deed", prefix: [] };
};

export function apply(ctx, config = {}) {
  const live = new Map(); // 会话 id → 活着的 agent（起子代理要用「精确的在线父级」）
  // hand → { childId }：同一个段的重审交给同一个审查者。落盘是因为重启之后内存就空了，
  // 而"这一段一直由同一个人判"这件事不该因为宿主重启而换人。
  const hands = new Map();
  let handsRoot = null;
  const handsFile = (root) => path.join(root, ".deed", "tmp", "hands.json");
  const loadHands = (root) => {
    if (handsRoot === root) return;
    handsRoot = root;
    try {
      const saved = JSON.parse(fs.readFileSync(handsFile(root), "utf8"));
      for (const [key, one] of Object.entries(saved ?? {})) if (one?.childId && !hands.has(key)) hands.set(key, one);
    } catch {
      // 没有就没有：第一次起审查者的时候自然会写出来。
    }
  };
  const saveHands = (root) => {
    try {
      fs.mkdirSync(path.join(root, ".deed", "tmp"), { recursive: true });
      fs.writeFileSync(handsFile(root), JSON.stringify(Object.fromEntries(hands), null, 1), "utf8");
    } catch (err) {
      note(root, "存审查者名册失败 · " + clip(err?.message ?? err, 160));
    }
  };
  const inflight = new Set(); // 正在起/正在发的那一个 hand，防止同一份材料被起两次
  const logFile = (root) => path.join(root, ".deed", "tmp", "dsh.log");

  const note = (root, line) => {
    if (root) lastRoot = root;
    if (pendingInfo !== null && root) {
      line = pendingInfo + " | " + line;
      pendingInfo = null;
    }
    try {
      fs.mkdirSync(path.join(root, ".deed", "tmp"), { recursive: true });
      fs.appendFileSync(logFile(root), new Date().toISOString() + "  " + line + "\n");
    } catch {}
  };

  const runDeed = (root, args, input) => {
    const { command, prefix } = deedInvocation(root, config);
    const run = spawnSync(command, [...prefix, ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, DEED_NO_PANEL: "1" },
      timeout: 30_000,
      input,
    });
    return {
      code: run.status,
      out: String(run.stdout ?? "").trim(),
      err: String(run.stderr ?? "").trim(),
      why: run.error ? String(run.error.message ?? run.error) : "",
    };
  };

  // ---- 1. 原文 ------------------------------------------------------------------
  // 人说的话由钩子交来：话仍是人说的，只是通道写着 hook。同一个消息号交过就不再交。
  ctx.on("session/event", (session, event) => {
    try {
      const root = session?.header?.cwd;
      if (!root || !boundRoot(root)) return;
      if (!session?.header?.parentSession && session?.header?.origin !== "subagent") watch(session);
      // 子代理（审查者）的会话不是这一场对话：它的开场提示词不是人说的，
      // 它的答复也不进账本，惯例也不往它那里塞。
      const sub = session?.header?.parentSession !== undefined || session?.header?.origin === "subagent";
      const type = event?.type;

      // 一轮开始：这一轮要问一次「有没有值得记下的判断」。挂在 turn/start 上而不是
      // 用户消息上——实测 user/message 落在第一个 pre-step 之后，那时注入已经错过了。
      if (type === "turn/start") {
        if (!sub) askPoint.add(session.id);
        // 上一轮排着的那条已经送到：清掉记号，下一批结论才轮得到排队。
        const row = watchers.get(session?.id);
        if (row) row.queued = false;
        checkDue(session).catch((err) => note(root, "审查钩子异步出错 · " + clip(err?.message ?? err, 200)));
        return;
      }

      // 人说的话：记一轮。系统注入的那几条（指令链、运行时上下文、技能目录、deed 自己的提醒）
      // 不是人说的，一律不进账本。
      if (type === "user/message") {
        if (sub) return;
        if (event.data?.source?.kind !== "user") return;
        const text = textOf(event.data?.content);
        const mid = typeof event.data?.id === "string" ? event.data.id : null;
        if (!text || !mid) return;
        askPoint.add(session.id);
        const run = runDeed(root, ["say", "--from", "dsh:" + session.id + ":" + mid], text);
        if (run.code !== 0) note(root, "say 失败 · " + clip(run.why || run.err || run.out, 200));
        return;
      }

      // 我说的话：原文的另一半。只取文本：reasoning 与工具块不进账本。
      if (type === "assistant/message") {
        if (sub) return;
        const message = event.data?.message;
        if (!message || message.role !== "assistant") return;
        const text = textOf(message.content);
        const mid = typeof message.id === "string" ? message.id : null;
        if (!text || !mid) return;
        const run = runDeed(root, ["reply", "--from", "dsh:" + session.id + ":" + mid], text);
        if (run.code !== 0) note(root, "reply 失败 · " + clip(run.why || run.err || run.out, 200));
        return;
      }
    } catch (err) {
      try {
        const root = session?.header?.cwd;
        if (root) note(root, "原文钩子出错 · " + clip(err?.message ?? err, 200));
      } catch {}
    }
  });

  try {
    const hmr = ctx.get("hmr");
    pendingInfo = hmr
      ? "hmr=开 · base=" + String(hmr.baseDir ?? "?") + " · root=" + JSON.stringify(hmr.config?.root ?? null)
      : "hmr=没有这个服务";
  } catch (err) {
    pendingInfo = "hmr=读不到（" + String(err?.message ?? err).slice(0, 60) + "）";
  }

  // 重载了就留一行：这是"存盘即生效"唯一能被验证的证据。
  ctx.on("hmr/reload", () => {
    if (!lastRoot) return;
    try {
      fs.appendFileSync(logFile(lastRoot), new Date().toISOString() + "  适配器已热重载\n");
    } catch {}
  });

  // ---- 2. 惯例：每一轮开口时注入一次 ------------------------------------------------
  // 写在系统段里是"一直在"，挂在用户消息上是"每到一轮就问一次"——后者才会真的形成一道门。
  // 它只跟着人说的话触发：子代理（审查者）没有这一轮，所以不会被这条规则打扰。
  const askPoint = new Set(); // 这一轮已经问过没有：用户一开口就置位，注入之后清掉

  ctx.on("agent/pre-step", async (payload, next) => {
    const decision = await next();
    try {
      const session = payload?.agent?.session;
      const sid = session?.header?.id;
      const root = session?.header?.cwd;
      if (!sid || !root || !boundRoot(root)) return decision;
      if (!askPoint.has(sid)) return decision;
      if (payload?.step !== 1) return decision;
      askPoint.delete(sid);
      const text = CONVENTION;
      return {
        ...decision,
        messages: [
          ...decision.messages,
          {
            role: "user",
            content: [{ type: "text", text }],
            source: { kind: "deed-reminder", form: "snapshot" },
            id: "deed-reminder-" + Date.now(),
          },
        ],
      };
    } catch (err) {
      try {
        const root = payload?.agent?.session?.header?.cwd;
        if (root) note(root, "惯例注入出错 · " + clip(err?.message ?? err, 160));
      } catch {}
      return decision;
    }
  }, { prepend: true });

  // 起子代理要用"精确的在线父级"：agent/created 那一刻抓到它，agent 走了就忘掉。
  ctx.on("agent/created", (agent) => {
    try {
      const id = agent?.session?.header?.id;
      if (id) live.set(id, agent);
      const root = agent?.session?.header?.cwd;
      if (root) note(root, "抓到 agent · " + String(id));
    } catch (err) {
      const root = agent?.session?.header?.cwd;
      if (root) note(root, "抓 agent 出错 · " + clip(err?.message ?? err, 160));
    }
  });

  const handKey = (due) => String(due?.hand ?? "");

  // 这一份清单展开成"### T…"的那些条目就是要判的（沿用的一律压成一行，不展开）。
  // 复审的消息只写这些号，审查者不必把整份清单再读一遍才知道该看哪。
  const redoIds = (root, brief) => {
    try {
      const text = fs.readFileSync(path.join(root, String(brief)), "utf8");
      return [...text.matchAll(/^### (T\d+) /gmu)].map((one) => one[1]);
    } catch {
      return [];
    }
  };

  // 这一段出过几份清单：盘上 S<段>-<时刻>.md 的个数（角色包不算）。
  const countBriefs = (root, segment) => {
    if (!segment) return 1;
    try {
      const dir = path.join(root, ".deed", "review");
      return Math.max(
        1,
        fs.readdirSync(dir).filter((one) => one.startsWith("S" + String(segment).replace(/^S/u, "") + "-") && one.endsWith(".md") && !one.endsWith("-reviewer.md")).length,
      );
    } catch {
      return 1;
    }
  };

  // 第一次：角色包 + 清单，一起读。复审：同一个人接着判，角色包不再发——
  // 上一份他已经读过，重发一遍只是让他把同一段话再读一次。
  const promptFor = (root, due, nth = 1, redo = []) => {
    const { command, prefix } = deedInvocation(root, config);
    const deed = [command, ...prefix].join(" ");
    const segment = due.kind === "period" ? null : due.segment;
    const verdict = segment
      ? deed + " review --segment " + segment + " --verdict pass --result-all met"
      : deed + " review --all --verdict pass";
    const fail = segment
      ? deed + " review --segment " + segment + " --verdict fail --rework T1,T2 --why \"为什么\""
      : deed + " review --all --verdict fail --rework S01.1 --why \"为什么\"";
    if (nth > 1) {
      // 复审：同一个人接着判。角色包、方法、边界他都知道，这里只给这一份的
      // 变量部分——清单在哪、哪几条要判、结论怎么落。多一个字都是让他重读。
      const only = redo.join("、");
      return [
        "这一段还是你在审：第 " + nth + " 份清单。上一份判过的沿用，这次只判" + (only ? "：" + only : "「要重判的」那几条") + "。",
        "清单：" + path.join(root, due.brief),
        "落结论：" + verdict,
        "        " + fail,
      ].join("\n");
    }
    return [
      "你是 deed 的审查者，只回答一件事：这份清单上写的标准，在这一份字节上成立不成立。",
      "",
      "清单（审什么）：" + path.join(root, due.brief),
      "角色包（怎么审）：" + path.join(root, due.guide ?? ""),
      "",
      "先读角色包，再读清单，逐条核；每条给一个判断（达成／未达成／无法判断）与依据（命令、输出、文件:行）。",
      "",
      "结论用命令落（账本只有一个写入口，别直接改账本）：",
      "  " + verdict,
      "不合格：",
      "  " + fail,
      "",
      "不要改工作区里的任何文件：你判的是别人交付的那一份字节。",
    ].join("\n");
  };

  // 不同构建的子代理 API 名字不一样（本机装的是 startContinuable，另一些构建是
  // startActivation/start）。这里按能力挑，挑不到就说清，不猜。
  const spawnChild = async (subagents, agent, prompt, signal, key) => {
    if (typeof subagents.startContinuable === "function") {
      const started = await subagents.startContinuable({
        provider: "spawn",
        // 标签就是这个名字：热重载把内存清空之后，靠它从子代理目录里找回同一个审查者。
        label: key,
        request: { parent: agent, prompt },
        signal,
      });
      // result 一起带回去：它落定的那一刻就是"这个审查者已经收工"，
      // 之后这一段再来一份清单不能再发给他。
      return { childId: started.childId, api: "startContinuable", result: started.result };
    }
    // 本机装的是 startActivation：它要 delivery:"caller" 才把结果交给调用方，
    // 而 dsh-subagent 的 notifySettlement 在 delivery === "caller" 时直接返回——
    // 完成通知根本不会发给父会话（实测：审查者落了结论，主会话什么都没收到）。
    // 所以"叫作者回来"这件事不能靠子代理的完成提示，只能靠账本（见 verdicts.mjs）。
    if (typeof subagents.startActivation === "function") {
      const started = await subagents.startActivation({
        provider: "spawn",
        // 标签用与段绑定的那个名字（不是笼统的 "deed review"）：重启之后靠它从
        // 子代理目录里把同一个审查者找回来，找不到才会另起一个。
        label: key,
        prompt,
        parent: agent,
        signal,
        delivery: "caller",
      });
      return { childId: started.childId, api: "startActivation", result: started.result };
    }
    const run = await subagents.start("spawn", { label: key, prompt, parent: agent, signal });
    return { childId: run?.childId ?? run?.id, api: "start", result: run?.result };
  };

  // 名册上那一份是不是已经有人回答过：账本里 review.log／verdict.pass 带着 brief 路径。
  // 读账本尾巴就够，不必把整本重放一遍。
  const answeredBriefs = (root) => {
    try {
      const dir = path.join(root, ".deed", "log");
      const names = fs.readdirSync(dir).filter((one) => one.endsWith(".jsonl")).sort().slice(-2);
      const seen = [];
      for (const name of names) {
        for (const line of fs.readFileSync(path.join(dir, name), "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.brief && (ev.k === "review.log" || ev.k === "verdict.pass")) seen.push(ev.brief);
          } catch {}
        }
      }
      return seen;
    } catch {
      return [];
    }
  };

  const deliver = async (root, due) => {
    const subagents = ctx.get("subagents") ?? ctx.subagents ?? null;
    // 起子代理要「精确的在线父级」：先问 agent 注册表，再退回事件里抓到的那一个。
    // 不能只靠 agent/created——插件挂得比 agent 晚一步的时候就抓不到。
    const agents = ctx.get("agents");
    const sid = String(due.session ?? "");
    const agent = agents?.get?.(sid) ?? live.get(sid) ?? null;
    if (!subagents || !agent) {
      note(root, "没起审查者 · " + (subagents ? "没有在线 agent（" + sid + "）" : "宿主没有 subagents 服务"));
      return;
    }
    const key = handKey(due);
    loadHands(root);
    if (inflight.has(key)) return; // 同一份材料只起一次：并发问两次会起两个审查者
    // 这个工作区一次只判一件事：手上已经有别人在判（他的那一份还没被回答），就等它落结论。
    // 同时起好几个审查者，先是消息排队，接着就是"判 → 叫醒 → 再判"的轮子。
    // 已经回答过的那一份不算"在判"：那个审查者是空闲的，同一段的新一份还要发回给他。
    const answered = answeredBriefs(root);
    const busy = [...hands.entries()].filter(([, one]) => one.brief && !answered.includes(one.brief));
    if (busy.length > 0 && !busy.some(([old]) => old === key)) {
      note(root, "已经有人在判（" + busy.map(([old]) => old).join("、") + "） · 等它落结论 · 不再另起");
      return;
    }

    // 重载或重启之后内存里的那张表没了：先去父会话的子代理目录里找同名的那一个。
    // 找回来就接着给它发消息，而不是另起一个——同一份材料不该有两个读者。
    if (!hands.has(key) && typeof subagents.listChildren === "function") {
      try {
        const rows = await subagents.listChildren(sid, AbortSignal.timeout(5000));
        // 目录行在有的构建里 kind 是 null，但 label 与 id 稳定：按 label 认，不认 kind。
        const hit = rows.find((row) => row?.label === key && row?.id);
        if (hit?.id) {
          hands.set(key, { childId: hit.id });
          note(root, "找回了审查者 · " + String(hit.id).slice(0, 12) + " · " + key);
        }
      } catch (err) {
        note(root, "找审查者失败（照常新起） · " + clip(err?.message ?? err, 160));
      }
    }
    inflight.add(key);
    try {
      await deliverOnce(root, due, key, { subagents, agent });
    } finally {
      inflight.delete(key);
    }
  };

  const deliverOnce = async (root, due, key, { subagents, agent }) => {
    const known = due.kind === "period" ? null : hands.get(key);
    // 这一段已经出过几份清单：第二份起只发增量（角色包不再重发）。
    // 数盘上的清单文件（S02.20-<时刻>.md），不新造一条命令去问账本。
    const which = countBriefs(root, due.segment);
    const text = promptFor(root, due, which, redoIds(root, due.brief));
    const prompt = [{ type: "text", text }];
    const signal = AbortSignal.timeout(REVIEW_TIMEOUT_MS);

    if (known && known.brief === due.brief) {
      // 这一份已经在他手上：再发一遍只是让他把同一段话再读一次。
      note(root, "这一份还在他手上 · " + (due.segment ?? "整期"));
      return;
    }
    if (known && typeof subagents.sendMessage === "function") {
      // 同一个人接着判新的一份：只发增量（角色包不再重发），并把这一份记在他名下。
      try {
        await subagents.sendMessage(agent, known.childId, prompt, { signal });
        hands.set(key, { ...known, brief: due.brief });
        saveHands(root);
        note(root, "重审交给 " + known.childId.slice(0, 12) + " · " + (due.segment ?? "整期"));
        return;
      } catch (err) {
        note(root, "重审没送到，另起一个 · " + clip(err?.message ?? err, 160));
        hands.delete(key);
        saveHands(root);
      }
    }

    const started = await spawnChild(subagents, agent, prompt, signal, key);
    hands.set(key, { childId: started.childId, brief: due.brief });
    saveHands(root);
    note(root, "起了审查者 · " + started.api + " · " + String(started.childId).slice(0, 12) + " · " + (due.segment ?? "整期"));
    started.result?.then?.(
      (result) => {
        note(root, "审查者收工 · " + clip(result?.stopReason ?? "?", 80));
        const now = hands.get(key);
        if (now && now.childId === started.childId) {
          hands.delete(key);
          saveHands(root);
        }
      },
      (err) => {
        note(root, "审查者出错 · " + clip(err?.message ?? err, 200));
        const now = hands.get(key);
        if (now && now.childId === started.childId) {
          hands.delete(key);
          saveHands(root);
        }
      },
    );
  };

  const checkDue = async (session) => {
    const root = session?.header?.cwd;
    if (!root || !boundRoot(root)) return;
    note(root, "问 due · " + (session?.id ?? "?"));
    // 并发问两次不会起两个审查者：inflight 与「这一份还在他手上」两道都在 deliver 里。

    try {
      let asked = runDeed(root, ["review", "--due"]);
      if (asked.code !== 0) {
        note(root, "问 due 失败 · " + clip(asked.err || asked.out, 200));
        return;
      }
      let due = null;
      try {
        due = JSON.parse(asked.out.split("\n").pop());
      } catch {
        // 读不出来就说出来：安静地跳过，看起来和"还没到时候"一模一样。
        note(root, "due 读不出来 · " + clip(asked.out || "(空)", 120));
        return;
      }
      note(root, "该谁 · " + (due ? String(due.needs ?? due.kind) + " · " + String(due.segment ?? due.kind) : "空"));
      if (!due || due.kind === null) return;
      due.session = session.id;
      if (due.needs === "brief") {
        // 出清单只在面板上按：审查必须经过人同意，钩子不代按（用户定下的规矩）。
        // 这里说出来就够——面板那一格亮着，人按下去账本才动。
        note(root, "等你按「开始审查」 · " + String(due.segment ?? due.kind));
        return;
      }
      await deliver(root, due);
    } catch (err) {
      note(root, "审查钩子出错 · " + clip(err?.message ?? err, 200));
    }
  };

  // 结论落下之后回到作者那一步：账本尾巴上出现结论 → 在作者那个会话里开一轮。
  // 子代理的完成通知回的是它自己的父会话，主会话这边收不到，所以盯账本。
  // 账本动没动：一次 readdir + stat，够便宜，也够准（只在写入之后变）。
  const ledgerStamp = (root) => {
    try {
      const dir = path.join(root, ".deed", "log");
      let last = "";
      let size = 0;
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".jsonl")) continue;
        const st = fs.statSync(path.join(dir, name));
        size += st.size;
        last = name;
      }
      return last + ":" + size;
    } catch {
      return null;
    }
  };

  const watchers = new Map(); // 会话 id → { watermark }

  const watch = (session) => {
    const id = session?.id;
    const root = session?.header?.cwd;
    if (!id || !root || !boundRoot(root)) return;
    if (watchers.has(id)) return;
    // 这条线从此刻起算：之后再写的行才算"新"，之前的一律不重播。
    const state = { watermark: null, since: new Date().toISOString() };
    watchers.set(id, state);
    const timer = setInterval(() => {
      void (async () => {
        const agents = ctx.get("agents");
        const agent = agents?.get?.(id) ?? live.get(id) ?? null;
        try {
          await pollVerdicts({ root, agent, state, log: (line) => note(root, line) });
        } catch (err) {
          note(root, "盯结论出错 · " + clip(err?.message ?? err, 160));
        }
        // 出清单不能只等人开口：作者交完最后一条之后就再没有"下一轮开头"了，
        // 该审的那一步会一直挂在原地，而人和作者都以为它在跑。所以这里跟同一个节拍问一次——
        // 但只在账本动过之后问：没动过就没有答案会变，白起一个 node 进程不值。
        const stamp = ledgerStamp(root);
        if (stamp !== null && stamp !== state.ledger) {
          state.ledger = stamp;
          checkDue(session).catch((err) => note(root, "问 due 出错 · " + clip(err?.message ?? err, 160)));
        }
      })();
    }, 4000);
    timer.unref?.();
    pollTimers.set(id, timer);
  };

  const pollTimers = new Map();
  const stopWatch = (id) => {
    const timer = pollTimers.get(id);
    if (timer) clearInterval(timer);
    pollTimers.delete(id);
    watchers.delete(id);
  };
  ctx.effect(() => () => {
    for (const id of [...pollTimers.keys()]) stopWatch(id);
  });

}

