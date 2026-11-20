/**
 * Vérification de la session au démarrage de l'application (GET /auth/me).
 *
 * Seul un refus explicite (401, 403) veut dire « pas de session ». Une erreur réseau ou
 * serveur (redémarrage de l'API, déploiement, démarrage à froid : le proxy répond 500 ou
 * 502 pendant quelques secondes) n'en dit rien : on réessaie au lieu de renvoyer
 * l'utilisateur vers l'écran de connexion alors que son cookie est toujours valide
 * (scénario 1, constat 56).
 */

/** Statut HTTP porté par une erreur axios, ou null quand aucune réponse n'est arrivée. */
export function httpStatusOf(err: unknown): number | null {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : null;
}

/** Vrai quand le serveur a répondu que la session n'existe pas ou n'est pas autorisée. */
export function isSessionRejected(err: unknown): boolean {
  const status = httpStatusOf(err);
  return status === 401 || status === 403;
}

export interface ProbeOptions {
  /** Nombre total d'essais (le premier compris). */
  attempts?: number;
  /** Attente entre deux essais, en millisecondes. */
  delayMs?: number;
  /** Injectable pour les tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Rend l'utilisateur de la session, ou null si le serveur la refuse. Les erreurs passagères
 * sont réessayées ; si le serveur reste injoignable après tous les essais, on rend null
 * (comportement d'avant), faute de mieux.
 */
export async function probeSession<T>(fetchMe: () => Promise<T>, options: ProbeOptions = {}): Promise<T | null> {
  const attempts = Math.max(1, options.attempts ?? 8);
  const delayMs = options.delayMs ?? 1500;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchMe();
    } catch (err) {
      if (isSessionRejected(err) || attempt >= attempts) return null;
      await sleep(delayMs);
    }
  }
}
