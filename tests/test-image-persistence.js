"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "anti-recall-persistence-test-"));
const pluginDataDir = path.join(testDataDir, "anti_recall");
fs.mkdirSync(pluginDataDir, { recursive: true });
fs.writeFileSync(path.join(pluginDataDir, "config.json"), JSON.stringify({
  mainColor: "#ff6d6d",
  saveDb: true,
  enableShadow: true,
  enableTip: true,
  isAntiRecallSelfMsg: false,
  maxMsgSaveLimit: 10000,
  deleteMsgCountPerTime: 500,
}));
global.LiteLoader = { path: { data: testDataDir } };

const stored = new Map();
const db = {
  open(callback) { setImmediate(() => callback(null)); },
  put(key, value, callback) {
    // Reproduce level's JSON value encoding, including Map -> plain object.
    stored.set(String(key), JSON.parse(JSON.stringify(value)));
    callback?.(null);
  },
  async get(key) {
    if (!stored.has(String(key))) {
      const error = new Error("NotFound");
      error.notFound = true;
      error.status = 404;
      throw error;
    }
    return JSON.parse(JSON.stringify(stored.get(String(key))));
  },
  async clear() { stored.clear(); },
  async close() {},
  createValueStream() {
    const listeners = new Map();
    const stream = {
      on(name, handler) {
        listeners.set(name, handler);
        if (name === "end") {
          setImmediate(() => {
            for (const value of stored.values()) listeners.get("data")?.(JSON.parse(JSON.stringify(value)));
            handler();
          });
        }
        return stream;
      },
      once(name, handler) { return stream.on(name, handler); },
    };
    return stream;
  },
};

