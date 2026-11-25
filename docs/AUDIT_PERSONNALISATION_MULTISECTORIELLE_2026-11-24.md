# KALUM — Audit de personnalisation multisectorielle

## Périmètre et verdict

Revue statique ciblée des mécanismes de configuration, des interfaces de paramètres et des scénarios de tests au 24 novembre 2026. Les migrations jusqu'à 662 existent dans le dépôt ; leur état en production n'a pas été interrogé. Le socle est avancé, mais ne permet pas encore de qualifier le produit d'Enterprise-Grade multisociété. La présente livraison est un premier lot vérifié, pas une certification de la cible complète.

## Matrice de traçabilité

| ID | Besoin | Existant / preuve | Écart | Décision / réalisation | Validation |
|---|---|---|---|---|---|
| MS-01 | Assistant guidé | `SetupHome`, `SectorTab`, `ProductionSetupWizard` | Parcours dispersé | Navigation guidée en quatre étapes dans l'écran existant ; aucun stockage parallèle | Compilation client ; E2E à faire |
| MS-02 | Profils hérités | `sector.repository.ts`, migration 633 | Plans de contrôle omis de la résolution des couches | Héritage par famille d'article, étape et caractéristique ; enfant prioritaire | Test unitaire réussi |
| MS-03 | Dépendances | `planAdjustments`, registre partagé | Changement de profil, reset et restauration ne passaient pas tous par le contrôle | Invariants communs sur le commit ; aperçu du secteur sans écriture | Tests unitaires réussis |
| MS-04 | Capacités réglementaires | `capabilityUsage` | Perte indirecte non contrôlée sur tous les chemins ; erreur SQL assimilée à zéro | Contrôle des pertes effectives et propagation des erreurs inattendues | Test de blocage réussi ; vérification DB à faire |
| MS-05 | Analyse d'impact | `module-impact.ts` | Aperçu de secteur limité aux données de départ | API d'aperçu autorisée, validation du corps, affichage des modules, rôles et données masquées | Test unitaire réussi ; API/E2E à faire |
| MS-06 | Spécialités métiers | `specialization.repository.ts`, migration 633 | Une spécialité hors filiation pouvait être activée via API ; application des capacités et référentiels sur deux transactions | Contrôle d'appartenance ajouté ; atomicité globale à traiter | Compilation ; intégration à faire |
| MS-07 | Vocabulaire | `VocabularyPanel`, `sector_labels`, `company_label_overrides` | Couverture des libellés, traductions et documents non démontrée exhaustivement | Conserver le moteur ; audit de couverture par écran | À faire |
| MS-08 | Processus et écrans | `process-model.repository.ts`, `screen-definition.repository.ts`, `production-screens.repository.ts`, `policies.ts` | Couverture intermodules et profils à mesurer | Conserver et étendre par métadonnées déclaratives | À faire |
| MS-09 | Fiscalité | `country-pack.ts`, `parameters-catalog.ts`, écran Finance | Paramétrage et conformité de chaque juridiction non certifiés | Validation métier et réglementaire séparée, sans auto-activation | À faire |
| MS-10 | Rôles | `role_permissions`, diffusion par rôle et établissement | Modèles de rôles par profil et séparation des tâches à auditer | Conserver les autorisations serveur, ne pas confondre visibilité et droits | À faire |
| MS-11 | Historique et rollback | `config_versions`, `config-layers.repository.ts` | Versions de profil vivant, concurrence, restauration des effets annexes à approfondir | Gardes communes ; pas de promesse de retour arrière complet | À faire |
| MS-12 | Isolation entreprises | `company_settings WHERE id = 1`, tables `company_*`, cache global de 30 s ; RLS établissement dans `database.ts` | Le cloisonnement d'établissements ne démontre pas l'isolation de sociétés juridiquement distinctes | Clarifier modèle d'instance ou tenant ; avant SaaS partagé, isolation démontrée par tests | Bloquant cible multisociété |
| MS-13 | Données initiales | `sector-starter.service.ts`, import/export de profils | Chargement séparé, non inclus dans une simulation globale ; séparation de la démonstration à vérifier | Réutiliser les imports, définir une stratégie de données fictives | À faire |

## Architecture cible et séquencement

1. **P0 — intégrité** : valider chaque transition, gérer concurrence et version attendue, rendre l'application des spécialisations atomique, distinguer compteurs indisponibles et compteurs nuls ; démontrer le cloisonnement. La validation ajoutée dans ce lot précède la transaction : elle ne résout pas encore les écritures concurrentes.
2. **P1 — orchestration** : brouillon versionné côté serveur, étapes conditionnelles issues d'un catalogue, simulation sans écritures, calcul d'impact puis publication atomique. Ne pas introduire une seconde source de vérité. Les quatre étapes actuelles utilisent les écrans enregistrés existants, elles ne constituent pas le parcours complet de douze étapes de la maquette.
3. **P1 — profils** : versionner les profils et leurs spécialités, traiter cycles et parents invalides explicitement, gouverner les profils secondaires et les conflits de priorité. Les familles de profils actuelles sont une base ; plusieurs secteurs principaux simultanés ne sont pas implémentés.
4. **P2 — expérience et domaine** : intégrer au parcours le contexte société/pays, processus, écrans, finance, rôles, données initiales et révision. Évaluer les règles codées en dur et la couverture terminologique ; privilégier les composants existants et le Design System. Valider fiscalité et plans de contrôle avec les responsables métier.
5. **P2 — validation** : scénarios boulangerie, agroalimentaire, assemblage, négoce, services et reconfiguration en production simulée ; tests de migration, restauration, limites réglementaires, concurrence, droits et mesures de temps de réponse. Aucune publication avant cette recette.

## Résultats observés

- Compilation TypeScript des packages partagé, serveur et client et construction Vite réussies pendant le lot. Vite signale un gros bundle principal (environ 5,3 Mo brut / 1,38 Mo gzip) ; optimisation à mesurer avant décision de découpage.
- Deux suites ciblées réussies, six tests (dont quatre nouveaux tests de transition/héritage et deux gardes de couplage sectoriel).
- `git diff --check` sans erreur au moment de la revue.
- PostgreSQL local sur le port 5432 indisponible (`pg_isready` : no response). Aucun test d'intégration PostgreSQL ou E2E navigateur de ce lot n'est déclaré réussi. Les suites existantes `inheritance.db.test.ts`, `industry-profiles.db.test.ts`, `scenarios-profils.db.test.ts`, `sector-negoce-e2e.db.test.ts` sont à rejouer sur une base jetable migrée, pas sur la production.
- Aucun déploiement, aucun changement de données réelles, aucune migration ajoutée.

## Critères de sortie du chantier

Le parcours complet doit permettre de préparer et simuler une configuration sans modifier la société active ; les versions doivent rendre visibles les différences et les effets non réversibles. Chaque profil doit produire des écrans et règles métier réellement distincts, sans changement de code spécifique au client. Les contrôles réglementaires ne peuvent être désactivés lorsqu'ils sont requis. La recette doit démontrer l'isolation, la cohérence des dépendances, la compatibilité avec les sociétés existantes et la reprise après échec. Le niveau de couverture n'est pas chiffré tant que la matrice de tests complète n'a pas été exécutée.
