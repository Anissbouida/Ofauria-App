-- Migration 305 : Demandes d'achat — couverture dérivée par ligne de BC, statut calculé,
-- motif d'annulation, piste d'audit (refonte Achats, domaine D2, lot 1 : G-D2-02, G-D2-03, G-D2-13)
--
-- POURQUOI
--   Aujourd'hui le statut d'une DA est ÉCRIT par le code à partir du statut d'en-tête du BC :
--   - toutes les DA d'un BC passent « reçues » même si la ligne de leur article est arrivée à 0 ;
--   - un BC annulé, « non livré » ou supprimé laisse ses DA « attribuées » à vie, et l'économat
--     masque alors le bouton « Commander » pour l'ingrédient (incident BSI-260817-001, mig 271) ;
--   - generatePurchaseOrder marque « attribuées » les ids reçus du client, pas ceux réellement
--     verrouillés et commandés.
--   Dans SAP / Oracle / Odoo, la couverture d'une demande est PAR LIGNE et DÉRIVÉE des quantités
--   commandées et reçues sur les lignes de BC qui la couvrent. Une annulation de BC rend la ligne
--   à nouveau « à commander » sans qu'aucun code ne l'oublie.
--
-- MODÈLE
--   purchase_requests (une ligne de besoin ; l'en-tête de DA viendra avec G-D2-01)
--   request_po_lines  (N:N) : quelle part de la demande est couverte par quelle ligne de BC
--   fn_recompute_purchase_request(id) : seule fonction qui écrit status / purchase_order_id,
--     appelée par triggers sur request_po_lines, purchase_order_items et purchase_orders.
--   Statuts : pending (rien de commandé) · assigned (commandé, totalement ou partiellement)
--             · received (quantité reçue ≥ demandée) · closed (reliquat clôturé à la main)
--             · cancelled. 'ordered' reste admis pour compatibilité mais n'est plus produit.
--   BC qui ne couvrent plus rien : 'annule' et 'non_livre'.
--
-- INVERSION
--   DROP TRIGGER purchase_orders_request_coverage, purchase_order_items_request_coverage,
--   request_po_lines_coverage, purchase_requests_document_audit, purchase_requests_guard ;
--   DROP FUNCTION fn_recompute_purchase_request, fn_recompute_purchase_requests_for_po,
--   trg_*_request_coverage, trg_purchase_requests_guard, log_purchasing_document_change ;
--   DROP VIEW v_purchase_request_coverage ; DROP TABLE request_po_lines, purchasing_document_audit ;
--   ALTER TABLE purchase_requests DROP COLUMN cancelled_by, cancelled_at, cancel_reason,
--   closed_by, closed_at, close_reason, updated_by ; remettre l'ancien CHECK de statut.

-- ═══════════════════════════════════════════════════════════════════════
-- 0. Reliquat de la 304 : l'entrée « Traite » sans code a un code NULL, pas ''.
-- ═══════════════════════════════════════════════════════════════════════
DELETE FROM ref_entries
 WHERE table_id = 'payment_methods' AND (code IS NULL OR trim(code) = '') AND is_active = false;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Colonnes de traçabilité et statut 'closed'
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE purchase_requests
  ADD COLUMN IF NOT EXISTS updated_by    UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_by  UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS closed_by     UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS closed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS close_reason  TEXT;

ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_status_check;
ALTER TABLE purchase_requests ADD CONSTRAINT purchase_requests_status_check
  CHECK (status IN ('pending', 'assigned', 'ordered', 'received', 'closed', 'cancelled'));

ALTER TABLE purchase_requests ADD CONSTRAINT chk_purchase_requests_cancel_trace
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL);
ALTER TABLE purchase_requests ADD CONSTRAINT chk_purchase_requests_close_trace
  CHECK (status <> 'closed' OR (closed_at IS NOT NULL AND close_reason IS NOT NULL));

COMMENT ON COLUMN purchase_requests.status IS
  'Calculé par fn_recompute_purchase_request (mig 305) à partir de request_po_lines ; seuls cancelled et closed sont posés par une action humaine.';
