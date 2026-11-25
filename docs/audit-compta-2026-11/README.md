# Audit du module comptable et financier de Kalum — novembre 2026

Audit mené le 24 novembre 2026 sur `main` à `f00c917c`. Aucune modification de code ni de données n'a été faite.

## En une page

Le grand livre de Kalum est **formellement solide** : sur 111 397 écritures d'une exploitation simulée de 174 jours, aucune n'est déséquilibrée, la numérotation n'a aucun trou, tout est scellé dans la chaîne d'inaltérabilité, et chaque ticket, facture et paiement a son écriture. Les 224 tests comptables passent.

Il est **matériellement incomplet**. Sur la même exploitation :

- 0 DH de TVA comptabilisée pour 1,92 M DH de ventes et 0,63 M DH d'achats, sans aucune alerte ;
- 123 898 DH de charges sociales et d'impôt sur le revenu absents, parce que la paie n'entre au grand livre qu'à une clôture que personne n'a faite ;
- une caisse de 1,42 M DH jamais versée en banque, et une banque créditrice de 203 428 DH.

Un bilan tiré de cette base serait faux alors que tous les contrôles sont au vert.

L'audit du code relève 12 défauts critiques. Les plus graves : un avoir fournisseur est comptabilisé comme une sortie de caisse ; la TVA d'un ticket à plusieurs taux sort de la déclaration ; une pièce peut exister sans écriture sans que personne ne soit prévenu ; les protections d'inaltérabilité peuvent être désactivées par le compte de connexion de l'application.

Côté paramétrage, il n'existe pas de moteur de règles : environ 60 comptes sont écrits dans le code, et la table de profils existante est à moitié ignorée. C'est l'écart principal avec SAP Business One et Business Central.

## Documents

| Fichier | Contenu |
|---|---|
| [01_RAPPORT_AUDIT.md](01_RAPPORT_AUDIT.md) | Constats (12 critiques, 22 importants), résultats des tests, validation de l'intégrité, risques de fraude |
| [02_CONFORMITE_MAROC.md](02_CONFORMITE_MAROC.md) | Matrice de conformité sourcée, dix points à soumettre à un expert-comptable |
| [03_BENCHMARK.md](03_BENCHMARK.md) | Comparaison avec Sage 100, Sage FRP 1000, Odoo, Business Central, SAP Business One |
| [04_ARCHITECTURE_CIBLE.md](04_ARCHITECTURE_CIBLE.md) | Moteur comptable unique, moteur de règles, profils, trajectoire de migration, place de l'IA |
| [05_SCHEMAS_ET_CONTROLES.md](05_SCHEMAS_ET_CONTROLES.md) | Catalogue des schémas d'écritures existants et matrice des contrôles |
| [06_FEUILLE_DE_ROUTE.md](06_FEUILLE_DE_ROUTE.md) | Lots P0 à P3, critères d'acceptation, tableau de suivi |
| [07_PLAN_ACTION_TECHNIQUE.md](07_PLAN_ACTION_TECHNIQUE.md) | Plan étape par étape : fichiers, fonctions, migrations et tests de chaque modification |
| [maquette/maquette-changements-compta.html](maquette/maquette-changements-compta.html) | Maquette des écrans qui changent, au Design System de Kalum, données d'exemple |

## Limites à connaître

- La base de production n'a pas été consultée.
- Une seule entreprise simulée, d'un seul secteur, sans clôture annuelle.
- Les constats marqués « Lu » viennent d'une lecture déléguée du code et n'ont pas tous été relus.
- Le benchmark repose sur des extraits pour Sage et SAP, dont les sites ont refusé la consultation.
- Plusieurs textes marocains n'ont pas été lus dans leur version officielle (loi 9-88, CGNC, avis CNC n° 24, loi 69-21).
