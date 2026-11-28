// serve: the same page, live. GET only, one port, no writes, no build step.
// The page is rendered per request from the ledger, so a browser refresh can
// never show something the shell command would not.

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { UnknownKindError } from "../core/events.mjs";
import { fold } from "../core/fold.mjs";
import { pressure, reading, currentSession } from "../core/policy/session.mjs";
import { countIn } from "../core/policy/task.mjs";
import { openSegment } from "../core/policy/segment.mjs";
import { nextAction } from "../core/policy/step.mjs";
import { signBlockers } from "../core/policy/sign.mjs";
import { readEvents } from "../lib/store.mjs";
import { currentVersion, unknownKindNotice } from "../lib/version.mjs";
import { wordsNotice } from "../lib/words.mjs";
import { renderBoard, when } from "./render.mjs";
import { applyGate } from "./gates.mjs";
import { buildNow, clearPanel, recordPanel } from "../lib/panel.mjs";

function snapshot(root) {
  // A panel that vanishes because one ledger line is malformed is worse than a
  // panel that says so: the caller catches and renders the reason instead.
  const events = readEvents(root);
  const doc = fold(events);
  return { doc, events, config: doc.config };
}

// 两种读不动的原因走两套话：账本比程序新要升级，这一行坏了要挪走。
const escape = (text) => String(text ?? "").replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"));

// /state 与 SSE 只带一句：和页面同一个判断，不另说一套。
const brokenText = (error) => {
  const notice = error instanceof UnknownKindError ? unknownKindNotice(error.kind, error.writer, currentVersion(), error.meaning) : null;
  return notice ? notice.headline + " · " + notice.advice : String(error && error.message ? error.message : error);
};

function brokenPage(error) {
  const notice = error instanceof UnknownKindError ? unknownKindNotice(error.kind, error.writer, currentVersion(), error.meaning) : null;
  const title = notice?.newer ? "账本比 deed 新" : "账本里有读不动的行";
  const lead = notice?.newer
    ? "页面照旧只读：这本账是更新的 deed 写的，升级之后这一行就能读，别删也别挪。"
    : "页面照旧只读，事实停留在最后一次能读通的位置。修法是先定位、再决定：";
  return (
    "<!doctype html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\">" +
    "<title>deed · " + title + "</title></head>" +
    "<body style=\"font:15px/1.7 system-ui;margin:4vh auto;max-width:44rem;padding:0 1.5rem;background:#fbf9f5;color:#1c1a17\">" +
    "<h1 style=\"font-size:1.2rem\">" + title + "</h1>" +
    "<p>" + lead + "</p>" +
    "<pre style=\"background:#f1ece3;padding:.8rem 1rem;overflow:auto\">deed check --ledger</pre>" +
    "<p style=\"color:#6b6255\">" +
    escape(notice ? notice.headline : (error && error.message ? error.message : error)) +
    "</p>" + (notice ? "<p style=\"color:#6b6255\">" + escape(notice.advice) + "</p>" : "") +
    "</body></html>\n"
  );
}

function zoneOfMachine() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

// 这个进程是谁：路径、pid、端口、代码指纹。一个问题就能回答"这条页面是不是这个工作区的、
// 手里的代码是不是最新的"——没有这个答案，端口上坐着谁只能靠猜，猜错就会同时开着两个面板。
let seenBuild = null;
const buildCached = () => {
  const now = Date.now();
  if (seenBuild !== null && now - seenBuild.at < 1000) return seenBuild.build;
  seenBuild = { at: now, build: buildNow() };
  return seenBuild.build;
};

export function identity(root, port) {
  return { deed: true, root: path.resolve(root), pid: process.pid, port, build: buildCached() };
}

// 一条打开的 SSE 流就是"有人在看"：页面连着，人可能在读，不能按闲置收摊。
// 没有连接时，最后一次请求过了 idle 这么久就该退。
export const shouldRetire = ({ streams, lastRequest, idle, now }) => streams === 0 && now - lastRequest >= idle;

