# Refonte de la gestion des utilisateurs — plan d'implémentation

Maquette validée le 2026-11-25 : `docs/utilisateurs-refonte/maquette/gestion-utilisateurs.html`
(artifact https://claude.ai/artifact/BDhdvWsJCGmLScjhxd2pPN, version 2).

Règles : Design System Kalum (`docs/DESIGN_SYSTEM.md`), commit direct sur `main`, un lot = un ou
plusieurs commits autonomes qui compilent et passent les tests. Migrations numérotées à partir de
**700**.

## Lots

| Lot | Contenu | Serveur | Migration |
|---|---|---|---|
| 0 | Défauts existants : noms dans l'aperçu de la matrice, rôle de base limité à 8 rôles, mot de passe de 4 caractères accepté pour un administrateur, « Catégories autorisées » sans effet, libellés d'événements manquants, suppression d'un rôle encore tenu par un compte désactivé, avertissement avant changement du rôle principal | oui | — |
| 1 | Coquille du module (Tableau de bord / Opérations / Rapports / Paramétrage), Vue d'ensemble « À traiter », Comptes : pastilles de situation, « Vous », établissement sous les rôles, aperçu en tiroir, Réactiver, journal des connexions dans le module | léger | — |
| 2 | Fiche utilisateur en page `/users/:id` : Profil (langue réglable par l'administrateur, fiche salarié), Rôles et périmètre (rôle principal confirmé, rattachements en lecture), Droits effectifs, Sécurité (2FA par compte, mot de passe, PIN, connexions Google/Microsoft), Historique | oui | — |
| 3 | Création en étapes (identité, rôles avec modèles du secteur, périmètre, sécurité, vérification des conflits) ; invitation par e-mail avec lien de 72 h | oui | 700 invitations |
| 4 | Rôles : origine (système, personnalisé, modèle du secteur), fiche rôle en page (accès par module par niveau, permissions détaillées, membres, contrôles et rattachements, identité modifiable avec page d'accueil), comparaison, sections de Paramètres par rôle | oui | 701 roles.home_route |
| 5 | Contrôles internes : séparation des tâches (cumul de rôles et pièces) avec un seul vocabulaire de mode, plafonds rattachés aux circuits, délégations réunies (rôle complet / approbations) avec date de début, contrôle des droits | oui | — |
| 6 | Exceptions individuelles (accorder ou retirer une permission, motif, date de fin) qui s'ajoutent aux rôles | oui | 702 |
| 7 | Plusieurs établissements par compte, établissement par défaut, portée « Son établissement » sur l'ensemble | oui | 703 user_stores |
| 8 | Sécurité et connexions : politique paramétrable (longueur du mot de passe, renouvellement, verrouillage, délai 2FA, inactivité, écran PIN), sessions et appareils, inscription libre supprimée | oui | 704 user_sessions |
| 9 | Revue des accès en campagnes (décisions datées, rapport), comptes dormants | oui | 705 |
| 10 | Administration déléguée (gérer les comptes de sa portée) et approbation des changements sensibles (circuit « Changement de configuration ») | oui | 706 |

## Décisions prises

- **Rôle principal** : tant que les droits propres remplacent ceux du rôle (avant le lot 6), le
  changement de rôle principal les efface toujours, mais une confirmation le dit avant d'enregistrer.
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
- [ ] Lot 3
- [ ] Lot 4
- [ ] Lot 5
- [ ] Lot 6
- [ ] Lot 7
- [ ] Lot 8
- [ ] Lot 9
- [ ] Lot 10
