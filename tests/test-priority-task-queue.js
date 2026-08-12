"use strict";

const assert = require("assert");
const { PriorityTaskQueue } = require("../payload/LiteLoaderQQNT/plugins/qq-anti-recall/priorityTaskQueue.js");

(async () => {
  let active = 0;
  let maxActive = 0;
  const gates = [];
  const queue = new PriorityTaskQueue({ concurrency: 3, maxPending: 2 });
  const run = (name) => async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => gates.push({ name, resolve }));
    active -= 1;
    return name;
  };

  const activeJobs = ["a", "b", "c"].map((name) => queue.schedule(name, run(name), "normal"));
  await new Promise((resolve) => setImmediate(resolve));
  const low1 = queue.schedule("low-1", run("low-1"), "low");
  const low2 = queue.schedule("low-2", run("low-2"), "low");
  const high = queue.schedule("high", run("high"), "high");
  assert(high?.isNew, "a live image must evict queued historical work when the queue is full");
  assert.equal(await low1.promise, false, "the oldest low-priority job should be evicted");

  while (gates.length || queue.active || queue.pending) {
    const gate = gates.shift();
    if (gate) gate.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
  await Promise.allSettled([...activeJobs.map((job) => job.promise), low2.promise, high.promise]);
  assert(maxActive <= 3, "the queue must cap actual task concurrency");

  const reservedQueue = new PriorityTaskQueue({ concurrency: 3, maxPending: 20 });
  const lowGates = [];
  const started = [];
  const lowRun = (name) => async () => {
    started.push(name);
    await new Promise((resolve) => lowGates.push(resolve));
    return name;
  };
  reservedQueue.schedule("history-1", lowRun("history-1"), "low");
  reservedQueue.schedule("history-2", lowRun("history-2"), "low");
  reservedQueue.schedule("history-3", lowRun("history-3"), "low");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["history-1", "history-2"],
    "historical tasks must leave one worker available for live work");
  const live = reservedQueue.schedule("live", async () => {
    started.push("live");
    return "live";
  }, "high");
  assert.equal(await live.promise, "live");
  assert.equal(started[2], "live", "live work must start without waiting for historical downloads");
  while (lowGates.length || reservedQueue.active || reservedQueue.pending) {
    const resolve = lowGates.shift();
    if (resolve) resolve();
    await new Promise((onImmediate) => setImmediate(onImmediate));
  }
  console.log("PRIORITY_TASK_QUEUE_TEST_OK");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
