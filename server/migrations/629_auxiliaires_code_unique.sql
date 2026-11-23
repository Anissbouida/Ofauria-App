-- 629 — Comptes auxiliaires : un code en collision ne laisse plus un tiers sans auxiliaire.
--
-- POURQUOI
--   Le code d'un auxiliaire est formé du préfixe, des 6 premiers caractères du nom et des
--   4 premiers caractères de l'identifiant (4411-FOUR-MINOTE-3f2a). Deux tiers dont le nom
--   commence pareil ont 1 chance sur 65 536 par paire de tomber sur le même code ; pour les
--   clients société (prénom et nom vides), le nom ne compte même pas : 3421-CLI--3f2a.
--   L'insertion se faisait en ON CONFLICT DO NOTHING : le second tiers restait sans
--   auxiliaire, et chaque écriture sur son compte collectif échouait (« Auxiliaire manquant
--   pour compte 4411 ») et partait en file d'attente sans que personne ne le voie : facture
--   ou paiement sans écriture. Constaté sur la base de test : le fournisseur
--   « Fournisseur devise … » tombait sur le code de « Fournisseur achats … »
--   (4411-FOUR-FOURNI-33ee).
--
-- CE QUI CHANGE
--   - fn_ensure_supplier_auxiliary et la nouvelle fn_ensure_customer_auxiliary : si le code
--     court est pris, le suffixe s'allonge (8 puis 12 caractères de l'identifiant, puis
--     l'identifiant entier tronqué à 30), ce qui garantit un code libre.
--   - Client : le nom du code et le libellé retombent sur la raison sociale quand le prénom
--     et le nom sont vides.
--   - Rattrapage : un auxiliaire est créé pour chaque fournisseur ou client qui n'en a pas.
--     Les codes existants ne changent pas.
--
-- INVERSION
--   Remettre fn_ensure_supplier_auxiliary de la mig 304, supprimer fn_ensure_customer_auxiliary
--   et fn_auxiliary_free_code. Les auxiliaires créés par le rattrapage peuvent rester.

CREATE OR REPLACE FUNCTION fn_auxiliary_free_code(p_prefix TEXT, p_name TEXT, p_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_hex  TEXT := replace(p_id::text, '-', '');
  v_base TEXT := p_prefix || UPPER(SUBSTR(REGEXP_REPLACE(COALESCE(p_name, ''), '[^A-Za-z0-9]', '', 'g'), 1, 6)) || '-';
  v_code TEXT;
  n      INT;
BEGIN
  -- Convention historique d'abord (seed 179, mig 304, journal-generator).
  FOREACH n IN ARRAY ARRAY[4, 8, 12] LOOP
    v_code := v_base || SUBSTR(v_hex, 1, n);
    IF length(v_code) <= 30 AND NOT EXISTS (SELECT 1 FROM account_auxiliaries WHERE code = v_code) THEN
      RETURN v_code;
    END IF;
  END LOOP;
  -- Dernier recours : préfixe + identifiant (30 caractères au plus).
  RETURN SUBSTR(p_prefix || v_hex, 1, 30);
END;
$$;

CREATE OR REPLACE FUNCTION fn_ensure_supplier_auxiliary(p_supplier_id UUID)
RETURNS UUID AS $$
DECLARE
  v_account UUID;
  v_aux     UUID;
  v_name    TEXT;
BEGIN
  SELECT id INTO v_aux FROM account_auxiliaries WHERE supplier_id = p_supplier_id;
  IF v_aux IS NOT NULL THEN RETURN v_aux; END IF;

  SELECT id INTO v_account FROM accounts WHERE code = '4411';
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Compte collectif fournisseurs 4411 absent du plan comptable : impossible de créer l''auxiliaire';
  END IF;
  SELECT name INTO v_name FROM suppliers WHERE id = p_supplier_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Deux créations simultanées ne doivent pas calculer le même code libre.
  PERFORM pg_advisory_xact_lock(hashtext('account_auxiliaries.code'));
  SELECT id INTO v_aux FROM account_auxiliaries WHERE supplier_id = p_supplier_id;
  IF v_aux IS NOT NULL THEN RETURN v_aux; END IF;

  INSERT INTO account_auxiliaries (account_id, supplier_id, code, label)
  VALUES (v_account, p_supplier_id, fn_auxiliary_free_code('4411-FOUR-', v_name, p_supplier_id), v_name)
  RETURNING id INTO v_aux;
  RETURN v_aux;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_ensure_customer_auxiliary(p_customer_id UUID)
RETURNS UUID AS $$
DECLARE
  v_account UUID;
  v_aux     UUID;
  v_person  TEXT;
  v_company TEXT;
BEGIN
  SELECT id INTO v_aux FROM account_auxiliaries WHERE customer_id = p_customer_id;
  IF v_aux IS NOT NULL THEN RETURN v_aux; END IF;

  SELECT id INTO v_account FROM accounts WHERE code = '3421';
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Compte collectif clients 3421 absent du plan comptable : impossible de créer l''auxiliaire';
  END IF;
  SELECT TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), TRIM(COALESCE(company_name, ''))
    INTO v_person, v_company
    FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('account_auxiliaries.code'));
  SELECT id INTO v_aux FROM account_auxiliaries WHERE customer_id = p_customer_id;
  IF v_aux IS NOT NULL THEN RETURN v_aux; END IF;

  -- Code : convention historique (prénom + nom), raison sociale à défaut.
  INSERT INTO account_auxiliaries (account_id, customer_id, code, label)
  VALUES (v_account, p_customer_id,
          fn_auxiliary_free_code('3421-CLI-', COALESCE(NULLIF(v_person, ''), v_company), p_customer_id),
          COALESCE(NULLIF(v_person, ''), v_company))
  RETURNING id INTO v_aux;
  RETURN v_aux;
END;
$$ LANGUAGE plpgsql;

-- Rattrapage : tiers restés sans auxiliaire après une collision.
SELECT fn_ensure_supplier_auxiliary(s.id)
  FROM suppliers s
 WHERE NOT EXISTS (SELECT 1 FROM account_auxiliaries a WHERE a.supplier_id = s.id);
SELECT fn_ensure_customer_auxiliary(c.id)
  FROM customers c
 WHERE NOT EXISTS (SELECT 1 FROM account_auxiliaries a WHERE a.customer_id = c.id);
