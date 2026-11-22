import type { QueueSnapshot, QueueSourceAdapter } from "../types.js";

/**
 * Deterministic multi-node simulator modeling real store/central replication queues:
 * - node-01: healthy normal traffic
 * - node-02: high backlog, actively draining (HIGH_LOAD -> avoids false alert)
 * - node-03: stalled queue (backlog >= threshold, 0 progress across cycles -> STALLED)
 * - node-04: intermittent error followed by automatic recovery (ERROR -> RECOVERY)
 */
export class SimulatorQueueAdapter implements QueueSourceAdapter {
  readonly name = "multi-node-simulator";
  private cycle = 0;

  async pollSnapshots(): Promise<QueueSnapshot[]> {
    this.cycle += 1;
    const now = new Date().toISOString();
    const n4Error = this.cycle % 6 === 3 || this.cycle % 6 === 4;

    return [
      {
        nodeId: "store-01",
        queueName: "download",
        pendingCount: 8,
        processedTotal: 1000 + this.cycle * 25,
        capturedAt: now,
      },
      {
        nodeId: "store-01",
        queueName: "upload",
        pendingCount: 3,
        processedTotal: 600 + this.cycle * 14,
        capturedAt: now,
      },
      {
        nodeId: "store-02",
        queueName: "download",
        pendingCount: Math.max(55, 180 - this.cycle * 10),
        processedTotal: 4200 + this.cycle * 40,
        capturedAt: now,
      },
      {
        nodeId: "store-03",
        queueName: "upload",
        pendingCount: 142,
        processedTotal: 950,
        capturedAt: now,
      },
      {
        nodeId: "store-04",
        queueName: "download",
        pendingCount: n4Error ? 85 : 12,
        processedTotal: n4Error ? 300 : 300 + this.cycle * 20,
        lastError: n4Error ? "SQL replication timeout on batch #4491" : null,
        capturedAt: now,
      },
    ];
  }
}
