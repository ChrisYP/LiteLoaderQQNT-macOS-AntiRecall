"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"]);
const SESSION_MAX_BYTES = 512 * 1024 * 1024;
const SESSION_MAX_FILES = 5000;
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

class ImageStore {
  constructor(pluginDataDir, getRecordId) {
    this.getRecordId = getRecordId;
    this.preservedDir = path.join(pluginDataDir, "preserved-images");
    this.sessionRoot = path.join(pluginDataDir, "session-images");
    this.sessionDir = path.join(
      this.sessionRoot,
      `${process.pid}-${crypto.randomBytes(6).toString("hex")}`
    );
    this.sessionMeta = new Map();
  }

  initializeSession() {
    fs.rmSync(this.sessionRoot, { recursive: true, force: true });
    fs.mkdirSync(this.sessionDir, { recursive: true });
  }

  existingPath(pic) {
    const candidates = [pic?.sourcePath, pic?.filePath, pic?.originPath, pic?.localPath, pic?.path];
    const expectedBytes = Math.max(0, Number(pic?.fileSize) || 0);
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !path.isAbsolute(candidate)) continue;
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile() && stat.size > 100 && (!expectedBytes || stat.size >= expectedBytes)) return candidate;
      } catch {
      }
    }
    return "";
  }

  storagePath(baseDir, record, element, index) {
    const pic = element?.picElement;
    const rawIdentity = String(
      pic?.md5HexStr || pic?.originImageMd5 || pic?.fileUuid ||
      `${this.getRecordId(record)}:${element?.elementId || index}`
    );
    const hexIdentity = rawIdentity.replace(/[^a-f0-9]/gi, "").toLowerCase();
    const identity = hexIdentity.length >= 16
      ? hexIdentity.slice(0, 80)
      : crypto.createHash("sha256").update(rawIdentity).digest("hex");
    const rawExtension = path.extname(String(pic?.fileName || pic?.sourcePath || "")).toLowerCase();
    const extension = IMAGE_EXTENSIONS.has(rawExtension) ? rawExtension : ".jpg";
    return path.join(baseDir, `${identity}${extension}`);
  }

  preservedPath(record, element, index) {
    return this.storagePath(this.preservedDir, record, element, index);
  }

  sessionPath(record, element, index) {
    return this.storagePath(this.sessionDir, record, element, index);
  }

  applyPath(pic, targetPath) {
    if (!pic || !targetPath) return;
    pic.sourcePath = targetPath;
    pic.filePath = targetPath;
    pic.originPath = targetPath;
    pic.localPath = targetPath;
    pic.path = targetPath;
    pic.thumbPath = new Map([[0, targetPath], [198, targetPath], [720, targetPath]]);
  }

  validStoragePath(baseDir, record, element, index) {
    const targetPath = this.storagePath(baseDir, record, element, index);
    const expectedBytes = Math.max(0, Number(element?.picElement?.fileSize) || 0);
    try {
      const stat = fs.statSync(targetPath);
      if (stat.isFile() && stat.size > 100 && (!expectedBytes || stat.size >= expectedBytes)) return targetPath;
    } catch {
    }
    return "";
  }

  validPreservedPath(record, element, index) {
    return this.validStoragePath(this.preservedDir, record, element, index);
  }

  validSessionPath(record, element, index) {
    return this.validStoragePath(this.sessionDir, record, element, index);
  }

  normalizeRecord(record) {
    if (!Array.isArray(record?.elements)) return false;
    let changed = false;
    for (const [index, element] of record.elements.entries()) {
      const pic = element?.picElement;
      if (!pic) continue;
      const renderPath = this.existingPath(pic)
        || this.validPreservedPath(record, element, index)
        || this.validSessionPath(record, element, index);
      if (!renderPath) continue;
      this.applyPath(pic, renderPath);
      changed = true;
    }
    return changed;
  }

  hasImages(record) {
    return Array.isArray(record?.elements) && record.elements.some((element) => element?.picElement);
  }

  hasLocalImagesNeedingArchive(record) {
    if (!Array.isArray(record?.elements)) return false;
    return record.elements.some((element, index) => {
      const pic = element?.picElement;
      if (!pic || this.validPreservedPath(record, element, index)) return false;
      return Boolean(this.existingPath(pic) || this.validSessionPath(record, element, index));
    });
  }

  hasUnavailableImages(record) {
    return Array.isArray(record?.elements)
      && record.elements.some((element) => element?.picElement && !this.existingPath(element.picElement));
  }

  clearPersisted() {
    fs.rmSync(this.preservedDir, { recursive: true, force: true });
    fs.mkdirSync(this.preservedDir, { recursive: true });
  }

  clearSession() {
    fs.rmSync(this.sessionRoot, { recursive: true, force: true });
    this.sessionMeta.clear();
  }

  removeSession(filePath) {
    if (!this.isInside(filePath, this.sessionDir)) return;
    fs.rmSync(filePath, { force: true });
    this.sessionMeta.delete(filePath);
  }

  trackSession(filePath) {
    if (!this.isInside(filePath, this.sessionDir)) return;
    try {
      const stat = fs.statSync(filePath);
      const previous = this.sessionMeta.get(filePath);
      this.sessionMeta.set(filePath, {
        bytes: stat.size,
        lastUsedAt: Date.now(),
        recalled: Boolean(previous?.recalled),
      });
      this.pruneSession();
    } catch {
      this.sessionMeta.delete(filePath);
    }
  }

  markSessionRecalled(record) {
    if (!Array.isArray(record?.elements)) return;
    for (const [index, element] of record.elements.entries()) {
      if (!element?.picElement) continue;
      const meta = this.sessionMeta.get(this.sessionPath(record, element, index));
      if (meta) meta.recalled = true;
    }
  }

  pruneSession() {
    const now = Date.now();
    const entries = Array.from(this.sessionMeta.entries()).sort((left, right) => {
      if (left[1].recalled !== right[1].recalled) return left[1].recalled ? 1 : -1;
      return left[1].lastUsedAt - right[1].lastUsedAt;
    });
    let totalBytes = entries.reduce((sum, [, meta]) => sum + meta.bytes, 0);
    let totalFiles = entries.length;
    for (const [filePath, meta] of entries) {
      const expired = now - meta.lastUsedAt > SESSION_MAX_AGE_MS;
      const overLimit = totalBytes > SESSION_MAX_BYTES || totalFiles > SESSION_MAX_FILES;
      if (!expired && !overLimit) continue;
      fs.rmSync(filePath, { force: true });
      this.sessionMeta.delete(filePath);
      totalBytes -= meta.bytes;
      totalFiles -= 1;
    }
  }

  async archive(sourcePath, targetPath, expectedBytes) {
    if (!sourcePath || !path.isAbsolute(sourcePath)) return "";
    const sourceSize = await this.waitForCompletedFile(sourcePath, expectedBytes, 5000);
    if (!sourceSize) return "";
    if (path.resolve(sourcePath) === path.resolve(targetPath)) return sourcePath;
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    try {
      const stat = await fs.promises.stat(targetPath);
      if (stat.isFile() && stat.size > 100 && (!expectedBytes || stat.size >= expectedBytes)) return targetPath;
    } catch {
    }
    const temporaryPath = `${targetPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    try {
      await fs.promises.copyFile(sourcePath, temporaryPath);
      await fs.promises.rename(temporaryPath, targetPath);
      return targetPath;
    } finally {
      await fs.promises.unlink(temporaryPath).catch(() => {});
    }
  }

  waitForCompletedFile(filePath, expectedBytes, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let previousSize = -1;
    let stableReads = 0;
    return new Promise((resolve) => {
      const check = () => {
        let size = 0;
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile()) size = stat.size;
        } catch {
        }
        if (size > 100 && expectedBytes > 0 && size >= expectedBytes) return resolve(size);
        if (!expectedBytes && size > 100 && size === previousSize) stableReads += 1;
        else stableReads = 0;
        if (!expectedBytes && size > 100 && stableReads >= 2) return resolve(size);
        previousSize = size;
        if (Date.now() >= deadline) return resolve(0);
        setTimeout(check, 100);
      };
      check();
    });
  }

  fileUrl(filePath) {
    return this.isInside(filePath, this.preservedDir) ? pathToFileURL(filePath).href : "";
  }

  isInside(filePath, baseDir) {
    if (!filePath || !path.isAbsolute(filePath)) return false;
    const relative = path.relative(baseDir, filePath);
    return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
  }
}

module.exports = { ImageStore };
