"use strict";

const assert = require("assert");
const {
  collectCommandNames,
  collectImageDownloadCompletions,
  collectMessageRecords,
  collectRecentContactTargets,
} = require("../payload/LiteLoaderQQNT/plugins/qq-anti-recall/eventParser.js");

const message = {
  msgId: "message-1",
  msgSeq: "1",
  elements: [{ elementId: "text-1", textElement: { content: "safe" } }],
};
const event = {
  command: { cmdName: "NodeIKernelMsgListener/onRecvMsg" },
  payload: {
    msgList: [message, message],
    recent: { msgId: "message-1", chatType: 2, peerUid: "group-1", guildId: "" },
    completion: {
      commonFileInfo: {
        msgId: "message-1",
        msgElementId: "image-1",
        filePath: "/tmp/image-1.jpg",
        fileErrCode: 0,
      },
    },
  },
};

assert.deepEqual(collectMessageRecords(event), [message]);
assert.deepEqual(collectCommandNames(event), ["NodeIKernelMsgListener/onRecvMsg"]);
assert.deepEqual(collectRecentContactTargets(event), [{
  msgId: "message-1",
  chatType: 2,
  peerUid: "group-1",
  guildId: "",
}]);
assert.deepEqual(collectImageDownloadCompletions(event), [{
  msgId: "message-1",
  elementId: "image-1",
  filePath: "/tmp/image-1.jpg",
  errorCode: 0,
}]);

const deep = {};
let cursor = deep;
for (let index = 0; index < 20; index += 1) cursor = cursor.next = {};
cursor.hidden = message;
assert.equal(collectMessageRecords(deep).length, 0, "parsing must stop at the configured depth");

console.log("EVENT_PARSER_TEST_OK");
