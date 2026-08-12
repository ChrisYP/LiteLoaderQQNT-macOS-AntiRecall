"use strict";

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { RkeyManager } = require("./rkeyManager.js");

const GCHAT_IMAGE_HOST = "https://gchat.qpic.cn";
const NT_IMAGE_HOST = "https://multimedia.nt.qq.com.cn";
const DEFAULT_MAX_IMAGE_BYTES = 30 * 1024 * 1024;

class ImgDownloader {
  constructor() {
    this.rkeyManager = new RkeyManager();
  }

  async getImageUrl(pic) {
    if (!pic) return "";
    const raw = String(pic.originImageUrl || "").trim();
    if (!raw) return this.getLegacyImageUrl(pic);
    let parsed;
    try {
      parsed = new URL(raw, GCHAT_IMAGE_HOST);
    } catch {
      return this.getLegacyImageUrl(pic);
    }
    const appid = parsed.searchParams.get("appid");
    if (appid !== "1406" && appid !== "1407") return parsed.toString();
    parsed.host = new URL(NT_IMAGE_HOST).host;
    parsed.protocol = "https:";
    if (!parsed.searchParams.get("rkey")) {
      let data;
      try {
        data = await this.rkeyManager.getRkey();
      } catch {
        return this.getLegacyImageUrl(pic);
      }
      const rkey = appid === "1406" ? data.private_rkey : data.group_rkey;
      if (!rkey) return this.getLegacyImageUrl(pic);
      parsed.searchParams.set("rkey", rkey);
    }
    if (!parsed.searchParams.get("spec")) parsed.searchParams.set("spec", "0");
    return parsed.toString();
  }

  getLegacyImageUrl(pic) {
    const md5 = String(pic?.md5HexStr || pic?.originImageMd5 || "")
      .replace(/[^a-f0-9]/gi, "").toUpperCase();
    return md5 ? `${GCHAT_IMAGE_HOST}/gchatpic_new/0/0-0-${md5}/0` : "";
  }

  async downloadToFile(url, targetPath, maxBytes = DEFAULT_MAX_IMAGE_BYTES, signal = null) {
    const limit = Math.max(1024, Number(maxBytes) || DEFAULT_MAX_IMAGE_BYTES);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.download-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    try {
      await this.requestToFile(url, temporaryPath, limit, 0, signal);
      await fs.promises.rename(temporaryPath, targetPath);
      return targetPath;
    } finally {
      await fs.promises.unlink(temporaryPath).catch(() => {});
    }
  }

  requestToFile(url, targetPath, maxBytes, redirects = 0, signal = null) {
    return new Promise((resolve, reject) => {
      if (!url || redirects > 5) return reject(new Error("too many image redirects"));
      const protocol = String(url).startsWith("https:") ? https : http;
      const request = protocol.get(url, { timeout: 12000 }, (response) => {
        const status = Number(response.statusCode) || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          return resolve(this.requestToFile(
            new URL(response.headers.location, url).toString(),
            targetPath,
            maxBytes,
            redirects + 1,
            signal
          ));
        }
        if (status < 200 || status >= 300) {
          response.resume();
          return reject(new Error(`image HTTP ${status}`));
        }
        const type = String(response.headers["content-type"] || "");
        if (/json|text\//i.test(type)) {
          response.resume();
          return reject(new Error(`unexpected image content type: ${type}`));
        }
        const declaredBytes = Number(response.headers["content-length"] || 0);
        if (declaredBytes > maxBytes) {
          response.resume();
          return reject(new Error("image response exceeds size limit"));
        }
        let receivedBytes = 0;
        let settled = false;
        const output = fs.createWriteStream(targetPath, { flags: "wx", mode: 0o600 });
        const fail = (error) => {
          if (settled) return;
          settled = true;
          response.destroy();
          output.destroy();
          reject(error);
        };
        response.on("data", (chunk) => {
          receivedBytes += chunk.length;
          if (receivedBytes > maxBytes) fail(new Error("image response exceeds size limit"));
        });
        response.on("aborted", () => fail(new Error("image response aborted")));
        response.on("error", fail);
        output.on("error", fail);
        output.on("finish", () => {
          if (settled) return;
          settled = true;
          resolve(receivedBytes);
        });
        response.pipe(output);
      });
      request.on("timeout", () => request.destroy(new Error("image request timed out")));
      request.on("error", reject);
      if (signal) {
        if (signal.aborted) request.destroy(new Error("image request aborted"));
        else signal.addEventListener("abort", () => request.destroy(new Error("image request aborted")), { once: true });
      }
    });
  }
}

module.exports = { ImgDownloader };
