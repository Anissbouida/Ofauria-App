# Suivi de l'implémentation multisectorielle

Références fonctionnelles : `PLAN_ACTION.md` (18 lots) et `assistant-configuration.html` transmis le 24 novembre 2026. Ce suivi complète le plan ; il ne le remplace pas.

## J1 — Lots 0 et 1

| Élément | État | Preuve / reste |
|---|---|---|
| Garde des codes sectoriels | Implémenté | Ajout des deux profils agroalimentaires ; tests ciblés |
| Déclaration des sept scénarios | Implémenté | `wizard-industry-scenarios.db.test.ts` : tests explicitement en attente |
| Actualisation des documents historiques | Implémenté | Renvois depuis les deux audits et le guide |
| Instantané avant/après ÔFAURIA | Validé pour 676 | Configuration effective locale identique avant/après ; les instantanés antérieurs aux migrations 670–675 n’ont pas été capturés |
| Migration du brouillon | Appliquée localement | 670 (665 à 669 réservées entre-temps sur main) |
| Registre des 12 étapes | Implémenté | Mode rapide à 7 étapes ; réponses masquées conservées |
| Sauvegarde et reprise | Implémentées, intégration à vérifier | Enregistrement sur changement d'étape et après 2 s ; révision optimiste |
| Interface conforme à la template | Implémentée, recette visuelle à faire | `/settings/assistant`, trois colonnes, progression, assistance, pied d'actions |
| Composants communs | Implémenté | Stepper, ChoiceCard et Switch ; ancien OdooToggle conservé comme façade |
| Reprise depuis Paramètres | Implémentée | Résumé de brouillon dans `/settings/setup` |
| Premier démarrage automatique | Différé | L'absence de version ne suffit pas à distinguer une société existante d'une installation vierge |
| Formulaires métier et simulation | Partiellement réalisés | Données structurées dans le brouillon, aperçu d'impact ; aucune activation réelle |
| Recette PostgreSQL | Débloquée | Instance Docker sur 5433 ; base jetable distincte `kalum_wizard_test_20261124`, migrations jouées |

Les modifications antérieures du socle sectoriel restent présentes dans le worktree. Aucun déploiement, aucune modification de données actives et aucune migration en production. Les métadonnées Git étant protégées, la séparation et les commits des lots restent à faire dans un environnement autorisé.

Validation ciblée : 10 tests réussis (4 nouveaux du socle, 6 précédents), 1 test PostgreSQL ignoré faute de base. Les 7 scénarios fonctionnels sont déclarés en attente, pas validés.

## Scénarios de recette à compléter

| Scénario | Attendu | État |
|---|---|---|
| Boulangerie artisanale, trois établissements | Écart de configuration nul, rôles et flux adaptés | À rejouer |
| Agroalimentaire industriel | Traçabilité et contrôle qualité selon référentiel | À rejouer |
| Manufacture à la commande | Séries, nomenclatures, absence de POS | À rejouer |
| Distribution | Pas de fabrication | À rejouer |
| Services | Parcours réduit, projets et temps | À rejouer |
| Multisecteur et multisite | Union de capacités, priorité et dérogations | À développer |
| Reconfiguration d'une société active | Impact, version, retour arrière, données intactes | À développer |

## Deuxième incrément — matrice des 18 lots

Le programme ne doit pas être considéré terminé : le code de préparation peut avancer sans base de test, mais les migrations, la bascule de source et la publication transactionnelle ne peuvent pas être validées sans PostgreSQL isolé et un instantané de référence.

