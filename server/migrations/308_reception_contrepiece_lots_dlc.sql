-- Migration 308 : Réception — contre-pièce au lieu de suppression, correction de ligne, numéro de
-- lot interne obligatoire, politique lot/DLC par catégorie, fin du double comptage du stock
-- (refonte Achats, domaine D5, lot 1 : G-D5-02, G-D5-04, G-D5-06, G-D5-07, G-D5-14)
--
-- POURQUOI
--   - Chaque réception compte le stock deux fois : le trigger trg_inventory_sync_lots recalcule
--     inventory depuis les lots, puis le code ajoute encore la quantité reçue. L'annulation fait
--     l'inverse en double. 116 lignes d'inventaire valent exactement « lots + dernière réception ».
--   - L'annulation de réception SUPPRIME bon, lignes, lots, mouvements et facture : la preuve
--     disparaît (conservation 10 ans, traçabilité ONSSA). Aucune correction de ligne n'existe.
--   - 634 lots sur 669 n'ont pas de numéro interne (la séquence lot_number_seq n'est jamais
--     appelée) ; 97 % des lots actifs n'ont pas de DLC, rien ne l'exige.
--
-- RÈGLES
--   Journal de réception : une ligne de réception ne se modifie ni ne se supprime. Une correction
--   ou une extourne est une NOUVELLE ligne (kind correct_up / correct_down / reverse) qui pointe sa
--   ligne d'origine ; elle poste son événement sur la ligne de BC (mig 307).
--   Extourne d'un bon : bon miroir (voucher_kind = 'reversal') ; l'original passe « reversed » ;
--   lots passés « reversed » à quantité nulle ; facture annulée (jamais supprimée).
--   Lot : numéro LI-AAMMJJ-NNNNN attribué par défaut, unique, obligatoire.
--   Lot / DLC : exigences par catégorie (surcharge possible par article). Mode d'application en
--   paramètre : 'warn' (signalé, non bloquant) par défaut, 'block' ensuite. Une DLC déjà passée
--   à la réception est toujours refusée.
--   Stock : plus aucune écriture applicative de inventory à la réception ; le trigger des lots
--   fait foi pour ce flux.
--
-- INVERSION
--   DROP TRIGGER rvi_immutable, rvi_check_lot_dlc ; remettre trg_rvi_post_gr de la mig 307 ;
--   DROP FUNCTION fn_next_lot_number, fn_lot_requirements ; DROP VIEW v_stock_lot_divergence ;
--   ALTER TABLE ... DROP COLUMN des colonnes ajoutées ; remettre les CHECK d'origine.

-- ═══════════════════════════════════════════════════════════════════════
-- 0. Paramètres et motifs
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO module_parameters (key, value, description) VALUES
  ('purchasing.lot_dlc_enforcement', '{"mode": "warn"}'::jsonb,
   'Exigences lot fournisseur / DLC à la réception : warn = signalées sans bloquer, block = réception refusée tant qu''elles manquent.'),
  ('purchasing.receipt_correction_window_hours', '{"hours": 72}'::jsonb,
   'Délai pendant lequel une ligne de réception peut être corrigée par le gérant (l''administrateur n''est pas limité).')
ON CONFLICT (key) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, display_order, metadata) VALUES
  ('purchase_reason_codes', 'receipt_entry_error', 'Erreur de saisie à la réception', 24, '{"scope":["reverse","correct"]}'),
  ('purchase_reason_codes', 'receipt_count_error', 'Erreur de comptage / de pesée',   25, '{"scope":["correct"]}'),
  ('purchase_reason_codes', 'breakage_on_receipt', 'Casse constatée après réception', 26, '{"scope":["correct","return"]}'),
  ('purchase_reason_codes', 'short_shelf_life_accepted', 'Durée de vie courte acceptée', 31, '{"scope":["dlc_override"],"sector":"agro"}')
ON CONFLICT (table_id, code) DO NOTHING;
UPDATE ref_entries SET metadata = jsonb_set(metadata, '{scope}', (metadata->'scope') || '["correct"]'::jsonb)
 WHERE table_id = 'purchase_reason_codes' AND code = 'other' AND NOT (metadata->'scope' ? 'correct');

