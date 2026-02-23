"use strict";

const DEFAULT_STALE_MS = 60000;

class TabManager {
  constructor(opts = {}) {
    this.staleThresholdMs = opts.staleThresholdMs ?? DEFAULT_STALE_MS;
    this._tabs = new Map();
  }

  register(tabId, platform, runId) {
    this._tabs.set(tabId, {
      tabId,
      platform,
      runId,
      acquiredAt: Date.now(),
    });
  }

  release(tabId) {
    this._tabs.delete(tabId);
  }

  getInfo(tabId) {
    return this._tabs.get(tabId) || null;
  }

  touch(tabId) {
    const info = this._tabs.get(tabId);
    if (info) {
      info.acquiredAt = Date.now();
    }
  }

  getStaleTabs() {
    const cutoff = Date.now() - this.staleThresholdMs;
    const stale = [];
    for (const info of this._tabs.values()) {
      if (info.acquiredAt < cutoff) {
        stale.push(info);
      }
    }
    return stale;
  }

  cleanupStaleTabs() {
    const stale = this.getStaleTabs();
    for (const info of stale) {
      this._tabs.delete(info.tabId);
    }
    return stale.length;
  }

  getTabsForPlatform(platform) {
    const tabs = [];
    for (const info of this._tabs.values()) {
      if (info.platform === platform) tabs.push(info);
    }
    return tabs;
  }

  getTabsForRun(runId) {
    const tabs = [];
    for (const info of this._tabs.values()) {
      if (info.runId === runId) tabs.push(info);
    }
    return tabs;
  }

  releaseRun(runId) {
    const toRemove = [];
    for (const [tabId, info] of this._tabs.entries()) {
      if (info.runId === runId) toRemove.push(tabId);
    }
    for (const tabId of toRemove) {
      this._tabs.delete(tabId);
    }
    return toRemove.length;
  }
}

module.exports = { TabManager };