| Lot | Réalisé dans cet incrément | Reste avant clôture |
|---|---|---|
| 0 | Garde sectorielle, suivi et scénarios déclarés | Instantané réel avant/après et exécution des scénarios |
| 1 | Parcours 12/7 étapes, reprise, édition persistante, contrôles des brouillons | Migration 670 et recette navigateur/DB |
| 2 | Résolveur pur onze portées, priorité, conflits, fusion, verrous, trace ; politiques et paramètres historiques utilisent l'algorithme ; provenance société/défaut dans l'écran | Migration 671 non appliquée, projection en lecture seule, bascule des sources et enforcement transactionnel à valider ; cache/version à traiter |
| 3 | Formulaire entreprise (identité, pays/devise en lecture seule, langue, fuseau, taille, sites) et migration de colonnes 674 | Écriture effective et impact sur les documents |
| 4 | Catalogue réel, choix principal et secondaires, persistance active (676), union des modules/capacités, historique et restauration des activités ; spécialités proposées par tous les profils actifs | Nouveaux profils métiers et validation de chaque profil ; activation complète depuis l’assistant |
| 5 | Moteur de dépendances commun modules/capacités, cycles/conflits, choix dynamiques, migration 677 du catalogue | Relations en base comme source active, classes de modules et contrôles de routes |
| 6 | Questions sur production, stock, traçabilité et ventes, conditionnées par modules | Traduction vers le catalogue de paramètres et publication |
| 7 | Six termes issus du catalogue existant et aperçu des libellés | 200 termes, formes, traductions et tous les consommateurs |
| 8 | Choix des règles de fabrication enregistrés dans le brouillon | Compilation des règles, approbations, contrôles de champs et validations serveur |
| 9 | Choix espace de travail et densité dans le brouillon | Moteur d'accueil, catalogue d'écrans, préférences utilisateur |
| 10 | Préparation exercice/TVA/analytique, pays/devise lisibles | Packs pays versionnés et validation comptable ; aucune règle fiscale changée |
| 11 | Suggestions de rôles selon modules/spécialités, aucun droit attribué | Templates, périmètres, séparation des tâches, validation et création |
| 12 | Choix de préparation de démonstration, sans import | Imports supplémentaires et isolation/annulation de démonstration |
| 13 | Révision, impact, jeu de changements versionné (675), compilation, reprise sur une référence actualisée, simulation technique des secteurs/modules avec rollback réel sur base jetable | Raccorder chaque autre opération, simuler les cycles métier, puis activation globale et restauration complète ; simulation technique désactivée par défaut et interdite en production |
| 14 | Pas de publication de nouveaux profils | Versionnement, comparaison, éditeur, import/export v4 |
| 15 | Aperçu d'impact et brouillons d'évolution | Approbation de changement sensible, mise à niveau et restauration |
| 16 | Recommandations déterministes dans le formulaire (profils, rôles, prérequis) | Registre central de recommandations et assistant IA paramétrable |
| 17 | Scénarios déclarés, tests ciblés | Exécution E2E, mesure et validation métier de chaque profil |

Les migrations 670, 671, 674, 675, 676 et 677 sont additives et appliquées à la base **locale** ainsi qu'à la base isolée. La migration des relations a été renumérotée de 673 à 677 après arrivée de `673_conservation_preparations.sql` sur main ; uniquement les deux historiques locaux ont été réconciliés après contrôle exact du checksum. Aucun déploiement distant ni activation de brouillon effectués.

La capture d'écran « Impossible de charger les brouillons » était due à l'absence de la table 670, pas à un défaut d'affichage du parcours. Après migration, le catalogue et les brouillons sont disponibles en base ; le client présente également un message d'erreur et un bouton Réessayer en cas d'indisponibilité.

Validation après le deuxième incrément : suite serveur complète exécutée (629 tests réussis, aucun échec ; 1 021 ignorés faute de prérequis, 7 scénarios à compléter). Les nouvelles routes ont été ajoutées explicitement à l'instantané des droits sans changement des entrées existantes. Les tests de projection de configuration, catalogue SQL et verrous de schéma sont prêts pour PostgreSQL.

Troisième incrément : base PostgreSQL jetable créée et migrée ; **30 tests ciblés réussis** (6 suites DB et 3 suites unitaires/contrôle des routes), dont reprise, rebase, projection historique, verrous SQL, héritage, politiques, union des secteurs, restauration d’une version et simulation avec annulation réelle des écritures. L’instantané local avant/après 676 indique « Configuration effective identique ». La simulation est partielle, réservée aux tests ; aucun cycle vente/achat/production n’a été simulé par ce nouvel assistant et aucune activation globale n’est disponible.

