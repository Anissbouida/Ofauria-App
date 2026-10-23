-- Migration 271 : statut 'received' sur purchase_requests + fermeture des demandes livrees
--
-- POURQUOI
--   Une demande d'achat ne quittait jamais 'assigned'. La seule transition existante
--   est pending -> assigned a la creation du bon de commande ; aucune reception ne la
--   fait avancer. Consequence : dans l'onglet Economat "Ingredients a commander", le
--   flag already_ordered (bon-sortie.repository, EXISTS sur status IN pending/assigned/
--   ordered) reste vrai a vie. Le magasinier voit "Commande" sur un ingredient dont la
--   marchandise est livree et consommee depuis longtemps, et ne peut plus jamais
--   declencher de commande pour lui.
--
--   Constat en prod locale : 9 demandes toutes en 'assigned', dont 2 rattachees a des
--   BC en statut livre_complet — crème fraîche et oeufs entiers liquides, bloquant le
--   BSI-260817-001.
--
-- CHOIX
--   'received' plutot que 'cancelled' : la marchandise est arrivee, l'inscrire comme
--   annulee falsifierait l'historique d'achat. 'received' est terminal et sort donc
--   naturellement du EXISTS de already_ordered, sans toucher a cette requete.
--
-- PORTEE
--   CHECK etendu + backfill des demandes dont le BC est deja receptionne.
--   Une demande rattachee a un BC en livre_partiel reste ouverte : le reste arrive encore.
--
-- INVERSION
--   UPDATE purchase_requests SET status = 'assigned' WHERE status = 'received';
--   ALTER TABLE ... CHECK sans 'received' (valeurs d'origine : pending/assigned/ordered/cancelled).

ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_status_check;

ALTER TABLE purchase_requests
  ADD CONSTRAINT purchase_requests_status_check
    CHECK (status IN ('pending', 'assigned', 'ordered', 'received', 'cancelled'));

COMMENT ON COLUMN purchase_requests.status IS
  'pending = en attente d''affectation a un BC ; assigned/ordered = BC emis, marchandise attendue ; received = marchandise receptionnee (mig 271, statut terminal) ; cancelled = abandonnee.';

-- Backfill : toute demande rattachee a un BC dont la marchandise est arrivee.
-- en_attente_facturation = livre integralement, seuls les prix manquent.
UPDATE purchase_requests pr
   SET status = 'received',
       note = COALESCE(pr.note, '') || ' | Cloturee (mig 271) : BC receptionne',
       updated_at = NOW()
  FROM purchase_orders po
 WHERE po.id = pr.purchase_order_id
   AND pr.status IN ('assigned', 'ordered')
   AND po.status IN ('livre_complet', 'en_attente_facturation');
