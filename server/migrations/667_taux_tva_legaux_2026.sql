-- ═══════════════════════════════════════════════════════════════════════
-- 667 — Plan d'action compta, étape 4 (audit C-02) : taux de TVA légaux datés
--
--   Le paramètre `fiscalite.vat_rates` du pack pays valait [7, 10, 14, 20] depuis 2000, sans
--   date de fin, alors que les taux de 7 % et 14 % sont résorbés par les lois de finances
--   2024-2026 (CGI édition 2026, art. 99 : taux normal 20 %, taux réduit 10 %). Les contrôles
--   (relevé des déductions EDI, cession d'immobilisation) lisaient une liste en dur ou ce
--   paramètre non daté et acceptaient donc encore les anciens taux.
--
--   Nouvelle ligne datée au 1er janvier 2026 : [10, 20]. La ligne de 2000 reste en vigueur pour
--   les pièces antérieures (une facture de 2025 à 14 % n'est pas signalée). Un futur changement
--   de taux = une nouvelle ligne datée, jamais une mise à jour.
--
-- À valider avec l'expert-comptable : taux 10 % réduit unique et sort des taux 7 % / 14 % encore
--   portés par des pièces postérieures au 1er janvier 2026.
--
-- Rollback : DELETE FROM country_pack_parameters WHERE country_code = 'MA'
--   AND key = 'fiscalite.vat_rates' AND effective_from = '2026-01-01'.
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO country_pack_parameters (country_code, key, category, label, value_numeric, value_json, effective_from, legal_ref)
VALUES ('MA', 'fiscalite.vat_rates', 'fiscalite', 'Taux de TVA légaux (%)', NULL, '[10, 20]'::jsonb,
        DATE '2026-01-01', 'CGI 2026 art. 99 (convergence LF 2024-2026)')
ON CONFLICT (country_code, key, effective_from) DO NOTHING;
