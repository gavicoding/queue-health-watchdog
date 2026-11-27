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

export type NotifierErrorHandler = (error: unknown, event: AlertEvent, index: number) => void;

const logNotifierError: NotifierErrorHandler = (error, event, index) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(
    `[watchdog] notifier #${index} failed to deliver ${event.kind} for ${event.nodeId}/${event.queueName}: ${detail}`,
  );
};

/**
 * Sends each alert to every notifier. One failing channel never blocks the others,
 * but its failure is reported (by default on stderr) instead of being dropped silently.
 */
export class CompositeNotifier implements AlertNotifier {
  private readonly notifiers: readonly AlertNotifier[];
  private readonly onError: NotifierErrorHandler;

  constructor(notifiers: readonly AlertNotifier[], onError: NotifierErrorHandler = logNotifierError) {
    this.notifiers = notifiers;
    this.onError = onError;
  }

  async notify(event: AlertEvent): Promise<void> {
    const results = await Promise.allSettled(
      this.notifiers.map((notifier) => notifier.notify(event)),
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        this.onError(result.reason, event, index);
      }
    });
  }
}
