import { SimulatorQueueAdapter } from "./adapters/simulator.js";
import { DEFAULT_THRESHOLDS } from "./engine/classifier.js";
import {
  CompositeNotifier,
  ConsoleNotifier,
  WebhookNotifier,
  type AlertNotifier,
} from "./notifiers/webhook.js";
import { createHttpServer, WatchdogRuntime } from "./server.js";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  const port = parsePositiveInt(process.env.PORT, 3080);
  const pollIntervalMs = parsePositiveInt(process.env.POLL_INTERVAL_MS, 5000);
  const pendingThreshold = parsePositiveInt(
    process.env.PENDING_THRESHOLD,
    DEFAULT_THRESHOLDS.pendingThreshold,
  );
  const stalledWindow = parsePositiveInt(
    process.env.STALLED_WINDOW,
    DEFAULT_THRESHOLDS.stalledWindow,
  );
  const cooldownMinutes = parsePositiveInt(
    process.env.COOLDOWN_MINUTES,
    DEFAULT_THRESHOLDS.cooldownMinutes,
  );

  const notifiers: AlertNotifier[] = [new ConsoleNotifier()];
  if (process.env.WEBHOOK_URL) {
    notifiers.push(new WebhookNotifier(process.env.WEBHOOK_URL));
  }

  const runtime = new WatchdogRuntime({
    adapter: new SimulatorQueueAdapter(),
    notifier: new CompositeNotifier(notifiers),
    thresholds: { pendingThreshold, stalledWindow, cooldownMinutes },
  });

  await runtime.runOnce();
  const timer = setInterval(() => {
    runtime.runOnce().catch((err) => {
      console.error("[watchdog] poll cycle failed:", err);
    });
  }, pollIntervalMs);

  const server = createHttpServer(runtime);
  server.listen(port, () => {
    console.log(`Queue Health Watchdog dashboard listening on http://localhost:${port}`);
  });

  const shutdown = () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal watchdog startup error:", err);
  process.exit(1);
});
