// store: the ledger on disk. Append-only, one line per event, monthly files.

import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/digest.mjs";

export const DEED_DIR = ".deed";

export function paths(root) {
  const dir = path.join(root, DEED_DIR);
  return {
    dir,
    log: path.join(dir, "log"),
    config: path.join(dir, "config.json"),
    review: path.join(dir, "review"),
  };
}

export function ensureDirs(root) {
  const p = paths(root);
  for (const dir of [p.dir, p.log, p.review]) fs.mkdirSync(dir, { recursive: true });
  return p;
}

// 账本里存相对路径，且一律正斜杠：换个系统读这本账，路径还认得。
export const rel = (root, target) => path.relative(root, target).split(path.sep).join("/");

const monthFile = (at) => `${at.slice(0, 7)}.jsonl`;

export function append(root, event) {
  const p = ensureDirs(root);
  fs.appendFileSync(path.join(p.log, monthFile(event.at)), `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

// A batch lands as one write: a plan that says four things either all of them
// happened or none did. Rows can still sit in two monthly files when a batch
// crosses midnight, so group by month and write each group once.
export function appendMany(root, events) {
  if (events.length === 0) return [];
  const p = ensureDirs(root);
  const byMonth = new Map();
  for (const event of events) {
    const file = monthFile(event.at);
    if (!byMonth.has(file)) byMonth.set(file, []);
    byMonth.get(file).push(event);
  }
  for (const [file, rows] of byMonth)
    fs.appendFileSync(path.join(p.log, file), rows.map((one) => JSON.stringify(one) + "\n").join(""), "utf8");
  return events;
}


// Two agents can be told to record at the same moment. Line appends are atomic
// enough, but "read the ledger, decide the next id, append" is not: without a
// lock both sides pick T3. The lock names its holder (pid + start time); it is
// taken over only when that pid is provably gone, so a slow writer is never cut
// and a crashed one does not block the next writer for ten seconds.
const LOCK_WAIT_MS = 10000;
const LOCK_GRACE_MS = 250;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function holderOf(lock) {
  try {
    const info = JSON.parse(fs.readFileSync(lock, "utf8"));
    return { pid: info.pid, start: info.start };
  } catch {
    return null;
  }
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// Two cases, and only two: a lock that does not name a usable holder yet —
// unreadable, or valid JSON without a positive pid — is given a short grace,
// since its writer may be between create and write; a lock whose named holder
// is gone is taken at once. A live holder is never cut, however long it writes.
function abandonable(age, info) {
  if (!Number.isInteger(info?.pid) || info.pid <= 0) return age > LOCK_GRACE_MS;
  return !alive(info.pid);
}

export function withLock(root, fn) {
  const p = ensureDirs(root);
  const lock = path.join(p.log, "lock");
  const deadline = Date.now() + LOCK_WAIT_MS;
  const mine = JSON.stringify({ pid: process.pid, start: Date.now() });
  for (;;) {
    try {
      fs.writeFileSync(lock, mine, { flag: "wx" });
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let age = 0;
      try {
        age = Date.now() - fs.statSync(lock).mtimeMs;
      } catch {
        continue;
      }
      if (abandonable(age, holderOf(lock))) {
        try {
          fs.rmSync(lock, { force: true });
        } catch {
          /* another process got there first */
        }
        continue;
      }
      if (Date.now() > deadline) {
        const info = holderOf(lock);
        throw new Error(
          "账本正被另一个进程占着（.deed/log/lock 由 pid " +
            (info?.pid ?? "?") +
            " 持有，锁龄 " +
            Math.round(age / 1000) +
            " 秒），等它做完再来",
        );
      }
      sleep(20);
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.rmSync(lock, { force: true });
    } catch {
      /* already gone */
    }
  }
}

export function readEvents(root) {
  const p = paths(root);
  if (!fs.existsSync(p.log)) return [];
  const files = fs
    .readdirSync(p.log)
    .filter((name) => /^\d{4}-\d{2}\.jsonl$/.test(name))
    .sort();
  const events = [];
  for (const name of files) {
    const text = fs.readFileSync(path.join(p.log, name), "utf8");
    for (const [index, line] of text.split("\n").entries()) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        throw new Error(`${name} 第 ${index + 1} 行不是合法事件：账本坏了要人来看`);
      }
    }
  }
  // The month in a file name is the writer's clock, not the fact: a machine
  // whose clock went backwards can put a later event in an earlier file. Order
  // by the event's own instant, keeping file order for equal instants.
  return events.sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0));
}

// 门槛的默认值是空的：deed 不知道你的工作区长什么样，替所有工作区写下一串必审目录
// 等于替它们做判断，还会让没被写进去的目录悄悄免审。要免审就由工作区自己声明。
export const DEFAULT_CONFIG = {
  review: { required: [], exempt: [] },
  gates: { commit: [], check: [] },
  board: { port: 7317 },
};

// The file, exactly as written. Drift is measured against this: the merged view
// below fills in defaults, which would hide a key someone deleted by hand.
export function readConfigFile(root) {
  const p = paths(root);
  if (!fs.existsSync(p.config)) return null;
  // Windows 上的编辑器（记事本、VS Code 的旧默认）会在开头写 BOM；JSON.parse 不认它，
  // 而这个文件本来就是要人手动改的，所以读的时候先剥掉，不让编码问题变成"门槛 JSON 坏了"。
  return JSON.parse(fs.readFileSync(p.config, "utf8").replace(/^\uFEFF/, ""));
}

export function writeConfig(root, config) {
  const p = ensureDirs(root);
  fs.writeFileSync(p.config, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

// Where the workspace stood at the last delivery. The review threshold needs the
// paths work actually moved, not the ones a task claims; this snapshot is how
// "actually" is measured without asking the workspace to be a git repository.
// 快照是"上一次交付时工作区停在哪"，不是把本机的草稿也算进去。
const SKIP_DIRS = new Set([".deed", ".git", "node_modules", ".shots", ".tmp", ".archify", ".idea", ".vscode"]);
const MAX_HASH_BYTES = 4_000_000;

// A file too large to hash is not "unchanged", it is "not weighed". It keeps a
// marker made of its size: a new one, or one whose size moved, still reads as a
// change, so a task cannot cover it by declaring only the files it did touch.
// What the marker cannot see is a same-size edit inside such a file; that is the
// one blind spot this snapshot is allowed to have, and it is written down.
const unweighed = (size) => "!size:" + size;

function scanWorkspace(root) {
  const found = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // 名字里带 % 的是没被展开的环境变量（一台输入法把 %SystemDrive%\\… 落进了工作区）。
      // 那不是工作区里的内容，也不该出现在"这次交付动了什么"里。
      if (entry.name.includes("%")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        continue;
      }
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (size > MAX_HASH_BYTES) {
        found.set(relative, unweighed(size));
        continue;
      }
      try {
        found.set(relative, digest(fs.readFileSync(full)));
      } catch {
        // Recorded rather than dropped: a file this delivery could not read is a
        // path it cannot vouch for, and vouching for it silently is the bug.
        found.set(relative, "!unreadable");
      }
    }
  };
  walk(root);
  return found;
}

export function snapshotPath(root) {
  return path.join(ensureDirs(root).dir, "workspace.json");
}

export function readSnapshot(root) {
  try {
    return JSON.parse(fs.readFileSync(snapshotPath(root), "utf8"));
  } catch {
    return {};
  }
}

// Two deliveries can scan at the same moment and land one after the other; the
// second scan may have started before the first one's file existed. Replacing
// the snapshot would then drop a path the other writer just recorded. Merge
// instead: keep an old entry only if the file still hashes to what was recorded,
// and let this scan win wherever it has something to say.
export function writeSnapshot(root, files) {
  const before = readSnapshot(root);
  const merged = new Map(files);
  for (const [file, pinned] of Object.entries(before)) {
    if (merged.has(file)) continue;
    let seen;
    try {
      const full = path.join(root, file);
      const size = fs.statSync(full).size;
      seen = size > MAX_HASH_BYTES ? unweighed(size) : digest(fs.readFileSync(full));
    } catch {
      continue;
    }
    if (seen === pinned) merged.set(file, pinned);
  }
  const ordered = {};
  for (const key of [...merged.keys()].sort()) ordered[key] = merged.get(key);
  fs.writeFileSync(snapshotPath(root), JSON.stringify(ordered, null, 1) + "\n", "utf8");
  return ordered;
}

// Paths that differ from the last snapshot, in either direction: a deleted file
// is a change too, and the ledger records it the same way.
export function changedPaths(root) {
  const before = readSnapshot(root);
  const now = scanWorkspace(root);
  const changed = [];
  for (const [file, digest] of now) if (before[file] !== digest) changed.push(file);
  for (const file of Object.keys(before)) if (!now.has(file)) changed.push(file);
  return { changed: changed.sort(), now };
}
