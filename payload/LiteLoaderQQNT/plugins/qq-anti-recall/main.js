const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, ipcMain, dialog } = require("electron");
const { ImageStore } = require("./imageStore.js");
const { ImgDownloader } = require("./imgDownloader.js");
const { PriorityTaskQueue } = require("./priorityTaskQueue.js");
const {
  collectCommandNames,
  collectImageDownloadCompletions,
  collectMessageRecords,
  collectRecentContactTargets,
} = require("./eventParser.js");

var configFilePath = "";
var pluginDataDir = path.join(LiteLoader.path.data, "anti_recall");
const recalledDbPath = path.join(pluginDataDir, "qq-recalled-db");

const imageStore = new ImageStore(pluginDataDir, getRecordId);
const imgDownloader = new ImgDownloader();
const Level = require("level-party");
var db = null;

var sampleConfig = {
  mainColor: "#ff6d6d",
  saveDb: false,
  enableShadow: true,
  enableTip: true,
  isAntiRecallSelfMsg: false,
  maxMsgSaveLimit: 10000,
  deleteMsgCountPerTime: 500,
};

var nowConfig = {};

function initConfig() {
  fs.writeFileSync(
    configFilePath,
    JSON.stringify(sampleConfig, null, 2),
    "utf-8"
  );
}

function loadConfig() {
  if (!fs.existsSync(configFilePath)) {
    initConfig();
    return sampleConfig;
  } else {
    return JSON.parse(fs.readFileSync(configFilePath, "utf-8"));
  }
}

async function onLoad() {
  if (!fs.existsSync(pluginDataDir)) {
    fs.mkdirSync(pluginDataDir, { recursive: true });
  }
  // Session images are only a short-lived buffer for messages that might be
  // recalled. Remove leftovers from a previous crash before starting anew.
  imageStore.initializeSession();
  configFilePath = path.join(pluginDataDir, "config.json");
  nowConfig = loadConfig();

  if (nowConfig.mainColor == null) {
    nowConfig.mainColor = "#ff6d6d";
  }
  if (nowConfig.enableShadow == null) {
    nowConfig.enableShadow = true;
  }
  if (nowConfig.enableTip == null) {
    nowConfig.enableTip = true;
  }
  fs.writeFileSync(configFilePath, JSON.stringify(nowConfig, null, 2), "utf-8");

  ipcMain.handle(
    "LiteLoader.anti_recall.getNowConfig",
    async (event, message) => {
      return nowConfig;
    }
  );

  ipcMain.handle(
    "LiteLoader.anti_recall.getRecalledMsgIds",
    async () => {
      await recalledDbIndexReady.catch(() => {});
      return getKnownRecalledIds();
    }
  );

  ipcMain.handle(
    "LiteLoader.anti_recall.getRecalledGroupImageIds",
    async () => {
      await recalledDbIndexReady.catch(() => {});
      // Kept under the old IPC name for compatibility with already installed
      // preload scripts. The index now covers every persisted group recall,
      // including text-only messages whose native QQ bubble became a gray tip.
      return Array.from(persistedRecalledGroupIds);
    }
  );

  ipcMain.handle(
    "LiteLoader.anti_recall.getRecalledGroupImages",
    async (event, msgId) => {
      await recalledDbIndexReady.catch(() => {});
      return getRecalledGroupImagePayloads(String(msgId || ""));
    }
  );

  ipcMain.handle("LiteLoader.anti_recall.saveConfig", async (event, config) => {
    nowConfig = config;
    sendChatWindowsMessage("LiteLoader.anti_recall.mainWindow.repatchCss");
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), "utf-8");
  });

  if (nowConfig.saveDb) {
    db = Level(recalledDbPath, {
      valueEncoding: "json",
    });

    recalledDbIndexReady = new Promise((resolve) => {
      let settled = false;
      let scanStarted = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timeout = setTimeout(finish, 5000);
      if (timeout.unref) timeout.unref();
      const scanPersistedIndex = () => {
        if (scanStarted) return;
        scanStarted = true;
        setImmediate(() => {
        loadPersistedRecallIndex()
          .catch((error) => output("Load persisted recall index failed:", error?.message || error))
          .finally(() => {
            clearTimeout(timeout);
            finish();
          });
        });
      };
      if (typeof db.once === "function") db.once("leader", scanPersistedIndex);
      db.open((e) => {
      if (e !== undefined && e !== null) {
        // app.whenReady().then(() => {
        //   dialog
        //     .showMessageBox({
        //       type: "warning",
        //       title: "警告",
        //       message:
        //         "打开反撤回数据库失败，可能是上次QQ进程未完全退出。建议关闭QQ并彻底结束QQ进程，再重启QQ，否则反撤回消息无法正常保存（即使反撤回仍生效，只是重启QQ后会丢失）。",
        //       buttons: ["继续打开QQ", "关闭QQ"],
        //     })
        //     .then((r) => {
        //       if (r.response == 1) {
        //         app.exit();
        //       }
        //     });
        // });
        output(
          "打开数据库失败，可能是QQ进程未完全退出。请查看下面详细错误信息中的cause部分：",
          e
        );
        clearTimeout(timeout);
        finish();
        return;
      }
      // Standard Level-compatible implementations do not emit level-party's
      // leader event. Scan immediately once they report a successful open.
      if (typeof db.isLeader !== "function" && typeof db.forward !== "function") {
        scanPersistedIndex();
      }
      });
    });
  }
  ipcMain.handle("LiteLoader.anti_recall.clearDb", async (event, message) => {
    return dialog
      .showMessageBox({
        type: "warning",
        title: "警告",
        message: "清空所有已储存的撤回消息后不可恢复，是否确认清空？",
        buttons: ["确定", "取消"],
        cancelId: 1,
      })
      .then(async (idx) => {
        //第一个按钮
        if (idx.response == 0) {
          clearingStoredMessages = true;
          try {
            await Promise.allSettled(imageTaskQueue.allPromises());
            if (db != null) await db.clear();
            else fs.rmSync(recalledDbPath, { recursive: true, force: true });
            persistedRecallIndex.clear();
            persistedRecallIdsByPeer.clear();
            persistedRecalledGroupIds.clear();
            imageStore.clearPersisted();
          } finally {
            clearingStoredMessages = false;
          }
          dialog.showMessageBox({
            type: "info",
            title: "提示",
            message:
              "清空完毕，之前保存的所有已撤回消息均被删除，重启QQ后就能看见效果。",
            buttons: ["确定"],
          });
        }
      });
  });

  app.on("quit", async () => {
    imageStore.clearSession();
    if (db != null) {
      output("Closing db...");
      await db.close();
    }
  });
}

