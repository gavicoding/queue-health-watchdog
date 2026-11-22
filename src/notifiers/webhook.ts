import type { AlertEvent } from "../types.js";

export interface AlertNotifier {
  notify(event: AlertEvent): Promise<void>;
}

export class ConsoleNotifier implements AlertNotifier {
  async notify(event: AlertEvent): Promise<void> {
    const level = event.kind === "RECOVERY" ? "INFO" : "WARN";
    console.log(`[${event.timestamp}] [${level}] ${event.message}`);
  }
}

export class WebhookNotifier implements AlertNotifier {
  private readonly webhookUrl: string;
  private readonly timeoutMs: number;

  constructor(webhookUrl: string, timeoutMs = 5000) {
    this.webhookUrl = webhookUrl;
    this.timeoutMs = timeoutMs;
  }

  async notify(event: AlertEvent): Promise<void> {
    const payload = {
      text: event.message,
      event,
    };
    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Webhook delivery failed with HTTP ${response.status}`);
    }
  }
}

export class CompositeNotifier implements AlertNotifier {
  private readonly notifiers: readonly AlertNotifier[];

  constructor(notifiers: readonly AlertNotifier[]) {
    this.notifiers = notifiers;
  }

  async notify(event: AlertEvent): Promise<void> {
    await Promise.allSettled(this.notifiers.map((notifier) => notifier.notify(event)));
  }
}
