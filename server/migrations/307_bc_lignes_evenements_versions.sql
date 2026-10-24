-- Migration 307 : Bon de commande — ligne en double unité figée, journal des événements de ligne,
-- compteurs dérivés, clôture du reliquat non destructive, versions (avenants), suppression interdite
-- d'un BC engagé, unicité de la facture auto (refonte Achats, domaine D4, lot 1 :
-- G-D4-03, G-D4-04, G-D4-07, G-D4-10, G-D4-19)
--
-- POURQUOI
--   - La ligne de BC ne garde que la quantité en unité de base : le nombre de sacs commandé est perdu,
--     le prix n'a ni remise, ni TVA, ni catégorie figée.
--   - La quantité livrée est un compteur que trois chemins écrivent à la main (réception, édition
--     admin, annulation de réception) : 16 lignes divergent de la somme des réceptions, 11 lignes
--     sont sur-livrées de plus de 10 %, deux BC « livrés » n'ont aucun bon de réception.
--   - La clôture forcée d'une réception SUPPRIME les lignes non livrées et RÉÉCRIT la quantité
--     commandée : l'engagement d'origine est perdu.
--   - Aucun avenant : un BC envoyé se modifiait sans trace ; le prix commandé était écrasé par le
--     prix reçu.
--   SAP (EKBE), Oracle (RCV_TRANSACTIONS, quantity_cancelled, change orders), Odoo et D365 gardent
--   un journal append-only par ligne dont dérivent reçu / annulé, figent le facteur d'unité sur la
--   ligne, versionnent le BC envoyé et ne suppriment jamais un document engagé.
--
-- RÈGLES
--   Double unité  : qty_container (saisie, en contenants) × qty_per_container (facteur FIGÉ) =
--                   quantity_ordered (unité de base). Le facteur, le type de contenant, l'unité de base
--                   et la catégorie sont copiés depuis l'article à l'insertion, jamais recalculés.
--                   Le prix reste exprimé en unité de base (comparable d'une commande à l'autre).
--   Événements    : GR (réception) / GR_REVERSAL (annulation de réception) / CANCEL (reliquat clôturé)
--                   / CANCEL_REVERSAL (reliquat rouvert). Un seul trigger maintient qty_received_base,
--                   qty_cancelled_base et la colonne historique quantity_delivered (= reçu).
--                   Plus aucune écriture directe de quantity_delivered.
--                   Borne : reçu + annulé ≤ commandé × (1 + tolérance), tolérance en paramètre (10 %).
--   Avenant       : un BC engagé ne se modifie que par une demande de changement (contexte
--                   app.change_order = 'on'), motivée, qui crée une version numérotée (snapshot + diff).
--                   La version 0 est figée à l'envoi.
--   Suppression   : seul un brouillon (en_attente, jamais engagé, sans événement) se supprime.
--   Facture auto  : au plus une facture reçue active par BC (index partiel).
--
-- INVERSION
--   DROP TRIGGER poi_dual_unit, poi_counters_guard, po_line_events_apply, po_line_events_immutable,
--   rvi_post_gr, rvi_post_gr_reversal, po_no_delete, poi_no_delete_with_events,
--   purchase_order_versions_immutable ; DROP FUNCTION associées, fn_po_delivery_status, fn_po_snapshot ;
--   DROP TABLE po_line_events, purchase_order_versions, idempotency_keys ;
--   DROP INDEX uq_invoices_one_active_per_po ; ALTER TABLE … DROP COLUMN des colonnes ajoutées ;
--   remettre les fonctions de verrou de la mig 306.

