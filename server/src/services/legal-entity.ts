import { legalEntityRepository, type LegalEntityRow } from '../repositories/legal-entity.repository.js';

/**
 * G6-03 — entité juridique du contexte (helper serveur unique).
 *
 *   entityForStore(storeId) : entité de l'établissement ; établissement inconnu ou absent → entité par défaut.
 *   currentEntity(req)      : entité de l'établissement de l'utilisateur connecté, sinon par défaut.
 *   resolveLegalEntity(ctx) : entité explicite > établissement > défaut.
 *
 * Renvoie null tant que la mig 608 n'est pas passée : les appelants retombent alors sur
 * company_settings (comportement historique). Une installation mono-société n'a qu'une
 * entité, miroir exact de company_settings : toutes les résolutions donnent la même.
 *
 * Cache court (5 s par défaut, LEGAL_ENTITY_CACHE_MS ; désactivé sous vitest pour que les
 * tests qui modifient la société en SQL relisent tout de suite). Les écritures de ce
 * module et de Paramètres › Entreprise vident le cache (clearLegalEntityCache).
 *
 * Analogie Oracle : c'est le « MO_GLOBAL.get_current_org_id » d'E-Business Suite, en plus
 * modeste — l'organisation est déduite de l'établissement de la session.
 */
export interface LegalContext {
  /** Entité imposée (prioritaire). */
  entityId?: string | null;
  /** Établissement de la pièce ou de la requête. */
  storeId?: string | null;
}

const TTL_MS = (() => {
  const raw = process.env.LEGAL_ENTITY_CACHE_MS;
  if (raw !== undefined && raw !== '') return Math.max(0, Number(raw) || 0);
  return process.env.VITEST ? 0 : 5000;
})();

const cache = new Map<string, { at: number; value: LegalEntityRow | null }>();

async function cached(key: string, load: () => Promise<LegalEntityRow | null>): Promise<LegalEntityRow | null> {
  if (TTL_MS > 0) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  }
  const value = await load();
  if (TTL_MS > 0) cache.set(key, { at: Date.now(), value });
  return value;
}

export function clearLegalEntityCache(): void {
  cache.clear();
}

export async function defaultEntity(): Promise<LegalEntityRow | null> {
  if (!(await legalEntityRepository.available())) return null;
  return cached('default', () => legalEntityRepository.findDefault());
}

export async function entityForStore(storeId: string | null | undefined): Promise<LegalEntityRow | null> {
  if (!storeId) return defaultEntity();
  if (!(await legalEntityRepository.available())) return null;
  const e = await cached(`store:${storeId}`, () => legalEntityRepository.findByStore(storeId));
  return e ?? defaultEntity();
}

export async function resolveLegalEntity(ctx: LegalContext = {}): Promise<LegalEntityRow | null> {
  if (ctx.entityId) {
    if (!(await legalEntityRepository.available())) return null;
    const id = ctx.entityId;
    const e = await cached(`entity:${id}`, () => legalEntityRepository.findById(id));
    if (e) return e;
  }
  return entityForStore(ctx.storeId);
}

/** Contexte de la requête : établissement de l'utilisateur connecté. */
export function requestLegalContext(req: { user?: { storeId?: string } } | null | undefined): LegalContext {
  return { storeId: req?.user?.storeId ?? null };
}

export async function currentEntity(req: { user?: { storeId?: string } } | null | undefined): Promise<LegalEntityRow | null> {
  return resolveLegalEntity(requestLegalContext(req));
}
