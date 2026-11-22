import assert from "node:assert/strict";
import test from "node:test";
import { SimulatorQueueAdapter } from "../src/adapters/simulator.js";
import { evaluateQueueHistory } from "../src/engine/classifier.js";
import { SnapshotStore } from "../src/engine/store.js";
import { AlertThrottler } from "../src/engine/throttler.js";
import type { AlertNotifier } from "../src/notifiers/webhook.js";
import { createHttpServer, WatchdogRuntime } from "../src/server.js";
import type { AlertEvent, QueueSnapshot, WatchdogThresholds } from "../src/types.js";

const THRESHOLDS: WatchdogThresholds = {
  pendingThreshold: 50,
  stalledWindow: 3,
  cooldownMinutes: 60,
};

function makeSnapshot(
  overrides: Partial<QueueSnapshot> & Pick<QueueSnapshot, "pendingCount" | "processedTotal">,
): QueueSnapshot {
  return {
    nodeId: "node-01",
    queueName: "upload",
    capturedAt: "2026-11-22T12:00:00.000Z",
    ...overrides,
  };
}

test("classifier reports OK when pending is below threshold", () => {
  const res = evaluateQueueHistory(
    [makeSnapshot({ pendingCount: 12, processedTotal: 100 })],
    THRESHOLDS,
  );
  assert.equal(res.status, "OK");
});

test("classifier distinguishes draining HIGH_LOAD from STALLED queue", () => {
  const store = new SnapshotStore(10);
  store.append(makeSnapshot({ pendingCount: 80, processedTotal: 100 }));
  store.append(makeSnapshot({ pendingCount: 95, processedTotal: 120 }));
  const historyHighLoad = store.append(makeSnapshot({ pendingCount: 110, processedTotal: 150 }));

  const highLoadEval = evaluateQueueHistory(historyHighLoad, THRESHOLDS);
  assert.equal(highLoadEval.status, "HIGH_LOAD");
  assert.equal(highLoadEval.drainedDelta, 50);

  const stalledStore = new SnapshotStore(10);
  stalledStore.append(makeSnapshot({ pendingCount: 120, processedTotal: 500 }));
  stalledStore.append(makeSnapshot({ pendingCount: 120, processedTotal: 500 }));
  const historyStalled = stalledStore.append(makeSnapshot({ pendingCount: 125, processedTotal: 500 }));

  const stalledEval = evaluateQueueHistory(historyStalled, THRESHOLDS);
  assert.equal(stalledEval.status, "STALLED");
  assert.equal(stalledEval.drainedDelta, 0);
});

test("classifier immediately flags ERROR when lastError is present", () => {
  const res = evaluateQueueHistory(
    [makeSnapshot({ pendingCount: 0, processedTotal: 10, lastError: "Connection refused" })],
    THRESHOLDS,
  );
  assert.equal(res.status, "ERROR");
  assert.match(res.reason, /Connection refused/);
});

test("throttler suppresses duplicate alerts during cooldown and emits RECOVERY", () => {
  const throttler = new AlertThrottler(60);
  const t0 = 1_700_000_000_000;

  const stalledEval = evaluateQueueHistory(
    [
      makeSnapshot({ pendingCount: 100, processedTotal: 10 }),
      makeSnapshot({ pendingCount: 100, processedTotal: 10 }),
      makeSnapshot({ pendingCount: 100, processedTotal: 10 }),
    ],
    THRESHOLDS,
  );

  const first = throttler.evaluate(stalledEval, t0);
  assert.equal(first?.kind, "STALLED");
  assert.equal(throttler.activeIncidentCount(), 1);

  const suppressed = throttler.evaluate(stalledEval, t0 + 10 * 60_000);
  assert.equal(suppressed, null);

  const reAlerted = throttler.evaluate(stalledEval, t0 + 61 * 60_000);
  assert.equal(reAlerted?.kind, "STALLED");

  const recoveredEval = evaluateQueueHistory(
    [makeSnapshot({ pendingCount: 4, processedTotal: 110 })],
    THRESHOLDS,
  );
  const recovery = throttler.evaluate(recoveredEval, t0 + 65 * 60_000);
  assert.equal(recovery?.kind, "RECOVERY");
  assert.equal(throttler.activeIncidentCount(), 0);
});

test("WatchdogRuntime and HTTP server expose live health, status, and dashboard", async () => {
  const captured: AlertEvent[] = [];
  const memoryNotifier: AlertNotifier = {
    async notify(event) {
      captured.push(event);
    },
  };

  const runtime = new WatchdogRuntime({
    adapter: new SimulatorQueueAdapter(),
    notifier: memoryNotifier,
    thresholds: THRESHOLDS,
  });

  await runtime.runOnce();
  await runtime.runOnce();
  await runtime.runOnce();

  assert.ok(captured.some((a) => a.nodeId === "store-03" && a.kind === "STALLED"));

  const server = createHttpServer(runtime);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { status: string; activeIncidents: number };
    assert.equal(healthJson.status, "ok");
    assert.ok(healthJson.activeIncidents >= 1);

    const statusRes = await fetch(`${baseUrl}/api/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as { evaluations: unknown[] };
    assert.equal(statusJson.evaluations.length, 5);

    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /Queue Health Watchdog/);
    assert.match(html, /store-03/);

    const missingRes = await fetch(`${baseUrl}/nonexistent`);
    assert.equal(missingRes.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