-- ═══════════════════════════════════════════════════════════════════════
-- 0. Paramètres et motifs
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO module_parameters (key, value, description) VALUES
  ('purchasing.over_receipt_tolerance_pct', '{"pct": 10}'::jsonb,
   'Sur-livraison tolérée par ligne de BC, en % de la quantité commandée. Au-delà, la réception est refusée.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, display_order, metadata) VALUES
  ('purchase_reason_codes', 'qty_change',   'Modification de quantité',        20, '{"scope":["change"]}'),
  ('purchase_reason_codes', 'price_change', 'Modification de prix négociée',   21, '{"scope":["change"]}'),
  ('purchase_reason_codes', 'date_change',  'Modification de date de livraison', 22, '{"scope":["change"]}'),
  ('purchase_reason_codes', 'partial_delivery_closed', 'Livraison partielle acceptée, reliquat abandonné', 23, '{"scope":["force_close"]}')
ON CONFLICT (table_id, code) DO NOTHING;
UPDATE ref_entries SET metadata = jsonb_set(metadata, '{scope}', (metadata->'scope') || '["change"]'::jsonb)
 WHERE table_id = 'purchase_reason_codes' AND code = 'other' AND NOT (metadata->'scope' ? 'change');
UPDATE ref_entries SET metadata = jsonb_set(metadata, '{scope}', (metadata->'scope') || '["force_close"]'::jsonb)
 WHERE table_id = 'purchase_reason_codes' AND code IN ('supplier_unavailable', 'late_delivery') AND NOT (metadata->'scope' ? 'force_close');

-- ═══════════════════════════════════════════════════════════════════════
-- 1. LIGNE DE BC EN DOUBLE UNITÉ (G-D4-03)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS qty_container      NUMERIC(12,4) CHECK (qty_container IS NULL OR qty_container > 0),
  ADD COLUMN IF NOT EXISTS qty_per_container  NUMERIC(12,4) NOT NULL DEFAULT 1 CHECK (qty_per_container > 0),
  ADD COLUMN IF NOT EXISTS container_type_id  UUID REFERENCES ref_entries(id),
  ADD COLUMN IF NOT EXISTS base_unit          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS discount_pct       NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS tva_rate           NUMERIC(5,2) CHECK (tva_rate IS NULL OR tva_rate BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS category_id        UUID REFERENCES expense_categories(id),
  ADD COLUMN IF NOT EXISTS description        TEXT,
  ADD COLUMN IF NOT EXISTS expected_date      DATE,
  ADD COLUMN IF NOT EXISTS qty_received_base  NUMERIC(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_cancelled_base NUMERIC(12,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN purchase_order_items.qty_container IS 'Quantité saisie en contenants (sacs, cartons, bidons) ; quantity_ordered en dérive (mig 307).';
COMMENT ON COLUMN purchase_order_items.qty_per_container IS 'Facteur contenant → unité de base FIGÉ à la commande ; jamais recalculé si la fiche article change (mig 307).';
COMMENT ON COLUMN purchase_order_items.quantity_delivered IS 'Compatibilité : = qty_received_base, entretenue par le trigger des événements de ligne (mig 307). Ne plus écrire.';

-- Reprise (avant le trigger de synchronisation) : snapshot depuis l'article. Le contenant
-- n'est repris que si la quantité commandée en est un multiple exact (règle « contenant entier ») ;
-- sinon la ligne historique a été commandée hors contenant et garde le facteur 1.
UPDATE purchase_order_items poi
   SET qty_per_container = CASE WHEN ing.container_size > 0 AND mod(poi.quantity_ordered, ing.container_size) = 0 THEN ing.container_size ELSE 1 END,
       container_type_id = CASE WHEN ing.container_size > 0 AND mod(poi.quantity_ordered, ing.container_size) = 0 THEN ing.container_type_id END,
       base_unit         = COALESCE(ing.unit, pkg.unit),
       category_id       = COALESCE(ing.category_id, pkg.category_id),
       qty_container     = poi.quantity_ordered / CASE WHEN ing.container_size > 0 AND mod(poi.quantity_ordered, ing.container_size) = 0 THEN ing.container_size ELSE 1 END
  FROM purchase_order_items x
  LEFT JOIN ingredients ing ON ing.id = x.ingredient_id
  LEFT JOIN packaging_items pkg ON pkg.id = x.packaging_id
 WHERE x.id = poi.id;

-- Montant HT de ligne, sans prix = inconnu (NULL), jamais 0.
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS amount_ht NUMERIC(14,2)
  GENERATED ALWAYS AS (CASE WHEN unit_price IS NULL THEN NULL
                            ELSE round(quantity_ordered * unit_price * (1 - discount_pct / 100), 2) END) STORED;

CREATE OR REPLACE FUNCTION trg_poi_dual_unit()
RETURNS TRIGGER AS $$
DECLARE v_size NUMERIC; v_ct UUID; v_unit TEXT; v_cat UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.ingredient_id IS NOT NULL THEN
      SELECT container_size, container_type_id, unit, category_id INTO v_size, v_ct, v_unit, v_cat FROM ingredients WHERE id = NEW.ingredient_id;
    ELSIF NEW.packaging_id IS NOT NULL THEN
      SELECT NULL, NULL, unit, category_id INTO v_size, v_ct, v_unit, v_cat FROM packaging_items WHERE id = NEW.packaging_id;
    END IF;
    -- Snapshot : ce que l'appelant n'a pas précisé est copié de l'article, une fois pour toutes.
    IF NEW.qty_per_container IS NULL OR (NEW.qty_per_container = 1 AND NEW.container_type_id IS NULL AND COALESCE(v_size, 0) > 0) THEN
      NEW.qty_per_container := COALESCE(NULLIF(v_size, 0), 1);
    END IF;
    NEW.container_type_id := COALESCE(NEW.container_type_id, v_ct);
    NEW.base_unit         := COALESCE(NEW.base_unit, v_unit);
    NEW.category_id       := COALESCE(NEW.category_id, v_cat);
    IF NEW.qty_container IS NOT NULL THEN
      NEW.quantity_ordered := NEW.qty_container * NEW.qty_per_container;
    ELSE
      NEW.qty_container := NEW.quantity_ordered / NEW.qty_per_container;
    END IF;
  ELSE
    IF NEW.qty_container IS DISTINCT FROM OLD.qty_container AND NEW.qty_container IS NOT NULL THEN
      NEW.quantity_ordered := NEW.qty_container * NEW.qty_per_container;
    ELSIF NEW.quantity_ordered IS DISTINCT FROM OLD.quantity_ordered
       OR NEW.qty_per_container IS DISTINCT FROM OLD.qty_per_container THEN
      NEW.qty_container := NEW.quantity_ordered / NEW.qty_per_container;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS poi_dual_unit ON purchase_order_items;
CREATE TRIGGER poi_dual_unit BEFORE INSERT OR UPDATE ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION trg_poi_dual_unit();

-- ═══════════════════════════════════════════════════════════════════════
-- 2. JOURNAL DES ÉVÉNEMENTS DE LIGNE, COMPTEURS DÉRIVÉS (G-D4-04)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS po_line_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_line_id     UUID NOT NULL REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  event_type     VARCHAR(20) NOT NULL CHECK (event_type IN ('GR', 'GR_REVERSAL', 'CANCEL', 'CANCEL_REVERSAL', 'LEGACY_ADJUST')),
  sign           SMALLINT NOT NULL CHECK (sign IN (-1, 1)),
  qty_base       NUMERIC(12,4) NOT NULL CHECK (qty_base > 0),
  ref_doc_type   VARCHAR(30) NOT NULL,      -- reception_voucher_item | close_remainder | legacy_admin_edit
  ref_doc_id     UUID NOT NULL,
  reason_code_id UUID REFERENCES ref_entries(id),
  note           TEXT,
  posted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by      UUID REFERENCES users(id),
  CONSTRAINT uq_po_line_events_ref UNIQUE (event_type, ref_doc_type, ref_doc_id)
);
CREATE INDEX IF NOT EXISTS idx_po_line_events_line ON po_line_events (po_line_id, posted_at);
COMMENT ON TABLE po_line_events IS
  'Journal append-only des mouvements d''une ligne de BC (mig 307) : réception, extourne, reliquat clôturé/rouvert. Les compteurs de ligne en dérivent.';

DROP TRIGGER IF EXISTS po_line_events_immutable ON po_line_events;
CREATE TRIGGER po_line_events_immutable BEFORE UPDATE OR DELETE ON po_line_events
  FOR EACH ROW EXECUTE FUNCTION trg_audit_append_only();   -- mig 304

CREATE OR REPLACE FUNCTION trg_po_line_events_apply()
RETURNS TRIGGER AS $$
DECLARE
  v_line purchase_order_items%ROWTYPE;
  v_tol  NUMERIC;
  v_po   TEXT;
BEGIN
  PERFORM set_config('app.po_events', 'on', true);
  UPDATE purchase_order_items SET
    qty_received_base  = qty_received_base  + CASE WHEN NEW.event_type IN ('GR', 'GR_REVERSAL', 'LEGACY_ADJUST') THEN NEW.sign * NEW.qty_base ELSE 0 END,
    qty_cancelled_base = qty_cancelled_base + CASE WHEN NEW.event_type IN ('CANCEL', 'CANCEL_REVERSAL') THEN NEW.sign * NEW.qty_base ELSE 0 END
  WHERE id = NEW.po_line_id
  RETURNING * INTO v_line;
  -- Pendant la reprise, le compteur historique fait foi jusqu'au rapprochement final.
  IF COALESCE(current_setting('app.backfill', true), '') <> 'on' THEN
    UPDATE purchase_order_items SET quantity_delivered = qty_received_base
     WHERE id = NEW.po_line_id AND quantity_delivered IS DISTINCT FROM qty_received_base;
  END IF;
  PERFORM set_config('app.po_events', '', true);

  IF v_line.qty_received_base < -0.0001 OR v_line.qty_cancelled_base < -0.0001 THEN
    RAISE EXCEPTION 'Ligne de BC : compteur négatif (reçu %, annulé %)', v_line.qty_received_base, v_line.qty_cancelled_base
      USING ERRCODE = 'OF409';
  END IF;

  IF COALESCE(current_setting('app.backfill', true), '') <> 'on' AND NEW.sign > 0 THEN
    SELECT COALESCE((value ->> 'pct')::numeric, 0) INTO v_tol FROM module_parameters WHERE key = 'purchasing.over_receipt_tolerance_pct';
    IF v_line.qty_received_base + v_line.qty_cancelled_base > v_line.quantity_ordered * (1 + COALESCE(v_tol, 0) / 100) + 0.0001 THEN
      SELECT order_number INTO v_po FROM purchase_orders WHERE id = v_line.purchase_order_id;
      RAISE EXCEPTION 'BC % : la ligne dépasserait la quantité commandée (% reçu + % clôturé > % commandé, tolérance % %%)',
        v_po, v_line.qty_received_base, v_line.qty_cancelled_base, v_line.quantity_ordered, COALESCE(v_tol, 0)
        USING ERRCODE = 'OF409';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS po_line_events_apply ON po_line_events;
CREATE TRIGGER po_line_events_apply AFTER INSERT ON po_line_events
  FOR EACH ROW EXECUTE FUNCTION trg_po_line_events_apply();

-- Les compteurs ne s'écrivent que par le journal.
CREATE OR REPLACE FUNCTION trg_poi_counters_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF COALESCE(current_setting('app.po_events', true), '') <> 'on'
     AND (NEW.quantity_delivered IS DISTINCT FROM OLD.quantity_delivered
          OR NEW.qty_received_base IS DISTINCT FROM OLD.qty_received_base
          OR NEW.qty_cancelled_base IS DISTINCT FROM OLD.qty_cancelled_base) THEN
    RAISE EXCEPTION 'Les quantités reçues d''une ligne de BC ne se modifient que par une réception ou une clôture de reliquat'
      USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Reprise du journal : un GR par ligne de réception, puis l'écart historique ──
SELECT set_config('app.backfill', 'on', true);
SELECT set_config('app.change_origin', 'receipt', true);   -- verrou mig 306

INSERT INTO po_line_events (po_line_id, event_type, sign, qty_base, ref_doc_type, ref_doc_id, posted_at, posted_by, note)
SELECT rvi.purchase_order_item_id, 'GR', 1, rvi.quantity_received, 'reception_voucher_item', rvi.id,
       rv.created_at, rv.received_by, 'reprise mig 307 — ' || rv.voucher_number
  FROM reception_voucher_items rvi
  JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
 WHERE rvi.purchase_order_item_id IS NOT NULL AND rvi.quantity_received > 0;

-- Écart entre le compteur historique et la somme des réceptions (édition admin, BC « livrés » sans BR) :
-- tracé tel quel, pour régularisation par le gérant.
INSERT INTO po_line_events (po_line_id, event_type, sign, qty_base, ref_doc_type, ref_doc_id, note)
SELECT poi.id, 'LEGACY_ADJUST', CASE WHEN d > 0 THEN 1 ELSE -1 END, abs(d), 'legacy_admin_edit', poi.id,
       'reprise mig 307 — quantité livrée saisie hors réception (édition admin), à régulariser'
  FROM (SELECT poi.id, poi.quantity_delivered - poi.qty_received_base AS d FROM purchase_order_items poi) poi
 WHERE abs(d) > 0.00001;

DO $$
DECLARE v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad FROM purchase_order_items WHERE abs(quantity_delivered - qty_received_base) > 0.00001;
  IF v_bad > 0 THEN RAISE EXCEPTION 'mig 307 : % ligne(s) dont le reçu dérivé diffère du compteur historique', v_bad; END IF;
END $$;

SELECT set_config('app.backfill', '', true);
SELECT set_config('app.change_origin', '', true);

DROP TRIGGER IF EXISTS poi_counters_guard ON purchase_order_items;
CREATE TRIGGER poi_counters_guard BEFORE UPDATE ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION trg_poi_counters_guard();

-- La réception poste ses événements d'elle-même : impossible d'oublier.
CREATE OR REPLACE FUNCTION trg_rvi_post_gr()
RETURNS TRIGGER AS $$
DECLARE v_by UUID;
BEGIN
  IF NEW.purchase_order_item_id IS NULL OR NEW.quantity_received <= 0 THEN RETURN NULL; END IF;
  SELECT received_by INTO v_by FROM reception_vouchers WHERE id = NEW.reception_voucher_id;
  INSERT INTO po_line_events (po_line_id, event_type, sign, qty_base, ref_doc_type, ref_doc_id, posted_by)
  VALUES (NEW.purchase_order_item_id, 'GR', 1, NEW.quantity_received, 'reception_voucher_item', NEW.id, v_by);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS rvi_post_gr ON reception_voucher_items;
CREATE TRIGGER rvi_post_gr AFTER INSERT ON reception_voucher_items
  FOR EACH ROW EXECUTE FUNCTION trg_rvi_post_gr();

-- Annulation de réception (encore par suppression, D5 la transformera en contre-pièce) :
-- l'extourne reste tracée dans le journal.
CREATE OR REPLACE FUNCTION trg_rvi_post_gr_reversal()
RETURNS TRIGGER AS $$
DECLARE v_ctx TEXT := current_setting('app.user_id', true);
BEGIN
  IF OLD.purchase_order_item_id IS NULL OR OLD.quantity_received <= 0 THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM purchase_order_items WHERE id = OLD.purchase_order_item_id) THEN RETURN NULL; END IF;
  INSERT INTO po_line_events (po_line_id, event_type, sign, qty_base, ref_doc_type, ref_doc_id, posted_by, note)
  VALUES (OLD.purchase_order_item_id, 'GR_REVERSAL', -1, OLD.quantity_received, 'reception_voucher_item', OLD.id,
          NULLIF(v_ctx, '')::uuid, 'annulation de la réception');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS rvi_post_gr_reversal ON reception_voucher_items;
CREATE TRIGGER rvi_post_gr_reversal AFTER DELETE ON reception_voucher_items
  FOR EACH ROW EXECUTE FUNCTION trg_rvi_post_gr_reversal();

-- Statut de livraison dérivé des lignes (une seule règle, appelée par la réception et la clôture).
CREATE OR REPLACE FUNCTION fn_po_delivery_status(p_po UUID)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN count(*) = 0 THEN 'en_attente'
           WHEN bool_and(qty_received_base + qty_cancelled_base >= quantity_ordered - 0.0001) THEN
             CASE WHEN sum(qty_received_base) <= 0.0001 THEN 'non_livre'
                  WHEN bool_or(unit_price IS NULL AND qty_received_base > 0) THEN 'en_attente_facturation'
                  ELSE 'livre_complet' END
           WHEN sum(qty_received_base) > 0.0001 THEN 'livre_partiel'
           ELSE 'envoye'
         END
    FROM purchase_order_items WHERE purchase_order_id = p_po
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. VERSIONS / AVENANTS (G-D4-07)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS purchase_order_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  version_no        INTEGER NOT NULL CHECK (version_no >= 0),
  reason_code_id    UUID REFERENCES ref_entries(id),
  reason_note       TEXT,
  snapshot          JSONB NOT NULL,
  diff              JSONB,
  reconstituted     BOOLEAN NOT NULL DEFAULT false,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (purchase_order_id, version_no),
  CHECK (version_no = 0 OR reason_code_id IS NOT NULL)
);
COMMENT ON TABLE purchase_order_versions IS
  'Versions numérotées du BC engagé (mig 307) : v0 = état à l''envoi, vN = avenant motivé avec snapshot et diff. Append-only.';
DROP TRIGGER IF EXISTS purchase_order_versions_immutable ON purchase_order_versions;
CREATE TRIGGER purchase_order_versions_immutable BEFORE UPDATE OR DELETE ON purchase_order_versions
  FOR EACH ROW EXECUTE FUNCTION trg_audit_append_only();

CREATE OR REPLACE FUNCTION fn_po_snapshot(p_po UUID)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'header', jsonb_build_object(
      'order_number', po.order_number, 'supplier_id', po.supplier_id, 'supplier_name', s.name,
      'order_date', po.order_date, 'expected_delivery_date', po.expected_delivery_date, 'notes', po.notes),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', poi.id, 'item', COALESCE(ing.name, pkg.name),
               'ingredient_id', poi.ingredient_id, 'packaging_id', poi.packaging_id,
               'qty_container', poi.qty_container, 'qty_per_container', poi.qty_per_container,
               'quantity_ordered', poi.quantity_ordered, 'base_unit', poi.base_unit,
               'unit_price', poi.unit_price, 'discount_pct', poi.discount_pct, 'tva_rate', poi.tva_rate,
               'amount_ht', poi.amount_ht, 'expected_date', poi.expected_date)
             ORDER BY COALESCE(ing.name, pkg.name))
        FROM purchase_order_items poi
        LEFT JOIN ingredients ing ON ing.id = poi.ingredient_id
        LEFT JOIN packaging_items pkg ON pkg.id = poi.packaging_id
       WHERE poi.purchase_order_id = po.id), '[]'::jsonb))
  FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
  WHERE po.id = p_po