## Quatrième incrément — raccordement des couches et atomicité

| Lot | Correction réalisée | Limitation restante |
|---|---|---|
| 3 | Identité, forme juridique, langue, fuseau et taille raccordés aux versions et à la simulation ; valeurs actuelles chargées dans le formulaire | Sites, impacts documentaires ; pays et devise en lecture seule |
| 4 | Spécialités raccordées à la simulation ; activation atomique des adhésions, ateliers, référentiels et capacités ; retrait sans suppression métier | Activation globale, cas métier par spécialité et catalogue élargi |
| 7 | Termes connus raccordés aux surcharges de vocabulaire et à la restauration ; validation des valeurs | Extension du dictionnaire et des consommateurs |
| 13/15 | Verrou société, détection de plan obsolète pour secteurs et surcharges modules/capacités, contrôle du compilateur et de la référence versionnée, caches isolés des transactions | Gouvernance des autres couches, contrôle de toutes les écritures concurrentes et publication globale |

Validation : 632 tests serveur réussis, 1 026 ignorés et 7 à compléter ; 30 tests ciblés réussis sur PostgreSQL isolé et nouvelle épreuve de reprise après échec injecté (suite héritage : 7/7). La reprise après échec contrôle l'absence d'atelier, de type d'étape et d'adhésion résiduels, ainsi que le nombre de versions. Compilation client réussie ; les avertissements Vite de taille des bundles restent à traiter. Aucun changement appliqué à la configuration active d’ÔFAURIA, aucune migration supplémentaire, aucun déploiement.

## Cinquième incrément — lots 6 et 8 : paramètres opérationnels et règles

Le catalogue existant (`parameters-catalog.ts`) demeure la source des définitions, valeurs de référence, types et contraintes. L’assistant sélectionne treize paramètres déjà consommés par les modules métier ; il ne fabrique pas de règles parallèles. Les champs inchangés ne sont pas compilés. Les réponses historiques non raccordées restent visibles et peuvent être retirées explicitement du brouillon.

| Besoin | Paramètres effectivement raccordés | Validation / limite |
|---|---|---|
| Planification, rendement, coûts | `production.mrp_horizon`, `production.yield_target`, `production.cost_allocation_key` | Validation des types et bornes ; écriture via les politiques existantes. Mode de fabrication à la commande/sur stock et types d'ordre restent distincts. |
| Stocks et traçabilité | `stock.negative_policy`, `stock.dlc_alerts` | Fusion partielle sans écraser les autres familles d'articles ; restauration de la version. Le suivi lot/série au niveau article reste à configurer. |
| Vente et caisse | `sales.pos_stock`, `sales.quotes`, `sales.closure` | Réutilisation des contrôles existants ; aucun nouveau flux de vente créé. |
| Production et qualité | `production.enforce_declared_steps`, `quality.auto_release`, `quality.ccp_rule` | Paramètres d'application des étapes et inspections ; la déclaration des étapes obligatoires par type d'ordre, les modèles de processus et la fiche technique restent à raccorder. |
| Achats et réception | `purchasing.lot_dlc_enforcement`, `purchasing.po_requires_request` | Modes existants de signalement et de blocage ; ne modifie pas les règles fiscales. |
| Versionnement | Sept paramètres de stockage `module_parameters` capturés et restaurables ; six politiques déjà versionnées | Écriture du centre historique et assistant dans la même transaction ; verrou de société pour les modifications concurrentes. Les paramètres non sélectionnés ne sont pas restaurés par cette couche. |
| Autorisations | Accès global à l'assistant réservé aux droits de consultation et modification des sections Société, Production et Métier | Contrôle commun côté client et serveur, six tests de droits. Les autorisations métier des utilisateurs et la séparation des tâches du lot 11 restent à réaliser. |

