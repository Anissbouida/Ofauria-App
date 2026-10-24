-- Migration 306 : Achats — journal des actions de document, codes motif, paramètres,
-- verrouillage / blocage / gel du BC (refonte Achats, domaine D3, lot 1 :
-- G-D3-03, G-D3-08, G-D3-05, G-D3-02)
--
-- POURQUOI
--   Aucune action sur un document d'achat n'a d'auteur ni de motif : 81 BC modifiés après
--   création sans trace, annulations sans raison, « Envoyer » qui ne laisse rien. Un BC
--   envoyé ou livré reste modifiable de bout en bout : l'édition admin a créé du stock sans
--   bon de réception ni lot (1 900 kg de farine). Le contrôle « BC requis avant dépense »
--   est une constante figée à false dans le code.
--   Les ERP de référence (Oracle PO_ACTION_HISTORY, SAP CDHDR, Odoo chatter + po_lock,
--   D365 reason codes) posent : un journal d'actions append-only, des motifs codés, un BC
--   verrouillé une fois engagé, un blocage (hold) qui suspend réception et facture, des
--   règles en table et non en constante.
--
-- PORTÉE
--   1. document_actions (append-only, séquence par document) + reprise de l'historique
--      reconstituable (création, réception, facturation, annulation).
--   2. module_parameters (paramètres en table, audités) ; seed purchasing.expense_requires_po
--      DÉSACTIVÉ : l'activation est une décision du gérant (les 48 catégories « BC requis »
--      ont été posées par défaut par la mig 038 et doivent être revues avant).
--   3. Référentiel purchase_reason_codes (ref_entries) avec périmètre d'usage (scope) ;
--      motifs génériques au noyau, motifs légaux marqués pays, motifs DLC marqués secteur.
--   4. purchase_orders : motif d'annulation / non-livraison, hold, gel, verrou.
--      Triggers de verrou sur purchase_orders et purchase_order_items, garde de hold sur
--      reception_vouchers et invoices.
--   5. Audit SGBD (purchasing_document_audit, mig 305) étendu aux BC, lignes, factures, paiements.
--
-- RÈGLES DU VERROU (le BC est engagé dès qu'il quitte « en_attente », ou s'il est gelé)
--   En-tête : fournisseur, magasin et date de commande figés.
--   Lignes  : ni ajout ni suppression ; article et quantité commandée figés ; quantité livrée
--             modifiable uniquement par la réception (contexte app.change_origin = 'receipt') ;
--             prix : seul le complément d'un prix manquant (NULL → valeur) est permis, c'est le
--             flux « en attente de facturation » ; corriger un prix existant passe par la réception
--             ou, plus tard, par une demande de changement versionnée (D4).
--   Hold    : ni réception ni facture tant que le blocage n'est pas levé.
--
-- INVERSION
--   DROP TRIGGER po_guard_locked, poi_guard_locked, rv_guard_po_hold, invoices_guard_po_hold,
--   *_document_audit (purchase_orders, purchase_order_items, invoices, payments, module_parameters),
--   document_actions_immutable, document_actions_seq ; DROP FUNCTION correspondantes ;
--   DROP TABLE document_actions, module_parameters ; DELETE ref_entries/ref_tables 'purchase_reason_codes' ;
--   ALTER TABLE purchase_orders DROP COLUMN cancel_reason_code_id … locked_by.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. JOURNAL DES ACTIONS DE DOCUMENT
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS document_actions (
  id              BIGSERIAL PRIMARY KEY,
  document_type   VARCHAR(30) NOT NULL CHECK (document_type IN
                    ('purchase_request', 'purchase_order', 'reception_voucher', 'supplier_invoice', 'expense_payment', 'supplier')),
  document_id     UUID NOT NULL,
  revision_no     INTEGER NOT NULL DEFAULT 0,
  seq             INTEGER NOT NULL,
  action          VARCHAR(20) NOT NULL CHECK (action IN (
                    'created', 'submitted', 'approved', 'rejected', 'returned', 'auto_approved',
                    'sent', 'acknowledged', 'received', 'invoiced', 'paid', 'changed',
                    'cancelled', 'not_delivered', 'reopened', 'closed', 'force_closed',
                    'held', 'released', 'frozen', 'unfrozen', 'locked', 'unlocked',
                    'escalated', 'delegated', 'deleted', 'reversed')),
  actor_id        UUID REFERENCES users(id),          -- NULL = système / reprise
  on_behalf_of    UUID REFERENCES users(id),
  channel         VARCHAR(15) NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'email_token', 'whatsapp', 'auto', 'script')),
  reason_code_id  UUID REFERENCES ref_entries(id),
  note            TEXT,
  snapshot_amount NUMERIC(14,2),
  diff            JSONB,
  acted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_type, document_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_document_actions_doc   ON document_actions (document_type, document_id, seq);
