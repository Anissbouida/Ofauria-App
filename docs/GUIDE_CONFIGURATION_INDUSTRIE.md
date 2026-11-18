# Configurer Kalum pour une industrie

Ce guide décrit comment installer Kalum pour un métier autre que la boulangerie, sans écrire de code. Chaque étape renvoie à un écran existant. Rien n'est irréversible : chaque changement de modules passe par un aperçu d'impact et l'historique des versions, et les données de départ n'écrasent jamais ce qui existe.

## 1. Choisir le profil

**Paramètres › Secteur et modules › onglet Secteur.** Cliquez sur un profil. La confirmation affiche ce que le profil apportera ensuite (types d'ordre, politiques, impressions, procédé, démonstration). Le changement adapte les modules et les menus ; aucune donnée n'est supprimée.

| Profil | Pour qui | Type d'ordre par défaut | Matières | Coût réparti | Vocabulaire |
|---|---|---|---|---|---|
| Boulangerie / Pâtisserie | Boulangerie, pâtisserie, traiteur | Plan du jour | Au bon de sortie, pesé | Au poids | Fournée, recette, plan de production |
| Industrie — process | Cosmétique, agroalimentaire | Ordre de lot (pesée, contrôle) | Au bon de sortie, pesé | Au poids | Lot, formule, semi-fini |
| Industrie — discret sur stock | Meuble, assemblage en série | Ordre de série | À la déclaration | À la quantité | Série, nomenclature, sous-ensemble |
| Atelier à la commande | Métallerie, sur-mesure | Ordre d'affaire | Saisie manuelle par affaire | Parts saisies | Affaire, nomenclature |
| Industrie / Fabrication | Fabricant généraliste | Plan du jour | Au bon de sortie | Au poids | Ordre de fabrication, nomenclature |

Les valeurs des trois profils de référence sont **proposées** : faites-les relire par une personne du métier avant de les proposer à un client.

## 2. Charger les données de départ

**Même onglet, section « Données de départ » › bouton « Charger les données de départ ».** Seuls les éléments absents sont créés :

- catégories, types d'étape et d'équipement, unités ;
- un atelier, seulement si aucun n'existe ;
- une nomenclature de démonstration (modifiable ou supprimable ensuite) ;
- les **types d'ordre** du profil (un type de même code n'est pas recréé) ;
- les **politiques** du profil, si la société n'en a pas déjà posé une au même niveau ;
- les **gabarits d'impression**, si le gabarit n'a jamais été modifié.

Le type d'ordre par défaut du profil ne remplace l'actuel que si celui-ci n'a encore aucun ordre.

## 3. Vérifier modules et options

**Onglet Modules et options.** Les options propres à un métier (vitrine, saisie par fournée, fiche bilingue…) ne sont actives que dans le profil boulangerie. Activez celles dont vous avez besoin ; l'aperçu d'impact montre ce qui change.

## 4. Régler la production

**Production › Paramétrage.**

- **Types d'ordre** : étapes requises (bon de sortie, pesage, contrôle), mode de consommation des matières, sous-traitance, atelier par défaut.
- **Politiques** : rendement cible, taux de charges, clé de répartition du coût, source des étapes (fiche ou gamme)… par société, établissement, atelier ou type d'ordre.
- **Impressions** : titre, colonnes, signatures et mention de chaque document, par type d'ordre.
- **Réglages** : étapes, rendement, coût de revient (désactiver retire le panneau de l'ordre).

## 5. Ajuster les mots

**Paramètres › Secteur et modules › onglet Vocabulaire.** Renommez les termes qui ne correspondent pas à votre métier ; l'aperçu se met à jour pendant la saisie. « Rétablir » rend le terme du profil.

## 6. Décrire le procédé

- **Production › Postes & gammes** : postes, calendriers, gammes (opérations, temps de réglage et unitaires).
- **Contrôle** : plans de contrôle par famille d'article, libération des lots.
- **Fiche article › Production & cycle de vie › Traçabilité** : par lot ou par numéro de série.

## 7. Lancer le bilan de santé

**Paramètres › Secteur et modules › onglet Modules et options**, bloc « Bilan de santé ». Il signale notamment :

- un type d'ordre qui exige une étape dont le module est masqué ;
- un type « sous-traité » sans fournisseur actif ;
- la politique « étapes par gamme » sans aucune gamme active ;
- des termes de boulangerie encore affichés hors boulangerie.

## 8. Enregistrer comme profil réutilisable

**Onglet Modèles et assistant › Enregistrer comme secteur / Exporter.** Le fichier (format `kalum.config`, version 2) contient modules, options, vocabulaire, données de départ, types d'ordre, politiques et impressions. Un fichier importé est filtré : codes invalides, politiques inconnues et colonnes hors catalogue sont ignorés avec un avertissement. Les fichiers de version 1 restent acceptés.

## Règles pour les développeurs

- Le code ne compare jamais le code du secteur : il lit une option, une politique ou un attribut du type d'ordre. Le test `never-sector-guard.test.ts` échoue sinon.
- Tout réglage a une valeur par défaut égale au comportement de la boulangerie.
- Un nouveau réglage n'est terminé que s'il est exporté dans le modèle de configuration (`services/industry-profile.ts`) et a une valeur dans au moins un profil autre que la boulangerie.
