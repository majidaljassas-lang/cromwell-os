/**
 * Trigger Registry (Universal Ingestion, Phase A)
 *
 * Maps (docType, intent) → handler. Adding a new doctype = registering a
 * handler. The engine never changes again.
 *
 * Coexists with the legacy switch in auto-action.ts: when an event's classified
 * docType has a handler in the registry, the registry wins; otherwise the
 * legacy switch runs. Migrate handlers in over time.
 */
import type { Intent, MessageClassification } from "./classifier";

export interface TriggerContext {
  eventId: string;
  classification: MessageClassification;
  intent: Intent;
  subject: string;
  text: string;
  fromEmail: string;
  fromName: string;
  /** Original ParsedMessage.structuredData payload (subject, headers, etc.). */
  data: Record<string, unknown>;
}

export interface TriggerOutcome {
  eventId: string;
  action: string;
  success: boolean;
  details: string;
  /** IntakeDocument id if the handler created one — feeds resolveTasksForSignal. */
  intakeDocumentId?: string;
}

export type TriggerHandler = (ctx: TriggerContext) => Promise<TriggerOutcome>;

type Key = `${string}:${Intent}`;

class TriggerRegistry {
  private handlers = new Map<Key, TriggerHandler>();

  private keyOf(docType: string, intent: Intent): Key {
    return `${docType}:${intent}`;
  }

  register(docType: string, intent: Intent, handler: TriggerHandler): void {
    const key = this.keyOf(docType, intent);
    if (this.handlers.has(key)) {
      throw new Error(`TriggerRegistry: handler already registered for ${key}`);
    }
    this.handlers.set(key, handler);
  }

  /** Replace any existing handler for the key — explicit override path. */
  overwrite(docType: string, intent: Intent, handler: TriggerHandler): void {
    this.handlers.set(this.keyOf(docType, intent), handler);
  }

  /** Returns null if no handler — caller falls back to legacy path. */
  async dispatch(ctx: TriggerContext): Promise<TriggerOutcome | null> {
    const handler = this.handlers.get(this.keyOf(ctx.classification, ctx.intent));
    if (!handler) return null;
    return handler(ctx);
  }

  has(docType: string, intent: Intent): boolean {
    return this.handlers.has(this.keyOf(docType, intent));
  }

  list(): Array<{ docType: string; intent: Intent }> {
    return Array.from(this.handlers.keys()).map((k) => {
      const [docType, intent] = k.split(":") as [string, Intent];
      return { docType, intent };
    });
  }
}

export const triggerRegistry = new TriggerRegistry();
