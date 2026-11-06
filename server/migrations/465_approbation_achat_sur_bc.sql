-- Flux procure-to-pay : l'approbation des achats se fait sur le BON DE COMMANDE
-- chiffré (le devis retenu à l'attribution), AVANT envoi au fournisseur — et non
-- plus sur la demande d'achat. Approuver une DA sur un montant *estimé* avant même
-- de connaître les prix n'avait pas de sens ; l'approbation réelle (engagement TTC
-- + cumul fournisseur du jour) existe déjà au niveau BC (mig 350 / L4 P2P).
--
-- Une demande d'achat redevient un simple besoin, directement sourçable
-- (approval_status 'approved' = « prête à sourcer », posé à la création côté
-- serveur). Les propositions MRP restent 'draft' jusqu'à activation manuelle.
--
-- Ce rattrapage : (1) débloque les DA restées en attente d'une approbation de DA
-- désormais inexistante, (2) clôt les demandes d'approbation de DA encore ouvertes
-- (nettoie la boîte « À approuver »), (3) désactive les règles d'approbation de DA.

BEGIN;

-- 1. DA en attente d'approbation → approuvées (directement sourçables).
UPDATE purchase_requests
   SET approval_status = 'approved', updated_at = now()
 WHERE approval_status = 'pending';

-- 2. Demandes d'approbation de DA encore ouvertes → étapes closes puis annulées.
UPDATE approval_steps s
   SET status = 'skipped'
  FROM approval_requests r
 WHERE s.request_id = r.id
   AND r.doc_type = 'purchase_request'
   AND r.status = 'pending'
   AND s.status IN ('pending', 'waiting');

UPDATE approval_requests
   SET status = 'cancelled',
       decided_at = now(),
       decision_reason = 'Flux P2P : approbation déplacée sur le bon de commande chiffré'
 WHERE doc_type = 'purchase_request'
   AND status = 'pending';

-- 3. Règles d'approbation de DA désactivées : le BC porte désormais l'approbation.
UPDATE approval_rules
   SET enabled = false
 WHERE doc_type = 'purchase_request';

COMMIT;
