"use strict";

const assert = require("assert");
const { RkeyManager, normalizePayload } = require("../payload/LiteLoaderQQNT/plugins/qq-anti-recall/rkeyManager.js");

(async () => {
    let calls = 0;
    const winningFetch = async (url, { signal }) => {
      calls += 1;
      if (String(url).includes("winner")) {
        await new Promise(resolve => setTimeout(resolve, 15));
        return {
          ok: true,
          async json() {
            return { data: {
              group_rkey: "&rkey=group-key",
              private_rkey: "private-key",
              expired_time: Math.floor(Date.now() / 1000) + 600,
            } };
          },
        };
      }
      return await new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    };
    const manager = new RkeyManager(
      ["https://slow-one.invalid/rkey", "https://winner.invalid/rkey", "https://slow-two.invalid/rkey"],
      { totalTimeoutMs: 100, failureCooldownMs: 1000, fetchImpl: winningFetch }
    );
    const startedAt = Date.now();
    const value = await manager.getRkey();
    assert(Date.now() - startedAt < 80, "the first successful rkey endpoint must win without serial waiting");
    assert.equal(calls, 3, "all endpoints should race within one total budget");
    assert.equal(value.group_rkey, "group-key");
    assert.equal(value.private_rkey, "private-key");

    calls = 0;
    const failingFetch = async (_url, { signal }) => {
      calls += 1;
      return await new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    };
    const failingManager = new RkeyManager(
      ["https://slow-a.invalid/rkey", "https://slow-b.invalid/rkey"],
      { totalTimeoutMs: 35, failureCooldownMs: 1000, fetchImpl: failingFetch }
    );
    const failureStartedAt = Date.now();
    await assert.rejects(() => failingManager.getRkey(), /all rkey endpoints failed/);
    assert(Date.now() - failureStartedAt < 150, "rkey lookup must honor one bounded total timeout");
    assert.equal(calls, 2);
    await assert.rejects(() => failingManager.getRkey(), /cooling down/);
    assert.equal(calls, 2, "the failure cooldown must suppress immediate retry storms");

    assert.deepEqual(normalizePayload({
      retcode: 0,
      data: { group_rkey: "&rkey=g", private_rkey: "rkey=p", expired_time: 123 },
    }), { group_rkey: "g", private_rkey: "p", expired_time: 123 });
    console.log("RKEY_MANAGER_TEST_OK");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