-- ═══════════════════════════════════════════════════════════════════════
-- 1. BON DE RÉCEPTION : nature, statut, extourne (G-D5-04)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE reception_vouchers
  ADD COLUMN IF NOT EXISTS voucher_kind        VARCHAR(10) NOT NULL DEFAULT 'receipt',
  ADD COLUMN IF NOT EXISTS status              VARCHAR(10) NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS reverses_voucher_id UUID REFERENCES reception_vouchers(id),
  ADD COLUMN IF NOT EXISTS reversed_by         UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reversed_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reverse_reason_code_id UUID REFERENCES ref_entries(id),
  ADD COLUMN IF NOT EXISTS reverse_note        TEXT;
ALTER TABLE reception_vouchers
  ADD CONSTRAINT chk_rv_kind   CHECK (voucher_kind IN ('receipt', 'reversal')),
  ADD CONSTRAINT chk_rv_status CHECK (status IN ('posted', 'reversed')),
  ADD CONSTRAINT chk_rv_reversal_link CHECK ((voucher_kind = 'reversal') = (reverses_voucher_id IS NOT NULL)),
  ADD CONSTRAINT chk_rv_reversed_trace CHECK (status <> 'reversed' OR (reversed_at IS NOT NULL AND reverse_reason_code_id IS NOT NULL));

-- ═══════════════════════════════════════════════════════════════════════
-- 2. LIGNE DE RÉCEPTION = JOURNAL (G-D5-02)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE reception_voucher_items
  ADD COLUMN IF NOT EXISTS kind           VARCHAR(15) NOT NULL DEFAULT 'receive',
  ADD COLUMN IF NOT EXISTS parent_item_id UUID REFERENCES reception_voucher_items(id),
  ADD COLUMN IF NOT EXISTS reason_code_id UUID REFERENCES ref_entries(id),
  ADD COLUMN IF NOT EXISTS created_by     UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS po_unit_price  NUMERIC(12,4);   -- prix commandé au moment de la réception (écart prix, D6)
ALTER TABLE reception_voucher_items
  ADD CONSTRAINT chk_rvi_kind CHECK (kind IN ('receive', 'correct_up', 'correct_down', 'reverse')),
  ADD CONSTRAINT chk_rvi_parent CHECK ((kind = 'receive') = (parent_item_id IS NULL)),
  ADD CONSTRAINT chk_rvi_reason CHECK (kind = 'receive' OR reason_code_id IS NOT NULL);
-- Quantité signée, pour tous les cumuls (une ligne de journal porte une quantité positive et un sens).
ALTER TABLE reception_voucher_items ADD COLUMN IF NOT EXISTS signed_quantity NUMERIC(12,4)
  GENERATED ALWAYS AS (quantity_received * CASE WHEN kind IN ('receive', 'correct_up') THEN 1 ELSE -1 END) STORED;

UPDATE reception_voucher_items rvi
   SET po_unit_price = poi.unit_price
  FROM purchase_order_items poi
 WHERE poi.id = rvi.purchase_order_item_id AND rvi.po_unit_price IS NULL;

-- Immuable : ni suppression, ni modification des quantités, articles, prix et lots saisis.
CREATE OR REPLACE FUNCTION trg_rvi_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Une ligne de réception ne se supprime pas : extournez ou corrigez-la' USING ERRCODE = 'OF409';
  END IF;
  IF NEW.quantity_received IS DISTINCT FROM OLD.quantity_received
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.ingredient_id IS DISTINCT FROM OLD.ingredient_id
     OR NEW.packaging_id IS DISTINCT FROM OLD.packaging_id
     OR NEW.purchase_order_item_id IS DISTINCT FROM OLD.purchase_order_item_id
     OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
     OR NEW.reception_voucher_id IS DISTINCT FROM OLD.reception_voucher_id THEN
    RAISE EXCEPTION 'Une ligne de réception est définitive : passez par une correction' USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS rvi_immutable ON reception_voucher_items;
CREATE TRIGGER rvi_immutable BEFORE UPDATE OR DELETE ON reception_voucher_items
  FOR EACH ROW EXECUTE FUNCTION trg_rvi_immutable();

