# Demande d'ingrédients, pesage et économat — processus cible

*Refonte du 09/10/2026. Référence : `docs/AUDIT_PESAGE.md` (constats W1-W16) et l'audit production du 02/10/2026.*

## Le processus en trois temps

```
 CHEF                         MAGASINIER (poste de pesée)                       CHEF
 ─────────────────────        ─────────────────────────────────────────────     ──────────────────────────
 Confirme le plan      ──►    1. Prend en charge la demande                ──►  Réceptionne (+ démarre)
 (bon généré, notifié)        2. Pèse chaque ligne                              ou refuse avec motif
                                 · À peser   : stock au pesage
                                 · À ouvrir  : stock en économat → le contenant
                                               est ouvert PAR la pesée
                                 · Manquant  : « Commander », ou remise avec
                                               manquants signalés
                                 · Autre lot : le lot réellement attrapé
                              3. Remet au chef (avec ou sans manquants)
```

### 1. Demande (chef)
La confirmation du plan calcule les besoins et génère le bon de sortie (statut `genere`), passe le plan en « en attente d'ingrédients » et notifie les magasiniers. Aucune action supplémentaire du chef. La notification ouvre directement le bon dans le Pesage (magasinier) ou le plan (chef).

### 2. Préparation (magasinier) — un seul écran
Chaque ligne du bon porte son état et son action, sans quitter l'écran :

| État | Signification | Action |
|---|---|---|
| **À peser** | le stock est au pesage (contenant déjà ouvert) | saisir le poids lu sur la balance |
| **À ouvrir** | le stock est en économat (contenant scellé) | saisir le poids : le serveur ouvre le contenant dans la même transaction (transfert économat → pesage tracé). La ligne affiche « Sorti de l'économat » : par défaut des contenants entiers si l'ingrédient est défini par contenant, sinon la quantité pesée ; le magasinier peut saisir ce qu'il a réellement sorti ou cliquer « Tout le lot ». Si le contenant a déjà été mis au pesage à l'avance, la ligne est simplement « À peser » |
| **Manquant** | rien en stock, ni pesage ni économat | « Commander » (demande d'achat) — ou remettre le bon en signalant le manquant |
| **Stock revenu** | la ligne était manquante, du stock est arrivé | « Actualiser le stock » ou choisir le lot |
| **Lot périmé** | la DLC du lot alloué est dépassée | choisir un autre lot |
| **Pesé** | mesure enregistrée (écart et motif si hors tolérance) | — |

« Autre lot » sur chaque ligne liste les lots utilisables (pesage puis économat, FEFO, périmés grisés) : le lot réellement pris est enregistré, la traçabilité lot → production reste vraie.

**Remettre au chef** est possible dès que toutes les lignes en stock sont pesées. S'il reste des manquants, le bouton devient « Remettre avec N manquant(s) » (confirmation) : le chef les voit à la réception et décide. Une rupture sur un ingrédient mineur ne fige plus le plan.

Les lignes **emballage** sont affichées à part, informatives : elles sont consommées automatiquement à la remise.

**Mettre au pesage à l'avance** (module Économat, onglet « Transfert vers le pesage », bouton « Pesage » sur chaque ligne de stock ; aussi dans le Pesage, onglet Stock pesage) : ingrédient → lot en économat (FEFO, périmés exclus) → quantité, nombre de contenants ou « Tout le lot ». Sert à préparer le poste le matin ou avant une grosse production ; les bons du jour trouvent alors le stock « À peser » (même trace que l'ouverture faite pendant la pesée). Les vues groupées du module Économat gardent « Tout ouvrir » pour traiter plusieurs bons d'un coup.