$$;

-- Reprise : version 0 reconstituée pour les BC déjà engagés (les prix d'origine écrasés
-- par la réception ne sont pas récupérables : c'est l'état courant qui est figé).
INSERT INTO purchase_order_versions (purchase_order_id, version_no, snapshot, reconstituted, created_by, created_at)
SELECT po.id, 0, fn_po_snapshot(po.id), true, po.created_by, COALESCE(po.locked_at, po.created_at)
  FROM purchase_orders po
 WHERE po.status <> 'en_attente'
ON CONFLICT (purchase_order_id, version_no) DO NOTHING;

-- Verrou de la mig 306 : la demande de changement (app.change_order = 'on') est le seul
-- chemin qui modifie un BC engagé ; elle applique ses propres règles côté service.
CREATE OR REPLACE FUNCTION trg_po_guard_locked()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'en_attente' AND NEW.status <> 'en_attente' AND NEW.locked_at IS NULL THEN
    NEW.locked_at := now();
  END IF;
  IF fn_po_is_locked(OLD.status, OLD.frozen)
     AND COALESCE(current_setting('app.change_order', true), '') <> 'on'
     AND (NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
          OR NEW.store_id IS DISTINCT FROM OLD.store_id
          OR NEW.order_date IS DISTINCT FROM OLD.order_date) THEN
    RAISE EXCEPTION 'Le bon de commande % est verrouillé (%) : passez par une demande de changement',
      OLD.order_number, CASE WHEN OLD.frozen THEN 'gelé' ELSE OLD.status END
      USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_poi_guard_locked()
