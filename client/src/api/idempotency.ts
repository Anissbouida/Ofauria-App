/**
 * Clé d'idempotence par INTENTION (plan d'exécution multi-industries, étape 8, tâche 5).
 *
 * Le serveur (middleware idempotent, mig 307) rejoue la réponse mémorisée quand la même clé
 * revient. Une même action envoyée deux fois de suite (double clic, reprise réseau) réutilise
 * la même clé pendant une courte fenêtre : elle n'est exécutée qu'une fois. Une action
 * différente (autre ordre, autres quantités) reçoit une nouvelle clé.
 */
const WINDOW_MS = 15_000;
const recent = new Map<string, { key: string; at: number }>();

function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** En-têtes à joindre à une requête de mutation : `api.post(url, body, intentHeaders(url, body))`. */
export function intentHeaders(route: string, body?: unknown): { headers: Record<string, string> } {
  const now = Date.now();
  for (const [k, v] of recent) if (now - v.at > WINDOW_MS) recent.delete(k);
  const sig = `${route}|${JSON.stringify(body ?? null)}`;
  const hit = recent.get(sig);
  const key = hit ? hit.key : newKey();
  recent.set(sig, { key, at: hit?.at ?? now });
  return { headers: { 'Idempotency-Key': key } };
}