CREATE INDEX IF NOT EXISTS idx_document_actions_actor ON document_actions (actor_id, acted_at DESC);
COMMENT ON TABLE document_actions IS
  'Journal append-only des actions métier sur les documents d''achat : qui, quand, pourquoi (mig 306). Complète purchasing_document_audit (effet technique colonne par colonne).';

-- Séquence 1..n par document, sans trou, sous verrou consultatif de transaction.
CREATE OR REPLACE FUNCTION trg_document_actions_seq()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.document_type || ':' || NEW.document_id::text));
  SELECT COALESCE(MAX(seq), 0) + 1 INTO NEW.seq
    FROM document_actions WHERE document_type = NEW.document_type AND document_id = NEW.document_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS document_actions_seq ON document_actions;
CREATE TRIGGER document_actions_seq BEFORE INSERT ON document_actions
  FOR EACH ROW EXECUTE FUNCTION trg_document_actions_seq();

DROP TRIGGER IF EXISTS document_actions_immutable ON document_actions;
CREATE TRIGGER document_actions_immutable BEFORE UPDATE OR DELETE ON document_actions
  FOR EACH ROW EXECUTE FUNCTION trg_audit_append_only();   -- mig 304

-- ═══════════════════════════════════════════════════════════════════════
-- 2. PARAMÈTRES EN TABLE
-- ═══════════════════════════════════════════════════════════════════════
-- Une ligne par paramètre. Le futur passage SaaS ajoutera tenant_id à la clé (plan SaaS) ;
-- la valeur est du JSON typé décrit par `description`.
CREATE TABLE IF NOT EXISTS module_parameters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         VARCHAR(80) NOT NULL UNIQUE,
  value       JSONB NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE module_parameters IS
  'Paramètres métier modifiables sans déploiement (mig 306). Remplace les constantes de code et les drapeaux d''environnement.';