RETURNS TRIGGER AS $$
DECLARE
  v_po      purchase_orders%ROWTYPE;
  v_receipt BOOLEAN := COALESCE(current_setting('app.change_origin', true), '') = 'receipt';
  v_change  BOOLEAN := COALESCE(current_setting('app.change_order', true), '') = 'on';
BEGIN
  -- Écritures du journal de ligne (compteurs) : contrôlées par leur propre trigger.
  IF COALESCE(current_setting('app.po_events', true), '') = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT * INTO v_po FROM purchase_orders WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  IF NOT FOUND OR NOT fn_po_is_locked(v_po.status, v_po.frozen) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- Réception : prix reçu sur ligne sans prix. Avenant : ses règles sont dans le service.
  IF v_receipt OR (v_change AND NOT v_po.frozen) THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Le bon de commande % est verrouillé : ajoutez la ligne par une demande de changement', v_po.order_number USING ERRCODE = 'OF409';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Le bon de commande % est verrouillé : une ligne engagée ne se supprime pas', v_po.order_number USING ERRCODE = 'OF409';
  END IF;

  IF NEW.ingredient_id IS DISTINCT FROM OLD.ingredient_id
     OR NEW.packaging_id IS DISTINCT FROM OLD.packaging_id
     OR NEW.quantity_ordered IS DISTINCT FROM OLD.quantity_ordered
     OR NEW.qty_container IS DISTINCT FROM OLD.qty_container
     OR NEW.qty_per_container IS DISTINCT FROM OLD.qty_per_container
     OR NEW.discount_pct IS DISTINCT FROM OLD.discount_pct
     OR NEW.tva_rate IS DISTINCT FROM OLD.tva_rate THEN
    RAISE EXCEPTION 'Le bon de commande % est verrouillé : quantités, remise et TVA changent par une demande de changement', v_po.order_number USING ERRCODE = 'OF409';
  END IF;
  IF NEW.unit_price IS DISTINCT FROM OLD.unit_price AND OLD.unit_price IS NOT NULL THEN
    RAISE EXCEPTION 'Le bon de commande % est verrouillé : un prix déjà saisi change par une demande de changement (seul un prix manquant se complète ici)', v_po.order_number USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. SUPPRESSION : brouillons seulement (G-D4-10)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trg_po_no_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status <> 'en_attente' OR OLD.locked_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM po_line_events e JOIN purchase_order_items poi ON poi.id = e.po_line_id WHERE poi.purchase_order_id = OLD.id) THEN
    RAISE EXCEPTION 'Le bon de commande % a été engagé : il s''annule, il ne se supprime pas', OLD.order_number
      USING ERRCODE = 'OF409';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS po_no_delete ON purchase_orders;
