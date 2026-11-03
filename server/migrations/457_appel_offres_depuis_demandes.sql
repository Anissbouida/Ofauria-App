-- Migration 457 : lien Appel d'offres ↔ Demandes d'achat (sourcing obligatoire)
--
-- POURQUOI
--   Flux procure-to-pay : une DEMANDE D'ACHAT approuvée (mig 456) ne devient pas
--   un BC directement — elle doit passer par le SOURCING (appel d'offres, mig 360)
--   avant qu'un BC soit créé. Décision client 2026-11-03 : sourcing OBLIGATOIRE
--   pour toute DA approuvée, via le module Appels d'offres.
--   Cycle : Identification → Demande d'achat → Approbation → APPEL D'OFFRES →
--   Bon de commande (créé à l'attribution) → Réception → Facturation.
--
-- MODÈLE
--   rfq_requests (N:N) : quelles DA un appel d'offres met en concurrence. L'AO est
--   pré-rempli avec les lignes (ingrédients) des DA sélectionnées ; à l'attribution
--   (rfq.award), le BC créé depuis le devis retenu COUVRE ces DA via request_po_lines
--   (mig 305) — le statut de couverture des DA passe alors « assigned » tout seul.
--   Lien au niveau de l'AO (pas de la ligne d'AO) : il survit à une réédition des
--   lignes du brouillon (replaceItems supprime/recrée rfq_items). La répartition
--   par DA se fait à l'attribution, au prorata de la quantité demandée par article.
--
--   Une DA est « en sourcing » tant qu'elle est liée à un AO vivant
--   (status IN draft/sent/quoted) : elle est alors retirée de « À commander » et de
--   la liste groupée pour ne pas être sourcée deux fois. AO annulé/clôturé → la DA
--   redevient sourçable ; AO attribué → la DA est couverte (assigned).
--
-- INVERSION
--   DROP TABLE rfq_requests.

CREATE TABLE IF NOT EXISTS rfq_requests (
  rfq_id              UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  purchase_request_id UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rfq_id, purchase_request_id)
);
CREATE INDEX IF NOT EXISTS idx_rfq_requests_pr ON rfq_requests (purchase_request_id);

COMMENT ON TABLE rfq_requests IS
  'Demandes d''achat mises en concurrence par un appel d''offres (mig 457). À l''attribution, le BC couvre ces DA (request_po_lines). Une DA liée à un AO vivant est « en sourcing » et retirée de « À commander ».';
