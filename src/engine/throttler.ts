import crypto from "node:crypto";
import type { AlertEvent, NodeEvaluation } from "../types.js";

interface IncidentState {
  status: "STALLED" | "ERROR";
  lastAlertedAtMs: number;
}

/**
 * Prevents alert fatigue by throttling repeated alerts per (node, queue) within a cooldown window,
 * while immediately emitting a RECOVERY event once the queue returns to OK or HIGH_LOAD.
 */
export class AlertThrottler {
  private readonly cooldownMs: number;
  private readonly activeIncidents = new Map<string, IncidentState>();

  constructor(cooldownMinutes = 60) {
    this.cooldownMs = Math.max(0, cooldownMinutes) * 60_000;
  }

  private static makeKey(nodeId: string, queueName: string): string {
    return `${nodeId}::${queueName}`;
  }

  evaluate(evaluation: NodeEvaluation, nowMs = Date.now()): AlertEvent | null {
    const key = AlertThrottler.makeKey(evaluation.nodeId, evaluation.queueName);
    const active = this.activeIncidents.get(key);

    if (evaluation.status === "STALLED" || evaluation.status === "ERROR") {
      const escalated = active !== undefined && active.status !== evaluation.status;
      const cooldownElapsed =
        active !== undefined && nowMs - active.lastAlertedAtMs >= this.cooldownMs;

      if (!active || escalated || cooldownElapsed) {
        this.activeIncidents.set(key, {
          status: evaluation.status,
          lastAlertedAtMs: nowMs,
        });
        return {
          id: crypto.randomUUID(),
          kind: evaluation.status,
          nodeId: evaluation.nodeId,
          queueName: evaluation.queueName,
          status: evaluation.status,
          pendingCount: evaluation.pendingCount,
          message: `[${evaluation.status}] ${evaluation.nodeId}/${evaluation.queueName}: ${evaluation.reason}`,
          timestamp: new Date(nowMs).toISOString(),
        };
      }
      return null;
    }

    if (active) {
      this.activeIncidents.delete(key);
      return {
        id: crypto.randomUUID(),
        kind: "RECOVERY",
        nodeId: evaluation.nodeId,
        queueName: evaluation.queueName,
        status: evaluation.status,
        pendingCount: evaluation.pendingCount,
        message: `[RECOVERY] ${evaluation.nodeId}/${evaluation.queueName} recovered (${evaluation.status}, pending=${evaluation.pendingCount}).`,
        timestamp: new Date(nowMs).toISOString(),
      };
    }

    return null;
  }

  activeIncidentCount(): number {
    return this.activeIncidents.size;
  }
}
