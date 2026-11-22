export type HealthStatus = "OK" | "HIGH_LOAD" | "STALLED" | "ERROR";

export type AlertKind = "STALLED" | "ERROR" | "RECOVERY";

export interface QueueSnapshot {
  nodeId: string;
  queueName: string;
  pendingCount: number;
  processedTotal: number;
  lastError?: string | null;
  capturedAt: string;
}

export interface WatchdogThresholds {
  pendingThreshold: number;
  stalledWindow: number;
  cooldownMinutes: number;
}

export interface NodeEvaluation {
  nodeId: string;
  queueName: string;
  status: HealthStatus;
  pendingCount: number;
  drainedDelta: number;
  reason: string;
  lastError: string | null;
  evaluatedAt: string;
}

export interface AlertEvent {
  id: string;
  kind: AlertKind;
  nodeId: string;
  queueName: string;
  status: HealthStatus;
  pendingCount: number;
  message: string;
  timestamp: string;
}

export interface QueueSourceAdapter {
  readonly name: string;
  pollSnapshots(): Promise<QueueSnapshot[]>;
}
