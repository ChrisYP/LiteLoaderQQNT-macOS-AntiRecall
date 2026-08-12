"use strict";

const MAX_EVENT_DEPTH = 8;
const MAX_EVENT_RECORDS = 500;
const MAX_EVENT_OBJECTS = 6000;

function isMessageRecord(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value.msgId != null || value.msgSeq != null) &&
    Array.isArray(value.elements)
  );
}

function walkObjects(values, { maxDepth, maxObjects, visit }) {
  const seen = new WeakSet();
  const stack = [{ value: values, depth: 0 }];
  let objectCount = 0;
  while (stack.length && objectCount < maxObjects) {
    const { value, depth } = stack.pop();
    if (value == null || depth > maxDepth || typeof value !== "object") continue;
    if (value instanceof Uint8Array || value instanceof Map || seen.has(value)) continue;
    seen.add(value);
    objectCount += 1;
    if (visit(value) === false) continue;
    let children;
    try {
      children = Array.isArray(value) ? value : Object.values(value);
    } catch {
      continue;
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ value: children[index], depth: depth + 1 });
    }
  }
}

function collectMessageRecords(values) {
  const records = [];
  const recordSet = new WeakSet();
  walkObjects(values, {
    maxDepth: MAX_EVENT_DEPTH,
    maxObjects: MAX_EVENT_OBJECTS,
    visit(value) {
      if (!isMessageRecord(value)) return true;
      if (!recordSet.has(value) && records.length < MAX_EVENT_RECORDS) {
        recordSet.add(value);
        records.push(value);
      }
      return false;
    },
  });
  return records;
}

function collectCommandNames(values) {
  const names = new Set();
  walkObjects(values, {
    maxDepth: 6,
    maxObjects: 1000,
    visit(value) {
      if (typeof value.cmdName === "string" && value.cmdName) names.add(value.cmdName);
      return names.size < 12;
    },
  });
  return Array.from(names).slice(0, 12);
}

function collectRecentContactTargets(values) {
  const targets = [];
  const targetIds = new Set();
  walkObjects(values, {
    maxDepth: 8,
    maxObjects: 3000,
    visit(value) {
      const msgId = value.msgId == null ? "" : String(value.msgId);
      const chatType = Number(value.chatType ?? value.peer?.chatType);
      const peerUid = String(value.peerUid ?? value.peer?.peerUid ?? "");
      const guildId = String(value.guildId ?? value.peer?.guildId ?? "");
      if (msgId && Number.isFinite(chatType) && chatType > 0 && peerUid && !targetIds.has(msgId)) {
        targetIds.add(msgId);
        targets.push({ msgId, chatType, peerUid, guildId });
      }
      return targets.length < 30;
    },
  });
  return targets;
}

function collectImageDownloadCompletions(values) {
  const completions = [];
  const completionKeys = new Set();
  walkObjects(values, {
    maxDepth: 9,
    maxObjects: 3000,
    visit(value) {
      const common = value.commonFileInfo;
      const msgId = String(value.msgId ?? common?.msgId ?? "");
      const elementId = String(
        value.msgElementId ?? value.elementId ?? common?.msgElementId ?? common?.elementId ?? ""
      );
      const filePath = String(value.filePath ?? common?.filePath ?? "");
      const rawErrorCode = value.fileErrCode ?? common?.fileErrCode;
      const completionKey = `${msgId}:${elementId}:${filePath}:${String(rawErrorCode)}`;
      if (msgId && elementId && (filePath || rawErrorCode !== undefined) && !completionKeys.has(completionKey)) {
        completionKeys.add(completionKey);
        completions.push({
          msgId,
          elementId,
          filePath,
          errorCode: rawErrorCode === undefined ? 0 : Number(rawErrorCode),
        });
      }
      return completions.length < 50;
    },
  });
  return completions;
}

module.exports = {
  collectCommandNames,
  collectImageDownloadCompletions,
  collectMessageRecords,
  collectRecentContactTargets,
};