const DIAGNOSTIC_MAX_BYTES = 1024 * 1024;
const nativeMainChannelPattern = /^RM_IPCFROM_MAIN\d*$/;
const preservedRecallKeys = new Set([
  "msgSeq",
  "cntSeq",
  "clientSeq",
  "sendStatus",
  "emojiLikesList",
]);
const mergeRecallKeys = new Set(["msgAttrs", "msgMeta", "generalFlags"]);

// All BrowserWindows share this cache. QQ can route background/group events through
// hidden or notification windows that never navigate to #/main/message or #/chat.
const msgFlow = new Map();
const recalledMsg = new Map();
const proactiveFetches = new Map();
const persistedRecallIndex = new Map();
const persistedRecallIdsByPeer = new Map();
const persistedRecalledGroupIds = new Set();
const imageDownloadWaiters = new Map();
const recallImageFetchAttempts = new Map();
let clearingStoredMessages = false;
let recalledDbIndexReady = Promise.resolve();
const patchedWebContents = new WeakSet();
const mainWindowObjs = [];
const diagnosticPath = path.join(pluginDataDir, "global-capture-events.jsonl");
const PROACTIVE_FETCH_RETRY_MS = [0, 150, 650];
const MAX_PROACTIVE_FETCHES = 5000;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 15000;
const MAX_IMAGE_DOWNLOAD_TIMEOUT_MS = 90 * 1000;
const ESTIMATED_IMAGE_BYTES_PER_SECOND = 512 * 1024;
const RECALL_IMAGE_WAIT_BUDGET_MS = 1200;
const MAX_RECALL_IMAGE_FETCHES_PER_EVENT = 3;
const RECALL_IMAGE_FETCH_RETRY_MS = 60 * 1000;
const MAX_RENDER_FALLBACK_IMAGE_BYTES = 30 * 1024 * 1024;
const DIRECT_IMAGE_FALLBACK_DELAY_MS = 1500;
const DIRECT_IMAGE_FALLBACK_TIMEOUT_MS = 15 * 1000;
const EARLY_IMAGE_CAPTURE_MAX_AGE_MS = 15 * 60 * 1000;
const EARLY_IMAGE_CAPTURE_MAX_EXPLICIT_PER_EVENT = 12;
const EARLY_IMAGE_CAPTURE_MAX_OPPORTUNISTIC_PER_EVENT = 3;
const imageTaskQueue = new PriorityTaskQueue({ concurrency: 3, maxPending: 48 });

onLoad();

function rememberPersistedRecallEntry(entry) {
  const id = String(entry?.id || getRecordId(entry?.msg) || "");
  if (!id) return;
  const sender = String(entry?.sender || getRecordPeer(entry?.msg) || "");
  const previousSender = persistedRecallIndex.get(id);
  if (previousSender && previousSender !== sender) {
    const previousIds = persistedRecallIdsByPeer.get(previousSender);
    previousIds?.delete(id);
    if (previousIds?.size === 0) persistedRecallIdsByPeer.delete(previousSender);
  }
  persistedRecallIndex.set(id, sender);
  if (sender) {
    let ids = persistedRecallIdsByPeer.get(sender);
    if (!ids) {
      ids = new Set();
      persistedRecallIdsByPeer.set(sender, ids);
    }
    ids.add(id);
  }
  if (Number(entry?.msg?.chatType) === 2 && recordHasGroupFallbackContent(entry.msg)) {
    persistedRecalledGroupIds.add(id);
  } else {
    persistedRecalledGroupIds.delete(id);
  }
}

function getKnownRecalledIds(peerUid = "") {
  const peer = String(peerUid || "");
  const ids = peer
    ? new Set(persistedRecallIdsByPeer.get(peer) || [])
    : new Set(persistedRecallIndex.keys());
  for (const [id, entry] of recalledMsg) {
    if (!peer || !entry?.sender || String(entry.sender) === peer) ids.add(id);
  }
  return Array.from(ids);
}

function loadPersistedRecallIndex() {
  return new Promise((resolve, reject) => {
    if (db == null || typeof db.createValueStream !== "function") {
      resolve();
      return;
    }
    let stream;
    try {
      stream = db.createValueStream();
    } catch (error) {
      reject(error);
      return;
    }
    stream.on("data", rememberPersistedRecallEntry);
    stream.once("error", reject);
    stream.once("end", () => {
      sendChatWindowsMessage(
        "LiteLoader.anti_recall.mainWindow.recallTipList",
        getKnownRecalledIds()
      );
      resolve();
    });
  });
}

