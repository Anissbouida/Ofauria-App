-- Types de client et types de commande pilotés par le secteur (suite des mig 698-699).
--
-- Constat : une société « Bâtiment et travaux publics » se voyait proposer, à la création
-- d'une commande, « Client / Passager / Professionnel / Personnel (remise 10 %) » — quatre
-- cartes écrites dans l'écran — et ses clients étaient « particulier / professionnel /
-- association / revendeur », liste figée par un CHECK. Le code décidait du parcours en
-- comparant le type à 'particulier' (≈ 150 endroits).
--
-- Modèle : deux référentiels de plus dans l'architecture à trois niveaux de la mig 698
-- (commun / sectoriel / personnalisé, synchronisés par fn_ref_sync_sectors). Chaque valeur
-- porte dans metadata les COMPORTEMENTS que le code lit — le code ne compare plus le code
-- de la valeur :
--
--   customer_types.metadata
--     settlement       'comptant' : réglé au comptoir (avance facultative, solde à la remise)
--                      'compte'   : client en compte (prix HT, TVA par ligne, BL, facture)
--     legal_entity     personne morale (raison sociale sur les pièces)
--     requires_tax_id  identifiant fiscal (ICE) exigé pour facturer
--     vat_exempt       exonération de TVA proposée par défaut
--     personal_fields  champs d'une personne physique (anniversaire, allergies)
--
--   order_types.metadata
--     party            'customer' (fiche client) | 'walk_in' (nom et téléphone libres)
--                      | 'employee' (un salarié)
--     settlement       pour party = customer : 'comptant' | 'compte' | 'any' (clients proposés)
--     auto_discount    'none' | 'staff' (taux « remise du personnel » de la société)
--     direction_only   réservée à la direction
--
-- Compatibilité : les codes existants (particulier, professionnel, association, revendeur)
-- gardent leur comportement ; une boulangerie retrouve exactement ses quatre types de
-- commande. orders.type (custom / staff / online / event) n'est pas modifié : le type choisi
-- va dans la nouvelle colonne orders.order_kind.
--
-- INVERSION :
--   DROP TRIGGER orders_order_kind_ref ON orders; ALTER TABLE orders DROP COLUMN order_kind;
--   DROP TRIGGER customers_customer_type_ref ON customers;
--   ALTER TABLE customers ADD CONSTRAINT customers_customer_type_check
--     CHECK (customer_type IN ('particulier','professionnel','association','revendeur'));
--   DROP FUNCTION fn_customer_on_account(text); DROP FUNCTION fn_customer_type_flag(text, text);
--   DELETE FROM ref_tables WHERE id IN ('customer_types', 'order_types');