**Stock pesage** (onglet) : chaque contenant ouvert a deux actions — *Retour économat* (reliquat rangé en réserve, mouvement de zone) et *Perte* (casse, contamination, DLC : sortie d'inventaire sur la quantité perdue, motif obligatoire). Un lot périmé encore au pesage est signalé.

### 3. Réception (chef)
Un seul bandeau sur la page du plan : **Refuser** (motif, retour en préparation), **Réceptionner**, ou **Réceptionner et démarrer** (réception + démarrage de la production en un clic). Les manquants signalés sont listés dans le bandeau. La réception consomme le stock (lots du pesage), trace lot → production et clôture le bon.

## Règles de gestion
- **Contenant entier** (règle d'affaires du 09/10/2026) : pour un ingrédient dont la fiche définit un type de contenant et une quantité par contenant, tout mouvement se fait par contenant complet, minimum un, arrondi au contenant supérieur : bons de commande (création, modification, génération depuis les demandes d'achat), demandes d'achat (y compris « Commander » depuis un bon de sortie) et transferts économat → pesage (à l'avance, pendant la pesée, vue groupée). 8 kg de chocolat en sacs de 2,5 kg → 4 sacs (10 kg) ; 1 kg à transférer → 1 sac (2,5 kg). Seule exception : le dernier contenant d'un lot déjà entamé se transfère en entier tel quel. La règle est appliquée côté serveur (`services/container-rule.ts`) et les écrans saisissent en nombre de contenants. Les ingrédients sans contenant défini sur leur fiche restent en quantité libre : compléter le référentiel (fiche ingrédient → type de contenant + quantité par contenant) pour les y soumettre.
- **Péremption jugée sur la date** (`expiration_date < aujourd'hui`), jamais sur un statut : un lot périmé n'est plus proposé par le FEFO, ne peut être ni ouvert ni pesé, et reste visible au pesage pour être sorti en perte.
- **Fond de sac** : un résidu qui ne couvre ni le besoin ni 5 % de celui-ci (plancher 1 g) ne crée pas de ligne « à peser 0 g ».
- **Conservation** : Σ mouvements de stock du bon = Σ poids pesés ; par lot, stock avant − après = quantité pesée. Si une pesée dépasse ce que la zone pesage détenait, le complément est pris sur l'économat du même lot (plus de borne silencieuse à 0).
- **Magasin** : toute action sur un bon vérifie que le bon appartient au magasin de l'utilisateur (admin global excepté).
- Les vues groupées du module Économat (« à ouvrir », « à commander ») restent disponibles pour préparer à l'avance ou commander en lot, avec un lien « Ouvrir au pesage » vers le bon.

## Anomalies corrigées par la refonte
| Réf. | Anomalie | Correction |
|---|---|---|
| W1 | DLC inerte : `status='expired'` jamais posé, FEFO servait les périmés en premier | péremption par date partout (génération, ré-allocation, pesée, ouverture, affichage) |
| W3 | aucun retour pesage → économat, aucune sortie casse | actions *Retour économat* / *Perte* sur le stock pesage |
| W6 | pas de contrôle de magasin sur les routes par id | garde `checkStoreOwnership` sur toutes les routes BSI |
| W7 | substitution de lot écrite mais jamais appelée | sélecteur « Autre lot » dans la pesée ; `handleEcart` retiré |
| W9 | transfert économat = quitter le Pesage, sans retour | ouverture du contenant dans la pesée ; liens retour dans les vues Économat |
| W11 | notification « bon de sortie » non cliquable | routage vers `/warehouse?bon=` (magasinier) et vers le plan (chef) |
| W13 | `findPesageStock` lisait une colonne supprimée | requête corrigée, `asyncHandler` sur la route |
| W16 | lignes emballage invisibles (jointure interne) mais bloquant « prêt » | `LEFT JOIN`, section Emballages, exclues des blocages |
| — | rupture d'un ingrédient = plan figé sans issue manuelle | remise au chef avec manquants signalés |
| — | `preparation_partielle` absent de la file magasinier | inclus dans la file |
| — | ré-allocation créant de fausses ruptures (ligne réservant contre elle-même) | exclusion de la ligne elle-même |
| — | confirmation générant le bon deux fois (fausse alerte « Magasin requis ») | génération unique dans le dépôt |
| — | borne à 0 du lot à la consommation vs mouvement complet | complément pris sur l'économat du même lot |
| — | routes/boutons morts (`prelevement`, `verify`, `close`, `ecart`), `Sidebar.tsx`, spinner de ligne, saisie « 1,5 » perdue, chefs avec un menu Pesage en « Accès réservé », compteurs divergents, libellés « En commande » / « En transfert » avant toute action | nettoyés |

## Reste à faire
- Balance connectée (WebSerial) : la pesée accepte déjà `source: 'scale'`.
- Impression du bon de prélèvement et lecture code-barres des lots.
- Indicateurs du poste (délai demande → prêt, ruptures récurrentes, contenants ouverts vieillissants).
- Tests d'intégration automatisés sur l'invariant de conservation (le script de bout en bout utilisé pour cette refonte vit hors dépôt).
