"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "anti-recall-global-test-"));
global.LiteLoader = { path: { data: testDataDir } };

const handlers = new Map();
const ipcListeners = new Map();
const appHandlers = new Map();
const electronMock = {
  app: { on(name, handler) { appHandlers.set(name, handler); } },
  dialog: { showMessageBox: async () => ({ response: 1 }) },
  ipcMain: {
    handle(channel, handler) { handlers.set(channel, handler); },
    listeners(channel) { return ipcListeners.get(channel) || []; },
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronMock;
  if (request === "./imgDownloader.js") {
    return { ImgDownloader: class { async downloadPic() {} } };
  }
  if (request === "level-party") {
    return function () {
      throw new Error("The database must stay disabled in this test.");
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const plugin = require("../payload/LiteLoaderQQNT/plugins/qq-anti-recall/main.js");
Module._load = originalLoad;

function createWindow(id, url) {
  const sent = [];
  const webContentsEvents = new Map();
  const windowEvents = new Map();
  const webContents = {
    id,
    getURL: () => url,
    isDestroyed: () => false,
    on: (name, handler) => webContentsEvents.set(name, handler),
    send(channel, ...args) {
      sent.push({ channel, args });
    },
  };
  const window = {
    id,
    webContents,
    isDestroyed: () => false,
    once: (name, handler) => windowEvents.set(name, handler),
  };
  plugin.onBrowserWindowCreated(window);
  return { window, sent, webContentsEvents, windowEvents };
}

function textRecord(msgId, peerUid, text, chatType = 2) {
  return {
    msgId,
    msgSeq: "101",
    chatType,
    peerUid,
    msgType: 2,
    subMsgType: 0,
    elements: [{ elementType: 1, textElement: { content: text } }],
  };
}

function imageRecord(msgId, peerUid, chatType = 1) {
  return {
    msgId,
    msgSeq: "102",
    chatType,
    peerUid,
    msgType: 2,
    subMsgType: 0,
    elements: [{
      elementId: "image-element-1",
      elementType: 2,
      picElement: {
        fileName: "background.jpg",
        fileSize: 512,
        md5HexStr: "1234567890abcdef1234567890abcdef",
        originImageUrl: "/download?appid=1406",
        sourcePath: path.join(testDataDir, "qq-cache", "missing-background.jpg"),
        thumbPath: {},
      },
    }],
  };
}

function recallRecord(msgId, peerUid) {
  return {
    msgId,
    msgSeq: "101",
    chatType: 2,
    peerUid,
    msgType: 5,
    subMsgType: 4,
    elements: [{
      elementType: 8,
      grayTipElement: {
        revokeElement: { isSelfOperate: false },
      },
    }],
  };
}

(async () => {
  const hiddenReceiver = createWindow(7, "file:///hidden/notification.html");
  const chatRenderer = createWindow(9, "file:///renderer/index.html#/main/message");
  const original = textRecord("msg-background-1", "group-42", "background payload");

  await hiddenReceiver.window.webContents.send(
    "RM_IPCFROM_MAIN7",
    { type: "event" },
    { cmdName: "NodeIKernelMsgListener/onRecvMsg", result: { data: { records: [original] } } }
  );

  // Mutating the source after delivery must not poison the process-wide snapshot.
  original.elements[0].textElement.content = "mutated after capture";
  const recall = recallRecord("msg-background-1", "group-42");
  await chatRenderer.window.webContents.send(
    "RM_IPCFROM_MAIN9",
    { type: "event" },
    { cmdName: "NodeIKernelMsgListener/onMsgInfoListUpdate", payload: { msgList: [recall] } }
  );

  assert.equal(recall.msgType, 2, "the recall record should be restored to its original type");
  assert.equal(
    recall.elements[0].textElement.content,
    "background payload",
    "the restored record should come from the immutable cross-window snapshot"
  );
  assert(chatRenderer.sent.some(event =>
    event.channel === "LiteLoader.anti_recall.mainWindow.recallTip" &&
    event.args[0] === "msg-background-1"
  ), "the renderer should receive a recall marker");

  const missing = recallRecord("msg-never-captured", "group-99");
  await chatRenderer.window.webContents.send(
    "RM_IPCFROM_MAIN9",
    { type: "event" },
    { cmdName: "NodeIKernelMsgListener/onMsgInfoListUpdate", payload: { msgList: [missing] } }
  );
  assert.equal(missing.msgType, 5, "an uncached recall must remain visible instead of being silently hidden");

  const proactiveOriginal = textRecord(
    "msg-proactive-1",
    "private-peer-1",
    "fetched before recall",
    1
  );
  const proactiveImage = imageRecord("msg-proactive-image-1", "private-peer-1");
  const nativeRecords = new Map([
    [proactiveOriginal.msgId, proactiveOriginal],
    [proactiveImage.msgId, proactiveImage],
  ]);
  const nativeRequests = [];
  let nativeImageDestination = "";
  let activeImageDownloads = 0;
  let maxActiveImageDownloads = 0;
  ipcListeners.set("RM_IPCFROM_RENDERER7", [
    (fakeEvent, request, command) => {
      nativeRequests.push({ request, command });
      if (command.cmdName === "nodeIKernelMsgService/getMsgsByMsgId") {
        const record = nativeRecords.get(command.payload?.[0]?.msgIds?.[0]);
        fakeEvent.reply(
          "RM_IPCFROM_MAIN7",
          { type: "response", callbackId: request.callbackId },
          { cmdName: command.cmdName, payload: { msgList: record ? [record] : [] } }
        );
      } else if (command.cmdName === "nodeIKernelMsgService/downloadRichMedia") {
        activeImageDownloads += 1;
        maxActiveImageDownloads = Math.max(maxActiveImageDownloads, activeImageDownloads);
        const getReq = command.payload?.[0]?.getReq;
        const destination = path.join(testDataDir, "qq-native-cache", `${getReq.msgId}.jpg`);
        nativeImageDestination = destination;
        setTimeout(() => {
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.writeFileSync(destination, Buffer.alloc(512, 7));
          fakeEvent.reply(
            "RM_IPCFROM_MAIN7",
            { type: "event" },
            {
              cmdName: "nodeIKernelMsgListener/onRichMediaDownloadComplete",
              payload: {
                notifyInfo: {
                  msgId: getReq.msgId,
                  msgElementId: getReq.elementId,
                  filePath: destination,
                  fileErrCode: 0,
                  commonFileInfo: { filePath: destination, fileSize: 512 },
                },
              },
            }
          );
          activeImageDownloads -= 1;
        }, 5);
      }
    },
  ]);

  await hiddenReceiver.window.webContents.send(
    "RM_IPCFROM_MAIN7",
    { type: "event" },
    {
      cmdName: "nodeIKernelRecentContactListener/onRecentContactListChangedVer2",
      payload: {
        changedList: [{
          chatType: 1,
          peerUid: "private-peer-1",
          msgId: "msg-proactive-1",
          msgAbstract: "SECRET ABSTRACT 11111",
        }],
      },
    }
  );
  await new Promise(resolve => setTimeout(resolve, 30));

  assert(nativeRequests.length >= 1, "a recent-contact update should proactively query the full message");
  assert.equal(nativeRequests[0].request.eventName, "ntApi");
  assert.equal(nativeRequests[0].command.cmdName, "nodeIKernelMsgService/getMsgsByMsgId");
  assert.deepEqual(nativeRequests[0].command.payload, [{
    peer: { chatType: 1, peerUid: "private-peer-1", guildId: "" },
    msgIds: ["msg-proactive-1"],
  }, null]);

  const proactiveRecall = recallRecord("msg-proactive-1", "private-peer-1");
  proactiveRecall.chatType = 1;
  await chatRenderer.window.webContents.send(
    "RM_IPCFROM_MAIN9",
    { type: "event" },
    { cmdName: "nodeIKernelMsgListener/onMsgInfoListUpdate", payload: { msgList: [proactiveRecall] } }
  );
  assert.equal(proactiveRecall.msgType, 2, "a proactively fetched message should survive a background recall");
  assert.equal(proactiveRecall.elements[0].textElement.content, "fetched before recall");

  await hiddenReceiver.window.webContents.send(
    "RM_IPCFROM_MAIN7",
    { type: "event" },
    {
      cmdName: "nodeIKernelRecentContactListener/onRecentContactListChangedVer2",
      payload: {
        changedList: [{
          chatType: 1,
          peerUid: "private-peer-1",
          msgId: "msg-proactive-image-1",
        }],
      },
    }
  );
  await new Promise(resolve => setTimeout(resolve, 150));

  const imageDownloadRequest = nativeRequests.find(
    item => item.command.cmdName === "nodeIKernelMsgService/downloadRichMedia"
  );
  assert(imageDownloadRequest, "an unopened image message should be downloaded before recall");
  assert.equal(imageDownloadRequest.command.payload[0].getReq.msgId, "msg-proactive-image-1");
  assert.equal(imageDownloadRequest.command.payload[0].getReq.elementId, "image-element-1");
  assert.equal(imageDownloadRequest.command.payload[0].getReq.downloadType, 1);

  // QQ commonly emits a fresher message clone after the image download. Its
  // sourcePath is valid, but thumbPath can still point at a missing thumbnail.
  // This update must not downgrade the already-preserved cache entry.
  const imageReplacement = imageRecord("msg-proactive-image-1", "private-peer-1");
  imageReplacement.elements[0].picElement.sourcePath = nativeImageDestination;
  imageReplacement.elements[0].picElement.thumbPath = { 0: path.join(testDataDir, "missing-thumb.jpg") };
  await hiddenReceiver.window.webContents.send(
    "RM_IPCFROM_MAIN7",
    { type: "response" },
    { cmdName: "nodeIKernelMsgService/getMsgsByMsgId", payload: { msgList: [imageReplacement] } }
  );

  const imageRecall = recallRecord("msg-proactive-image-1", "private-peer-1");
  imageRecall.chatType = 1;
  await chatRenderer.window.webContents.send(
    "RM_IPCFROM_MAIN9",
    { type: "event" },
    { cmdName: "nodeIKernelMsgListener/onMsgInfoListUpdate", payload: { msgList: [imageRecall] } }
  );
  assert.equal(imageRecall.msgType, 2, "the background image message should survive recall");
  const restoredPic = imageRecall.elements[0].picElement;
  assert(restoredPic, "the original image element should replace the recall gray tip");
  assert(fs.existsSync(restoredPic.sourcePath), "the restored image source must exist locally");
  assert.equal(fs.statSync(restoredPic.sourcePath).size, 512);
  assert.equal(restoredPic.filePath, restoredPic.sourcePath);
  assert(restoredPic.thumbPath instanceof Map,
    "image paths restored from JSON-compatible records must be rehydrated to a Map");
  assert.equal(restoredPic.thumbPath.get(0), restoredPic.sourcePath);
  assert(restoredPic.sourcePath.includes(`${path.sep}session-images${path.sep}`),
    "non-persistent image recovery should use the bounded session cache");
  const persistentImageDir = path.join(testDataDir, "anti_recall", "preserved-images");
  assert.equal(
    fs.existsSync(persistentImageDir)
      ? fs.readdirSync(persistentImageDir, { withFileTypes: true }).filter(item => item.isFile()).length
      : 0,
    0,
    "saveDb=false must not create durable image archives"
  );

  const historicalImage = imageRecord("msg-historical-image-1", "private-peer-1");
  historicalImage.elements[0].elementId = "historical-image-element";
  await hiddenReceiver.window.webContents.send(
    "RM_IPCFROM_MAIN7",
    { type: "response" },
    { cmdName: "nodeIKernelMsgService/getAioFirstViewLatestMsgs", payload: { msgList: [historicalImage] } }
  );
  const downloadsBeforeHistoryRecall = nativeRequests.filter(
    item => item.command.cmdName === "nodeIKernelMsgService/downloadRichMedia"
  ).length;
  const historicalRecall = recallRecord("msg-historical-image-1", "private-peer-1");
  historicalRecall.chatType = 1;
  const historyStart = Date.now();
  await chatRenderer.window.webContents.send(
    "RM_IPCFROM_MAIN9",
    { type: "response" },
    { cmdName: "nodeIKernelMsgService/getAioFirstViewLatestMsgs", payload: { msgList: [historicalRecall] } }
  );
  assert(Date.now() - historyStart < 100, "historical missing images must never block the message list");
  assert.equal(nativeRequests.filter(
    item => item.command.cmdName === "nodeIKernelMsgService/downloadRichMedia"
  ).length, downloadsBeforeHistoryRecall, "history rendering must not start bulk image downloads");

  const requestsBeforeBulkSnapshot = nativeRequests.length;
  await hiddenReceiver.window.webContents.send(
    "RM_IPCFROM_MAIN7",
    { type: "event" },
    {
      cmdName: "nodeIKernelRecentContactListener/onRecentContactListChangedVer2",
      payload: {
        changedList: Array.from({ length: 6 }, (_, index) => ({
          chatType: 1,
          peerUid: `bulk-peer-${index}`,
          msgId: `bulk-msg-${index}`,
        })),
      },
    }
  );
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(nativeRequests.length, requestsBeforeBulkSnapshot,
    "bulk recent-contact snapshots must not trigger proactive history queries");

  const opportunisticImages = Array.from({ length: 20 }, (_, index) => {
    const record = imageRecord(`opportunistic-image-${index}`, "bulk-image-peer");
    record.msgTime = Math.floor(Date.now() / 1000);
    record.elements[0].elementId = `opportunistic-element-${index}`;
    record.elements[0].picElement.md5HexStr = index.toString(16).padStart(32, "0");
    return record;
  });
  const downloadsBeforeOpportunisticBatch = nativeRequests.filter(
    item => item.command.cmdName === "nodeIKernelMsgService/downloadRichMedia"
  ).length;
  await hiddenReceiver.window.webContents.send(
    "RM_IPCFROM_MAIN7",
    { type: "response" },
    { cmdName: "nodeIKernelMsgService/getAioFirstViewLatestMsgs", payload: { msgList: opportunisticImages } }
  );
  await new Promise(resolve => setTimeout(resolve, 80));
  const opportunisticDownloads = nativeRequests.filter(
    item => item.command.cmdName === "nodeIKernelMsgService/downloadRichMedia"
  ).length - downloadsBeforeOpportunisticBatch;
  assert.equal(opportunisticDownloads, 3,
    "a recent history response must opportunistically capture only three images");

  const explicitImages = Array.from({ length: 20 }, (_, index) => {
    const record = imageRecord(`explicit-image-${index}`, "live-image-peer");
    record.msgTime = Math.floor(Date.now() / 1000);
    record.elements[0].elementId = `explicit-element-${index}`;
    record.elements[0].picElement.md5HexStr = (100 + index).toString(16).padStart(32, "0");
    return record;
  });
  const downloadsBeforeExplicitBatch = nativeRequests.filter(
    item => item.command.cmdName === "nodeIKernelMsgService/downloadRichMedia"
  ).length;
  await hiddenReceiver.window.webContents.send(
    "RM_IPCFROM_MAIN7",
    { type: "event" },
    { cmdName: "NodeIKernelMsgListener/onRecvMsg", payload: { msgList: explicitImages } }
  );
  await new Promise(resolve => setTimeout(resolve, 160));
  const explicitDownloads = nativeRequests.filter(
    item => item.command.cmdName === "nodeIKernelMsgService/downloadRichMedia"
  ).length - downloadsBeforeExplicitBatch;
  assert.equal(explicitDownloads, 12,
    "one live event must enqueue at most twelve image captures");
  assert(maxActiveImageDownloads <= 3,
    "early image capture must never exceed three concurrent native downloads");

  const albumMessages = Array.from({ length: 3 }, (_, messageIndex) => {
    const record = imageRecord(`album-message-${messageIndex}`, "album-peer");
    record.msgTime = Math.floor(Date.now() / 1000);
    record.elements = Array.from({ length: 6 }, (_, imageIndex) => ({
      elementId: `album-element-${messageIndex}-${imageIndex}`,
      elementType: 2,
      picElement: {
        fileName: `album-${messageIndex}-${imageIndex}.jpg`,
        fileSize: 512,
        md5HexStr: (1000 + messageIndex * 10 + imageIndex).toString(16).padStart(32, "0"),
        sourcePath: path.join(testDataDir, "qq-cache", `missing-album-${messageIndex}-${imageIndex}.jpg`),
        thumbPath: {},
      },
    }));
    return record;
  });
  await hiddenReceiver.window.webContents.send(
    "RM_IPCFROM_MAIN7",
    { type: "event" },
    { cmdName: "NodeIKernelMsgListener/onRecvMsg", payload: { msgList: albumMessages } }
  );
  await new Promise(resolve => setTimeout(resolve, 220));
  assert(maxActiveImageDownloads <= 3,
    "multi-image messages must still cap actual image-download concurrency at three");

  const diagnostics = fs.readFileSync(
    path.join(testDataDir, "anti_recall", "global-capture-events.jsonl"),
    "utf8"
  ).trim().split("\n").map(line => JSON.parse(line));
  assert(diagnostics.some(item => item.type === "recall-recovered" && item.source === "global-window-cache"));
  assert(diagnostics.some(item => item.type === "recall-miss"));
  assert(diagnostics.some(item => item.type === "proactive-fetch-requested"));
  assert(diagnostics.some(item => item.type === "proactive-fetch-captured"));
  assert(diagnostics.some(item => item.type === "image-preserve-requested"));
  assert(diagnostics.some(item => item.type === "image-preserve-complete"));
  assert(diagnostics.some(item => item.type === "proactive-fetch-baseline-skipped"));
  assert(diagnostics.every(item => !JSON.stringify(item).includes("background payload")),
    "diagnostics must not contain message text");
  assert(diagnostics.every(item => !JSON.stringify(item).includes("SECRET ABSTRACT 11111")),
    "shape diagnostics must only contain string lengths, never abstract text");

  const sessionRoot = path.join(testDataDir, "anti_recall", "session-images");
  assert(fs.existsSync(sessionRoot), "the current process should have a session image directory");
  await appHandlers.get("quit")?.();
  assert(!fs.existsSync(sessionRoot), "quitting QQ must remove all session image files");

  console.log("GLOBAL_CAPTURE_TEST_OK");
  console.log(`DIAGNOSTIC_EVENTS=${diagnostics.length}`);
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
