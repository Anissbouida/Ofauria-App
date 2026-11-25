# Refonte de la gestion des utilisateurs — plan d'implémentation

Maquette validée le 2026-11-25 : `docs/utilisateurs-refonte/maquette/gestion-utilisateurs.html`
(artifact https://claude.ai/artifact/BDhdvWsJCGmLScjhxd2pPN, version 2).

Règles : Design System Kalum (`docs/DESIGN_SYSTEM.md`), commit direct sur `main`, un lot = un ou
plusieurs commits autonomes qui compilent et passent les tests. Migrations numérotées à partir de
**700** ; d'autres chantiers prennent aussi des numéros (701, 702) : le numéro réel de chaque lot
est fixé au moment du commit, après vérification de `main`.

## Lots

| Lot | Contenu | Serveur | Migration |
|---|---|---|---|
| 0 | Défauts existants : noms dans l'aperçu de la matrice, rôle de base limité à 8 rôles, mot de passe de 4 caractères accepté pour un administrateur, « Catégories autorisées » sans effet, libellés d'événements manquants, suppression d'un rôle encore tenu par un compte désactivé, avertissement avant changement du rôle principal | oui | — |
| 1 | Coquille du module (Tableau de bord / Opérations / Rapports / Paramétrage), Vue d'ensemble « À traiter », Comptes : pastilles de situation, « Vous », établissement sous les rôles, aperçu en tiroir, Réactiver, journal des connexions dans le module | léger | — |
| 2 | Fiche utilisateur en page `/users/:id` : Profil (langue réglable par l'administrateur, fiche salarié), Rôles et périmètre (rôle principal confirmé, rattachements en lecture), Droits effectifs, Sécurité (2FA par compte, mot de passe, PIN, connexions Google/Microsoft), Historique | oui | — |
| 3 | Création en étapes (identité, rôles avec modèles du secteur, périmètre, sécurité, vérification des conflits) ; invitation par e-mail avec lien de 72 h | oui | 700 invitations |
| 4 | Rôles : origine (système, personnalisé, modèle du secteur), fiche rôle en page (accès par module par niveau, permissions détaillées, membres, contrôles et rattachements, identité modifiable avec page d'accueil), comparaison, sections de Paramètres par rôle | oui | 703 roles.home_route |
| 5 | Contrôles internes : séparation des tâches (cumul de rôles et pièces) avec un seul vocabulaire de mode, plafonds rattachés aux circuits, délégations réunies (rôle complet / approbations) avec date de début, contrôle des droits | oui | 704 |
| 6 | Exceptions individuelles (accorder ou retirer une permission, motif, date de fin) qui s'ajoutent aux rôles | oui | 706 |
| 7 | Plusieurs établissements par compte, établissement par défaut, portée « Son établissement » sur l'ensemble | oui | 703 user_stores |
| 8 | Sécurité et connexions : politique paramétrable (longueur du mot de passe, renouvellement, verrouillage, délai 2FA, inactivité, écran PIN), sessions et appareils, inscription libre supprimée | oui | 704 user_sessions |
| 9 | Revue des accès en campagnes (décisions datées, rapport), comptes dormants | oui | 705 |
| 10 | Administration déléguée (gérer les comptes de sa portée) et approbation des changements sensibles (circuit « Changement de configuration ») | oui | 706 |

## Décisions prises

- **Rôle principal** : depuis le lot 6, les exceptions individuelles s'ajoutent aux rôles et sont
  conservées au changement de rôle principal (avant, les droits propres remplaçaient ceux du rôle et
  étaient effacés).
- **Exceptions individuelles (lot 6)** : une exception de module remplace les droits des rôles pour
  ce module seulement ; une exception d'action accorde ou retire une permission précise. Motif
  obligatoire, date de fin facultative (incluse), expirée = ignorée mais affichée. Refusée si elle ne
  change rien, sur un administrateur, ou si elle crée un conflit de séparation des tâches en mode
  « Bloquer ». Les sessions du compte sont fermées à chaque changement. Les anciens droits propres
  sont repris sans changer les droits effectifs (exception « sans accès » pour les modules des rôles
  qu'ils ne listaient pas).
- **Mot de passe saisi par un administrateur** : même politique que la connexion, le générateur de
  l'écran la respecte déjà.
- **Rôle de base** : tout rôle système actif (la migration 637 l'autorise déjà côté base).
- **Fiche utilisateur** : page hors coquille, comme `/employees/:id`.
- **Invitation** : si les e-mails ne sont pas configurés (cas de la production aujourd'hui),
  l'écran propose le mot de passe provisoire et le dit.

## Suivi

- [x] Lot 0 — f435f45f
- [x] Lot 1 — module à rubriques, vue d'ensemble, comptes
- [x] Lot 2 — fiche en page `/users/:id` (connexions externes en lecture seule : elles se rattachent par l'e-mail à chaque connexion, « délier » n'aurait pas d'effet durable)
- [x] Lot 3 — création en étapes, invitation 72 h (mig 700), page publique `/invitation/:token`, contrôle des conflits avant création
- [x] Lot 4 — contrôlé à l'écran le 2026-11-25 avec le lot 3 (assistant de création parcouru sans créer de compte) ; fiche rôle `/users/roles/:code` (niveaux Aucun → Complet qui règlent aussi les permissions détaillées, écarts au niveau, membres et attribution, 2FA du rôle, plafonds, séparation des tâches, rattachements, identité avec page d'accueil), comparaison de 2 à 4 rôles, nouveau rôle depuis un modèle / une copie / vide (mig 703 ; 701-702 pris par d'autres chantiers). Libellés des permissions encore en partie en anglais (référentiel `shared/src/constants/permissions.ts`), « modifier ce rôle demande une approbation » renvoyé au lot 10
- [x] Lot 5 — Contrôles internes à quatre onglets, un vocabulaire de mode partout ; séparation des tâches sur les pièces réglée ici (mode Désactivé, mig 704) ; plafonds reliés aux circuits (seul le bon de commande applique un plafond : les autres types sont signalés « sans effet » et refusés à la création) ; délégations réunies (rôle complet / approbations, début futur, prolongation, historique, motif) ; cumul interdit refusé en mode Bloquer à la délégation. Contrôlé à l'écran le 2026-11-25 (page blanche du contrôle des droits sur les refus d'action métier corrigée)
- [x] Lot 6 — exceptions individuelles (mig 706), contrôlé à l'écran
- [ ] Lot 7
- [ ] Lot 8
- [ ] Lot 9
- [ ] Lot 10
