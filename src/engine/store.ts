import type { QueueSnapshot } from "../types.js";

/**
 * Bounded in-memory ring store of recent QueueSnapshots keyed by (nodeId, queueName).
 */
export class SnapshotStore {
  private readonly maxPerQueue: number;
  private readonly series = new Map<string, QueueSnapshot[]>();

  constructor(maxPerQueue = 20) {
    this.maxPerQueue = Math.max(1, maxPerQueue);
  }

  static makeKey(nodeId: string, queueName: string): string {
    return `${nodeId}::${queueName}`;
  }

  append(snapshot: QueueSnapshot): readonly QueueSnapshot[] {
    const key = SnapshotStore.makeKey(snapshot.nodeId, snapshot.queueName);
    const list = this.series.get(key) ?? [];
    list.push(snapshot);
    if (list.length > this.maxPerQueue) {
      list.shift();
    }
    this.series.set(key, list);
    return list;
  }

  getHistory(nodeId: string, queueName: string): readonly QueueSnapshot[] {
    return this.series.get(SnapshotStore.makeKey(nodeId, queueName)) ?? [];
  }

  listKeys(): string[] {
    return [...this.series.keys()];
  }
}
