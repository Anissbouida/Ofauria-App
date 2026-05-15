-- Migration 125 : configuration des imprimantes physiques (ESC/POS)
--
-- Contexte : aujourd'hui ReceiptModal cote frontend utilise window.print() pour
-- imprimer. Ca traverse l'OS et le driver d'imprimante, ce qui :
--   - ne preserve PAS les commandes ESC/POS binaires (donc le tiroir-caisse ne
--     s'ouvre pas, malgre la case a cocher "ouvrir le tiroir")
--   - depend du PC du caissier (drivers a installer manuellement par poste)
--   - ne marche pas en mode tablette/mobile
--
-- Solution : un backend qui parle DIRECTEMENT a l'imprimante (TCP/IP ou USB
-- via un agent local), en pure binaire ESC/POS. Cette table stocke la conf
-- de chaque imprimante (par magasin, par type d'usage).
--
-- Le champ connection_string contient :
--   - "tcp://192.168.1.100:9100" pour imprimante reseau (recommande)
--   - "usb:///dev/usb/lp0" pour USB Linux (agent local requis)
--   - "printer://NomImprimanteWindows" pour USB Windows
--
-- printer_model = familles supportees par node-thermal-printer :
--   EPSON, STAR, TANCA, DARUMA, BROTHER, CUSTOM
-- Le defaut EPSON couvre 80% des imprimantes generiques chinoises.

BEGIN;

CREATE TABLE IF NOT EXISTS printer_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'receipt'
    CHECK (type IN ('receipt', 'kitchen', 'label')),
  interface VARCHAR(20) NOT NULL DEFAULT 'tcp'
    CHECK (interface IN ('tcp', 'usb', 'serial')),
  connection_string VARCHAR(200) NOT NULL,
  printer_model VARCHAR(20) NOT NULL DEFAULT 'EPSON'
    CHECK (printer_model IN ('EPSON', 'STAR', 'TANCA', 'DARUMA', 'BROTHER', 'CUSTOM')),
  character_set VARCHAR(20) NOT NULL DEFAULT 'PC437_USA',
  paper_width INT NOT NULL DEFAULT 48
    CHECK (paper_width IN (32, 42, 48, 64)),  -- nombre de caracteres par ligne
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  open_drawer_on_cash BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Une seule imprimante par defaut par (store, type)
CREATE UNIQUE INDEX IF NOT EXISTS uq_printer_default_per_type
  ON printer_configs(store_id, type)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_printer_store ON printer_configs(store_id, is_active);

COMMENT ON TABLE printer_configs IS
  'Configuration des imprimantes ESC/POS physiques. Une imprimante par defaut par (magasin, type d''usage).';
COMMENT ON COLUMN printer_configs.connection_string IS
  'Format selon interface : "tcp://host:port", "usb:///dev/lp0", "printer://NomImprimante".';
COMMENT ON COLUMN printer_configs.paper_width IS
  'Largeur en caracteres par ligne (32 pour 58mm, 48 pour 80mm).';

COMMIT;
