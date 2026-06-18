-- Migration 184 : Discriminant source_detail sur les ecritures
--
-- POURQUOI
--   Une meme source metier peut donner naissance a PLUSIEURS ecritures :
--     - Un cheque : ecriture d'EMISSION (4411/5111) puis d'ENCAISSEMENT (5111/5141).
--     - Une traite : EMISSION (4411/4415) puis ENCAISSEMENT (4415/5141).
--   Les deux portent le meme (source_kind='payment', source_id=payment.id), ce
--   qui rend l'idempotence ambigue (persistEntry croit l'ecriture deja creee).
--
--   source_detail leve l'ambiguite : 'emission' | 'cashing' | NULL (defaut).
--   L'idempotence se fait desormais sur (source_kind, source_id, source_detail).
--
-- PORTEE
--   ALTER TABLE journal_entries ADD COLUMN source_detail (nullable).
--   Aucune donnee existante modifiee (les ecritures actuelles restent en NULL,
--   ce qui correspond a leur unicite par source_id).
--
-- INVERSION
--   ALTER TABLE journal_entries DROP COLUMN source_detail;

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS source_detail VARCHAR(20);

COMMENT ON COLUMN journal_entries.source_detail IS
  'Discriminant pour les sources a ecritures multiples : emission, cashing, NULL (defaut, source a ecriture unique).';

-- Index d'unicite logique : une seule ecriture vivante par (source, detail).
-- Partiel sur status != reversed pour autoriser une extourne ulterieure.
CREATE UNIQUE INDEX IF NOT EXISTS uq_je_source_detail
  ON journal_entries (source_kind, source_id, COALESCE(source_detail, ''))
  WHERE status != 'reversed' AND source_id IS NOT NULL;
