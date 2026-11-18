import { WEBHOOK_EVENTS_LIST, type WebhookEvent } from '@ofauria/shared';
import { webhookRepository } from '../repositories/webhook.repository.js';

/**
 * Émission d'un événement métier vers les webhooks abonnés (G6-08). Met une livraison en
 * file par point abonné, dans la transaction de l'appelant si un client est fourni ; ne fait
 * JAMAIS échouer l'action métier (un incident d'émission est seulement journalisé).
 */
type Runner = Parameters<typeof webhookRepository.enqueue>[2];

export async function emitEvent(event: WebhookEvent, data: Record<string, unknown>, runner?: Runner): Promise<void> {
  if (!WEBHOOK_EVENTS_LIST.includes(event)) return;
  try {
    await webhookRepository.enqueue(event, { event, occurred_at: new Date().toISOString(), data }, runner);
  } catch (err) {
    console.error(`[webhook] émission ${event} impossible :`, err instanceof Error ? err.message : err);
  }
}
