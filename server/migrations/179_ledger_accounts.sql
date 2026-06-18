-- Migration 179 : Plan comptable (CGNC Maroc) + tiers auxiliaires
--
-- POURQUOI
--   Aujourd'hui le suivi financier d'Ofauria repose sur des agregations ad hoc
--   (SUM des payments vs invoices) sans plan comptable normalise ni ecritures
--   en partie double. Pour pouvoir produire un grand livre, une balance, une
--   declaration TVA et un export FEC reglementaires, on introduit le squelette
--   d'une vraie comptabilite calquee sur le CGNC marocain.
--
-- PORTEE DE CETTE MIGRATION
--   - Cree uniquement deux tables nouvelles : accounts, account_auxiliaries.
--   - Seede ~60 comptes CGNC pertinents pour une activite restauration.
--   - Backfille account_auxiliaries depuis les suppliers et customers existants.
--   - NE TOUCHE A AUCUNE TABLE EXISTANTE : invoices, payments, suppliers,
--     customers restent strictement inchangees. Aucun ALTER, aucun UPDATE.
--
-- STRATEGIE D'INVERSION
--   DROP TABLE account_auxiliaries; DROP TABLE accounts; suffit a annuler
--   integralement cette migration sans toucher aux donnees historiques.

-- ============================================================================
-- 1. Table accounts (plan comptable CGNC)
-- ============================================================================
-- Hierarchie CGNC : classe (1 chiffre) -> rubrique (2) -> poste (3) -> divisionnaire (4-6).
-- On stocke les niveaux denormalises pour faciliter l'agregation (bilan, CPC)
-- sans avoir a parcourir parent_id recursivement.

CREATE TABLE IF NOT EXISTS accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(10) NOT NULL UNIQUE,
  label           VARCHAR(200) NOT NULL,

  -- Hierarchie CGNC denormalisee
  account_class   SMALLINT NOT NULL CHECK (account_class BETWEEN 1 AND 9),
  rubrique        VARCHAR(2) NOT NULL,
  poste           VARCHAR(3) NOT NULL,
  parent_id       UUID REFERENCES accounts(id),

  -- Nature comptable
  account_type    VARCHAR(20) NOT NULL
    CHECK (account_type IN ('asset','liability','equity','revenue','expense','result')),
  normal_side     CHAR(1) NOT NULL CHECK (normal_side IN ('D','C')),

  -- Tiers : compte collectif (3421, 4411) ventile par auxiliaire
  is_collective   BOOLEAN NOT NULL DEFAULT false,
  auxiliary_kind  VARCHAR(20) CHECK (auxiliary_kind IN ('supplier','customer')),

  -- TVA : utile pour la generation auto des declarations CA20
  tva_rate        DECIMAL(5,2),
  tva_direction   VARCHAR(15) CHECK (tva_direction IN ('collected','deductible')),

  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Coherence : un compte collectif doit avoir une nature de tiers
  CHECK (NOT is_collective OR auxiliary_kind IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_accounts_class    ON accounts(account_class);
CREATE INDEX IF NOT EXISTS idx_accounts_rubrique ON accounts(rubrique);
CREATE INDEX IF NOT EXISTS idx_accounts_poste    ON accounts(poste);
CREATE INDEX IF NOT EXISTS idx_accounts_active   ON accounts(is_active) WHERE is_active = true;

COMMENT ON TABLE accounts IS
  'Plan comptable marocain CGNC. Code = identifiant officiel (ex: 4411 Fournisseurs).';
COMMENT ON COLUMN accounts.is_collective IS
  'Compte collectif (3421 Clients, 4411 Fournisseurs) : les ecritures portent un auxiliary_id.';
COMMENT ON COLUMN accounts.normal_side IS
  'Sens normal du solde : D = debiteur (actifs, charges), C = crediteur (passifs, produits).';

-- ============================================================================
-- 2. Table account_auxiliaries (sous-comptes tiers)
-- ============================================================================
-- Plutot que de creer un compte par fournisseur (lourd, et ingerable a long
-- terme), on rattache chaque supplier/customer a un compte collectif via cette
-- table. Chaque auxiliaire a un code stable (ex: 4411-FOUR-0012) qui apparait
-- dans le grand livre auxiliaire.

CREATE TABLE IF NOT EXISTS account_auxiliaries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id),
  supplier_id   UUID REFERENCES suppliers(id) ON DELETE RESTRICT,
  customer_id   UUID REFERENCES customers(id) ON DELETE RESTRICT,
  code          VARCHAR(30) NOT NULL UNIQUE,
  label         VARCHAR(200) NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Exactement un des deux ID est rempli
  CHECK (
    (supplier_id IS NOT NULL AND customer_id IS NULL)
    OR (supplier_id IS NULL AND customer_id IS NOT NULL)
  )
);