-- L'ancien trigger d'extourne par suppression (mig 307) n'a plus de raison d'être.
DROP TRIGGER IF EXISTS rvi_post_gr_reversal ON reception_voucher_items;

-- Événement de ligne de BC selon la nature de la ligne de réception (remplace la version mig 307).
CREATE OR REPLACE FUNCTION trg_rvi_post_gr()
RETURNS TRIGGER AS $$
DECLARE v_by UUID;
BEGIN
  IF NEW.purchase_order_item_id IS NULL OR NEW.quantity_received <= 0 THEN RETURN NULL; END IF;
  v_by := COALESCE(NEW.created_by, (SELECT received_by FROM reception_vouchers WHERE id = NEW.reception_voucher_id));
  INSERT INTO po_line_events (po_line_id, event_type, sign, qty_base, ref_doc_type, ref_doc_id, reason_code_id, posted_by)
  VALUES (NEW.purchase_order_item_id,
          CASE WHEN NEW.kind IN ('receive', 'correct_up') THEN 'GR' ELSE 'GR_REVERSAL' END,
          CASE WHEN NEW.kind IN ('receive', 'correct_up') THEN 1 ELSE -1 END,
          NEW.quantity_received, 'reception_voucher_item', NEW.id, NEW.reason_code_id, v_by);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. LOTS : numéro interne obligatoire, statut « extourné » (G-D5-06)
-- ═══════════════════════════════════════════════════════════════════════
CREATE SEQUENCE IF NOT EXISTS lot_number_seq START 1;

CREATE OR REPLACE FUNCTION fn_next_lot_number(p_received DATE DEFAULT CURRENT_DATE)
RETURNS TEXT LANGUAGE sql VOLATILE AS $$
  SELECT 'LI-' || to_char(COALESCE(p_received, CURRENT_DATE), 'YYMMDD') || '-' || lpad(nextval('lot_number_seq')::text, 5, '0')
$$;

-- Reprise : un numéro pour chaque lot qui n'en a pas, dans l'ordre d'arrivée.
WITH ordered AS (
  SELECT id, received_at FROM ingredient_lots WHERE lot_number IS NULL ORDER BY received_at, created_at, id
)
UPDATE ingredient_lots l SET lot_number = fn_next_lot_number(o.received_at)
  FROM ordered o WHERE o.id = l.id;

ALTER TABLE ingredient_lots ALTER COLUMN lot_number SET DEFAULT fn_next_lot_number(CURRENT_DATE);
ALTER TABLE ingredient_lots ALTER COLUMN lot_number SET NOT NULL;
COMMENT ON COLUMN ingredient_lots.lot_number IS
  'Lot interne unique (mig 308) : LI-AAMMJJ-NNNNN à la réception, ADJ- pour les ajustements. Le lot fournisseur est dans supplier_lot_number.';

ALTER TABLE ingredient_lots DROP CONSTRAINT IF EXISTS ingredient_lots_status_check;
ALTER TABLE ingredient_lots ADD CONSTRAINT ingredient_lots_status_check
  CHECK (status IN ('active', 'depleted', 'expired', 'quarantine', 'waste', 'reversed'));
ALTER TABLE ingredient_lots
  ADD COLUMN IF NOT EXISTS status_reason_code_id UUID REFERENCES ref_entries(id),
  ADD COLUMN IF NOT EXISTS status_changed_by     UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS status_changed_at     TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. POLITIQUE LOT / DLC (G-D5-07) — générique : catégorie, surcharge par article
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS requires_lot            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_dlc            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_shelf_life_days INTEGER CHECK (default_shelf_life_days IS NULL OR default_shelf_life_days > 0),
  ADD COLUMN IF NOT EXISTS min_shelf_life_days     INTEGER CHECK (min_shelf_life_days IS NULL OR min_shelf_life_days >= 0);
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS requires_lot            BOOLEAN,     -- NULL = hériter de la catégorie
  ADD COLUMN IF NOT EXISTS requires_dlc            BOOLEAN,
  ADD COLUMN IF NOT EXISTS default_shelf_life_days INTEGER CHECK (default_shelf_life_days IS NULL OR default_shelf_life_days > 0),
  ADD COLUMN IF NOT EXISTS min_shelf_life_days     INTEGER CHECK (min_shelf_life_days IS NULL OR min_shelf_life_days >= 0);