COMMENT ON COLUMN purchase_requests.purchase_order_id IS
  'Compatibilité : dernier BC vivant qui couvre la demande, entretenu par fn_recompute_purchase_request. Source de vérité : request_po_lines.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Lien N:N demande ↔ ligne de BC
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS request_po_lines (
  purchase_request_id UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  po_item_id          UUID NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  -- Part de la demande couverte par cette ligne de BC, dans l'unité de la demande.
  quantity            NUMERIC(12,4) NOT NULL CHECK (quantity > 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID REFERENCES users(id),
  PRIMARY KEY (purchase_request_id, po_item_id)
);
CREATE INDEX IF NOT EXISTS idx_request_po_lines_item ON request_po_lines (po_item_id);
COMMENT ON TABLE request_po_lines IS
  'Couverture d''une demande d''achat par une ligne de BC (mig 305). Un BC annulé ne couvre plus rien : la demande retombe d''elle-même à commander.';

-- Couverture dérivée. La part reçue est proportionnelle à la livraison de la ligne de BC,
-- plafonnée à 100 % tant que la réception n'est pas bornée (sur-livraisons existantes).
CREATE OR REPLACE VIEW v_purchase_request_coverage AS
SELECT pr.id AS purchase_request_id,
       pr.quantity AS quantity_requested,
       COALESCE(SUM(x.quantity) FILTER (WHERE po.status NOT IN ('annule', 'non_livre')), 0) AS quantity_ordered,
       COALESCE(SUM(x.quantity * LEAST(1, poi.quantity_delivered / NULLIF(poi.quantity_ordered, 0)))
                FILTER (WHERE po.status NOT IN ('annule', 'non_livre')), 0) AS quantity_received,
       (ARRAY_AGG(po.id ORDER BY po.created_at DESC) FILTER (WHERE po.status NOT IN ('annule', 'non_livre')))[1] AS live_purchase_order_id,
       COUNT(x.po_item_id) FILTER (WHERE po.status IN ('annule', 'non_livre')) AS dead_links
  FROM purchase_requests pr
  LEFT JOIN request_po_lines x ON x.purchase_request_id = pr.id
  LEFT JOIN purchase_order_items poi ON poi.id = x.po_item_id
  LEFT JOIN purchase_orders po ON po.id = poi.purchase_order_id
 GROUP BY pr.id, pr.quantity;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Recalcul : seul point d'écriture du statut
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_recompute_purchase_request(p_id UUID)
RETURNS VOID AS $$
DECLARE
  v_req  purchase_requests%ROWTYPE;
  v_cov  v_purchase_request_coverage%ROWTYPE;
  v_new  VARCHAR(20);
BEGIN
  SELECT * INTO v_req FROM purchase_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_req.status IN ('cancelled', 'closed') THEN RETURN; END IF;

  SELECT * INTO v_cov FROM v_purchase_request_coverage WHERE purchase_request_id = p_id;

  v_new := CASE
    WHEN v_cov.quantity_ordered <= 0 THEN 'pending'
    WHEN v_cov.quantity_received >= v_req.quantity - 0.0001 THEN 'received'
    ELSE 'assigned'
  END;

  -- Mise à jour seulement si quelque chose change (évite le bruit d'audit).
  UPDATE purchase_requests
     SET status = v_new,
         purchase_order_id = v_cov.live_purchase_order_id,
         updated_by = NULL,          -- écriture système : pas d'auteur humain
         updated_at = now()
   WHERE id = p_id
     AND (status IS DISTINCT FROM v_new OR purchase_order_id IS DISTINCT FROM v_cov.live_purchase_order_id);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_recompute_purchase_requests_for_po(p_po_id UUID)
RETURNS INTEGER AS $$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT x.purchase_request_id
      FROM request_po_lines x JOIN purchase_order_items poi ON poi.id = x.po_item_id
     WHERE poi.purchase_order_id = p_po_id
  LOOP
    PERFORM fn_recompute_purchase_request(r.purchase_request_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

-- Triggers : toute variation côté BC ou lien recalcule les demandes concernées.
CREATE OR REPLACE FUNCTION trg_request_po_lines_coverage()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM fn_recompute_purchase_request(COALESCE(NEW.purchase_request_id, OLD.purchase_request_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS request_po_lines_coverage ON request_po_lines;
CREATE TRIGGER request_po_lines_coverage
  AFTER INSERT OR UPDATE OR DELETE ON request_po_lines
  FOR EACH ROW EXECUTE FUNCTION trg_request_po_lines_coverage();

CREATE OR REPLACE FUNCTION trg_purchase_order_items_request_coverage()
RETURNS TRIGGER AS $$
DECLARE r RECORD;
BEGIN
  -- La suppression d'une ligne de BC supprime ses liens en cascade (le trigger de
  -- request_po_lines recalcule) ; ici on traite les variations de quantité.
  FOR r IN SELECT purchase_request_id FROM request_po_lines WHERE po_item_id = NEW.id LOOP
    PERFORM fn_recompute_purchase_request(r.purchase_request_id);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS purchase_order_items_request_coverage ON purchase_order_items;
CREATE TRIGGER purchase_order_items_request_coverage
  AFTER UPDATE OF quantity_ordered, quantity_delivered ON purchase_order_items
  FOR EACH ROW
  WHEN (OLD.quantity_ordered IS DISTINCT FROM NEW.quantity_ordered OR OLD.quantity_delivered IS DISTINCT FROM NEW.quantity_delivered)
  EXECUTE FUNCTION trg_purchase_order_items_request_coverage();

CREATE OR REPLACE FUNCTION trg_purchase_orders_request_coverage()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM fn_recompute_purchase_requests_for_po(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS purchase_orders_request_coverage ON purchase_orders;
CREATE TRIGGER purchase_orders_request_coverage
  AFTER UPDATE OF status ON purchase_orders
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_purchase_orders_request_coverage();

-- Garde : une demande annulée ou clôturée ne revient jamais par une écriture de code ;
-- les actions humaines doivent laisser leur trace.
CREATE OR REPLACE FUNCTION trg_purchase_requests_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('cancelled', 'closed') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Demande d''achat % : statut % définitif', OLD.id, OLD.status
      USING ERRCODE = 'OF409';
  END IF;
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS purchase_requests_guard ON purchase_requests;
CREATE TRIGGER purchase_requests_guard
  BEFORE UPDATE ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION trg_purchase_requests_guard();

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Piste d'audit des documents d'achat (append-only)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS purchasing_document_audit (
  id          BIGSERIAL PRIMARY KEY,
  table_name  VARCHAR(60) NOT NULL,
  operation   VARCHAR(10) NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  record_id   UUID NOT NULL,
  changed_by  UUID REFERENCES users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  diff        JSONB,
  old_row     JSONB,
  new_row     JSONB
);
CREATE INDEX IF NOT EXISTS idx_pda_record ON purchasing_document_audit (table_name, record_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pda_date   ON purchasing_document_audit (changed_at DESC);
COMMENT ON TABLE purchasing_document_audit IS
  'Journal SGBD append-only des documents d''achat : demandes et leurs couvertures (mig 305). Les BC, réceptions et factures s''y ajouteront avec leurs domaines.';

DROP TRIGGER IF EXISTS purchasing_document_audit_append_only ON purchasing_document_audit;
CREATE TRIGGER purchasing_document_audit_append_only
  BEFORE UPDATE OR DELETE ON purchasing_document_audit
  FOR EACH ROW EXECUTE FUNCTION trg_audit_append_only();   -- fonction de la mig 304

CREATE OR REPLACE FUNCTION log_purchasing_document_change()
RETURNS TRIGGER AS $$
DECLARE
  v_old  JSONB; v_new JSONB; v_diff JSONB := '{}'::jsonb; v_key TEXT;
  v_by   UUID; v_ctx TEXT; v_rec UUID;
  v_noise TEXT[] := ARRAY['updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN v_old := to_jsonb(OLD);
  ELSIF TG_OP = 'INSERT' THEN v_new := to_jsonb(NEW);
  ELSE
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    FOR v_key IN SELECT jsonb_object_keys(v_old || v_new) LOOP
      IF NOT (v_key = ANY (v_noise)) AND (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
        v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      END IF;
    END LOOP;
    IF v_diff = '{}'::jsonb THEN RETURN NULL; END IF;
  END IF;

  v_rec := COALESCE((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid,
                    (v_new ->> 'purchase_request_id')::uuid, (v_old ->> 'purchase_request_id')::uuid);
  -- Auteur : updated_by posé par l'écriture humaine (le recalcul automatique le remet à NULL),
  -- requested_by à la création, sinon le contexte de session posé par l'API.
  v_by := COALESCE((v_new ->> 'updated_by')::uuid,
                   CASE WHEN TG_OP = 'INSERT' THEN COALESCE((v_new ->> 'requested_by')::uuid, (v_new ->> 'created_by')::uuid) END);
  IF v_by IS NULL THEN
    v_ctx := current_setting('app.user_id', true);
    IF v_ctx IS NOT NULL AND v_ctx <> '' THEN v_by := v_ctx::uuid; END IF;
  END IF;

  INSERT INTO purchasing_document_audit (table_name, operation, record_id, changed_by, diff, old_row, new_row)
  VALUES (TG_TABLE_NAME, TG_OP, v_rec, v_by, NULLIF(v_diff, '{}'::jsonb), v_old, v_new);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS purchase_requests_document_audit ON purchase_requests;
CREATE TRIGGER purchase_requests_document_audit
  AFTER INSERT OR UPDATE OR DELETE ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION log_purchasing_document_change();

DROP TRIGGER IF EXISTS request_po_lines_document_audit ON request_po_lines;
CREATE TRIGGER request_po_lines_document_audit
  AFTER INSERT OR UPDATE OR DELETE ON request_po_lines
  FOR EACH ROW EXECUTE FUNCTION log_purchasing_document_change();

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Reprise : 31 demandes liées à un BC → une couverture par ligne de BC du même article
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO request_po_lines (purchase_request_id, po_item_id, quantity, created_at, created_by)
SELECT pr.id, poi.id, pr.quantity, pr.updated_at, pr.requested_by
  FROM purchase_requests pr
  JOIN purchase_order_items poi
    ON poi.purchase_order_id = pr.purchase_order_id
   AND poi.ingredient_id = pr.ingredient_id
 WHERE pr.purchase_order_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Recalcul de tout le stock de demandes (idempotent).
SELECT fn_recompute_purchase_request(id) FROM purchase_requests;

DO $$
DECLARE v_orphan INT; v_changed INT;
BEGIN
  -- Toute demande rattachée à un BC doit avoir trouvé sa ligne.
  SELECT count(*) INTO v_orphan FROM purchase_requests pr
   WHERE pr.purchase_order_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM request_po_lines x WHERE x.purchase_request_id = pr.id);
  IF v_orphan > 0 THEN RAISE EXCEPTION 'mig 305 : % demande(s) rattachée(s) à un BC sans ligne correspondante', v_orphan; END IF;
END $$;
