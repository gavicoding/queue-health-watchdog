import type {
  HealthStatus,
  NodeEvaluation,
  QueueSnapshot,
  WatchdogThresholds,
} from "../types.js";

export const DEFAULT_THRESHOLDS: WatchdogThresholds = {
  pendingThreshold: 50,
  stalledWindow: 3,
  cooldownMinutes: 60,
};

/**
 * Evaluates a chronological list of queue snapshots for a single (node, queue) pair.
 * Distinguishes legitimate HIGH_LOAD (pending >= threshold, but draining)
 * from STALLED (pending >= threshold and consumer throughput stagnant across the window).
 */
export function evaluateQueueHistory(
  history: readonly QueueSnapshot[],
  thresholds: WatchdogThresholds = DEFAULT_THRESHOLDS,
): NodeEvaluation {
  if (history.length === 0) {
    throw new Error("Cannot evaluate an empty snapshot history.");
  }

  const latest = history[history.length - 1];
  const windowSize = Math.max(1, thresholds.stalledWindow);
  const windowStartIdx = Math.max(0, history.length - windowSize);
  const baseline = history[windowStartIdx];
  const drainedDelta = Math.max(0, latest.processedTotal - baseline.processedTotal);

  let status: HealthStatus;
  let reason: string;

  if (latest.lastError && latest.lastError.trim().length > 0) {
    status = "ERROR";
    reason = `Worker reported error: ${latest.lastError.trim()}`;
  } else if (latest.pendingCount < thresholds.pendingThreshold) {
    status = "OK";
    reason = `Pending (${latest.pendingCount}) is below threshold (${thresholds.pendingThreshold}).`;
  } else if (history.length < windowSize) {
    status = "HIGH_LOAD";
    reason = `Pending (${latest.pendingCount}) >= ${thresholds.pendingThreshold}; observing trend (${history.length}/${windowSize} samples).`;
  } else if (drainedDelta > 0 || latest.pendingCount < baseline.pendingCount) {
    status = "HIGH_LOAD";
    reason = `High backlog (${latest.pendingCount}), but consumer drained ${drainedDelta} items in last ${windowSize} cycles.`;
  } else {
    status = "STALLED";
    reason = `Backlog (${latest.pendingCount}) stagnant with 0 items processed over ${windowSize} consecutive cycles.`;
  }

  return {
    nodeId: latest.nodeId,
    queueName: latest.queueName,
    status,
    pendingCount: latest.pendingCount,
    drainedDelta,
    reason,
    lastError: latest.lastError ?? null,
    evaluatedAt: latest.capturedAt,
  };
}