CREATE OR REPLACE FUNCTION fn_lot_requirements(p_ingredient UUID)
RETURNS TABLE (requires_lot BOOLEAN, requires_dlc BOOLEAN, default_shelf_life_days INTEGER, min_shelf_life_days INTEGER)
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(i.requires_lot, c.requires_lot, false),
         COALESCE(i.requires_dlc, c.requires_dlc, false),
         COALESCE(i.default_shelf_life_days, c.default_shelf_life_days),
         COALESCE(i.min_shelf_life_days, c.min_shelf_life_days)
    FROM ingredients i
    LEFT JOIN expense_categories c ON c.id = i.category_id
   WHERE i.id = p_ingredient
$$;

-- Jeu de données « boulangerie-pâtisserie » (pack sectoriel agro) : périssables = DLC exigée ;
-- matières tracées par lot fournisseur. À ajuster dans Paramètres → catégories.
UPDATE expense_categories SET requires_dlc = true, requires_lot = true
 WHERE id IN ('30000000-0000-0000-0000-000000000013',  -- Beurre & Margarines
              '30000000-0000-0000-0000-000000000036',  -- Crèmes
              '73b0691f-75e5-43f4-ba41-4529dea739ad',  -- Fromages & Fromages frais
              '28741a6f-646d-4700-91a0-cde789febdba',  -- Lait & Boissons lactées
              '30000000-0000-0000-0000-000000000039',  -- Levures & agents
              '30000000-0000-0000-0000-000000000015',  -- Oeufs
              '30000000-0000-0000-0000-000000000042',  -- Poissons & Fruits de mer
              'dbedf477-6b64-485f-9095-f38897ea6e58',  -- Produits Laitiers
              '5f3596cc-e6cc-4bb4-b852-d9168d860bff',  -- Produits laitiers (divers)
              '30000000-0000-0000-0000-000000000041'); -- Viandes & Volailles
UPDATE expense_categories SET requires_dlc = true
 WHERE id IN ('30000000-0000-0000-0000-000000000044',  -- Fruits
              '30000000-0000-0000-0000-000000000043'); -- Légumes
UPDATE expense_categories SET requires_lot = true
 WHERE id IN ('30000000-0000-0000-0000-000000000012',  -- Farines
              '30000000-0000-0000-0000-000000000014',  -- Sucres
              '30000000-0000-0000-0000-000000000037'); -- Chocolat

-- Contrôle à la saisie d'une ligne de réception d'ingrédient (lignes 'receive' seulement).
CREATE OR REPLACE FUNCTION trg_rvi_check_lot_dlc()
RETURNS TRIGGER AS $$
DECLARE
  r       RECORD;
  v_mode  TEXT;
  v_name  TEXT;
  v_missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NEW.kind <> 'receive' OR NEW.ingredient_id IS NULL THEN RETURN NEW; END IF;
  SELECT name INTO v_name FROM ingredients WHERE id = NEW.ingredient_id;
  -- Toujours refusé : recevoir un produit déjà périmé.
  IF NEW.expiration_date IS NOT NULL AND NEW.expiration_date < CURRENT_DATE THEN
    RAISE EXCEPTION '« % » : la DLC % est déjà dépassée, la marchandise ne peut pas être réceptionnée', v_name, NEW.expiration_date
      USING ERRCODE = 'OF409';
  END IF;
  SELECT value ->> 'mode' INTO v_mode FROM module_parameters WHERE key = 'purchasing.lot_dlc_enforcement';
  IF COALESCE(v_mode, 'warn') <> 'block' THEN RETURN NEW; END IF;
  SELECT * INTO r FROM fn_lot_requirements(NEW.ingredient_id);
  IF r.requires_dlc AND NEW.expiration_date IS NULL THEN v_missing := array_append(v_missing, 'DLC'); END IF;
  IF r.requires_lot AND COALESCE(trim(NEW.supplier_lot_number), '') = '' THEN v_missing := array_append(v_missing, 'lot fournisseur'); END IF;
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION '« % » : % obligatoire(s) à la réception', v_name, array_to_string(v_missing, ' et ')
      USING ERRCODE = 'OF409';
  END IF;
  IF r.min_shelf_life_days IS NOT NULL AND NEW.expiration_date IS NOT NULL
     AND NEW.expiration_date - CURRENT_DATE < r.min_shelf_life_days THEN
    RAISE EXCEPTION '« % » : durée de vie restante % j, minimum exigé % j', v_name, NEW.expiration_date - CURRENT_DATE, r.min_shelf_life_days
      USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS rvi_check_lot_dlc ON reception_voucher_items;
