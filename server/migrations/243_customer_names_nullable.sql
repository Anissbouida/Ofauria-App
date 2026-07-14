-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 243 — first_name/last_name optionnels pour les entités morales
--
-- Pour une société/association/revendeur, on peut créer la fiche avant de
-- connaître un contact nommé (raison sociale suffit). On relâche donc la
-- contrainte NOT NULL sur first_name/last_name.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE customers
  ALTER COLUMN first_name DROP NOT NULL,
  ALTER COLUMN last_name DROP NOT NULL;