export function handler(root, onRequest = () => {}, onRetire = null, onStream = null) {
  return (req, res) => {
    onRequest();
    const url = new URL(req.url, "http://localhost");
    // 让位：这个号要给新代码用了。谁都不是杀手——面板自己收摊，端口随之放开。
    if (req.method === "POST" && url.pathname === "/__deed/retire") {
      const peer = req.socket.remoteAddress ?? "";
      const local = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
      if (!local) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, why: "只在这台机器上让位" }) + "\n");
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, pid: process.pid }) + "\n");
      // 先把话说完再收摊：对方要拿到 200 才会把这一格当成空的。
      setTimeout(() => {
        clearPanel(root, process.pid);
        if (onRetire) onRetire();
        else process.exit(0);
      }, 60);
      return;
    }
    if (url.pathname === "/__deed") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(identity(root, req.socket.localPort), null, 1) + "\n");
      return;
    }
    // 面板只多收一个写入口：/gate（那三个闸）。别的路径照旧只读。
    if (req.method === "POST") {
      if (url.pathname !== "/gate") {
        res.writeHead(405, { allow: "GET, HEAD, POST /gate", "content-type": "text/plain; charset=utf-8" });
        res.end("只读：这个面板只收 /gate 这一处写入\n");
        return;
      }
      // 只在跑它的这台机器上按：来源要是指向它自己的页面，也不许跨站。
      const peer = req.socket.remoteAddress ?? "";
      const local = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
      const origin = req.headers.origin ?? "";
      const host = req.headers.host ?? "";
      const same = !origin || origin.replace(/^https?:\/\//u, "") === host;
      if (!local || !same) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, why: "这个闸只在这台机器上的这一页里按" }) + "\n");
        return;
      }
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 8192) req.destroy();
      });
      req.on("end", () => {
        let asked;
        try {
          asked = body ? JSON.parse(body) : {};
        } catch {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, why: "看不懂这一行" }) + "\n");
          return;
        }
        try {
          const { ev } = applyGate(root, asked);
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify({ ok: true, kind: ev.k, by: ev.by, via: ev.via }) + "\n");
        } catch (error) {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, why: String(error.message ?? error) }) + "\n");
        }
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD, POST /gate", "content-type": "text/plain; charset=utf-8" });
      res.end("只读：这个面板只收 /gate 这一处写入\n");
      return;
    }
    if (url.pathname === "/") {
      let html;
      try {
        const { doc, events, config } = snapshot(root);
        // The notice is an input, not a lookup: the page still renders from what
        // the caller hands it, so the same facts always produce the same bytes.
        html = renderBoard(doc, config, { zone: zoneOfMachine(), events: events.length, notice: wordsNotice(root) });
      } catch (error) {
        res.writeHead(500, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(req.method === "HEAD" ? "" : brokenPage(error));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? "" : html);
      return;
    }
    if (url.pathname === "/state") {
      let taken;
      try {
        taken = snapshot(root);
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(req.method === "HEAD" ? "" : JSON.stringify({ broken: brokenText(error) }, null, 2));
        return;
      }
      const { doc, events, config } = taken;
      const session = currentSession(doc);
      const segment = openSegment(session);
      const body = {
        reading: reading(doc),
        next: nextAction(doc, config),
        session: session
          ? {
              id: session.id,
              opened: session.openedAt,
              turns: session.turns.length,
              segment: segment ? { id: segment.id, ...countIn(session, segment) } : null,
              sign: signBlockers(doc, session, config),
              pressure: pressure(session),
            }
          : null,
        events: events.length,
        turns: doc.sessions.reduce((sum, one) => sum + one.turns.length, 0),
      };
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? "" : JSON.stringify(body, null, 2));
      return;
    }
    if (url.pathname === "/events") {
      if (onStream) onStream(1);
      let closed = false;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      // Same zone as the page: one moment must not read two ways on one screen.
      // hello 带上"这一版代码的指纹"：页面拿它和自己手上那版比，换了就整页重来。
      // 没有这个，面板换代之后页面上还是旧代码（浏览器不会替你重新载入）。
      res.write(`event: hello\ndata: ${JSON.stringify({ at: when(new Date().toISOString(), zoneOfMachine()), build: buildCached() })}\n\n`);
      let timer = null;
      // A workspace that was never initialised has no .deed/log yet: attach when
      // it appears instead of dying with ENOENT on the first request.
      let watcher = null;
      const attach = () => {
        if (watcher) return;
        try {
          watcher = fs.watch(path.join(root, ".deed", "log"), () => {
            // Debounce: one append can arrive as several change notifications.
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = null;
              let count;
              try {
                count = readEvents(root).length;
              } catch (error) {
                // Do not close the stream on a malformed append: the client shows
                // the reason and stays connected for the next good write.
                res.write(`event: broken\ndata: ${brokenText(error).replace(/\n/g, " ")}\n\n`);
                return;
              }
              res.write(`event: change\ndata: ${count}\n\n`);
            }, 60);
          });
          watcher.on("error", () => {
            watcher = null;
          });
        } catch {
          watcher = null;
        }
      };
      attach();
      const waiting = setInterval(attach, 1000);
      const ping = setInterval(() => res.write(": ping\n\n"), 25000);
      const close = () => {
        if (closed) return;
        closed = true;
        if (onStream) onStream(-1);
        clearInterval(ping);
        clearInterval(waiting);
        if (timer) clearTimeout(timer);
        watcher?.close();
        res.end();
      };
      req.on("close", close);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("只有 / 、/state、/events\n");
  };
}

