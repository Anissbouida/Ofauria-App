-- Refonte Utilisateurs, lot 9 : revue des accès en campagnes.
--
-- Une campagne (une seule ouverte à la fois) reprend tous les comptes actifs à son ouverture.
-- Chaque compte reçoit une décision datée et signée : confirmé, corrigé (avec ce qui a été
-- changé) ou désactivé. La photo des droits à l'ouverture (rôles, établissements, exceptions,
-- signaux) est gardée pour le rapport, même si le compte change ensuite.
-- Le seuil des comptes dormants est un réglage de la politique de sécurité (security.policy,
-- dormantDays, 60 jours par défaut) : aucune colonne ici.
--
-- INVERSION : DROP TABLE access_review_items, access_review_campaigns.

CREATE TABLE IF NOT EXISTS access_review_campaigns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      varchar(120) NOT NULL,
  status     varchar(10)  NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  due_on     date,
  opened_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  opened_at  timestamptz NOT NULL DEFAULT now(),
  closed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_at  timestamptz
);
-- Une seule campagne ouverte à la fois.
CREATE UNIQUE INDEX IF NOT EXISTS ux_access_review_one_open ON access_review_campaigns ((true)) WHERE status = 'open';
COMMENT ON TABLE access_review_campaigns IS 'Campagnes de revue des accès (refonte Utilisateurs, lot 9).';

CREATE TABLE IF NOT EXISTS access_review_items (
  campaign_id uuid NOT NULL REFERENCES access_review_campaigns(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot    jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision    varchar(12) CHECK (decision IN ('confirmed', 'corrected', 'deactivated')),
  comment     text,
  decided_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at  timestamptz,
  PRIMARY KEY (campaign_id, user_id),
  CHECK ((decision IS NULL) = (decided_at IS NULL))
);
COMMENT ON TABLE access_review_items IS 'Décision datée et signée par compte et par campagne de revue (lot 9).';
