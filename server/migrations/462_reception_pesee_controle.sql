-- L5 Réception qualité (analyse d'écart P2P) — incrément 2 : capture de pesée.
--
-- POURQUOI
--   À la réception, la quantité « reçue » est aujourd'hui déclarée (recopiée du BC
--   ou saisie), jamais mesurée. Pour les marchandises au poids, on veut une pesée
--   de contrôle brut / tare / net et un écart visible entre le poids réel et la
--   quantité facturée — base d'une réclamation fournisseur (manque de poids).
--
-- QUOI
--   Trois poids (en unité de base, typiquement kg) + la source de la mesure sur la
--   ligne de réception. net = brut − tare (contrôlé applicativement). L'écart =
--   net − quantité reçue se calcule à l'affichage ; rien n'est bloqué ni ne modifie
--   le coût / la quantité : la pesée est une CONTRE-MESURE de contrôle, facultative.
--
--   Source prête pour la balance connectée (pesage BSI, mig 270) : 'manual'
--   aujourd'hui, 'scale' quand la mesure viendra du port série (WebSerial).
--
-- INVERSION :
--   ALTER TABLE reception_voucher_items
--     DROP COLUMN gross_weight, DROP COLUMN tare_weight,
--     DROP COLUMN net_weight,  DROP COLUMN weighing_source;

ALTER TABLE reception_voucher_items
  ADD COLUMN IF NOT EXISTS gross_weight    NUMERIC(14,3) CHECK (gross_weight    IS NULL OR gross_weight    >= 0),
  ADD COLUMN IF NOT EXISTS tare_weight     NUMERIC(14,3) CHECK (tare_weight     IS NULL OR tare_weight     >= 0),
  ADD COLUMN IF NOT EXISTS net_weight      NUMERIC(14,3) CHECK (net_weight      IS NULL OR net_weight      >= 0),
  ADD COLUMN IF NOT EXISTS weighing_source VARCHAR(10) NOT NULL DEFAULT 'manual'
    CHECK (weighing_source IN ('manual', 'scale'));

COMMENT ON COLUMN reception_voucher_items.gross_weight IS
  'Pesée de contrôle à la réception (L5 P2P, mig 462) : poids brut mesuré, unité de base (kg).';
COMMENT ON COLUMN reception_voucher_items.tare_weight IS
  'Tare (contenant/emballage) de la pesée de contrôle.';
COMMENT ON COLUMN reception_voucher_items.net_weight IS
  'Poids net mesuré (brut − tare). L''écart net − quantité reçue se lit à l''affichage.';
COMMENT ON COLUMN reception_voucher_items.weighing_source IS
  'Source de la pesée : manual (saisie) | scale (balance connectée, WebSerial — pesage BSI mig 270).';