INSERT INTO module_parameters (key, value, description) VALUES
  ('purchasing.expense_requires_po',
   '{"enabled": false, "threshold": 2000, "currency": "MAD"}'::jsonb,
   'Dépense directe : si enabled, une dépense d''une catégorie « BC requis » d''un montant ≥ threshold doit être rattachée à un bon de commande engagé (envoyé ou livré).')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. CODES MOTIF (référentiel existant ref_tables / ref_entries)
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('purchase_reason_codes', 'Motifs achats',
   'Annulation, non-livraison, blocage, rejet, retour, écart, clôture forcée, dérogation espèces. metadata.scope = actions autorisées ; requires_note = précision obligatoire.',
   'ClipboardList', 'ref_entries', true, 20)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, display_order, metadata) VALUES
  ('purchase_reason_codes', 'price_disagreement',      'Désaccord sur le prix',               1,  '{"scope":["reject","cancel","hold","award"]}'),
  ('purchase_reason_codes', 'supplier_unavailable',    'Fournisseur indisponible / rupture',  2,  '{"scope":["cancel","not_delivered","award"]}'),
  ('purchase_reason_codes', 'late_delivery',           'Livraison hors délai',                3,  '{"scope":["cancel","not_delivered","hold"]}'),
  ('purchase_reason_codes', 'duplicate',               'Doublon de commande',                 4,  '{"scope":["cancel","reject"]}'),
  ('purchase_reason_codes', 'need_changed',            'Besoin modifié ou annulé',            5,  '{"scope":["cancel","reject","force_close"]}'),
  ('purchase_reason_codes', 'entry_error',             'Erreur de saisie',                    6,  '{"scope":["cancel","reject","reverse"]}'),
  ('purchase_reason_codes', 'quality_reject',          'Refus qualité à la réception',        7,  '{"scope":["return","quality_reject","hold"]}'),
  ('purchase_reason_codes', 'qty_variance_accepted',   'Écart de quantité accepté',           8,  '{"scope":["variance","force_close"]}'),
  ('purchase_reason_codes', 'price_variance_accepted', 'Écart de prix accepté',               9,  '{"scope":["variance"]}'),
  ('purchase_reason_codes', 'invoice_dispute',         'Litige facture',                      10, '{"scope":["hold"]}'),
  ('purchase_reason_codes', 'supplier_compliance',     'Fournisseur non conforme (documents)', 11, '{"scope":["hold","reject"]}'),
  ('purchase_reason_codes', 'better_lead_time',        'Délai plus court',                    12, '{"scope":["award"]}'),
  ('purchase_reason_codes', 'better_quality',          'Qualité / référence habituelle',      13, '{"scope":["award"]}'),
  -- Motif sectoriel (agro / pharma) : DLC.
  ('purchase_reason_codes', 'dlc_short',               'DLC trop courte',                     30, '{"scope":["return","quality_reject"],"sector":"agro"}'),
  -- Motifs légaux du pack pays Maroc (CGI art. 11-II / 106-II).
  ('purchase_reason_codes', 'cash_exception_agri',     'Produits agricoles non transformés (art. 106-II)', 40, '{"scope":["cash_override"],"country":"MA"}'),
  ('purchase_reason_codes', 'cash_exception_other',    'Autre dérogation espèces (à justifier)',           41, '{"scope":["cash_override"],"country":"MA","requires_note":true}'),
  ('purchase_reason_codes', 'other',                   'Autre (préciser)',                    99, '{"scope":["reject","cancel","not_delivered","return","hold","variance","force_close","cash_override","award","quality_reject","reverse","unlock"],"requires_note":true}')
