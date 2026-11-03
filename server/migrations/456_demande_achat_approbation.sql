-- Migration 456 : état d'APPROBATION de la demande d'achat (flux procure-to-pay)
--
-- POURQUOI
--   Le flux cible est : Identification → DEMANDE D'ACHAT → APPROBATION (selon les
--   règles configurées, mig 350) → Bon de commande → Réception → Facturation. Le
--   chemin « BC direct » (une DA transformée en BC d'un clic depuis « À commander »)
--   est supprimé : désormais le BC ne naît QUE d'une DA approuvée.
--   Décision validée par le client, qui INVERSE la décision « BC directs »
--   (mémoire a_commander_bc_direct) : la DA redevient le pivot du cycle.
--
-- MODÈLE — DEUX DIMENSIONS SÉPARÉES sur purchase_requests, à ne pas confondre :
--   1. status (mig 057/271/305/434) = COUVERTURE, CALCULÉE par
--      fn_recompute_purchase_request depuis les lignes de BC
--      (pending/assigned/received/closed/cancelled). On n'y touche pas.
--   2. approval_status (ICI) = état du CIRCUIT D'APPROBATION, posé par l'action
--      humaine et par le moteur d'approbation :
--        - draft    : saisie en cours, pas encore soumise (réservé, non utilisé
--                     par le flux actuel qui soumet à la création) ;
--        - pending  : une règle d'approbation a matché, en attente de décision ;
--        - approved : aucune règle ne matchait, OU le circuit a été approuvé →
--                     la DA est COMMANDABLE (un BC peut être généré) ;
--        - rejected : le circuit a été refusé → non commandable.
--   Une DA est commandable ⇔ status = 'pending' (rien de commandé encore)
--   ET approval_status = 'approved'.
--
--   Le lien vers le circuit lui-même reste porté par approval_requests
--   (doc_type = 'purchase_request', doc_id = purchase_requests.id, mig 350) ;
--   on ne duplique pas la demande d'approbation ici.
--
-- COMPATIBILITÉ
--   Défaut 'approved' : toutes les DA existantes (créées sous l'ancien modèle « BC
--   direct », où la DA était un socle invisible) restent commandables. Les gardes
--   d'approbation ne bloquent donc QUE les DA explicitement pending/rejected/draft,
--   créées par le nouveau flux.
--
-- INVERSION
--   ALTER TABLE purchase_requests DROP COLUMN approval_status ;
--   DROP INDEX idx_pr_approval_status.

ALTER TABLE purchase_requests
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('draft', 'pending', 'approved', 'rejected'));

COMMENT ON COLUMN purchase_requests.approval_status IS
  'État du circuit d''approbation de la DA (mig 456), dimension SÉPARÉE de status (couverture). '
  'draft=brouillon · pending=en attente d''approbation · approved=approuvée, commandable · rejected=refusée. '
  'Posé par l''action humaine et le moteur d''approbation (approval_requests doc_type=purchase_request). '
  'Défaut approved : les DA antérieures restent commandables.';

-- Les écrans listent les DA « à approuver » et « approuvées, à commander ».
CREATE INDEX IF NOT EXISTS idx_pr_approval_status ON purchase_requests (approval_status);
