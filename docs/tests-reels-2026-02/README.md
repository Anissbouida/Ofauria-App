# Tests « vraie vie » — simulation depuis le 14/02/2026 (session interrompue par la limite d'usage)

## Où sont les données
- Les données de test sont dans **`ofauria_db`** (Postgres Docker 5433), donc visibles directement dans votre application locale. La base d'origine, intacte, est conservée sous **`ofauria_db_avant_tests_20261024`** (bascule faite le 24/10/2026 à la demande).
- `ofauria_db` est la copie migrée jusqu'à la 346 (les 23 migrations manquantes ont été appliquées : 266/269 enregistrées comme déjà faites, les autres rejouées).
- Horloge simulée : pendant les tests, `now()`/`current_date` de Postgres sont truqués dans `ofauria_db` (schéma `faketime`, table `faketime.clock`) ; **votre serveur voit donc la date simulée tant que la simulation tourne**. Les fonctions sont remises d'origine à la fin. Le code du worktree a `CURRENT_DATE` → `now()::date` en local non commité (23 fichiers), à ne pas commiter.
- Limite connue : les données historiques (juin→octobre 2026) sont « dans le futur » pour la simulation ; les écrans qui cherchent « la dernière session/pièce » peuvent prendre une pièce d'août 2026 (fond de caisse proposé, fenêtre d'invendus).
- Comptes de test (mdp `KalumTest-2026!`, PIN entre parenthèses) : soukaina.caisse (1111), meryem.caisse (2222), aya.vente (3333), jamal.boulanger (4444), issmail.patissier (5555), tarik.viennoiserie (6666), rachid.magasin (7777), nadia.achats (8888) @kalum.local ; gerant.test / admin.test @kalum.local.

## Ce qui a été joué (13–14/02/2026)
13/02 : création des comptes/rôles, fiches employé + liaison, planning 2 semaines, restauration de 20 préparations de base, 13 fiches techniques produit par les 3 chefs (formats + nomenclature + lien produit), 5 BC envoyés par la responsable achats.
14/02 : réceptions (complète, partielle, DLC courte, sur-réception refusée, lot manquant), factures auto + contrôles + paiement comptant, 3 plans de production → 3 BSI → pesage magasinier (tolérance, contenant entier, manquants, demandes d'achat) → réception chefs → 16 semi-finis → production, pertes, HACCP, coût réel → demande d'approvisionnement caissière → vitrine → ouverture de caisse → 16 ventes (cash, carte, mixte, remise, crédit personnel), client fidélité, commande avec avance, retour.

## État final (24/10/2026)
- Simulation terminée : 14/02 → 23/10/2026. Pointage quotidien tous les jours ; journées complètes (production, BSI, pesage, vitrine, 2 shifts de caisse, achats, HACCP) : 14→28/02 puis 4 jours témoins par mois de mars à octobre + 19→23/10 ; paie hebdo chaque samedi simulé, paie mensuelle + CNSS/IR + compta à chaque fin de mois (février → septembre).
- Volumes créés : 2 014 ventes (67 907 DH), 103 sessions de caisse, 176 plans de production, 351 BC / 358 réceptions / 371 factures, 296 paiements fournisseurs, 176 bulletins + 525 paies hebdo, 3 815 écritures comptables.
- Horloge Postgres remise d'origine (`now()` interne, schéma `faketime` supprimé, défauts `CURRENT_DATE` restaurés). Les serveurs de test (API :3011, client :4180) sont arrêtés ; l'application habituelle lit directement `ofauria_db`.
- Lecture conseillée : `SYNTHESE.md` (P0/P1), puis `CONSTATS.md` ; les artefacts de simulation sont signalés (F-030, F-041, F-067, F-071, F-076).

## Avancement (historique)
- 14/02 complet (passation 14 h, caisse du soir, invendus, clôture avec écart, contrôle gérant) ; 15→21/02 journées complètes automatisées (pointage, production, appro vitrine, 2 shifts, achats, HACCP, paie hebdo le samedi).
- Suite en cours : fin février (événements RH, incidents achats/stock, paie mensuelle, déclarations, compta), puis mars→octobre (une semaine témoin par mois + fins de mois + incidents).

## Non fait à la première interruption (repris ensuite)
Passation 14 h / 2e caissière, fin de journée (invendus, clôture, Z, écart de caisse), validation gérant, semaine 1 complète, pointage quotidien, paie hebdo/mensuelle/avances/CNSS, mois mars→octobre, comptabilité de fin de mois, rapports gérant, tests UI navigateur.

Voir `CONSTATS.md` (29 constats, dont 2 P0 : F-009 CMUP faussé, F-025 prix de vente écrasés à 0) et `JOURNAL.md`.
