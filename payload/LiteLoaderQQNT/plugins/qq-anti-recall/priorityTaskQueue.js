"use strict";

const PRIORITIES = ["high", "normal", "low"];

class PriorityTaskQueue {
  constructor({ concurrency = 3, maxPending = 48, lowConcurrency } = {}) {
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.maxPending = Math.max(1, Number(maxPending) || 1);
    this.lowConcurrency = lowConcurrency == null
      ? Math.max(1, this.concurrency - 1)
      : Math.max(1, Math.min(this.concurrency, Number(lowConcurrency) || 1));
    this.active = 0;
    this.activeLow = 0;
    this.queues = { high: [], normal: [], low: [] };
    this.jobs = new Map();
  }

  schedule(key, run, priority = "normal") {
    const id = String(key || "");
    if (!id || typeof run !== "function") return null;
    const existing = this.jobs.get(id);
    if (existing) return { promise: existing.promise, isNew: false };

    const normalizedPriority = PRIORITIES.includes(priority) ? priority : "normal";
    if (this.pending >= this.maxPending && !this.evictLowerPriority(normalizedPriority)) return null;

    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const job = { id, priority: normalizedPriority, run, promise, resolve, reject };
    this.jobs.set(id, job);
    this.queues[normalizedPriority].push(job);
    this.drain();
    return { promise, isNew: true };
  }

  evictLowerPriority(incomingPriority) {
    const incomingIndex = PRIORITIES.indexOf(incomingPriority);
    for (let index = PRIORITIES.length - 1; index > incomingIndex; index -= 1) {
      const victim = this.queues[PRIORITIES[index]].shift();
      if (!victim) continue;
      this.jobs.delete(victim.id);
      victim.resolve(false);
      return true;
    }
    return false;
  }

  drain() {
    while (this.active < this.concurrency) {
      const job = this.queues.high.shift()
        || this.queues.normal.shift()
        || (this.activeLow < this.lowConcurrency ? this.queues.low.shift() : null);
      if (!job) return;
      this.active += 1;
      if (job.priority === "low") this.activeLow += 1;
      Promise.resolve()
        .then(job.run)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active -= 1;
          if (job.priority === "low") this.activeLow -= 1;
          if (this.jobs.get(job.id) === job) this.jobs.delete(job.id);
          this.drain();
        });
    }
  }

  promisesWithPrefix(prefix) {
    const wanted = String(prefix || "");
    return Array.from(this.jobs.entries())
      .filter(([key]) => key.startsWith(wanted))
      .map(([, job]) => job.promise);
  }

  allPromises() {
    return Array.from(this.jobs.values(), (job) => job.promise);
  }

  get pending() {
    return this.queues.high.length + this.queues.normal.length + this.queues.low.length;
  }
}

module.exports = { PriorityTaskQueue };
