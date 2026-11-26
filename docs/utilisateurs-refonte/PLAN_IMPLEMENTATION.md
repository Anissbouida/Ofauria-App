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
| 7 | Plusieurs établissements par compte, établissement par défaut, portée « Son établissement » sur l'ensemble | oui | 707 user_stores |
| 8 | Sécurité et connexions : politique paramétrable (longueur du mot de passe, renouvellement, verrouillage, délai 2FA, inactivité, écran PIN), sessions et appareils, inscription libre supprimée | oui | 708 user_sessions |
| 9 | Revue des accès en campagnes (décisions datées, rapport), comptes dormants | oui | 709 |
| 10 | Administration déléguée (gérer les comptes de sa portée) et approbation des changements sensibles (circuit « Changement de configuration ») | oui | à numéroter |

## Décisions prises

- **Rôle principal** : depuis le lot 6, les exceptions individuelles s'ajoutent aux rôles et sont
  conservées au changement de rôle principal (avant, les droits propres remplaçaient ceux du rôle et
  étaient effacés).
- **Établissements (lot 7, décidé le 2026-11-25 : « Établissement actif »)** : un compte a
  plusieurs établissements (user_stores) dont un par défaut (= users.store_id, gardé d'accord par
  déclencheur). Le jeton porte l'établissement ACTIF ; la personne le change depuis la barre du haut
  (sélecteur visible à partir de deux établissements), parmi les siens seulement. La portée « Son
  établissement » se lit sur l'établissement actif, un à la fois : les 495 lectures existantes de
  l'établissement restent inchangées. Couvrir tous les établissements cochés à la fois n'est pas fait.
- **Sécurité et connexions (lot 8)** : politique dans module_parameters 'security.policy' (défauts =
  anciennes constantes : 12 caractères, pas de renouvellement, 5 échecs / 15 min, 2FA dès la
  connexion, PIN 6 chiffres, 15 min d'inactivité). La longueur du mot de passe ne descend pas sous
  12. Sessions : une ligne user_sessions par jeton émis (la révocation reste revoked_tokens +
  token_version). Non fait : écran PIN limité à l'établissement du poste (aucun poste n'est rattaché
  à un établissement), réglage de la connexion Google/Microsoft à l'écran (variables du serveur).
- **Revue des accès (lot 9)** : une campagne ouverte à la fois, reprenant les comptes actifs avec
  une photo de leurs droits ; décision datée et signée par compte (confirmé, corrigé avec ce qui a
  changé, désactivé) ; clôture seulement quand tout est décidé ; rapport CSV. Seuil des comptes
  dormants dans la politique de sécurité (dormantDays, 60 jours par défaut).
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
- [x] Lot 7 — établissements par compte, établissement actif (mig 707), contrôlé à l'écran
- [x] Lot 8 — politique de sécurité, sessions et appareils, inscription libre supprimée (mig 708), contrôlé à l'écran
- [x] Lot 9 — revue des accès en campagnes, comptes dormants (mig 709)
- [ ] Lot 10