CREATE TRIGGER rvi_check_lot_dlc BEFORE INSERT ON reception_voucher_items
  FOR EACH ROW EXECUTE FUNCTION trg_rvi_check_lot_dlc();

-- ═══════════════════════════════════════════════════════════════════════
-- 5. DOUBLE COMPTAGE (G-D5-14) : réparation ciblée + vue de suivi
-- ═══════════════════════════════════════════════════════════════════════
-- Seules les lignes dont l'écart avec les lots est EXACTEMENT la dernière réception sont réparées :
-- c'est la signature du double comptage. Les autres écarts (déductions de production faites sur
-- l'inventaire sans passer par les lots, inventaires physiques) restent à arbitrer et sont exposés
-- par la vue ci-dessous.
CREATE OR REPLACE VIEW v_stock_lot_divergence AS
SELECT i.ingredient_id, ing.name AS ingredient_name, i.store_id,
       i.current_quantity,
       COALESCE(l.qty, 0) AS lots_quantity,
       i.current_quantity - COALESCE(l.qty, 0) AS gap,
       lr.quantity_received AS last_reception_qty,
       lr.received_at AS last_reception_at
  FROM inventory i
  JOIN ingredients ing ON ing.id = i.ingredient_id
  LEFT JOIN LATERAL (
    SELECT SUM(economat_quantity + pesage_quantity) AS qty
      FROM ingredient_lots WHERE ingredient_id = i.ingredient_id AND store_id = i.store_id AND status = 'active') l ON true
  LEFT JOIN LATERAL (
    SELECT quantity_received, received_at FROM ingredient_lots
     WHERE ingredient_id = i.ingredient_id AND store_id = i.store_id AND reception_voucher_item_id IS NOT NULL
     ORDER BY received_at DESC, created_at DESC LIMIT 1) lr ON true
 WHERE abs(i.current_quantity - COALESCE(l.qty, 0)) > 0.0001;
COMMENT ON VIEW v_stock_lot_divergence IS
  'Écarts entre inventory et la somme des lots actifs (mig 308). À solder par inventaire physique ou par la refonte du stock.';

CREATE TEMP TABLE _d5_double_count AS
SELECT ingredient_id, store_id, gap FROM v_stock_lot_divergence
 WHERE last_reception_qty IS NOT NULL AND abs(gap - last_reception_qty) < 0.0001;

INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, store_id)
SELECT ingredient_id, 'adjustment', -gap,
       'Correction mig 308 : double comptage de la dernière réception (trigger des lots + mise à jour manuelle)', store_id
  FROM _d5_double_count;

SELECT sync_inventory_from_lots(ingredient_id, store_id) FROM _d5_double_count;
DROP TABLE _d5_double_count;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Audit SGBD (mig 305) sur les bons et lignes de réception
-- ═══════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS reception_vouchers_document_audit ON reception_vouchers;
CREATE TRIGGER reception_vouchers_document_audit AFTER INSERT OR UPDATE ON reception_vouchers
  FOR EACH ROW EXECUTE FUNCTION log_purchasing_document_change();
DROP TRIGGER IF EXISTS reception_voucher_items_document_audit ON reception_voucher_items;
CREATE TRIGGER reception_voucher_items_document_audit AFTER INSERT OR UPDATE ON reception_voucher_items
  FOR EACH ROW EXECUTE FUNCTION log_purchasing_document_change();
