"use strict";

const DEFAULT_ENDPOINTS = [
  "http://127.0.0.1:3000/get_rkey_server",
  "http://127.0.0.1:3001/get_rkey_server",
  "https://llob.linyuchen.net/rkey",
  "https://secret-service.bietiaop.com/rkeys",
  "https://rkey.furrycloud.top",
  "http://ss.xingzhige.com/music_card/rkey",
];
const RKEY_TOTAL_TIMEOUT_MS = 4500;
const RKEY_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

function normalizeRkey(value) {
  return String(value || "").trim().replace(/^&?rkey=/, "");
}

function normalizePayload(value) {
  const root = value && typeof value === "object" ? value : {};
  const data = root.data && typeof root.data === "object" ? root.data : root;
  const group = normalizeRkey(data.group_rkey);
  const privateKey = normalizeRkey(data.private_rkey);
  if (!group || !privateKey) throw new Error("incomplete rkey response");
  return {
    group_rkey: group,
    private_rkey: privateKey,
    expired_time: Number(data.expired_time) || Math.floor(Date.now() / 1000) + 300,
  };
}

class RkeyManager {
  constructor(endpoints = DEFAULT_ENDPOINTS, options = {}) {
    this.endpoints = Array.isArray(endpoints) ? endpoints : [endpoints];
    this.rkeyData = { group_rkey: "", private_rkey: "", expired_time: 0 };
    this.pending = null;
    this.failedUntil = 0;
    this.totalTimeoutMs = Math.max(1, Number(options.totalTimeoutMs) || RKEY_TOTAL_TIMEOUT_MS);
    this.failureCooldownMs = Math.max(1, Number(options.failureCooldownMs) || RKEY_FAILURE_COOLDOWN_MS);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  isExpired() {
    return Date.now() / 1000 >= Number(this.rkeyData.expired_time || 0) - 30;
  }

  async getRkey() {
    if (!this.isExpired() && (this.rkeyData.group_rkey || this.rkeyData.private_rkey)) {
      return this.rkeyData;
    }
    if (Date.now() < this.failedUntil) throw new Error("rkey lookup is cooling down");
    if (this.pending) return this.pending;
    this.pending = this.refreshRkey();
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }

  async refreshRkey() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.totalTimeoutMs);
    const attempts = this.endpoints.map(async (endpoint) => {
      try {
        if (typeof this.fetchImpl !== "function") throw new Error("fetch is unavailable");
        const response = await this.fetchImpl(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return normalizePayload(await response.json());
      } catch (error) {
        throw new Error(`${new URL(endpoint).host}: ${error?.message || error}`);
      }
    });
    try {
      this.rkeyData = await Promise.any(attempts);
      this.failedUntil = 0;
      controller.abort();
      return this.rkeyData;
    } catch (error) {
      this.failedUntil = Date.now() + this.failureCooldownMs;
      const details = Array.isArray(error?.errors)
        ? error.errors.map((item) => item?.message || String(item)).join("; ")
        : String(error?.message || error);
      throw new Error(`all rkey endpoints failed (${details})`);
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }
}

module.exports = { RkeyManager, normalizePayload, normalizeRkey };
