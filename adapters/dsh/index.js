/**
 * deed 的 DSH 适配器：把客户端里真实发生的事交回工作区的账本。
 *
 * 它只做三件机械的事，一个判断都不做：
 *   1. 原文——人说的话由这个钩子交给 `deed say`，agent 不必转述；同一个消息号只交一次。
 *   2. 惯例——每个模型步骤都看着「这一轮留下什么判断就记成要点」这段环境规则（系统提示词段，
 *      不是冒充用户说的话）。
 *   3. 审查——轮次结束时问一句 `deed review --due`：有该审的就起一个审查者（同一个段复用同一个，
 *      期审每次新开），材料是清单与角色包；结论由那个审查者自己敲命令落账，这里不代写。
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

export const name = "deed-dsh";
export const inject = ["sessions", "systemPrompt"];

const CONVENTION =
  "（deed · 环境规则）这个工作区用 deed 记账。每轮结束时，把你这一轮真正留下的判断记成一条要点：" +
  "deed point \"一句话\"（值得记才记，没有就跳过）。原文由宿主交来，你不要转述用户说了什么；" +
  "我的进展写进交付记录（deed submit）或结论（deed review），不记成轮次。";

const REVIEW_TIMEOUT_MS = 30 * 60 * 1000;

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
  const hands = new Map(); // hand → { childId, name }：同一个段的重审交给同一个审查者
  const running = new Set(); // 正在跑的那个会话的审查，防止一轮里反复问
  const inflight = new Set(); // 正在起/正在发的那一个 hand，防止同一份材料被起两次
  const logFile = (root) => path.join(root, ".deed", "tmp", "dsh.log");

  const note = (root, line) => {
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
    // 起子代理要求父 agent 的循环活着（"agent loop is not active" 是它的原话）：
    // 所以只看两种时刻——交付落下时（这一轮还在跑）、下一轮开步时（上一轮结束时错过的那一下）。
    if (event?.type === "task.done" || event?.type === "task.undo" || event?.type === "turn/start") {
      checkDue(session).catch((err) => {
        try {
          const root = session?.header?.cwd;
          if (root) note(root, "审查钩子异步出错 · " + clip(err?.message ?? err, 200));
        } catch {}
      });
      return;
    }
    try {
      if (event?.type !== "user/message") return;
      const source = event.data?.source;
      if (source?.kind !== "user") return; // 系统注入的那几条（指令链、运行时上下文、技能目录）不是人说的
      const root = session?.header?.cwd;
      if (!root || !boundRoot(root)) return;
      const text = (event.data?.content ?? [])
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (!text) return;
      const mid = typeof event.data?.id === "string" ? event.data.id : null;
      if (!mid) return;
      const args = ["say", "--from", "dsh:" + session.id + ":" + mid];
      const run = runDeed(root, args, text);
      if (run.code !== 0) note(root, "say 失败 · " + clip(run.why || run.err || run.out, 200));
    } catch (err) {
      try {
        const root = session?.header?.cwd;
        if (root) note(root, "原文钩子出错 · " + clip(err?.message ?? err, 200));
      } catch {}
    }
  });

  // ---- 2. 惯例 ------------------------------------------------------------------
  // 系统提示词段：模型读的是"环境规则"，不是"用户说的话"。
  ctx.effect(
    () => ctx.systemPrompt.section({ name: "deed:convention", order: 500, text: CONVENTION }),
    "deed-dsh.convention",
  );

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

  const promptFor = (root, due) => {
    const { command, prefix } = deedInvocation(root, config);
    const deed = [command, ...prefix].join(" ");
    const segment = due.kind === "period" ? null : due.segment;
    const verdict = segment
      ? deed + " review --segment " + segment + " --verdict pass --result-all met"
      : deed + " review --all --verdict pass";
    const fail = segment
      ? deed + " review --segment " + segment + " --verdict fail --rework T1,T2 --why \"为什么\""
      : deed + " review --all --verdict fail --rework S01.1 --why \"为什么\"";
    return [
      "你是 deed 的审查者，只回答一件事：这份清单上写的标准，在这一份字节上成立不成立。",
      "",
      "清单（审什么）：" + path.join(root, due.brief),
      "角色包（怎么审）：" + path.join(root, due.guide ?? ""),
      "",
      "先读角色包，再读清单，逐条核；每条给一个判断（达成／未达成／无法判断）与依据（命令、输出、文件:行）。",
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
  const spawnChild = async (subagents, agent, prompt, signal) => {
    if (typeof subagents.startContinuable === "function") {
      const started = await subagents.startContinuable({
        provider: "spawn",
        label: "deed review",
        request: { parent: agent, prompt },
        signal,
      });
      return { childId: started.childId, api: "startContinuable" };
    }
    if (typeof subagents.startActivation === "function") {
      const started = await subagents.startActivation({
        provider: "spawn",
        label: "deed review",
        prompt,
        parent: agent,
        signal,
        delivery: "caller",
      });
      return { childId: started.childId, api: "startActivation", result: started.result };
    }
    const run = await subagents.start("spawn", { label: "deed review", prompt, parent: agent, signal });
    return { childId: run?.childId ?? run?.id, api: "start", result: run?.result };
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
    if (inflight.has(key)) return; // 同一份材料只起一次：并发问两次会起两个审查者
    inflight.add(key);
    try {
      await deliverOnce(root, due, key, { subagents, agent });
    } finally {
      inflight.delete(key);
    }
  };

  const deliverOnce = async (root, due, key, { subagents, agent }) => {
    const known = hands.get(key);
    const text = promptFor(root, due);
    const prompt = [{ type: "text", text }];
    const signal = AbortSignal.timeout(REVIEW_TIMEOUT_MS);

    if (known && typeof subagents.sendMessage === "function") {
      // 同一个段的重审：交给原来那个审查者，它手上还留着上一份。
      try {
        await subagents.sendMessage(agent, known.childId, prompt, { signal });
        note(root, "重审交给 " + known.childId.slice(0, 12) + " · " + (due.segment ?? "整期"));
        return;
      } catch (err) {
        note(root, "重审没送到，另起一个 · " + clip(err?.message ?? err, 160));
        hands.delete(key);
      }
    }

    const started = await spawnChild(subagents, agent, prompt, signal);
    hands.set(key, { childId: started.childId });
    note(root, "起了审查者 · " + started.api + " · " + String(started.childId).slice(0, 12) + " · " + (due.segment ?? "整期"));
    started.result?.then?.(
      (result) => note(root, "审查者收工 · " + clip(result?.stopReason ?? "?", 80)),
      (err) => note(root, "审查者出错 · " + clip(err?.message ?? err, 200)),
    );
  };

  const checkDue = async (session) => {
    const root = session?.header?.cwd;
    if (!root || !boundRoot(root)) return;
    note(root, "轮次结束，问 due");
    if (running.has(session.id)) return;
    running.add(session.id);
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
        return;
      }
      if (!due || due.kind === null) return;
      due.session = session.id;
      if (due.needs === "brief") {
        // 材料还没出：让 deed 自己出（--auto 记下这一份是钩子那一侧写的）。
        const made = due.kind === "period" ? runDeed(root, ["review", "--all", "--auto"]) : runDeed(root, ["review", "--segment", due.segment, "--auto"]);
        if (made.code !== 0) {
          note(root, "出清单失败 · " + clip(made.err || made.out, 200));
          return;
        }
        asked = runDeed(root, ["review", "--due"]);
        try {
          due = JSON.parse(asked.out.split("\n").pop());
        } catch {
          return;
        }
        if (!due || due.kind === null || due.needs !== "verdict") return;
        due.session = session.id;
      }
      await deliver(root, due);
    } catch (err) {
      note(root, "审查钩子出错 · " + clip(err?.message ?? err, 200));
    } finally {
      running.delete(session.id);
    }
  };

}