-- ─── 1. Tables de référentiel ─────────────────────────────────────────────────────────
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order, module) VALUES
  ('customer_types', 'Types de client', 'Nature des clients et parcours qui en découle (comptant ou en compte, personne morale, identifiant fiscal…).', 'Users', 'ref_entries', true, 16, 'customers'),
  ('order_types', 'Types de commande', 'Choix proposés à la création d''une commande client et règles de chacun.', 'ClipboardList', 'ref_entries', true, 17, 'orders')
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Catalogue ─────────────────────────────────────────────────────────────────────
-- Inséré inactif ; la synchronisation (fin de fichier) active ce qui correspond au secteur.
INSERT INTO ref_entries (table_id, code, label, description, icon, color, display_order, metadata, sectors, excluded_sectors, origin, is_active, activation, system_label)
SELECT v.t, v.c, v.l, v.d, v.i, v.col, v.o, v.m::jsonb, v.s::text[], v.x::text[], 'system', false, 'auto', v.l
FROM (VALUES
  -- Types de client — communs
  ('customer_types', 'particulier', 'Particulier', 'Personne physique, réglée au comptoir', 'User', '#2563eb', 10,
     '{"settlement":"comptant","legal_entity":false,"requires_tax_id":false,"vat_exempt":false,"personal_fields":true}',
     '{}', '{btp,services,transport,fabrication}'),
  ('customer_types', 'professionnel', 'Société', 'Entreprise cliente en compte', 'Building2', '#059669', 20,
     '{"settlement":"compte","legal_entity":true,"requires_tax_id":true,"vat_exempt":false,"personal_fields":false}',
     '{}', '{}'),
  -- Métiers de bouche, détail, services à la personne
  ('customer_types', 'association', 'Association', 'Association ou organisme sans but lucratif', 'HeartHandshake', '#9333ea', 30,
     '{"settlement":"compte","legal_entity":true,"requires_tax_id":false,"vat_exempt":true,"personal_fields":false}',
     '{agroalimentaire,restauration,commerce_detail,services,sante}', '{}'),
  ('customer_types', 'revendeur', 'Revendeur', 'Achète pour revendre', 'Store', '#d97706', 40,
     '{"settlement":"compte","legal_entity":true,"requires_tax_id":true,"vat_exempt":false,"personal_fields":false}',
     '{agroalimentaire,commerce_detail,negoce,textile,fabrication,agriculture,ecommerce}', '{}'),
  -- Particulier facturé (métiers sans vente au comptoir)
  ('customer_types', 'client_prive', 'Particulier', 'Personne physique, facturée', 'User', '#2563eb', 15,
     '{"settlement":"compte","legal_entity":false,"requires_tax_id":false,"vat_exempt":false,"personal_fields":false}',
     '{btp,services,transport,fabrication}', '{}'),
  -- Bâtiment et travaux publics
  ('customer_types', 'maitre_ouvrage', 'Maître d''ouvrage', 'Commanditaire des travaux', 'Landmark', '#2563eb', 50,
     '{"settlement":"compte","legal_entity":true,"requires_tax_id":true,"vat_exempt":false,"personal_fields":false}',
     '{btp}', '{}'),
  ('customer_types', 'promoteur', 'Promoteur immobilier', 'Promoteur ou lotisseur', 'Building', '#059669', 60,
     '{"settlement":"compte","legal_entity":true,"requires_tax_id":true,"vat_exempt":false,"personal_fields":false}',
     '{btp}', '{}'),
  ('customer_types', 'organisme_public', 'Organisme public', 'État, collectivité, établissement public', 'Landmark', '#9333ea', 70,
     '{"settlement":"compte","legal_entity":true,"requires_tax_id":false,"vat_exempt":false,"personal_fields":false}',
     '{btp,services,sante,transport,negoce}', '{}'),
  -- Industrie, négoce, agriculture
  ('customer_types', 'distributeur', 'Distributeur', 'Grossiste, centrale ou grande distribution', 'Truck', '#d97706', 80,
     '{"settlement":"compte","legal_entity":true,"requires_tax_id":true,"vat_exempt":false,"personal_fields":false}',
     '{agroalimentaire,negoce,fabrication,textile,agriculture}', '{boulangerie}'),
  ('customer_types', 'donneur_ordre', 'Donneur d''ordre', 'Fait fabriquer sous sa marque ou son cahier des charges', 'Factory', '#9333ea', 90,
     '{"settlement":"compte","legal_entity":true,"requires_tax_id":true,"vat_exempt":false,"personal_fields":false}',
     '{fabrication,textile}', '{}'),
  ('customer_types', 'cooperative', 'Coopérative', 'Coopérative ou groupement', 'Sprout', '#059669', 100,
     '{"settlement":"compte","legal_entity":true,"requires_tax_id":true,"vat_exempt":false,"personal_fields":false}',
     '{agriculture}', '{}'),
  -- Transport, santé
  ('customer_types', 'chargeur', 'Chargeur', 'Confie des marchandises à transporter', 'Package', '#d97706', 110,
     '{"settlement":"compte","legal_entity":true,"requires_tax_id":true,"vat_exempt":false,"personal_fields":false}',
     '{transport}', '{}'),
  ('customer_types', 'etablissement_sante', 'Établissement de santé', 'Clinique, cabinet, laboratoire', 'Hospital', '#059669', 120,
     '{"settlement":"compte","legal_entity":true,"requires_tax_id":true,"vat_exempt":false,"personal_fields":false}',
     '{sante}', '{}'),
  ('customer_types', 'organisme_payeur', 'Organisme payeur', 'Mutuelle, assurance, caisse', 'ShieldCheck', '#9333ea', 130,
     '{"settlement":"compte","legal_entity":true,"requires_tax_id":false,"vat_exempt":false,"personal_fields":false}',
     '{sante}', '{}'),

  -- Types de commande — vente au comptoir (parcours historique, inchangé)
  ('order_types', 'client', 'Client', 'Particulier enregistré', 'Users', '#2563eb', 10,
     '{"party":"customer","settlement":"comptant","auto_discount":"none","direction_only":false}',
     '{boulangerie,restauration,commerce_detail,sante}', '{}'),
  ('order_types', 'passager', 'Passager', 'Client de passage', 'User', '#d97706', 20,
     '{"party":"walk_in","settlement":"comptant","auto_discount":"none","direction_only":false}',
     '{boulangerie,restauration,commerce_detail,sante}', '{}'),
  ('order_types', 'professionnel', 'Professionnel', 'Livré sur BL, facturé', 'Building2', '#059669', 30,
     '{"party":"customer","settlement":"compte","auto_discount":"none","direction_only":true}',
     '{boulangerie,restauration,commerce_detail,sante}', '{}'),
  ('order_types', 'staff', 'Personnel', 'Remise du personnel automatique', 'CircleUser', '#9333ea', 40,
     '{"party":"employee","settlement":"comptant","auto_discount":"staff","direction_only":false}',
     '{boulangerie,restauration,commerce_detail,sante}', '{}'),
  -- Commande en compte (industrie, négoce, agriculture, transport, e-commerce, générique)
  ('order_types', 'standard', 'Commande client', 'Livraison sur BL, facture', 'ClipboardList', '#2563eb', 50,
     '{"party":"customer","settlement":"any","auto_discount":"none","direction_only":false}',
     '{agroalimentaire,negoce,fabrication,agriculture,textile,transport,ecommerce,generique}', '{boulangerie}'),
  ('order_types', 'comptoir', 'Vente au comptoir', 'Client de passage, réglée sur place', 'Store', '#d97706', 60,
     '{"party":"walk_in","settlement":"comptant","auto_discount":"none","direction_only":false}',
     '{negoce}', '{}'),
  -- Bâtiment et travaux publics
  ('order_types', 'travaux', 'Commande de travaux', 'Travaux sur devis accepté', 'HardHat', '#d97706', 70,
     '{"party":"customer","settlement":"compte","auto_discount":"none","direction_only":false}',
     '{btp}', '{}'),
  ('order_types', 'marche', 'Commande liée à un marché', 'Marché public ou privé, facturé par situations', 'Landmark', '#2563eb', 80,
     '{"party":"customer","settlement":"compte","auto_discount":"none","direction_only":false}',
     '{btp}', '{}'),
  -- Services
  ('order_types', 'prestation', 'Commande de prestation', 'Mission ou prestation, facturée', 'Briefcase', '#2563eb', 90,
     '{"party":"customer","settlement":"compte","auto_discount":"none","direction_only":false}',
     '{services}', '{}')
) v(t, c, l, d, i, col, o, m, s, x)
ON CONFLICT (table_id, code) DO NOTHING;