-- Unicite tiers : un supplier (resp. customer) ne peut etre rattache qu'une
-- seule fois a un compte collectif.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aux_supplier
  ON account_auxiliaries(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_aux_customer
  ON account_auxiliaries(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aux_account ON account_auxiliaries(account_id);

COMMENT ON TABLE account_auxiliaries IS
  'Sous-comptes tiers rattaches aux comptes collectifs 3421 (clients) et 4411 (fournisseurs).';

-- ============================================================================
-- 3. Seed du plan comptable CGNC pour activite restauration
-- ============================================================================
-- ~60 comptes couvrant : capitaux, immobilisations, stocks, tiers, tresorerie,
-- charges courantes restauration, produits de ventes. Le seed est idempotent
-- via ON CONFLICT (code) DO NOTHING.

INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side, is_collective, auxiliary_kind, tva_rate, tva_direction) VALUES
  -- ============ Classe 1 : Financement permanent ============
  ('1111', 'Capital social',                              1, '11', '111', 'equity',    'C', false, NULL, NULL, NULL),
  ('1140', 'Reserve legale',                              1, '11', '114', 'equity',    'C', false, NULL, NULL, NULL),
  ('1161', 'Report a nouveau (solde crediteur)',          1, '11', '116', 'equity',    'C', false, NULL, NULL, NULL),
  ('1169', 'Report a nouveau (solde debiteur)',           1, '11', '116', 'equity',    'D', false, NULL, NULL, NULL),
  ('1191', 'Resultat net de l''exercice',                 1, '11', '119', 'result',    'C', false, NULL, NULL, NULL),
  ('1481', 'Emprunts aupres des etablissements de credit',1, '14', '148', 'liability', 'C', false, NULL, NULL, NULL),

  -- ============ Classe 2 : Actif immobilise ============
  ('2230', 'Fonds commercial',                            2, '22', '223', 'asset',     'D', false, NULL, NULL, NULL),
  ('2321', 'Batiments',                                   2, '23', '232', 'asset',     'D', false, NULL, NULL, NULL),
  ('2332', 'Materiel et outillage',                       2, '23', '233', 'asset',     'D', false, NULL, NULL, NULL),
  ('2351', 'Mobilier de bureau',                          2, '23', '235', 'asset',     'D', false, NULL, NULL, NULL),
  ('2355', 'Materiel informatique',                       2, '23', '235', 'asset',     'D', false, NULL, NULL, NULL),
  ('2356', 'Agencements et amenagements',                 2, '23', '235', 'asset',     'D', false, NULL, NULL, NULL),
  ('2832', 'Amortissements du materiel et outillage',     2, '28', '283', 'asset',     'C', false, NULL, NULL, NULL),
  ('2835', 'Amortissements du materiel informatique',     2, '28', '283', 'asset',     'C', false, NULL, NULL, NULL),

  -- ============ Classe 3 : Actif circulant ============
  ('3121',  'Matieres premieres',                         3, '31', '312', 'asset',     'D', false, NULL, NULL, NULL),
  ('3122',  'Matieres et fournitures consommables',       3, '31', '312', 'asset',     'D', false, NULL, NULL, NULL),
  ('3151',  'Produits finis',                             3, '31', '315', 'asset',     'D', false, NULL, NULL, NULL),
  ('3155',  'Produits intermediaires (semi-finis)',       3, '31', '315', 'asset',     'D', false, NULL, NULL, NULL),
  ('3421',  'Clients',                                    3, '34', '342', 'asset',     'D', true,  'customer', NULL, NULL),
  ('3423',  'Clients - Effets a recevoir',                3, '34', '342', 'asset',     'D', false, NULL, NULL, NULL),
  ('3424',  'Clients douteux ou litigieux',               3, '34', '342', 'asset',     'D', false, NULL, NULL, NULL),
  ('3425',  'Clients - Avances et acomptes verses',       3, '34', '342', 'asset',     'D', false, NULL, NULL, NULL),
  ('3455',  'Etat - TVA recuperable',                     3, '34', '345', 'asset',     'D', false, NULL, NULL, NULL),
  ('34551', 'TVA recuperable sur immobilisations 20%',    3, '34', '345', 'asset',     'D', false, NULL, 20.00, 'deductible'),
  ('34552', 'TVA recuperable sur charges 20%',            3, '34', '345', 'asset',     'D', false, NULL, 20.00, 'deductible'),
  ('34553', 'TVA recuperable sur charges 14%',            3, '34', '345', 'asset',     'D', false, NULL, 14.00, 'deductible'),
  ('34554', 'TVA recuperable sur charges 10%',            3, '34', '345', 'asset',     'D', false, NULL, 10.00, 'deductible'),
  ('34555', 'TVA recuperable sur charges 7%',             3, '34', '345', 'asset',     'D', false, NULL,  7.00, 'deductible'),

  -- ============ Classe 4 : Passif circulant ============
  ('4411',  'Fournisseurs',                               4, '44', '441', 'liability', 'C', true,  'supplier', NULL, NULL),
  ('4415',  'Fournisseurs - Effets a payer',              4, '44', '441', 'liability', 'C', false, NULL, NULL, NULL),
  ('4417',  'Fournisseurs - Factures non parvenues',      4, '44', '441', 'liability', 'C', false, NULL, NULL, NULL),
  ('4425',  'Clients - Avances et acomptes recus',        4, '44', '442', 'liability', 'C', false, NULL, NULL, NULL),
  ('4432',  'Remunerations dues au personnel',            4, '44', '443', 'liability', 'C', false, NULL, NULL, NULL),
  ('4441',  'CNSS',                                       4, '44', '444', 'liability', 'C', false, NULL, NULL, NULL),
  ('4443',  'Caisses de retraite (CIMR)',                 4, '44', '444', 'liability', 'C', false, NULL, NULL, NULL),
  ('4452',  'Etat - Impots et taxes',                     4, '44', '445', 'liability', 'C', false, NULL, NULL, NULL),
  ('4455',  'Etat - TVA facturee',                        4, '44', '445', 'liability', 'C', false, NULL, NULL, NULL),
  ('44551', 'TVA facturee 20%',                           4, '44', '445', 'liability', 'C', false, NULL, 20.00, 'collected'),
  ('44552', 'TVA facturee 14%',                           4, '44', '445', 'liability', 'C', false, NULL, 14.00, 'collected'),
  ('44553', 'TVA facturee 10%',                           4, '44', '445', 'liability', 'C', false, NULL, 10.00, 'collected'),
  ('44554', 'TVA facturee 7%',                            4, '44', '445', 'liability', 'C', false, NULL,  7.00, 'collected'),
  ('4456',  'Etat - TVA due (solde net)',                 4, '44', '445', 'liability', 'C', false, NULL, NULL, NULL),

  -- ============ Classe 5 : Tresorerie ============
  ('5111', 'Cheques a encaisser ou a l''encaissement',    5, '51', '511', 'asset',     'D', false, NULL, NULL, NULL),
  ('5113', 'Effets a encaisser ou a l''encaissement',     5, '51', '511', 'asset',     'D', false, NULL, NULL, NULL),
  ('5141', 'Banques',                                     5, '51', '514', 'asset',     'D', false, NULL, NULL, NULL),
  ('5161', 'Caisses',                                     5, '51', '516', 'asset',     'D', false, NULL, NULL, NULL),
  ('5165', 'Regies d''avances et accreditifs',            5, '51', '516', 'asset',     'D', false, NULL, NULL, NULL),

  -- ============ Classe 6 : Charges ============
  ('61121', 'Achats de matieres premieres',               6, '61', '611', 'expense',   'D', false, NULL, NULL, NULL),
  ('61221', 'Achats de matieres et fournitures consommables', 6, '61', '612', 'expense','D', false, NULL, NULL, NULL),
  ('6125',  'Achats non stockes (eau, electricite, gaz)', 6, '61', '612', 'expense',   'D', false, NULL, NULL, NULL),
  ('6131',  'Locations et charges locatives',             6, '61', '613', 'expense',   'D', false, NULL, NULL, NULL),
  ('6133',  'Entretien et reparations',                   6, '61', '613', 'expense',   'D', false, NULL, NULL, NULL),
  ('6142',  'Transports',                                 6, '61', '614', 'expense',   'D', false, NULL, NULL, NULL),
  ('6144',  'Publicite, publications, relations publiques',6, '61', '614', 'expense',  'D', false, NULL, NULL, NULL),
  ('6147',  'Services bancaires',                         6, '61', '614', 'expense',   'D', false, NULL, NULL, NULL),
  ('6167',  'Impots, taxes et versements assimiles',      6, '61', '616', 'expense',   'D', false, NULL, NULL, NULL),
  ('6171',  'Remunerations du personnel',                 6, '61', '617', 'expense',   'D', false, NULL, NULL, NULL),
  ('6174',  'Charges sociales (CNSS)',                    6, '61', '617', 'expense',   'D', false, NULL, NULL, NULL),
  ('6176',  'Charges sociales diverses (CIMR, AMO)',      6, '61', '617', 'expense',   'D', false, NULL, NULL, NULL),
  ('6181',  'Charges diverses',                           6, '61', '618', 'expense',   'D', false, NULL, NULL, NULL),
  ('6191',  'Dotations d''exploitation aux amortissements',6, '61', '619', 'expense',  'D', false, NULL, NULL, NULL),

  -- ============ Classe 7 : Produits ============
  ('7111', 'Ventes de marchandises au Maroc',             7, '71', '711', 'revenue',   'C', false, NULL, NULL, NULL),
  ('7121', 'Ventes de biens produits au Maroc',           7, '71', '712', 'revenue',   'C', false, NULL, NULL, NULL),
  ('7124', 'Ventes de services produits au Maroc',        7, '71', '712', 'revenue',   'C', false, NULL, NULL, NULL),
  ('7129', 'RRR accordes par l''entreprise',              7, '71', '712', 'revenue',   'D', false, NULL, NULL, NULL),
  ('7585', 'Autres produits non courants',                7, '75', '758', 'revenue',   'C', false, NULL, NULL, NULL)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 4. Backfill account_auxiliaries depuis suppliers et customers existants
-- ============================================================================
-- On cree un sous-compte par fournisseur (rattache au 4411) et un par client
-- (rattache au 3421). Idempotent via ON CONFLICT.
--
-- Code auxiliaire : 4411-FOUR-{6 premieres lettres du nom upper} pour lisibilite
--                   3421-CLI-{6 premieres lettres} idem cote client
-- On regle les collisions ulterieures avec un suffixe lors de la creation des
-- nouveaux tiers (cf. code applicatif a venir). Pour le backfill, on suffixe
-- par les 4 premiers chars de l'ID pour eviter toute collision.

INSERT INTO account_auxiliaries (account_id, supplier_id, code, label)
SELECT
  (SELECT id FROM accounts WHERE code = '4411'),
  s.id,
  '4411-FOUR-' || UPPER(SUBSTR(REGEXP_REPLACE(s.name, '[^A-Za-z0-9]', '', 'g'), 1, 6))
                || '-' || SUBSTR(s.id::TEXT, 1, 4),
  s.name
FROM suppliers s
WHERE NOT EXISTS (
  SELECT 1 FROM account_auxiliaries a WHERE a.supplier_id = s.id
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO account_auxiliaries (account_id, customer_id, code, label)
SELECT
  (SELECT id FROM accounts WHERE code = '3421'),
  c.id,
  '3421-CLI-' || UPPER(SUBSTR(REGEXP_REPLACE(
    COALESCE(c.first_name, '') || COALESCE(c.last_name, ''),
    '[^A-Za-z0-9]', '', 'g'), 1, 6))
              || '-' || SUBSTR(c.id::TEXT, 1, 4),
  TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM account_auxiliaries a WHERE a.customer_id = c.id
)
ON CONFLICT (code) DO NOTHING;