ON CONFLICT (table_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION fn_reason_scope_ok(p_reason UUID, p_scope TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM ref_entries
     WHERE id = p_reason AND table_id = 'purchase_reason_codes' AND is_active
       AND metadata -> 'scope' ? p_scope)
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. BON DE COMMANDE : motifs, hold, gel, verrou
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS cancel_reason_code_id UUID REFERENCES ref_entries(id),
  ADD COLUMN IF NOT EXISTS cancel_note           TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by          UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS on_hold               BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hold_reason_code_id   UUID REFERENCES ref_entries(id),
  ADD COLUMN IF NOT EXISTS hold_note             TEXT,
  ADD COLUMN IF NOT EXISTS held_by               UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS held_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS frozen                BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS frozen_by             UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS frozen_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_at             TIMESTAMPTZ;

-- Motif d'annulation / non-livraison : obligatoire. Les BC annulés ou non livrés historiques
-- reçoivent le motif « Autre » avec une note de reprise (auteur et raison inconnus).
UPDATE purchase_orders
   SET cancel_reason_code_id = (SELECT id FROM ref_entries WHERE table_id = 'purchase_reason_codes' AND code = 'other'),
       cancel_note = 'Reprise mig 306 : motif et auteur inconnus',
       cancelled_at = COALESCE(cancelled_at, updated_at)
 WHERE status IN ('annule', 'non_livre') AND cancel_reason_code_id IS NULL;
ALTER TABLE purchase_orders ADD CONSTRAINT chk_po_cancel_reason
  CHECK (status NOT IN ('annule', 'non_livre') OR cancel_reason_code_id IS NOT NULL);
ALTER TABLE purchase_orders ADD CONSTRAINT chk_po_hold_reason
  CHECK (NOT on_hold OR hold_reason_code_id IS NOT NULL);

COMMENT ON COLUMN purchase_orders.on_hold IS 'Blocage (mig 306) : ni réception ni facture tant qu''il n''est pas levé. Motif obligatoire.';
COMMENT ON COLUMN purchase_orders.frozen  IS 'Gel (mig 306) : en-tête et lignes figés quel que soit le statut ; réception et facture restent possibles.';
COMMENT ON COLUMN purchase_orders.locked_at IS 'Date d''engagement (sortie de en_attente) : à partir de là le BC est verrouillé (mig 306).';

CREATE OR REPLACE FUNCTION fn_po_is_locked(p_status TEXT, p_frozen BOOLEAN)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_frozen OR p_status <> 'en_attente'
$$;

CREATE OR REPLACE FUNCTION trg_po_guard_locked()
RETURNS TRIGGER AS $$
BEGIN
  -- Date d'engagement posée à la première sortie de en_attente.
  IF OLD.status = 'en_attente' AND NEW.status <> 'en_attente' AND NEW.locked_at IS NULL THEN
    NEW.locked_at := now();
  END IF;
  IF fn_po_is_locked(OLD.status, OLD.frozen)
     AND (NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
          OR NEW.store_id IS DISTINCT FROM OLD.store_id
          OR NEW.order_date IS DISTINCT FROM OLD.order_date) THEN
    RAISE EXCEPTION 'Le bon de commande % est verrouillé (%) : fournisseur, magasin et date ne sont plus modifiables',
      OLD.order_number, CASE WHEN OLD.frozen THEN 'gelé' ELSE OLD.status END
      USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS po_guard_locked ON purchase_orders;
CREATE TRIGGER po_guard_locked BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION trg_po_guard_locked();

CREATE OR REPLACE FUNCTION trg_poi_guard_locked()
RETURNS TRIGGER AS $$
DECLARE
  v_po      purchase_orders%ROWTYPE;
  v_receipt BOOLEAN := current_setting('app.change_origin', true) = 'receipt';
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  -- BC supprimé en cascade, ou encore en brouillon non gelé : rien à garder.
  IF NOT FOUND OR NOT fn_po_is_locked(v_po.status, v_po.frozen) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- La réception (et son extourne) a le droit d'ajuster ses propres colonnes.
  IF v_receipt THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Le bon de commande % est verrouillé : impossible d''ajouter une ligne', v_po.order_number USING ERRCODE = 'OF409';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Le bon de commande % est verrouillé : impossible de supprimer une ligne', v_po.order_number USING ERRCODE = 'OF409';
  END IF;

  IF NEW.ingredient_id IS DISTINCT FROM OLD.ingredient_id
     OR NEW.packaging_id IS DISTINCT FROM OLD.packaging_id
     OR NEW.quantity_ordered IS DISTINCT FROM OLD.quantity_ordered THEN
    RAISE EXCEPTION 'Le bon de commande % est verrouillé : article et quantité commandée ne sont plus modifiables', v_po.order_number USING ERRCODE = 'OF409';
  END IF;
  IF NEW.quantity_delivered IS DISTINCT FROM OLD.quantity_delivered THEN
    RAISE EXCEPTION 'Le bon de commande % est verrouillé : la quantité livrée ne change que par une réception', v_po.order_number USING ERRCODE = 'OF409';
  END IF;
  IF NEW.unit_price IS DISTINCT FROM OLD.unit_price AND OLD.unit_price IS NOT NULL THEN
    RAISE EXCEPTION 'Le bon de commande % est verrouillé : un prix déjà saisi ne se corrige plus ici (seul un prix manquant peut être complété)', v_po.order_number USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS poi_guard_locked ON purchase_order_items;
CREATE TRIGGER poi_guard_locked BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION trg_poi_guard_locked();

-- Hold : ni réception ni facture.
CREATE OR REPLACE FUNCTION trg_guard_po_hold()
RETURNS TRIGGER AS $$
DECLARE v_po purchase_orders%ROWTYPE;
BEGIN
  IF NEW.purchase_order_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_po FROM purchase_orders WHERE id = NEW.purchase_order_id;
  IF FOUND AND v_po.on_hold THEN
    RAISE EXCEPTION 'Le bon de commande % est bloqué : % impossible tant que le blocage n''est pas levé',
      v_po.order_number, CASE TG_TABLE_NAME WHEN 'reception_vouchers' THEN 'réception' ELSE 'facturation' END
      USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS rv_guard_po_hold ON reception_vouchers;
CREATE TRIGGER rv_guard_po_hold BEFORE INSERT ON reception_vouchers
  FOR EACH ROW EXECUTE FUNCTION trg_guard_po_hold();
DROP TRIGGER IF EXISTS invoices_guard_po_hold ON invoices;
CREATE TRIGGER invoices_guard_po_hold BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION trg_guard_po_hold();

-- Reprise : date d'engagement des BC déjà sortis de en_attente (information).
UPDATE purchase_orders SET locked_at = COALESCE(updated_at, created_at)
 WHERE status <> 'en_attente' AND locked_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. AUDIT SGBD ÉTENDU (fonction et table de la mig 305)
-- ═══════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS purchase_orders_document_audit ON purchase_orders;
CREATE TRIGGER purchase_orders_document_audit AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION log_purchasing_document_change();
DROP TRIGGER IF EXISTS purchase_order_items_document_audit ON purchase_order_items;
CREATE TRIGGER purchase_order_items_document_audit AFTER INSERT OR UPDATE OR DELETE ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION log_purchasing_document_change();
DROP TRIGGER IF EXISTS invoices_document_audit ON invoices;
CREATE TRIGGER invoices_document_audit AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION log_purchasing_document_change();
DROP TRIGGER IF EXISTS payments_document_audit ON payments;
CREATE TRIGGER payments_document_audit AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION log_purchasing_document_change();
DROP TRIGGER IF EXISTS module_parameters_document_audit ON module_parameters;
CREATE TRIGGER module_parameters_document_audit AFTER INSERT OR UPDATE OR DELETE ON module_parameters
  FOR EACH ROW EXECUTE FUNCTION log_purchasing_document_change();

-- ═══════════════════════════════════════════════════════════════════════
-- 6. REPRISE DE L'HISTORIQUE RECONSTITUABLE (canal 'script')
-- ═══════════════════════════════════════════════════════════════════════
-- L'envoi au fournisseur n'a jamais été daté : il n'est pas reconstitué.
INSERT INTO document_actions (document_type, document_id, action, actor_id, channel, note, snapshot_amount, acted_at)
SELECT 'purchase_order', po.id, 'created', po.created_by, 'script', 'reprise mig 306', NULL, po.created_at
  FROM purchase_orders po;

INSERT INTO document_actions (document_type, document_id, action, actor_id, channel, note, acted_at)
SELECT 'purchase_order', rv.purchase_order_id, 'received', rv.received_by, 'script',
       'reprise mig 306 — ' || rv.voucher_number, rv.created_at
  FROM reception_vouchers rv
 ORDER BY rv.created_at;

INSERT INTO document_actions (document_type, document_id, action, actor_id, channel, note, snapshot_amount, acted_at)
SELECT 'purchase_order', i.purchase_order_id, 'invoiced', i.created_by, 'script',
       'reprise mig 306 — ' || i.invoice_number, i.total_amount, i.created_at
  FROM invoices i
 WHERE i.purchase_order_id IS NOT NULL
 ORDER BY i.created_at;

INSERT INTO document_actions (document_type, document_id, action, actor_id, channel, note, acted_at)
SELECT 'purchase_order', po.id, 'cancelled', NULL, 'script', 'reprise mig 306 — auteur et motif inconnus', po.updated_at
  FROM purchase_orders po WHERE po.status = 'annule';

INSERT INTO document_actions (document_type, document_id, action, actor_id, channel, note, acted_at)
SELECT 'purchase_request', pr.id, 'created', pr.requested_by, 'script', 'reprise mig 306', pr.created_at
  FROM purchase_requests pr;