-- ─── 3. Fonctions lues par les requêtes ───────────────────────────────────────────────
-- Un type inconnu du référentiel garde la règle historique (tout sauf « particulier » est
-- en compte) : une base ancienne ne change pas de comportement.
CREATE OR REPLACE FUNCTION fn_customer_type_flag(p_type text, p_flag text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT (metadata ->> p_flag)::boolean FROM ref_entries
                    WHERE table_id = 'customer_types' AND code = COALESCE(p_type, 'particulier') AND metadata ? p_flag), false)
$$;
CREATE OR REPLACE FUNCTION fn_customer_on_account(p_type text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT metadata ->> 'settlement' = 'compte' FROM ref_entries
                    WHERE table_id = 'customer_types' AND code = COALESCE(p_type, 'particulier') AND metadata ? 'settlement'),
                  COALESCE(p_type, 'particulier') <> 'particulier')
$$;
COMMENT ON FUNCTION fn_customer_on_account(text) IS 'Client en compte (BL, facture) plutôt que réglé au comptoir : comportement « settlement » du type de client.';

-- ─── 4. Liste figée en base → référentiel ─────────────────────────────────────────────
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_customer_type_check;
DROP TRIGGER IF EXISTS customers_customer_type_ref ON customers;
CREATE TRIGGER customers_customer_type_ref BEFORE INSERT OR UPDATE OF customer_type ON customers
  FOR EACH ROW EXECUTE FUNCTION fn_check_ref_code('customer_types', 'customer_type');

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_kind varchar(60);
COMMENT ON COLUMN orders.order_kind IS 'Type de commande choisi (référentiel order_types). NULL : commande antérieure ou créée hors écran.';
DROP TRIGGER IF EXISTS orders_order_kind_ref ON orders;
CREATE TRIGGER orders_order_kind_ref BEFORE INSERT OR UPDATE OF order_kind ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_check_ref_code('order_types', 'order_kind');

INSERT INTO ref_usage_sources (table_id, source_table, source_column) VALUES
  ('customer_types', 'customers', 'customer_type'), ('order_types', 'orders', 'order_kind')
ON CONFLICT DO NOTHING;

-- Rattrapage des commandes existantes (parcours de vente au comptoir seulement).
UPDATE orders o SET order_kind = CASE
    WHEN o.type = 'staff' THEN 'staff'
    WHEN o.customer_id IS NULL THEN 'passager'
    WHEN fn_customer_on_account((SELECT c.customer_type FROM customers c WHERE c.id = o.customer_id)) THEN 'professionnel'
    ELSE 'client' END
 WHERE o.order_kind IS NULL AND COALESCE(o.type, 'custom') IN ('custom', 'staff', 'event');

-- ─── 5. Activation selon le secteur de la société ─────────────────────────────────────
SELECT fn_ref_sync_sectors('migration_701');
