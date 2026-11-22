import http from "node:http";
import { DEFAULT_THRESHOLDS, evaluateQueueHistory } from "./engine/classifier.js";
import { SnapshotStore } from "./engine/store.js";
import { AlertThrottler } from "./engine/throttler.js";
import type { AlertNotifier } from "./notifiers/webhook.js";
import type {
  AlertEvent,
  NodeEvaluation,
  QueueSourceAdapter,
  WatchdogThresholds,
} from "./types.js";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export class WatchdogRuntime {
  private readonly adapter: QueueSourceAdapter;
  private readonly store: SnapshotStore;
  private readonly throttler: AlertThrottler;
  private readonly notifier: AlertNotifier;
  private readonly thresholds: WatchdogThresholds;
  private readonly startedAtMs = Date.now();

  private latestEvaluations: NodeEvaluation[] = [];
  private recentAlerts: AlertEvent[] = [];
  private lastRunAt: string | null = null;

  constructor(options: {
    adapter: QueueSourceAdapter;
    notifier: AlertNotifier;
    thresholds?: WatchdogThresholds;
  }) {
    this.adapter = options.adapter;
    this.notifier = options.notifier;
    this.thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
    this.store = new SnapshotStore(Math.max(this.thresholds.stalledWindow * 3, 12));
    this.throttler = new AlertThrottler(this.thresholds.cooldownMinutes);
  }

  async runOnce(nowMs = Date.now()): Promise<{
    evaluations: NodeEvaluation[];
    emittedAlerts: AlertEvent[];
  }> {
    const snapshots = await this.adapter.pollSnapshots();
    const evaluations: NodeEvaluation[] = [];
    const emittedAlerts: AlertEvent[] = [];

    for (const snap of snapshots) {
      const history = this.store.append(snap);
      const evaluation = evaluateQueueHistory(history, this.thresholds);
      evaluations.push(evaluation);

      const alert = this.throttler.evaluate(evaluation, nowMs);
      if (alert) {
        emittedAlerts.push(alert);
        this.recentAlerts.unshift(alert);
        if (this.recentAlerts.length > 50) {
          this.recentAlerts.pop();
        }
        await this.notifier.notify(alert);
      }
    }

    this.latestEvaluations = evaluations;
    this.lastRunAt = new Date(nowMs).toISOString();
    return { evaluations, emittedAlerts };
  }

  getStatusPayload() {
    return {
      adapter: this.adapter.name,
      thresholds: this.thresholds,
      lastRunAt: this.lastRunAt,
      activeIncidents: this.throttler.activeIncidentCount(),
      evaluations: this.latestEvaluations,
      recentAlerts: this.recentAlerts,
    };
  }

  getHealthPayload() {
    return {
      status: "ok",
      uptimeSeconds: Math.floor((Date.now() - this.startedAtMs) / 1000),
      lastRunAt: this.lastRunAt,
      activeIncidents: this.throttler.activeIncidentCount(),
    };
  }
}

function renderDashboardHtml(runtime: WatchdogRuntime): string {
  const status = runtime.getStatusPayload();
  const badgeColor: Record<string, string> = {
    OK: "#16a34a",
    HIGH_LOAD: "#eab308",
    STALLED: "#dc2626",
    ERROR: "#991b1b",
    RECOVERY: "#2563eb",
  };

  const rows = status.evaluations
    .map((ev) => {
      const color = badgeColor[ev.status] ?? "#64748b";
      return `<tr>
        <td><strong>${escapeHtml(ev.nodeId)}</strong></td>
        <td><code>${escapeHtml(ev.queueName)}</code></td>
        <td><span style="background:${color};color:#fff;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600">${escapeHtml(ev.status)}</span></td>
        <td>${ev.pendingCount}</td>
        <td>+${ev.drainedDelta}</td>
        <td>${escapeHtml(ev.reason)}</td>
      </tr>`;
    })
    .join("");

  const alertItems =
    status.recentAlerts.length === 0
      ? "<p style='color:#94a3b8'>No alerts emitted yet.</p>"
      : `<ul>${status.recentAlerts
          .slice(0, 10)
          .map(
            (a) =>
              `<li><code>${escapeHtml(a.timestamp)}</code> - <strong>${escapeHtml(a.kind)}</strong>: ${escapeHtml(a.message)}</li>`,
          )
          .join("")}</ul>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="5" />
  <title>Queue Health Watchdog</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; padding:32px; }
    .wrap { max-width: 1080px; margin: 0 auto; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .meta { color:#94a3b8; margin-bottom:24px; font-size:14px; }
    table { width:100%; border-collapse:collapse; background:#1e293b; border-radius:8px; overflow:hidden; }
    th, td { text-align:left; padding:12px 14px; border-bottom:1px solid #334155; font-size:14px; }
    th { background:#0b1220; color:#94a3b8; font-weight:600; text-transform:uppercase; font-size:12px; }
    .panel { margin-top:24px; background:#1e293b; padding:16px 20px; border-radius:8px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Queue Health Watchdog</h1>
    <div class="meta">Adapter: <strong>${escapeHtml(status.adapter)}</strong> · Last Poll: <code>${escapeHtml(status.lastRunAt ?? "pending")}</code> · Active Incidents: <strong>${status.activeIncidents}</strong></div>
    <table>
      <thead><tr><th>Node</th><th>Queue</th><th>Status</th><th>Pending</th><th>Drained Window</th><th>Heuristic Reason</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="panel">
      <h2 style="margin-top:0;font-size:16px">Recent Alert Events</h2>
      ${alertItems}
    </div>
  </div>
</body>
</html>`;
}

export function createHttpServer(runtime: WatchdogRuntime): http.Server {
  return http.createServer((req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0];

    if (urlPath === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(runtime.getHealthPayload()));
      return;
    }

    if (urlPath === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(runtime.getStatusPayload()));
      return;
    }

    if (urlPath === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderDashboardHtml(runtime));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  });
}
