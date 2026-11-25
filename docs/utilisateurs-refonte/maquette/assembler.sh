#!/bin/sh
# Assemble la maquette autonome : feuille compilée de Kalum (reprise de la maquette validée
# de l'assistant de configuration) + corps de page _source-corps.html.
cd "$(dirname "$0")"
src=../../personnalisation-multisectorielle/maquette/assistant-configuration.html
{ sed -n '1,5p' $src
  echo "<title>Kalum — maquette de la gestion des utilisateurs</title>"
  echo "<!-- Feuille de style de Kalum compilée (client/dist, 24 nov. 2026), intégrée pour que la page soit autonome. -->"
  sed -n '8,9p' $src
  cat _source-corps.html; } > gestion-utilisateurs.html