La simulation compile uniquement les champs admis, vérifie la disponibilité et les modules sélectionnés, utilise le service de paramétrage existant, relit les valeurs enregistrées, présente l'écart avant/après et annule les écritures. Les dérogations d'établissement, atelier, type d'ordre et article ne sont pas écrasées. Les modifications de paramètres sélectionnés depuis le centre historique créent aussi une version avant/après. Les anciennes versions dépourvues de la couche `module_parameters` ne la modifient pas à la restauration.

Validation : 639 tests serveur réussis, 1 028 ignorés et 7 scénarios fonctionnels à compléter ; 26 tests ciblés réussis (7 suites) après renforcement final des verrous, incluant une véritable modification de politique, de paramètre stock et de règle qualité puis annulation sur la base PostgreSQL isolée. Une restauration de version depuis le centre historique a été vérifiée séparément. Compilation shared, serveur et client réussie. Recette navigateur et cycles métier complets encore nécessaires. Aucune modification de la configuration effective d'ÔFAURIA et aucun déploiement ; aucune nouvelle migration dans cet incrément.

## Sixième incrément — publication réelle (lot 13)

Reprise le 24 novembre 2026 après l'arrêt de Codex : le travail non commité du checkout principal a été rapatrié tel quel sur la branche de travail, vérifié puis commité.

| Élément | Réalisé | Limite |
|---|---|---|
| Publication | `POST /settings/assistant/:id/apply` : contrôles communs avec la simulation (brouillon verrouillé, jeu compilé à jour, aucune anomalie, référence inchangée, verrou société) puis écriture des secteurs, modules, couches (entreprise, vocabulaire, interfaces), spécialités et paramètres dans **une seule transaction** | Les réponses « À raccorder » (sites, finance, rôles, démonstration, règles non cataloguées) restent dans le brouillon sans effet |
| Version restaurable | Version « Assistant de configuration — publication » enregistrée après toutes les écritures ; `published_version_id` et `restoreVersionId` (référence du brouillon) conservés dans le jeu de changements | Retour arrière par l'historique des configurations existant (Paramètres › Secteur) |
| Écran | Étape Révision : bloc « Publication » et bouton « Publier la configuration » (confirmation), actif seulement si le jeu est compilé ; message de réussite avec accès à l'historique | Pas d'approbation à deux personnes (lot 15) |
| Garde d'architecture | Verrou de configuration déplacé du contrôleur des paramètres vers `settings-center.lockCompanyConfiguration()` (garde G3-07 de nouveau verte) | — |
| Tests | Nouveau cas PostgreSQL : publication écrite puis annulée, version créée, brouillon fermé, rejeu refusé (409), référence périmée refusée sans aucune écriture | Scénarios métier E2E toujours à rejouer |

Validation : suite serveur complète **642 tests réussis, 0 échec** (1 034 ignorés hors base, 7 scénarios à compléter) ; 4/4 tests du jeu de changements sur la base jetable `kalum_wizard_test_20261124` migrée jusqu'à 679 ; compilation shared/serveur/client et construction Vite réussies.

### Reste à faire (par ordre de valeur)

1. Recette navigateur complète de l'assistant sur une base de démonstration (parcours rapide et avancé, publication, restauration).
2. Lot 11 — modèles de rôles par secteur : création des rôles proposés à la publication, séparation des tâches.
3. Lot 3 — sites/établissements créés depuis l'assistant ; lot 10 — exercice et TVA appliqués (packs pays versionnés).
4. Lot 12 — données de démonstration isolées et annulables.
5. Lot 15 — approbation des changements sensibles avant publication ; lot 14 — versionnement et éditeur de profils.
6. Lot 2 — bascule des lectures sur `resolveConfig` (projection `config_values`) ; lot 7 — extension du vocabulaire.
7. Premier démarrage automatique de l'assistant sur une installation vierge.
8. Les 7 scénarios de `wizard-industry-scenarios.db.test.ts` (actuellement « à faire »).