CREATE TRIGGER po_no_delete BEFORE DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION trg_po_no_delete();

-- ═══════════════════════════════════════════════════════════════════════
-- 5. IDEMPOTENCE (G-D4-19)
-- ═══════════════════════════════════════════════════════════════════════
-- Au plus une facture reçue active par BC (la facture auto est créée sans verrou dans
-- createInvoiceFromPo ; deux réceptions concurrentes ne peuvent plus en créer deux).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_one_active_per_po
  ON invoices (purchase_order_id)
  WHERE status <> 'cancelled' AND purchase_order_id IS NOT NULL AND invoice_type = 'received';

-- Clés d'idempotence HTTP : une soumission de formulaire rejouée renvoie la même réponse.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key             VARCHAR(80) NOT NULL,
  user_id         UUID NOT NULL REFERENCES users(id),
  route           VARCHAR(200) NOT NULL,
  response_status INTEGER,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON idempotency_keys (created_at);
COMMENT ON TABLE idempotency_keys IS 'Réponses mémorisées par en-tête Idempotency-Key (mig 307), purgeables au-delà de 7 jours.';

-- Audit SGBD sur les nouvelles tables (mig 305).
DROP TRIGGER IF EXISTS po_line_events_document_audit ON po_line_events;
CREATE TRIGGER po_line_events_document_audit AFTER INSERT ON po_line_events
  FOR EACH ROW EXECUTE FUNCTION log_purchasing_document_change();