function insertDb(msg) {
  if (db == null || clearingStoredMessages || msg?.id == null) return;
  db.put(String(msg.id), msg, (error) => {
    if (error) output("Persist recalled message failed:", error);
    else rememberPersistedRecallEntry(msg);
  });
}

async function getMsgById(id) {
  if (db == null || id == null) return null;
  try {
    return await db.get(String(id));
  } catch (error) {
    if (error?.status != 404 && error?.notFound !== true) output(error);
    return null;
  }
}

function getImageDownloadTimeout(expectedBytes) {
  const bytes = Math.max(0, Number(expectedBytes) || 0);
  const estimate = Math.ceil(bytes / ESTIMATED_IMAGE_BYTES_PER_SECOND) * 1000 + 30 * 1000;
  return Math.min(MAX_IMAGE_DOWNLOAD_TIMEOUT_MS, Math.max(30 * 1000, estimate));
}

function cloneForCache(value, depth = 0, seen = new WeakMap()) {
  if (value == null || typeof value !== "object" || depth > 14) return value;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Map) {
    const result = new Map();
    seen.set(value, result);
    for (const [key, item] of value) {
      result.set(key, cloneForCache(item, depth + 1, seen));
    }
    return result;
  }
  const result = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "function") result[key] = cloneForCache(item, depth + 1, seen);
  }
  return result;
}

function getRecallInfo(record) {
  if (!Array.isArray(record?.elements)) return null;
  for (const element of record.elements) {
    const recallInfo = element?.grayTipElement?.revokeElement;
    if (recallInfo) return recallInfo;
  }
  return null;
}

function getRecordId(record) {
  if (record?.msgId != null && String(record.msgId)) return String(record.msgId);
  if (record?.msgSeq == null) return "";
  return [record.chatType || "", record.peerUid || record.peerUin || "", record.msgSeq].join(":");
}

function getRecordPeer(record) {
  return String(record?.peerUid || record?.peerUin || record?.peer?.peerUid || "");
}

function hashDiagnosticId(value) {
  return value ? crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : "";
}

function appendDiagnostic(type, window, commandNames, records, extra = {}) {
  try {
    if (fs.existsSync(diagnosticPath) && fs.statSync(diagnosticPath).size > DIAGNOSTIC_MAX_BYTES) {
      fs.truncateSync(diagnosticPath, 0);
    }
    const rawUrl = String(window?.webContents?.getURL?.() || "");
    const hashIndex = rawUrl.indexOf("#");
    const line = {
      time: new Date().toISOString(),
      type,
      windowId: Number(window?.id) || 0,
      route: (hashIndex === -1 ? rawUrl : rawUrl.slice(hashIndex)).replace(/\?.*$/, "").slice(0, 160),
      commands: commandNames,
      records: records.slice(0, 30).map((record) => ({
        id: hashDiagnosticId(getRecordId(record)),
        peer: hashDiagnosticId(getRecordPeer(record)),
        chatType: Number(record?.chatType) || 0,
        msgType: Number(record?.msgType) || 0,
        recall: Boolean(getRecallInfo(record)),
      })),
      ...extra,
    };
    fs.appendFileSync(diagnosticPath, JSON.stringify(line) + "\n", "utf8");
  } catch (error) {
    output("Diagnostic log failed:", error?.message || error);
  }
}

function pruneMsgFlow() {
  const max = Math.max(1, Number(nowConfig.maxMsgSaveLimit) || 10000);
  if (msgFlow.size <= max) return;
  let count = Math.max(1, Number(nowConfig.deleteMsgCountPerTime) || 500);
  for (const id of msgFlow.keys()) {
    msgFlow.delete(id);
    if (msgFlow.size <= max || --count <= 0) break;
  }
}

function cacheMessage(record, restoreImagePaths = false) {
  const id = getRecordId(record);
  if (!id || getRecallInfo(record)) return false;
  const cached = { id, sender: getRecordPeer(record), msg: cloneForCache(record) };
  if (restoreImagePaths) imageStore.normalizeRecord(cached.msg);
  // Refresh insertion order so recently observed records survive pruning.
  msgFlow.delete(id);
  msgFlow.set(id, cached);
  pruneMsgFlow();
  return true;
}

