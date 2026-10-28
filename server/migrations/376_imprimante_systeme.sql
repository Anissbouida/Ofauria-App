-- 376 — Imprimante système (file d'impression du poste : CUPS sur macOS/Linux).
--
-- Une imprimante thermique USB branchée sur le poste n'est pas joignable en TCP et le
-- serveur n'a pas d'accès USB direct. Le poste la déclare dans son système (file
-- d'impression brute, « raw »), et Kalum envoie le ticket ESC/POS tel quel à cette file
-- (`lp -o raw`). L'interface « cups » prend le nom de la file comme chaîne de connexion.
-- L'écran Paramètres › Caisse et tickets détecte les files existantes et les imprimantes
-- USB vues par le système, et peut créer la file en un clic.
--
-- Rollback : remettre la contrainte CHECK (interface IN ('tcp', 'usb', 'serial')).

ALTER TABLE printer_configs DROP CONSTRAINT IF EXISTS printer_configs_interface_check;
ALTER TABLE printer_configs ADD CONSTRAINT printer_configs_interface_check CHECK (interface IN ('tcp', 'usb', 'serial', 'cups'));