const handlers = new Map();
const appHandlers = new Map();
const ipcListeners = new Map();
const electronMock = {
  app: { on(name, handler) { appHandlers.set(name, handler); } },
  dialog: { showMessageBox: async () => ({ response: 0 }) },
  ipcMain: {
    handle(channel, handler) { handlers.set(channel, handler); },
    listeners(channel) { return ipcListeners.get(channel) || []; },
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronMock;
  if (request === "./imgDownloader.js") return { ImgDownloader: class {} };
  if (request === "level-party") return () => db;
  return originalLoad.call(this, request, parent, isMain);
};
const plugin = require("../payload/LiteLoaderQQNT/plugins/qq-anti-recall/main.js");
Module._load = originalLoad;

function createWindow(id) {
  const webContents = {
    id,
    getURL: () => "file:///renderer/index.html#/main/message",
    isDestroyed: () => false,
    on() {},
    send() {},
  };
  const window = { id, webContents, isDestroyed: () => false, once() {} };
  plugin.onBrowserWindowCreated(window);
  return window;
}

function imageRecord() {
  return {
    msgId: "persistent-image-message",
    msgSeq: "200",
    msgTime: Math.floor(Date.now() / 1000),
    chatType: 1,
    peerUid: "persistent-peer",
    msgType: 2,
    elements: [{
      elementId: "persistent-image-element",
      elementType: 2,
      picElement: {
        fileName: "persistent.png",
        fileSize: 768,
        md5HexStr: "fedcba0987654321fedcba0987654321",
        sourcePath: path.join(testDataDir, "qq-cache", "persistent.png"),
        thumbPath: {},
      },
    }],
  };
}

function recallRecord() {
  return {
    msgId: "persistent-image-message",
    msgSeq: "200",
    chatType: 1,
    peerUid: "persistent-peer",
    msgType: 5,
    elements: [{
      elementType: 8,
      grayTipElement: { revokeElement: { isSelfOperate: false } },
    }],
  };
}

(async () => {
  const window = createWindow(31);
  const original = imageRecord();
  fs.mkdirSync(path.dirname(original.elements[0].picElement.sourcePath), { recursive: true });
  fs.writeFileSync(original.elements[0].picElement.sourcePath, Buffer.alloc(768, 9));

  await window.webContents.send(
    "RM_IPCFROM_MAIN31",
    { type: "event" },
    { cmdName: "NodeIKernelMsgListener/onRecvMsg", payload: { msgList: [original] } }
  );
  await new Promise(resolve => setTimeout(resolve, 30));

  const permanentDir = path.join(pluginDataDir, "preserved-images");
  assert(!fs.existsSync(permanentDir) || fs.readdirSync(permanentDir).length === 0,
    "receiving an image must not make it durable before recall");

  const recall = recallRecord();
  await window.webContents.send(
    "RM_IPCFROM_MAIN31",
    { type: "event" },
    { cmdName: "NodeIKernelMsgListener/onMsgInfoListUpdate", payload: { msgList: [recall] } }
  );

  assert.equal(recall.msgType, 2, "the recalled image should be restored");
  assert(recall.elements[0].picElement.thumbPath instanceof Map,
    "the restored image should retain QQ's required Map type");
  assert(fs.existsSync(recall.elements[0].picElement.sourcePath),
    "the recalled image should point to a durable file");
  assert(recall.elements[0].picElement.sourcePath.startsWith(`${permanentDir}${path.sep}`));
  assert(stored.has("persistent-image-message"), "the recalled message should be written to the DB");
  const durablePath = recall.elements[0].picElement.sourcePath;
  const jsonRoundTrip = await db.get("persistent-image-message");
  assert(!(jsonRoundTrip.msg.elements[0].picElement.thumbPath instanceof Map),
    "the fixture must reproduce JSON type loss before plugin rehydration");

  // Simulate a plugin/QQ restart: the in-memory recalled map is empty again,
  // but the renderer must be able to reload the persisted recall ID index.
  const persistedIds = await handlers.get("LiteLoader.anti_recall.getRecalledMsgIds")?.({}, null);
  assert(persistedIds.includes("persistent-image-message"),
    "persisted recall IDs must be available to the renderer after restart");

  const missingGroup = imageRecord();
  missingGroup.msgId = "persistent-group-image-message";
  missingGroup.msgSeq = "201";
  missingGroup.chatType = 2;
  missingGroup.peerUid = "group-1011402574";
  missingGroup.sendMemberName = "山海不可平";
  missingGroup.senderUin = "1031142014";
  missingGroup.elements[0].elementId = "persistent-group-image-element";
  missingGroup.elements[0].picElement.md5HexStr = "aabbccddeeff00112233445566778899";
  missingGroup.elements[0].picElement.sourcePath = path.join(testDataDir, "qq-cache", "missing-group.png");
  missingGroup.elements.push({
    elementId: "persistent-group-text-element",
    elementType: 1,
    textElement: { content: "看得上你的那点？" },
  });

  const nativeRequests = [];
  ipcListeners.set("RM_IPCFROM_RENDERER31", [
    (fakeEvent, request, command) => {
      nativeRequests.push(command);
      if (command.cmdName !== "nodeIKernelMsgService/downloadRichMedia") return;
      const getReq = command.payload?.[0]?.getReq;
      const destination = path.join(testDataDir, "qq-native-cache", `${getReq.msgId}.png`);
      setTimeout(() => {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, Buffer.alloc(768, 4));
        fakeEvent.reply(
          "RM_IPCFROM_MAIN31",
          { type: "event" },
          {
            cmdName: "nodeIKernelMsgListener/onRichMediaDownloadComplete",
            payload: { notifyInfo: {
              msgId: getReq.msgId,
              msgElementId: getReq.elementId,
              filePath: destination,
              fileErrCode: 0,
            } },
          }
        );
      }, 5);
    },
  ]);
  stored.set(missingGroup.msgId, JSON.parse(JSON.stringify({
    id: missingGroup.msgId,
    sender: missingGroup.peerUid,
    msg: missingGroup,
  })));
  const missingGroupRecall = {
    msgId: missingGroup.msgId,
    msgSeq: missingGroup.msgSeq,
    chatType: 2,
    peerUid: missingGroup.peerUid,
    msgType: 5,
    elements: [{ elementType: 8, grayTipElement: { revokeElement: { isSelfOperate: false } } }],
  };
  await window.webContents.send(
    "RM_IPCFROM_MAIN31",
    { type: "response" },
    { cmdName: "nodeIKernelMsgService/getAioFirstViewLatestMsgs", payload: { msgList: [missingGroupRecall] } }
  );
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(nativeRequests.some(command => command.cmdName === "nodeIKernelMsgService/downloadRichMedia"),
    "a recalled group image missing from disk must self-heal from the database record");
  assert(missingGroupRecall.elements[0].picElement.sourcePath.startsWith(`${permanentDir}${path.sep}`),
    "the self-healed group image must be promoted to durable storage");
  assert(fs.existsSync(missingGroupRecall.elements[0].picElement.sourcePath),
    "the self-healed group image must exist before rendering");
  const groupPayloads = await handlers.get("LiteLoader.anti_recall.getRecalledGroupImages")?.(
    {}, missingGroup.msgId
  );
  assert.equal(groupPayloads.length, 1,
    "a persisted recalled group image must be exposed to the renderer fallback");
  assert(groupPayloads[0].fileUrl.startsWith("file://"),
    "the renderer fallback must receive a local URL instead of Base64 IPC payloads");
  assert(!Object.prototype.hasOwnProperty.call(groupPayloads[0], "dataUrl"),
    "persisted images must never be copied through IPC as Base64 strings");
  assert.equal(groupPayloads[0].senderName, "山海不可平",
    "the group fallback must preserve the original sender identity");
  assert.equal(groupPayloads[0].senderUin, "1031142014");
  assert(groupPayloads[0].avatarUrl.includes("dst_uin=1031142014"),
    "the group fallback should resolve the sender's real QQ avatar");
  assert.equal(groupPayloads[0].text, "看得上你的那点？",
    "the group fallback must preserve text from the same recalled image message");
  const groupImageIds = await handlers.get("LiteLoader.anti_recall.getRecalledGroupImageIds")?.({}, null);
  assert(groupImageIds.includes(missingGroup.msgId),
    "the renderer must receive a compact index of persisted recalled group images");

  const textOnlyGroup = {
    msgId: "persistent-group-text-only-message",
    msgSeq: "202",
    chatType: 2,
    peerUid: "group-578608308",
    msgType: 2,
    sendMemberName: "Hannibal",
    elements: [{
      elementId: "persistent-group-text-only-element",
      elementType: 1,
      textElement: { content: "123" },
    }],
  };
  await window.webContents.send(
    "RM_IPCFROM_MAIN31",
    { type: "event" },
    { cmdName: "NodeIKernelMsgListener/onRecvMsg", payload: { msgList: [textOnlyGroup] } }
  );
  const textOnlyRecall = {
    msgId: textOnlyGroup.msgId,
    msgSeq: textOnlyGroup.msgSeq,
    chatType: 2,
    peerUid: textOnlyGroup.peerUid,
    msgType: 5,
    elements: [{ elementType: 8, grayTipElement: { revokeElement: { isSelfOperate: false } } }],
  };
  await window.webContents.send(
    "RM_IPCFROM_MAIN31",
    { type: "response" },
    { cmdName: "nodeIKernelMsgService/getAioFirstViewLatestMsgs", payload: { msgList: [textOnlyRecall] } }
  );
  const textOnlyPayloads = await handlers.get("LiteLoader.anti_recall.getRecalledGroupImages")?.(
    {}, textOnlyGroup.msgId
  );
  assert.equal(textOnlyPayloads.length, 1,
    "a text-only group recall must be exposed to the renderer fallback");
  assert.equal(textOnlyPayloads[0].text, "123");
  assert.equal(textOnlyPayloads[0].hasImage, false);
  assert.equal(textOnlyPayloads[0].unavailable, false,
    "text-only recalls must not be mislabeled as missing images");
  const groupRecallIds = await handlers.get("LiteLoader.anti_recall.getRecalledGroupImageIds")?.({}, null);
  assert(groupRecallIds.includes(textOnlyGroup.msgId),
    "the persisted group index must include text-only recalls");

  const unsupportedGroup = {
    msgId: "persistent-group-voice-message",
    msgSeq: "203",
    chatType: 2,
    peerUid: "group-voice",
    msgType: 4,
    elements: [{
      elementId: "persistent-group-voice-element",
      elementType: 4,
      pttElement: { fileName: "voice.amr" },
    }],
  };
  await window.webContents.send(
    "RM_IPCFROM_MAIN31",
    { type: "event" },
    { cmdName: "NodeIKernelMsgListener/onRecvMsg", payload: { msgList: [unsupportedGroup] } }
  );
  const unsupportedRecall = {
    msgId: unsupportedGroup.msgId,
    msgSeq: unsupportedGroup.msgSeq,
    chatType: 2,
    peerUid: unsupportedGroup.peerUid,
    msgType: 5,
    elements: [{ elementType: 8, grayTipElement: { revokeElement: { isSelfOperate: false } } }],
  };
  await window.webContents.send(
    "RM_IPCFROM_MAIN31",
    { type: "response" },
    { cmdName: "nodeIKernelMsgService/getAioFirstViewLatestMsgs", payload: { msgList: [unsupportedRecall] } }
  );
  const unsupportedPayloads = await handlers.get("LiteLoader.anti_recall.getRecalledGroupImages")?.(
    {}, unsupportedGroup.msgId
  );
  assert.deepEqual(unsupportedPayloads, [],
    "unsupported group message types must remain on QQ's native renderer");
  const supportedGroupIds = await handlers.get("LiteLoader.anti_recall.getRecalledGroupImageIds")?.({}, null);
  assert(!supportedGroupIds.includes(unsupportedGroup.msgId),
    "voice/file recalls must not enter the text/image fallback index");

  const privatePayloads = await handlers.get("LiteLoader.anti_recall.getRecalledGroupImages")?.(
    {}, original.msgId
  );
  assert.deepEqual(privatePayloads, [],
    "private-message rendering must stay on the existing, already working path");

  const sessionDir = path.join(pluginDataDir, "session-images");
  const additional = imageRecord();
  additional.msgId = "non-recalled-session-image";
  additional.elements[0].elementId = "non-recalled-session-element";
  additional.elements[0].picElement.md5HexStr = "00112233445566778899aabbccddeeff";
  await window.webContents.send(
    "RM_IPCFROM_MAIN31",
    { type: "event" },
    { cmdName: "NodeIKernelMsgListener/onRecvMsg", payload: { msgList: [additional] } }
  );
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(fs.existsSync(sessionDir), "a non-recalled image should remain in the session cache");

  await handlers.get("LiteLoader.anti_recall.clearDb")?.({}, null);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(stored.size, 0, "clearDb should delete database entries");
  assert(fs.existsSync(permanentDir), "clearDb should leave a usable empty image directory");
  assert.equal(fs.readdirSync(permanentDir).length, 0,
    "clearDb should delete every durable recalled image");
  assert(!fs.existsSync(durablePath), "the durable recalled image file should be gone after clearDb");
  assert(fs.existsSync(sessionDir),
    "clearDb should not disrupt temporary anti-recall protection for current-session messages");

  await appHandlers.get("quit")?.();
  console.log("IMAGE_PERSISTENCE_TEST_OK");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
