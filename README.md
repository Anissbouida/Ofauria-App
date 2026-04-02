# Ofauria - Gestion Boulangerie & Patisserie

Application de gestion complete pour la boulangerie-patisserie Ofauria.

## Stack technique

- **Frontend** : React 18 + TypeScript + Vite + Tailwind CSS
- **Backend** : Node.js + Express + TypeScript
- **Base de donnees** : PostgreSQL 16
- **Architecture** : Monorepo avec npm workspaces

## Fonctionnalites

- Tableau de bord avec KPIs en temps reel
- Point de vente (POS) avec interface tactile
- Gestion des produits et categories
- Gestion des commandes (en magasin + sur mesure)
- Gestion des clients et programme de fidelite
- Inventaire et alertes de stock bas
- Gestion des recettes avec calcul des couts
- Gestion des employes et plannings
- Rapports et analyses de ventes
- Authentification JWT avec roles (admin, gerant, caissier)

## Demarrage rapide

### Prerequis

- Node.js 18+
- Docker & Docker Compose
- npm 9+

### Installation

```bash
# Cloner le projet
git clone https://github.com/votre-user/Ofauria-app.git
cd Ofauria-app

# Installer les dependances
npm install

# Demarrer PostgreSQL
docker compose up -d

# Copier la configuration
cp .env.example .env

# Compiler le package partage
npm run build:shared

# Executer les migrations
npm run db:migrate

# Demarrer en mode developpement
npm run dev
```

Le frontend sera disponible sur http://localhost:5173 et l'API sur http://localhost:3001.

## Structure du projet

```
Ofauria-app/
├── client/          # Frontend React
├── server/          # Backend Express
├── shared/          # Types et constantes partages
├── uploads/         # Images uploadees
└── docker-compose.yml
```

## Scripts

| Commande | Description |
|---|---|
| `npm run dev` | Demarrer frontend + backend |
| `npm run build` | Build de production |
| `npm run db:migrate` | Executer les migrations SQL |
