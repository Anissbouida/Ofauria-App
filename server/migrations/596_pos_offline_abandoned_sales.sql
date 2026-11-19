-- 596 — G0-21 (reste) : journal serveur des ventes hors ligne abandonnées.
--
-- Une vente encaissée hors ligne puis refusée par le serveur (caisse fermée, stock,
-- promotion épuisée…) peut être abandonnée par le caissier, avec un motif. Jusqu'ici
-- l'abandon restait dans le navigateur de la caisse (50 derniers) : la direction n'en
-- voyait rien, alors que la marchandise est sortie et que l'argent a pu être encaissé.
-- La caisse remonte désormais chaque abandon ici (POST /sales/offline-abandoned) ; la
-- direction le consulte (GET, onglet Sessions des ventes).
--
-- Une ligne par vente abandonnée, identifiée par sa clé d'idempotence (le renvoi d'un
-- même abandon ne crée pas de doublon). `payload` garde la vente telle que la caisse
-- l'aurait envoyée. `sale_id` : renseigné si une vente porte déjà cette clé au moment
-- de la remontée (abandon sur une caisse alors qu'elle est passée depuis une autre copie).
-- Aucune écriture comptable ni mouvement de stock : c'est un journal de contrôle.
--
-- INVERSION : DROP TABLE pos_offline_abandoned_sales;

CREATE TABLE IF NOT EXISTS pos_offline_abandoned_sales (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  VARCHAR(64) NOT NULL UNIQUE,
  store_id         UUID REFERENCES stores(id) ON DELETE SET NULL,
  abandoned_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  queued_at        TIMESTAMPTZ,
  rejected_at      TIMESTAMPTZ,
  abandoned_at     TIMESTAMPTZ NOT NULL,
  total            NUMERIC(12,2),
  summary          VARCHAR(300),
  reject_reason    VARCHAR(500) NOT NULL,
  reject_status    SMALLINT,
  reject_code      VARCHAR(80),
  abandon_reason   VARCHAR(200) NOT NULL CHECK (length(btrim(abandon_reason)) >= 3),
  payload          JSONB NOT NULL,
  sale_id          UUID REFERENCES sales(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_offline_abandoned_store ON pos_offline_abandoned_sales (store_id, abandoned_at DESC);
COMMENT ON TABLE pos_offline_abandoned_sales IS
  'Ventes hors ligne refusées par le serveur puis abandonnées à la caisse, avec motif (G0-21, mig 596). Journal de contrôle : ni stock ni écriture.';
