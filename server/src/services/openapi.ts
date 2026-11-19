import { WEBHOOK_EVENT_CATALOG } from '@ofauria/shared';
import { z } from 'zod';
import { publicOrderSchema } from '../validators/public-order.validator.js';

/**
 * Description OpenAPI 3.1 de l'API publique (G6-08), générée à partir du registre des points
 * publics (PUBLIC_ENDPOINTS, tenu à côté de public.routes.ts) et du catalogue des événements
 * de webhook (shared). Servie en JSON et rendue en page de documentation lisible.
 */
type Endpoint = {
  method: 'get' | 'post'; path: string; scope: string | null; summary: string; description: string;
  requestBody?: Record<string, unknown>; response: Record<string, unknown>;
};

const ProductSchema = { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, price: { type: 'number' }, category: { type: 'string', nullable: true }, is_available: { type: 'boolean' } } };

export const PUBLIC_ENDPOINTS: Endpoint[] = [
  { method: 'get', path: '/v1/ping', scope: null, summary: 'Vérifier la clé d\'API', description: 'Répond si la clé d\'API est valide et active.', response: { type: 'object', properties: { ok: { type: 'boolean' } } } },
  { method: 'get', path: '/v1/products', scope: 'products:read', summary: 'Catalogue', description: 'Produits disponibles à la vente, avec leur prix.', response: { type: 'array', items: ProductSchema } },
  {
    method: 'post', path: '/v1/orders', scope: 'orders:create', summary: 'Créer une commande', description: 'Enregistre une commande client (en-tête Idempotency-Key recommandé) ; émet l\'événement order.created.',
    // Généré depuis le schéma de validation de la route : la description ne peut pas diverger.
    requestBody: zodToJsonSchema(publicOrderSchema),
    response: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, order_number: { type: 'string' }, status: { type: 'string' } } },
  },
];

/** zod → JSON Schema : conversion native de zod 4 (`z.toJSONSchema`), côté entrée (ce que le
 *  client envoie : avant coercitions et transformations). Les parties non représentables
 *  (transformations libres) deviennent « n'importe quelle valeur » au lieu de faire échouer. */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', target: 'draft-2020-12' }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

export function buildOpenApi(serverUrl = '/api/v1/public') {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of PUBLIC_ENDPOINTS) {
    paths[e.path] = {
      ...(paths[e.path] ?? {}),
      [e.method]: {
        summary: e.summary, description: e.description,
        security: [{ apiKey: e.scope ? [e.scope] : [] }],
        ...(e.requestBody ? { requestBody: { required: true, content: { 'application/json': { schema: e.requestBody } } } } : {}),
        responses: {
          200: { description: 'Succès', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: e.response } } } } },
          401: { description: 'Clé d\'API absente, invalide ou sans le droit requis' },
          429: { description: 'Trop de requêtes' },
        },
      },
    };
  }
  const webhooks: Record<string, unknown> = {};
  for (const ev of WEBHOOK_EVENT_CATALOG) {
    webhooks[ev.event] = {
      post: {
        summary: ev.label, description: `${ev.description} Corps signé en HMAC-SHA256 (en-tête X-Kalum-Signature) avec le secret du point d'abonnement.`,
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { event: { type: 'string', const: ev.event }, occurred_at: { type: 'string', format: 'date-time' }, data: { type: 'object' } } } } } },
        responses: { 200: { description: 'Accusé de réception ; toute autre réponse déclenche une nouvelle tentative' } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'API publique Kalum', version: '1.0.0', description: 'Catalogue, commandes et événements métier. Authentification par clé d\'API (en-tête Authorization: Bearer <clé>), droits par portée.' },
    servers: [{ url: serverUrl }],
    components: { securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'Clé d\'API créée dans Paramètres › Intégrations' } } },
    paths, webhooks,
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Page de documentation autonome (aucun script externe). */
export function renderDocsHtml(spec: ReturnType<typeof buildOpenApi>): string {
  const ep = PUBLIC_ENDPOINTS.map(e => `<section><h3><code>${e.method.toUpperCase()} ${esc(spec.servers[0].url + e.path)}</code></h3><p>${esc(e.description)}</p><p>Portée : <code>${esc(e.scope ?? 'aucune')}</code></p>${e.requestBody ? `<details><summary>Corps de la requête</summary><pre>${esc(JSON.stringify(e.requestBody, null, 2))}</pre></details>` : ''}</section>`).join('');
  const wh = WEBHOOK_EVENT_CATALOG.map(e => `<li><code>${esc(e.event)}</code> — ${esc(e.label)} : ${esc(e.description)}</li>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>API publique Kalum</title>
<style>body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#222;line-height:1.5}code,pre{background:#f4f4f5;border-radius:4px;padding:.1rem .3rem}pre{padding:.75rem;overflow:auto}section{border-top:1px solid #e5e5e5;padding-top:.5rem}</style></head>
<body><h1>${esc(spec.info.title)}</h1><p>${esc(spec.info.description)}</p><p>Description OpenAPI : <a href="openapi.json">openapi.json</a></p>
<h2>Points d'accès</h2>${ep}<h2>Événements (webhooks)</h2><p>Chaque livraison est signée : <code>X-Kalum-Signature = HMAC-SHA256(secret, corps)</code>. Une réponse autre que 2xx déclenche jusqu'à 6 tentatives.</p><ul>${wh}</ul></body></html>`;
}
