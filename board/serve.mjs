// serve: the same page, live. GET only, one port, no writes, no build step.
// The page is rendered per request from the ledger, so a browser refresh can
// never show something the shell command would not.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { UnknownKindError } from "../core/events.mjs";
import { fold } from "../core/fold.mjs";
import { pressure, reading, countIn, currentSession, openSegment, nextAction, pendingAsks, signBlockers } from "../core/rules.mjs";
import { readEvents } from "../lib/store.mjs";
import { currentVersion, unknownKindNotice } from "../lib/version.mjs";
import { wordsNotice } from "../lib/words.mjs";
import { renderBoard, when } from "./render.mjs";

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
    "<pre style=\"background:#f1ece3;padding:.8rem 1rem;overflow:auto\">deed doctor</pre>" +
    "<p style=\"color:#6b6255\">" +
    escape(notice ? notice.headline : (error && error.message ? error.message : error)) +
    "</p>" + (notice ? "<p style=\"color:#6b6255\">" + escape(notice.advice) + "</p>" : "") +
    "</body></html>\n"
  );
}

function zoneOfMachine() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function handler(root) {
  return (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
      res.end("只读：这个面板不接受写入\n");
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
              asks: pendingAsks(session).map((ask) => ask.id),
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
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      // Same zone as the page: one moment must not read two ways on one screen.
      res.write(`event: hello\ndata: ${when(new Date().toISOString(), zoneOfMachine())}\n\n`);
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

export function start(root, port) {
  const server = http.createServer(handler(root));
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`deed: 端口 ${port} 被占用；换一个：deed serve --port ${port + 1}`);
      process.exit(1);
    }
    throw error;
  });
  server.listen(port, "127.0.0.1", () => {
    const actual = server.address().port;
    console.log(`契约页 http://127.0.0.1:${actual}`);
    console.log("  只读：命令由人执行，页面只呈现当前事实");
  });
  return server;
}