async function getRecalledGroupImagePayloads(msgId) {
  if (!msgId) return [];
  const found = await findCachedMessage(msgId);
  const record = found?.entry?.msg;
  // The native renderer already handles persisted private images correctly.
  // Keep the fallback scoped to group messages so text/private behavior stays
  // untouched.
  if (!record || Number(record.chatType) !== 2 || !recordHasGroupFallbackContent(record)) return [];
  imageStore.normalizeRecord(record);
  const payloads = [];
  for (const [index, element] of record.elements.entries()) {
    const pic = element?.picElement;
    if (!pic) continue;
    const filePath = imageStore.validPreservedPath(record, element, index);
    if (!filePath) continue;
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size <= 100 || stat.size > MAX_RENDER_FALLBACK_IMAGE_BYTES) continue;
    try {
      payloads.push({
        fileUrl: imageStore.fileUrl(filePath),
        width: Math.max(0, Number(pic.picWidth) || 0),
        height: Math.max(0, Number(pic.picHeight) || 0),
        fileName: String(pic.fileName || path.basename(filePath)),
      });
    } catch (error) {
      output("Read persisted group image failed:", error?.message || error);
    }
  }
  const text = record.elements
    .map((element) => String(element?.textElement?.content || ""))
    .join("")
    .trim();
  const common = {
    senderName: String(
      record.sendMemberName || record.sendNickName || record.sendRemarkName ||
      record.senderName || record.senderNickName || "群成员"
    ),
    senderUid: String(record.senderUid || record.senderUin || ""),
    senderUin: String(record.senderUin || ""),
    avatarUrl: record.senderUin
      ? `https://q.qlogo.cn/headimg_dl?dst_uin=${encodeURIComponent(String(record.senderUin))}&spec=100&img_type=jpg`
      : "",
    text,
    hasImage: imageStore.hasImages(record),
  };
  // This payload is also used for text-only group recalls. For image messages,
  // `unavailable` distinguishes a genuinely missing archive from a text card.
  if (!payloads.length) return [{
    ...common,
    fileUrl: "",
    unavailable: common.hasImage,
  }];
  return payloads.map((payload, index) => ({
    ...payload,
    ...common,
    text: index === 0 ? text : "",
  }));
}

function recordHasGroupFallbackContent(record) {
  return Array.isArray(record?.elements) && record.elements.some(
    (element) => element?.picElement || element?.textElement
  );
}

