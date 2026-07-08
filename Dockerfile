# ─── Stage 1 : Build ──────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copier les manifests pour profiter du cache Docker
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# Installer toutes les deps (incluant devDependencies pour le build TS/Vite)
RUN npm ci --workspaces --include-workspace-root --ignore-scripts

# Copier le code source (shared + server + client)
COPY shared/ ./shared/
COPY server/ ./server/
COPY client/ ./client/

# Build shared : composite=false pour forcer l'emission sans -b
RUN cd shared && \
    npx tsc --project tsconfig.json --composite false --declaration --outDir dist && \
    cd ..

# Build server : --noCheck transpile sans valider les types (parite avec tsx en dev)
RUN cd server && \
    npx tsc --noCheck

# Build client : VITE_API_URL non defini => le client utilise '/api/v1' par defaut
# (meme origine que le serveur)
RUN cd client && \
    npx vite build


# ─── Stage 2 : Runtime ────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV SERVER_PORT=8080

# Copier uniquement les manifests pour installer les deps de prod
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/

# Installer uniquement les deps de production
RUN npm ci --omit=dev --workspaces --include-workspace-root --ignore-scripts \
    && npm cache clean --force

# Copier les artefacts buildes + migrations SQL + bundle client
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/migrations ./server/migrations
# Assets statiques (logo par defaut des PDF factures / bons de commande).
# cwd runtime = /app/server -> le service PDF resout ./assets/logo-ofauria.png.
COPY --from=builder /app/server/assets ./server/assets
COPY --from=builder /app/client/dist ./client/dist

# Cloud Run ecoute sur PORT (par defaut 8080)
EXPOSE 8080

# Demarrage : node sur le bundle compile
WORKDIR /app/server
CMD ["node", "dist/index.js"]
