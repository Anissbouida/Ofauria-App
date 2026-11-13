-- 516 — Bilan de santé de la configuration (plan Production générique, lot P8).
--
-- Les recommandations sont CALCULÉES à la demande (services/config-health.ts, requêtes
-- sur les données, sans IA) : rien n'est stocké sauf le choix de l'administrateur
-- d'écarter une proposition. Une proposition écartée revient après `dismissed_until`
-- (90 jours par défaut), si la situation n'a pas changé.
-- Additif. Retour arrière : supprimer la table config_health_dismissals.

CREATE TABLE IF NOT EXISTS config_health_dismissals (
  check_key       VARCHAR(80) PRIMARY KEY,
  dismissed_until TIMESTAMPTZ NOT NULL,
  dismissed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