function isRecentMessageRecord(record) {
  let timestamp = Number(record?.msgTimeMs || record?.msgTime || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  if (timestamp < 1e12) timestamp *= 1000;
  const age = Date.now() - timestamp;
  return age >= -60 * 1000 && age <= EARLY_IMAGE_CAPTURE_MAX_AGE_MS;
}

function enqueueEarlyImageCapture(window, record, priority = false) {
  const queued = queueRecordImages(window, record, {
    priority: priority ? "high" : "low",
  });
  queued.promise.catch((error) => output("Early image preservation failed:", error?.message || error));
  return queued.accepted;
}

function getImageDownloadKey(msgId, elementId) {
  return `${String(msgId || "")}:${String(elementId || "")}`;
}

function createImageDownloadWaiter(msgId, elementId, timeoutMs = IMAGE_DOWNLOAD_TIMEOUT_MS) {
  const key = getImageDownloadKey(msgId, elementId);
  let waiter;
  const promise = new Promise((resolve) => {
    waiter = {
      settled: false,
      resolve,
      settle,
      timer: setTimeout(() => settle(null), timeoutMs),
    };
    let waiters = imageDownloadWaiters.get(key);
    if (!waiters) {
      waiters = new Set();
      imageDownloadWaiters.set(key, waiters);
    }
    waiters.add(waiter);
  });
  function settle(value) {
    if (!waiter || waiter.settled) return false;
    waiter.settled = true;
    clearTimeout(waiter.timer);
    const waiters = imageDownloadWaiters.get(key);
    waiters?.delete(waiter);
    if (waiters?.size === 0) imageDownloadWaiters.delete(key);
    waiter.resolve(value);
    return true;
  }
  return { promise, settle, cancel: () => settle(null) };
}

function resolveImageDownloadCompletions(window, commandNames, args) {
  if (!commandNames.some((name) => /onRichMediaDownloadComplete$/i.test(name))) return;
  const completions = collectImageDownloadCompletions(args);
  for (const completion of completions) {
    const key = getImageDownloadKey(completion.msgId, completion.elementId);
    const waiters = imageDownloadWaiters.get(key);
    if (!waiters?.size) continue;
    for (const waiter of Array.from(waiters)) waiter.settle(completion);
    appendDiagnostic("image-preserve-signaled", window, commandNames, [], {
      target: {
        id: hashDiagnosticId(completion.msgId),
        element: hashDiagnosticId(completion.elementId),
      },
      errorCode: Number.isFinite(completion.errorCode) ? completion.errorCode : -1,
      hasPath: Boolean(completion.filePath),
    });
  }
}

function firstSuccessfulPath(promises) {
  return new Promise((resolve) => {
    let pending = promises.length;
    let settled = false;
    if (!pending) return resolve("");
    for (const promise of promises) {
      Promise.resolve(promise).then((value) => {
        if (!settled && value) {
          settled = true;
          resolve(value);
        } else if (--pending === 0 && !settled) {
          resolve("");
        }
      }).catch(() => {
        if (--pending === 0 && !settled) resolve("");
      });
    }
  });
}

function createDirectImageFallback(pic, targetPath, expectedBytes, context = {}) {
  let canceled = false;
  let timer = null;
  let finish = null;
  const controller = new AbortController();
  const promise = new Promise((resolve) => {
    finish = resolve;
    timer = setTimeout(async () => {
      if (canceled || typeof imgDownloader.getImageUrl !== "function" ||
          typeof imgDownloader.downloadToFile !== "function") return resolve("");
      try {
        const imageUrl = await imgDownloader.getImageUrl(pic);
        if (!imageUrl || canceled) {
          appendDiagnostic("image-preserve-direct-url-unavailable", context.window, [], [context.record].filter(Boolean), {
            element: hashDiagnosticId(context.elementId),
          });
          return resolve("");
        }
        let endpoint = {};
        try {
          const parsed = new URL(imageUrl);
          endpoint = { host: parsed.host, appid: parsed.searchParams.get("appid") || "" };
        } catch {
        }
        appendDiagnostic("image-preserve-direct-requested", context.window, [], [context.record].filter(Boolean), {
          element: hashDiagnosticId(context.elementId),
          endpoint,
        });
        let timeout = setTimeout(() => controller.abort(), DIRECT_IMAGE_FALLBACK_TIMEOUT_MS);
        if (timeout.unref) timeout.unref();
        await imgDownloader.downloadToFile(
          imageUrl,
          targetPath,
          MAX_RENDER_FALLBACK_IMAGE_BYTES,
          controller.signal
        ).finally(() => clearTimeout(timeout));
        let bytes = 0;
        try {
          bytes = Number((await fs.promises.stat(targetPath)).size) || 0;
        } catch {
        }
        if (canceled || bytes <= 100 || (expectedBytes > 0 && bytes < Math.min(expectedBytes, 1024))) {
          await fs.promises.unlink(targetPath).catch(() => {});
          appendDiagnostic("image-preserve-direct-invalid", context.window, [], [context.record].filter(Boolean), {
            element: hashDiagnosticId(context.elementId),
            bytes,
            endpoint,
          });
          return resolve("");
        }
        appendDiagnostic("image-preserve-direct-complete", context.window, [], [context.record].filter(Boolean), {
          element: hashDiagnosticId(context.elementId),
          bytes,
          endpoint,
        });
        resolve(targetPath);
      } catch (error) {
        output("Direct recalled image fallback failed:", error?.message || error);
        appendDiagnostic("image-preserve-direct-error", context.window, [], [context.record].filter(Boolean), {
          element: hashDiagnosticId(context.elementId),
          error: String(error?.message || error).slice(0, 200),
        });
        resolve("");
      }
    }, DIRECT_IMAGE_FALLBACK_DELAY_MS);
    if (timer.unref) timer.unref();
  });
  return {
    promise,
    cancel() {
      if (canceled) return;
      canceled = true;
      clearTimeout(timer);
      controller.abort();
      finish?.("");
    },
  };
}

async function runImagePreservation(window, record, element, index, durable) {
  const pic = element?.picElement;
  if (!pic) return "";
  const msgId = getRecordId(record);
  const chatType = Number(record?.chatType);
  const peerUid = String(record?.peerUid || record?.peerUin || "");
  const elementId = String(element?.elementId || "");
  const targetPath = durable
    ? imageStore.preservedPath(record, element, index)
    : imageStore.sessionPath(record, element, index);
  const expectedBytes = Math.max(0, Number(pic.fileSize) || 0);
  const existingPath = imageStore.existingPath(pic);
  const preservedPath = imageStore.validPreservedPath(record, element, index);
  const sessionPath = imageStore.validSessionPath(record, element, index);
  const storedPath = durable ? preservedPath : sessionPath;
  if (storedPath) {
    imageStore.applyPath(pic, storedPath);
    if (!durable) imageStore.trackSession(storedPath);
    return storedPath;
  }

  // A previously recalled image with the same content is already durable and
  // can be reused without creating another session copy.
  if (!durable && preservedPath) {
    imageStore.applyPath(pic, preservedPath);
    return preservedPath;
  }

  if (!msgId || !elementId) {
    const renderPath = existingPath || (durable ? sessionPath : preservedPath);
    if (renderPath) imageStore.applyPath(pic, renderPath);
    return renderPath;
  }

  try {
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      const localSourcePath = existingPath || (durable ? sessionPath : preservedPath);
      if (localSourcePath) {
        const archivedPath = await imageStore.archive(localSourcePath, targetPath, expectedBytes);
        appendDiagnostic(archivedPath ? "image-preserve-local-complete" : "image-preserve-local-incomplete",
          window, [], [record], {
            element: hashDiagnosticId(elementId),
            bytes: archivedPath ? Number(fs.statSync(archivedPath).size) || 0 : 0,
            durable,
          });
        if (archivedPath && durable) imageStore.removeSession(sessionPath);
        if (archivedPath && !durable) imageStore.trackSession(archivedPath);
        return archivedPath;
      }

      if (!Number.isFinite(chatType) || chatType <= 0 || !peerUid) return "";
      const waiter = createImageDownloadWaiter(
        msgId,
        elementId,
        getImageDownloadTimeout(expectedBytes)
      );
      const directFallback = durable && (pic.originImageUrl || pic.md5HexStr)
        ? createDirectImageFallback(pic, targetPath, expectedBytes, {
          window,
          record,
          elementId,
        })
        : null;
      try {
        const requestedPath = typeof pic.sourcePath === "string" && path.isAbsolute(pic.sourcePath)
          ? pic.sourcePath
          : targetPath;
        const invoked = invokeNativeWithoutWaiting(
          window,
          "ntApi",
          "nodeIKernelMsgService/downloadRichMedia",
          [{
            getReq: {
              fileModelId: "0",
              downSourceType: 0,
              downloadSourceType: 0,
              triggerType: 1,
              msgId,
              chatType,
              peerUid,
              elementId,
              thumbSize: 0,
              downloadType: 1,
              filePath: requestedPath,
            },
          }, null]
        );
        appendDiagnostic(invoked ? "image-preserve-requested" : "image-preserve-unavailable", window,
          ["nodeIKernelMsgService/downloadRichMedia"], [record], {
            element: hashDiagnosticId(elementId),
            expectedBytes,
            durable,
          });
        if (!invoked) return "";
        const nativeArchive = waiter.promise.then(async (completion) => {
          const errorCode = Number(completion?.errorCode);
          if (!completion || (Number.isFinite(errorCode) && errorCode !== 0)) return "";
          const completedPath = completion.filePath && path.isAbsolute(completion.filePath)
            ? completion.filePath
            : requestedPath;
          return imageStore.archive(completedPath, targetPath, expectedBytes);
        });
        const archivedPath = await firstSuccessfulPath([
          nativeArchive,
          directFallback?.promise || Promise.resolve(""),
        ]);
        directFallback?.cancel();
        let bytes = 0;
        try {
          bytes = archivedPath ? fs.statSync(archivedPath).size : 0;
        } catch {
        }
        appendDiagnostic(archivedPath ? "image-preserve-complete" : "image-preserve-incomplete", window,
          ["nodeIKernelMsgService/downloadRichMedia"], [record], {
            element: hashDiagnosticId(elementId),
            bytes,
            durable,
          });
        if (archivedPath && durable) imageStore.removeSession(sessionPath);
        if (archivedPath && !durable) imageStore.trackSession(archivedPath);
        return archivedPath;
      } finally {
        waiter.cancel();
        directFallback?.cancel();
      }
  } catch (error) {
      appendDiagnostic("image-preserve-error", window,
        ["nodeIKernelMsgService/downloadRichMedia"], [record], {
          element: hashDiagnosticId(elementId),
          error: String(error?.message || error).slice(0, 200),
        });
    return "";
  }
}

function scheduleImageElement(window, record, element, index, durable, priority) {
  const pic = element?.picElement;
  if (!pic) return { accepted: false, promise: Promise.resolve(true) };
  const msgId = getRecordId(record);
  const elementId = String(element?.elementId || index);
  const targetPath = durable
    ? imageStore.preservedPath(record, element, index)
    : imageStore.sessionPath(record, element, index);
  const scheduled = imageTaskQueue.schedule(
    `${msgId}:${elementId}:${targetPath}`,
    () => runImagePreservation(window, record, element, index, durable),
    priority
  );
  if (!scheduled) return { accepted: false, promise: Promise.resolve(false) };
  const promise = scheduled.promise.then((renderPath) => {
    if (!renderPath) return false;
    imageStore.applyPath(pic, renderPath);
    return true;
  }).catch(() => false);
  return { accepted: scheduled.isNew, promise };
}

function queueRecordImages(window, record, { durable = false, priority = "normal" } = {}) {
  if (!Array.isArray(record?.elements)) return { accepted: false, promise: Promise.resolve(true) };
  const jobs = [];
  let accepted = false;
  for (const [index, element] of record.elements.entries()) {
    if (!element?.picElement) continue;
    const scheduled = scheduleImageElement(window, record, element, index, durable, priority);
    accepted ||= scheduled.accepted;
    jobs.push(scheduled.promise);
  }
  return {
    accepted,
    promise: jobs.length ? Promise.all(jobs).then((results) => results.every(Boolean)) : Promise.resolve(true),
  };
}

function preserveRecordImages(window, record, durable = false, priority = durable ? "high" : "normal") {
  return queueRecordImages(window, record, { durable, priority }).promise;
}

function hasActiveImagePreservation(record) {
  const prefix = `${getRecordId(record)}:`;
  return prefix !== ":" && imageTaskQueue.promisesWithPrefix(prefix).length > 0;
}

async function waitForActiveImagePreservation(record, timeoutMs = 1000) {
  const prefix = `${getRecordId(record)}:`;
  if (prefix === ":") return;
  const tasks = imageTaskQueue.promisesWithPrefix(prefix);
  if (!tasks.length) return;
  await Promise.race([
    Promise.allSettled(tasks),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

function pruneProactiveFetches() {
  while (proactiveFetches.size > MAX_PROACTIVE_FETCHES) {
    proactiveFetches.delete(proactiveFetches.keys().next().value);
  }
}

function invokeNativeWithoutWaiting(window, eventName, cmdName, payload) {
  if (window?.isDestroyed?.() || window?.webContents?.isDestroyed?.()) return false;
  const webContentId = window?.webContents?.id;
  if (webContentId == null || typeof ipcMain.listeners !== "function") return false;
  const requestChannel = `RM_IPCFROM_RENDERER${webContentId}`;
  const listeners = ipcMain.listeners(requestChannel);
  if (!listeners.length) return false;
  const request = {
    peerId: webContentId,
    callbackId: crypto.randomUUID(),
    type: "request",
    eventName,
  };
  const command = { cmdName, cmdType: "invoke", payload };
  const fakeEvent = {
    sender: window.webContents,
    reply: (channel, ...args) => window.webContents.send(channel, ...args),
  };
  for (const listener of listeners) listener(fakeEvent, request, command);
  return true;
}

function scheduleRecentContactFetches(window, commandNames, args) {
  if (!commandNames.some((name) => name.includes("onRecentContactListChangedVer2"))) return;
  const targets = collectRecentContactTargets(args);
  if (!targets.length) return;

  if (targets.length > 5) {
    appendDiagnostic("proactive-fetch-baseline-skipped", window, commandNames, [], {
      targetCount: targets.length,
    });
    return;
  }

  // A first-screen snapshot can contain hundreds of historical contacts. The
  // incremental event normally contains one or only a few newly changed chats.
  const boundedTargets = targets.slice(0, 20);
  for (const target of boundedTargets) {
    if (msgFlow.has(target.msgId) || proactiveFetches.has(target.msgId)) continue;
    const state = { attempts: 0, captured: false };
    proactiveFetches.set(target.msgId, state);
    pruneProactiveFetches();
    appendDiagnostic("proactive-fetch-scheduled", window, commandNames, [], {
      target: {
        id: hashDiagnosticId(target.msgId),
        peer: hashDiagnosticId(target.peerUid),
        chatType: target.chatType,
      },
    });

    for (const delay of PROACTIVE_FETCH_RETRY_MS) {
      setTimeout(() => {
        if (state.captured || msgFlow.has(target.msgId) || window?.isDestroyed?.()) return;
        state.attempts += 1;
        try {
          const invoked = invokeNativeWithoutWaiting(
            window,
            "ntApi",
            "nodeIKernelMsgService/getMsgsByMsgId",
            [{
              peer: {
                chatType: target.chatType,
                peerUid: target.peerUid,
                guildId: target.guildId,
              },
              msgIds: [target.msgId],
            }, null]
          );
          appendDiagnostic(invoked ? "proactive-fetch-requested" : "proactive-fetch-unavailable", window, commandNames, [], {
            target: { id: hashDiagnosticId(target.msgId) },
            attempt: state.attempts,
          });
        } catch (error) {
          appendDiagnostic("proactive-fetch-error", window, commandNames, [], {
            target: { id: hashDiagnosticId(target.msgId) },
            attempt: state.attempts,
            error: String(error?.message || error).slice(0, 200),
          });
        }
      }, delay);
    }
  }
}

async function findCachedMessage(id) {
  if (recalledMsg.has(id)) return { entry: recalledMsg.get(id), source: "recalled" };
  if (msgFlow.has(id)) return { entry: msgFlow.get(id), source: "global-window-cache" };
  const stored = await getMsgById(id);
  return stored ? { entry: stored, source: "database" } : null;
}

function mergeOriginalIntoRecall(recallRecord, originalRecord) {
  for (const key of Object.keys(originalRecord)) {
    if (preservedRecallKeys.has(key)) continue;
    const newValue = originalRecord[key];
    const oldValue = recallRecord[key];
    if (
      mergeRecallKeys.has(key) &&
      newValue &&
      oldValue &&
      typeof newValue === "object" &&
      typeof oldValue === "object" &&
      !(newValue instanceof Map) &&
      !(oldValue instanceof Map)
    ) {
      for (const oldKey of Object.keys(oldValue)) delete oldValue[oldKey];
      Object.assign(oldValue, newValue);
      recallRecord[key] = oldValue;
    } else {
      recallRecord[key] = newValue;
    }
  }
}

async function recoverRecallRecord(record, window, options = {}) {
  const id = getRecordId(record);
  const found = id ? await findCachedMessage(id) : null;
  if (!found?.entry?.msg) return null;
  const entry = found.entry;
  if (!recalledMsg.has(id)) recalledMsg.set(id, entry);
  imageStore.normalizeRecord(entry.msg);
  const hadActiveImageTask = hasActiveImagePreservation(entry.msg);
  if (hadActiveImageTask) {
    await waitForActiveImagePreservation(entry.msg, 1000);
    imageStore.normalizeRecord(entry.msg);
  }
  let imagePreservation = null;
  if (imageStore.hasImages(entry.msg)) {
    imageStore.markSessionRecalled(entry.msg);
    const previousImageFetchAt = recallImageFetchAttempts.get(id) || 0;
    const canRetryImageFetch = Date.now() - previousImageFetchAt >= RECALL_IMAGE_FETCH_RETRY_MS;
    const shouldFetchMissingImage = imageStore.hasUnavailableImages(entry.msg) &&
      options.allowImageFetch !== false && canRetryImageFetch;
    const shouldPromoteLocalImage = imageStore.hasLocalImagesNeedingArchive(entry.msg);
    if (db != null && nowConfig.saveDb && (shouldFetchMissingImage || shouldPromoteLocalImage)) {
      // Only recalled images are promoted from the bounded session cache into
      // durable storage. Missing group images are allowed to self-heal here even
      // when QQ did not emit a small recent-contact update before the recall.
      if (shouldFetchMissingImage) recallImageFetchAttempts.set(id, Date.now());
      imagePreservation = preserveRecordImages(window, entry.msg, true);
      const waitBudgetMs = Math.max(0, Number(options.imageWaitBudgetMs) || 0);
      if (waitBudgetMs > 0) {
        await Promise.race([
          imagePreservation,
          new Promise((resolve) => setTimeout(resolve, waitBudgetMs)),
        ]);
      }
    } else if (shouldFetchMissingImage) {
      recallImageFetchAttempts.set(id, Date.now());
      imagePreservation = preserveRecordImages(window, entry.msg, false);
    }
  }
  imageStore.normalizeRecord(entry.msg);
  // A database/recalled-cache recovery is read-only unless image
  // preservation changes the durable path below. Rewriting every recovered
  // item on each group render causes substantial LevelDB churn.
  if (nowConfig.saveDb && found.source === "global-window-cache") insertDb(entry);
  imagePreservation?.then((success) => {
    imageStore.normalizeRecord(entry.msg);
    if (success && nowConfig.saveDb) {
      insertDb(entry);
      sendChatWindowsMessage("LiteLoader.anti_recall.mainWindow.recalledImageReady", id);
    }
  }).catch(() => {});
  const originalRecord = cloneForCache(entry.msg);
  originalRecord.isOnlineMsg = true;
  mergeOriginalIntoRecall(record, originalRecord);
  return {
    id,
    entry,
    source: found.source,
    imageFetchStarted: Boolean(imagePreservation),
  };
}

function sendChatWindowsMessage(message, ...args) {
  for (const window of mainWindowObjs) {
    if (!window.isDestroyed()) window.webContents.send(message, ...args);
  }
}

function rememberChatWindow(window) {
  if (window.isDestroyed()) return;
  const url = window.webContents.getURL();
  if (!url.includes("#/main/message") && !url.includes("#/chat")) return;
  if (!mainWindowObjs.includes(window)) mainWindowObjs.push(window);
}

function patchWindowSend(window) {
  const webContents = window?.webContents;
  if (!webContents || patchedWebContents.has(webContents)) return;
  patchedWebContents.add(webContents);
  const sendOwner = webContents.__qqntim_original_object || webContents;
  const originalSend = sendOwner.send;
  if (typeof originalSend !== "function") return;

  sendOwner.send = async function (channel, ...args) {
    if (!nativeMainChannelPattern.test(String(channel || ""))) {
      return originalSend.call(webContents, channel, ...args);
    }
    try {
      const records = collectMessageRecords(args);
      const commandNames = collectCommandNames(args);
      resolveImageDownloadCompletions(window, commandNames, args);
      scheduleRecentContactFetches(window, commandNames, args);
      if (records.length) {
        const recalls = [];
        let recallImageFetches = 0;
        let explicitEarlyCaptures = 0;
        let opportunisticEarlyCaptures = 0;
        const recallImageWaitDeadline = Date.now() + RECALL_IMAGE_WAIT_BUDGET_MS;
        for (const record of records) {
          if (getRecallInfo(record)) recalls.push(record);
          else if (cacheMessage(record)) {
            const id = getRecordId(record);
            const proactiveState = proactiveFetches.get(id);
            const cachedEntry = msgFlow.get(id);
            const isIncomingEvent = commandNames.some((name) => /onRecvMsg$/i.test(name));
            // Background group events are not consistently named on QQNT. A
            // recent record is a much safer signal than relying exclusively on
            // `onRecvMsg`: it captures unopened-chat images before a later
            // recall, while the age bound avoids scanning old group history.
            const isExplicitCapture = Boolean(proactiveState || isIncomingEvent);
            const shouldCaptureRecentImage = !isExplicitCapture && isRecentMessageRecord(cachedEntry?.msg);
            const withinEventLimit = isExplicitCapture
              ? explicitEarlyCaptures < EARLY_IMAGE_CAPTURE_MAX_EXPLICIT_PER_EVENT
              : opportunisticEarlyCaptures < EARLY_IMAGE_CAPTURE_MAX_OPPORTUNISTIC_PER_EVENT;
            if ((isExplicitCapture || shouldCaptureRecentImage) && withinEventLimit &&
                imageStore.hasImages(cachedEntry?.msg) &&
                enqueueEarlyImageCapture(window, cachedEntry.msg, isExplicitCapture)) {
              if (isExplicitCapture) explicitEarlyCaptures += 1;
              else opportunisticEarlyCaptures += 1;
            }
            if (proactiveState && !proactiveState.captured) {
              proactiveState.captured = true;
              appendDiagnostic("proactive-fetch-captured", window, commandNames, [record], {
                attempt: proactiveState.attempts,
              });
            }
          }
        }

        for (const recallRecord of recalls) {
          const recallInfo = getRecallInfo(recallRecord);
          if (!nowConfig.isAntiRecallSelfMsg && recallInfo?.isSelfOperate) continue;
          const allowImageFetch = recallImageFetches < MAX_RECALL_IMAGE_FETCHES_PER_EVENT;
          const recovered = await recoverRecallRecord(recallRecord, window, {
            allowImageFetch,
            imageWaitBudgetMs: Math.max(0, recallImageWaitDeadline - Date.now()),
          });
          if (!recovered) {
            appendDiagnostic("recall-miss", window, commandNames, [recallRecord], {
              cacheSize: msgFlow.size,
            });
            output("Detected recall but the original message was never captured.");
            continue;
          }
          if (allowImageFetch && recovered.imageFetchStarted) recallImageFetches += 1;
          originalSend.call(
            webContents,
            "LiteLoader.anti_recall.mainWindow.recallTip",
            recovered.id,
            Number(recovered.entry?.msg?.chatType) === 2 &&
              recordHasGroupFallbackContent(recovered.entry?.msg)
          );
          appendDiagnostic("recall-recovered", window, commandNames, [recallRecord], {
            source: recovered.source,
          });
          output("Detected recall, recovered from " + recovered.source);
        }

        const currentPeer = getRecordPeer(records[records.length - 1]);
        if (currentPeer) {
          originalSend.call(
            webContents,
            "LiteLoader.anti_recall.mainWindow.recallTipList",
            getKnownRecalledIds(currentPeer)
          );
        }
      }
    } catch (error) {
      output("NTQQ Anti-Recall global capture error:", error);
    }
    return originalSend.call(webContents, channel, ...args);
  };
  output("Global message capture attached to window " + (Number(window.id) || 0));
}

function onBrowserWindowCreated(window) {
  // Attach before the first page load. Background messages may arrive in hidden
  // windows and before any chat route has emitted did-stop-loading.
  patchWindowSend(window);
  window.webContents.on("did-stop-loading", () => rememberChatWindow(window));
  window.once("closed", () => {
    const index = mainWindowObjs.indexOf(window);
    if (index !== -1) mainWindowObjs.splice(index, 1);
  });
}

function output(...args) {
  console.log("\x1b[32m%s\x1b[0m", "Anti-Recall:", ...args);
}

module.exports = {
  onBrowserWindowCreated,
};
