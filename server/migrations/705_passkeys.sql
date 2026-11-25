-- Passkeys (WebAuthn) : connexion par Face ID, Touch ID, empreinte ou code de l'appareil.
-- La clé privée reste sur l'appareil (trousseau iCloud, gestionnaire Google, Windows Hello) ;
-- Kalum ne garde que la clé publique. Vérification de l'utilisateur exigée : une passkey vaut
-- à elle seule une double authentification (possession + biométrie ou code de l'appareil).
-- Deux usages : connexion sans mot de passe, ou second facteur après le mot de passe.
-- Une passkey est liée au domaine (rp_id) : créée en local, elle ne sert qu'en local.
-- « Réinitialiser la double authentification » (administrateur) supprime aussi les passkeys.
-- Retour arrière : DROP TABLE user_passkeys;
CREATE TABLE IF NOT EXISTS user_passkeys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,          -- identifiant de la passkey (base64url)
  public_key    bytea NOT NULL,                -- clé publique COSE
  counter       bigint NOT NULL DEFAULT 0,     -- compteur anti-clonage (0 pour les passkeys synchronisées)
  transports    text[] NOT NULL DEFAULT '{}',  -- internal, hybrid, usb…
  rp_id         text NOT NULL,                 -- domaine de création
  device_type   text,                          -- singleDevice / multiDevice
  backed_up     boolean NOT NULL DEFAULT false,
  label         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

CREATE INDEX IF NOT EXISTS ix_user_passkeys_user ON user_passkeys (user_id);

COMMENT ON TABLE user_passkeys IS 'Passkeys WebAuthn des comptes (mig 705) ; clé publique seule, la clé privée reste sur l''appareil.';