export function start(root, port, onFatal = null, options = {}) {
  let lastRequest = Date.now();
  // 开着页面看的人：SSE 连着就不算闲。它按连接数算，不按请求算——
  // 一条一直连着的 SSE 每 25 秒才写一个 ping，那些 ping 不该被当成请求来续命，
  // 但连接本身在，就是"有人在看"这件事实。
  let streams = 0;
  const server = http.createServer(
    handler(
      root,
      () => {
        lastRequest = Date.now();
      },
      // 让位：由起它的人决定怎么收场。后台拉起来的那个进程直接退；跑在测试里时只关服务，
      // 不把整个测试进程带走。
      () => {
        server.close(() => {
          if (options.exit === false) return;
          process.exit(0);
        });
      },
      (delta) => {
        streams += delta;
        if (streams > 0) lastRequest = Date.now();
      },
    ),
  );
  // 一个工作区只有一个面板，一个面板只占一格端口：这条页面是你收藏的那一条地址。
  // 号被占着就不再换号——换号意味着同时开着两个面板，而"看哪一条"从此变成一个要靠记忆的
  // 问题。占着的时候只有一句该说：这个号在谁手里、要不要把它关掉。
  server.on("error", (error) => {
    if (error.code !== "EADDRINUSE") throw error;
    const body = `deed: 端口 ${port} 被占着，面板不再换号（一个工作区只留一个面板）\n` +
      `  先看清它是谁：curl http://127.0.0.1:${port}/__deed\n` +
      `  是旧面板：deed panel --stop   不是：把它关掉，或改审查设置里的 board.port\n`;
    // 有人在等这条消息（serve 动词、测试）：交给他，由他决定怎么收场；
    // 没人等（后台拉起来的进程）就自己退，别占着不走。
    if (onFatal) {
      onFatal(body);
      return;
    }
    console.error(body);
    process.exit(1);
  });
  // 面板闲着自己退：它跟着命令被拉起来，就没有理由在没人看的时候一直占着一格端口。
  // 有人连着（SSE）不算闲，所以按"最后一次请求"算，不按"最后一个页面"算。
  // 代码换过之后，这个进程手里的渲染是旧的：它自己换掉自己，端口不动。
  // 以前靠"下一条命令发现指纹不符再重启"，可那条命令如果拿不到这个号（比如旧进程还活着），
  // 就只能再开一个——于是两个面板并存。让在位的那一个自己换代，这事就没有第二种结局。
  const buildAtStart = buildNow();
  const auto = setInterval(() => {
    if (buildCached() === buildAtStart) return;
    clearInterval(auto);
    clearInterval(clock);
    server.close(() => {
      clearPanel(root, process.pid);
      const child = spawn(process.execPath, [process.argv[1] ?? "", "serve", "--port", String(port)], {
        cwd: root,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      process.exit(0);
    });
  }, 2000);

  const idle = Number(process.env.DEED_PANEL_IDLE_MIN ?? 30) * 60 * 1000;
  // 该不该收摊是一个判断，节拍只是它多久看一次：抽出来，才能不必靠真实时间验它。
  const retire = () => shouldRetire({ streams, lastRequest, idle, now: Date.now() });
  // 检查间隔随 idle 缩短：生产是 60 秒一次，测试把 idle 调短时也能很快看到结果，
  // 不必为了一个退出分支等上一分钟。
  const tick = Math.min(60 * 1000, Math.max(1000, idle / 2));
  const clock = setInterval(() => {
    if (!retire()) return;
    clearInterval(clock);
    server.close(() => {
      if (options.exit === false) return;
      process.exit(0);
    });
  }, tick);
  server.on("close", () => {
    clearInterval(clock);
    clearInterval(auto);
    clearPanel(root, process.pid);
  });
  const ready = () => {
    const actual = server.address().port;
    // 记号写给下一條命令读：它要凭这个知道页面已经在，不再拉第二个。
    // 记号里带上模块指纹：改了面板代码之后，下一条命令据此把旧的换掉，
    // 不必有人记得"改完要重启"。
    recordPanel(root, { pid: process.pid, port: actual, build: buildNow() });
    lastRequest = Date.now();
    console.log(`契约页 http://127.0.0.1:${actual}`);
    console.log("  只读 + 三个闸：命令由人执行；页面上只有签收与推翻能写账本，按下去记下谁、什么时候");
  };
  server.listen(port, "127.0.0.1", ready);
  return server;
}
