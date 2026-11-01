-- ═══════════════════════════════════════════════════════════════════════
-- 416 — Clôture d'exercice et à-nouveaux (lot Essentiel 2)
--
-- POURQUOI
--   Seules existaient des périodes mensuelles. Aucun exercice, aucune clôture
--   annuelle, aucun report : les comptes 116x/119x étaient seedés mais jamais
--   mouvementés, et tous les états cumulaient « depuis l'origine ». En 2027,
--   les charges et produits de 2026 seraient apparus en ouverture des 6xxx/7xxx.
--
-- MODÈLE (celui de Sage)
--   Clôturer l'exercice N génère, au 1er jour de N+1, dans le journal AN, les
--   à-nouveaux des comptes de bilan (classes 1 à 5) : une écriture par magasin
--   (chaque groupe est équilibré puisque chaque écriture l'est), détaillée par
--   tiers sur les comptes collectifs. Le résultat de N y est reporté au compte
--   du profil « year_result » (1181, résultats nets en instance d'affectation)
--   jusqu'à l'affectation décidée par l'assemblée (écriture d'OD ensuite).
--   La clôture est définitive : les mois de N sont verrouillés et la chaîne
--   d'inaltérabilité (mig 413) est scellée, sa tête inscrite sur l'exercice.
--
-- RÈGLE DES SOLDES (fn_ledger_window_start)
--   Bilan (classes 1-5, 0, 9) : cumul depuis le lendemain du dernier exercice
--   clôturé (les AN y sont datés), sinon depuis l'origine.
--   Gestion (classes 6-8) : cumul depuis le début de l'exercice de la date.
--   Les écritures AN (source_kind 'opening') comptent dans les soldes
--   d'ouverture, jamais dans les mouvements d'une période.
--
-- INVERSION
--   DROP FUNCTION fn_close_fiscal_year(smallint, uuid), fn_fiscal_year_checklist(smallint),
--   fn_ledger_window_start(date, int), trg_fiscal_period_ensure_year(), trg_fiscal_year_guard() ;
--   DROP TABLE fiscal_years ; rejouer fn_close_checklist de la mig 415 ; retirer
--   'opening' des contraintes journals.kind et journal_entries.source_kind, et
--   'year_close' de ledger_audit_log.event. Les comptes 1181/1199 et le journal AN
--   peuvent rester.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══ 1. Référentiel : comptes, journal, profils, types ══════════════════
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side) VALUES
  ('1181', 'Résultats nets en instance d''affectation', 1, '11', '118', 'equity', 'C'),
  ('1199', 'Résultat net de l''exercice (solde débiteur)', 1, '11', '119', 'result', 'D')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE journals DROP CONSTRAINT IF EXISTS journals_kind_check;
ALTER TABLE journals ADD CONSTRAINT journals_kind_check
  CHECK (kind IN ('purchase', 'sales', 'bank', 'cash', 'misc', 'opening'));
INSERT INTO journals (code, label, kind, is_active, display_order)
VALUES ('AN', 'Journal des à-nouveaux', 'opening', true, 90)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_kind_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_kind_check CHECK (source_kind IN (
  'manual', 'invoice', 'credit_note', 'payment', 'payment_void', 'sale', 'reversal', 'backfill', 'shift_entry',
  'product_loss', 'closure_diff', 'advance_repayment', 'goods_receipt', 'goods_receipt_return', 'price_variance',
  'landed_cost', 'period_accrual', 'accrual_reversal', 'grir_write_off', 'vat_reclass', 'depreciation',
  'asset_acquisition', 'withholding_remittance', 'loyalty', 'opening'));

INSERT INTO posting_profiles (event_type, account_code, description)
VALUES ('year_result', '1181', 'Report du résultat de l''exercice aux à-nouveaux (en instance d''affectation)')
ON CONFLICT DO NOTHING;

ALTER TABLE ledger_audit_log DROP CONSTRAINT IF EXISTS ledger_audit_log_event_check;
ALTER TABLE ledger_audit_log ADD CONSTRAINT ledger_audit_log_event_check CHECK (event IN (
  'post', 'reverse', 'draft_delete', 'letter', 'unletter', 'reletter',
  'seal', 'verify', 'outbox_replay', 'year_close'));

-- ═══ 2. Exercices ═══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fiscal_years (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year          smallint NOT NULL UNIQUE,
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  status        varchar(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at     timestamptz,
  closed_by     uuid REFERENCES users(id),
  result_amount numeric(14,2),
  chain_seq     bigint,
  chain_hash    char(64),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date > start_date),
  CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);
COMMENT ON TABLE fiscal_years IS
  'Exercices comptables (mig 416). La clôture génère les à-nouveaux (journal AN, source_kind opening, source_id = exercice) et verrouille ses mois.';
COMMENT ON COLUMN fiscal_years.chain_hash IS 'Tête de la chaîne d''inaltérabilité au moment de la clôture : empreinte du PV de clôture.';

INSERT INTO fiscal_years (year, start_date, end_date)
SELECT year, make_date(year, 1, 1), make_date(year, 12, 31) FROM fiscal_periods GROUP BY year
ON CONFLICT (year) DO NOTHING;

-- Toute nouvelle période crée son exercice (fn_ensure_fiscal_period, mig 311).
CREATE OR REPLACE FUNCTION trg_fiscal_period_ensure_year() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO fiscal_years (year, start_date, end_date)
  VALUES (NEW.year, make_date(NEW.year, 1, 1), make_date(NEW.year, 12, 31))
  ON CONFLICT (year) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fiscal_periods_ensure_year ON fiscal_periods;
CREATE TRIGGER fiscal_periods_ensure_year AFTER INSERT ON fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION trg_fiscal_period_ensure_year();

-- Un exercice clôturé ne se modifie ni ne se supprime (clôture définitive).
CREATE OR REPLACE FUNCTION trg_fiscal_year_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Exercice % clôturé : clôture définitive, aucune modification possible', OLD.year USING ERRCODE = 'OF409';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS fiscal_years_guard ON fiscal_years;
CREATE TRIGGER fiscal_years_guard BEFORE UPDATE OR DELETE ON fiscal_years
  FOR EACH ROW EXECUTE FUNCTION trg_fiscal_year_guard();

-- ═══ 3. Règle des soldes ════════════════════════════════════════════════
-- Premier jour à cumuler pour un solde à la date p_date d'un compte de classe p_class.
CREATE OR REPLACE FUNCTION fn_ledger_window_start(p_date date, p_class int) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_class IN (6, 7, 8)
    THEN COALESCE((SELECT start_date FROM fiscal_years WHERE p_date BETWEEN start_date AND end_date),
                  date_trunc('year', p_date)::date)
    ELSE COALESCE((SELECT max(end_date) + 1 FROM fiscal_years WHERE status = 'closed' AND end_date < p_date),
                  '-infinity'::date)
  END
$$;
COMMENT ON FUNCTION fn_ledger_window_start(date, int) IS
  'Début de la fenêtre de cumul (mig 416) : bilan depuis le lendemain du dernier exercice clôturé (AN), gestion depuis le début de l''exercice.';

-- ═══ 4. Contrôles de clôture d'exercice ═════════════════════════════════
CREATE OR REPLACE FUNCTION fn_fiscal_year_checklist(p_year smallint)
RETURNS TABLE (code text, label text, item_count bigint, amount numeric, blocking boolean) LANGUAGE sql STABLE AS $$
  WITH fy AS (SELECT * FROM fiscal_years WHERE year = p_year)
  SELECT 'year_not_ended', 'Exercice non terminé',
         (CASE WHEN CURRENT_DATE <= fy.end_date THEN 1 ELSE 0 END)::bigint, NULL::numeric, true
    FROM fy
  UNION ALL
  SELECT 'previous_open', 'Exercice antérieur non clôturé',
         count(*), NULL::numeric, true
    FROM fiscal_years f, fy WHERE f.end_date < fy.start_date AND f.status = 'open'
  UNION ALL
  SELECT 'periods_open', 'Mois avec écritures ou ventes encore ouverts',
         count(*), NULL::numeric, true
    FROM fiscal_periods p, fy
   WHERE p.start_date BETWEEN fy.start_date AND fy.end_date AND p.status = 'open'
     AND (EXISTS (SELECT 1 FROM journal_entries je
                   WHERE je.fiscal_period_id = p.id AND je.status <> 'draft' AND je.source_kind <> 'opening')
          OR EXISTS (SELECT 1 FROM sales s
                      WHERE DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE 'Africa/Casablanca') BETWEEN p.start_date AND p.end_date))
  UNION ALL
  SELECT 'drafts', 'Écritures en brouillon dans l''exercice',
         count(*), NULL::numeric, true
    FROM journal_entries je, fy WHERE je.status = 'draft' AND je.entry_date BETWEEN fy.start_date AND fy.end_date
  UNION ALL
  -- Échecs enregistrés avant la fin de l'exercice : un échec plus tardif sera
  -- daté, une fois rejoué, dans une période ouverte (fn_accounting_date, mig 311).
  SELECT 'outbox_pending', 'Comptabilisations en attente (file) antérieures à la fin de l''exercice',
         count(*), NULL::numeric, true
    FROM ledger_outbox o, fy WHERE o.status <> 'posted' AND o.created_at::date <= fy.end_date
  UNION ALL
  SELECT 'next_period_closed', 'Premier mois de l''exercice suivant déjà fermé (les à-nouveaux y sont datés)',
         count(*), NULL::numeric, true
    FROM fiscal_periods p, fy WHERE p.start_date = fy.end_date + 1 AND p.status <> 'open'
  UNION ALL
  SELECT 'unlettered_tiers', 'Lignes de tiers non lettrées (factures ou règlements ouverts, reportés par tiers)',
         count(*), COALESCE(sum(jel.debit - jel.credit), 0), false
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN accounts a ON a.id = jel.account_id, fy
   WHERE a.is_collective AND jel.lettrage_id IS NULL AND je.status = 'posted' AND je.source_kind <> 'opening'
     AND je.entry_date BETWEEN fy.start_date AND fy.end_date
  UNION ALL
  SELECT 'result', 'Résultat de l''exercice (bénéfice positif, perte négative)',
         0::bigint, COALESCE(sum(jel.credit - jel.debit), 0), false
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN accounts a ON a.id = jel.account_id, fy
   WHERE a.account_class IN (6, 7, 8) AND je.status IN ('posted', 'reversed')
     AND je.entry_date BETWEEN fy.start_date AND fy.end_date
$$;

-- ═══ 5. Clôture d'exercice ══════════════════════════════════════════════
-- Atomique : contrôles, fermeture des mois vides, à-nouveaux, verrouillage,
-- scellement, trace. p_user est l'auteur (obligatoire : il valide les AN).
CREATE OR REPLACE FUNCTION fn_close_fiscal_year(p_year smallint, p_user uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  fy          fiscal_years%ROWTYPE;
  v_next      date;
  v_blocking  text;
  v_jnl       uuid;
  v_period    uuid;
  v_res_acc   uuid;
  v_result    numeric := 0;
  v_res_store numeric;
  v_entry     uuid;
  v_num       text;
  v_order     int;
  v_entries   jsonb := '[]'::jsonb;
  v_locked    int;
  v_seq       bigint;
  v_hash      text;
  g           record;
  l           record;
  p           record;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'Clôture d''exercice : auteur obligatoire' USING ERRCODE = 'OF409';
  END IF;
  SELECT * INTO fy FROM fiscal_years WHERE year = p_year FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exercice % introuvable', p_year USING ERRCODE = 'OF409'; END IF;
  IF fy.status = 'closed' THEN RAISE EXCEPTION 'Exercice % déjà clôturé', p_year USING ERRCODE = 'OF409'; END IF;
  v_next := fy.end_date + 1;

  SELECT string_agg(c.label || ' (' || c.item_count || ')', ' ; ') INTO v_blocking
    FROM fn_fiscal_year_checklist(p_year) c WHERE c.blocking AND c.item_count > 0;
  IF v_blocking IS NOT NULL THEN
    RAISE EXCEPTION 'Clôture de l''exercice % impossible : %', p_year, v_blocking USING ERRCODE = 'OF409';
  END IF;

  -- Mois restés ouverts sans écriture ni vente : fermés d'office, dans l'ordre.
  FOR p IN SELECT id FROM fiscal_periods
            WHERE start_date BETWEEN fy.start_date AND fy.end_date AND status = 'open' ORDER BY start_date LOOP
    PERFORM set_config('app.period_note', format('Clôture de l''exercice %s : mois sans écriture', p_year), true);
    UPDATE fiscal_periods SET status = 'closed', closed_at = now(), closed_by = p_user WHERE id = p.id;
  END LOOP;

  -- Soldes à reporter : bilan cumulé (AN antérieurs compris), gestion de l'exercice.
  DROP TABLE IF EXISTS _fy_balances;
  CREATE TEMP TABLE _fy_balances ON COMMIT DROP AS
    SELECT je.store_id, jel.account_id, a.code, a.account_class, jel.auxiliary_id,
           sum(jel.debit - jel.credit) AS bal
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN accounts a ON a.id = jel.account_id
     WHERE je.status IN ('posted', 'reversed') AND je.entry_date <= fy.end_date
       AND je.entry_date >= fn_ledger_window_start(fy.end_date, a.account_class)
     GROUP BY je.store_id, jel.account_id, a.code, a.account_class, jel.auxiliary_id;

  SELECT id INTO v_jnl FROM journals WHERE code = 'AN';
  SELECT a.id INTO v_res_acc FROM accounts a
   WHERE a.code = COALESCE((SELECT account_code FROM posting_profiles
                             WHERE event_type = 'year_result' AND category_id IS NULL AND is_active), '1181');
  IF v_res_acc IS NULL THEN RAISE EXCEPTION 'Compte de report du résultat introuvable (profil year_result)'; END IF;
  v_period := fn_ensure_fiscal_period(v_next);

  FOR g IN SELECT store_id FROM _fy_balances GROUP BY store_id HAVING bool_or(bal <> 0) ORDER BY store_id NULLS FIRST LOOP
    -- Résultat du magasin : solde (débit − crédit) de ses comptes de gestion.
    SELECT COALESCE(sum(bal), 0) INTO v_res_store FROM _fy_balances
     WHERE store_id IS NOT DISTINCT FROM g.store_id AND account_class IN (6, 7, 8);
    v_result := v_result - v_res_store;
    IF NOT EXISTS (SELECT 1 FROM _fy_balances WHERE store_id IS NOT DISTINCT FROM g.store_id
                     AND account_class NOT IN (6, 7, 8) AND bal <> 0) AND v_res_store = 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description,
                                 source_kind, source_id, source_detail, store_id, created_by)
    VALUES (next_entry_number(v_jnl, extract(year FROM v_next)::smallint), v_jnl, v_next, v_period,
            format('À-nouveaux de l''exercice %s', p_year), 'opening', fy.id,
            'store:' || COALESCE(g.store_id::text, 'none'), g.store_id, p_user)
    RETURNING id, entry_number INTO v_entry, v_num;

    v_order := 0;
    FOR l IN SELECT account_id, auxiliary_id, bal FROM _fy_balances
              WHERE store_id IS NOT DISTINCT FROM g.store_id AND account_class NOT IN (6, 7, 8) AND bal <> 0
              ORDER BY code, auxiliary_id NULLS FIRST LOOP
      v_order := v_order + 1;
      INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, auxiliary_id, debit, credit, label)
      VALUES (v_entry, v_order, l.account_id, l.auxiliary_id,
              CASE WHEN l.bal > 0 THEN l.bal ELSE 0 END, CASE WHEN l.bal < 0 THEN -l.bal ELSE 0 END,
              format('À nouveau %s', p_year));
    END LOOP;
    IF v_res_store <> 0 THEN
      v_order := v_order + 1;
      INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, debit, credit, label)
      VALUES (v_entry, v_order, v_res_acc,
              CASE WHEN v_res_store > 0 THEN v_res_store ELSE 0 END, CASE WHEN v_res_store < 0 THEN -v_res_store ELSE 0 END,
              format('Résultat %s en instance d''affectation', p_year));
    END IF;
    UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = p_user WHERE id = v_entry;
    v_entries := v_entries || jsonb_build_object('entry_number', v_num, 'store_id', g.store_id, 'lines', v_order);
  END LOOP;

  -- Clôture définitive : mois verrouillés (scellement et ancre à chaque passage, mig 413).
  PERFORM set_config('app.period_note', format('Clôture de l''exercice %s', p_year), true);
  UPDATE fiscal_periods SET status = 'locked'
   WHERE start_date BETWEEN fy.start_date AND fy.end_date AND status = 'closed';
  GET DIAGNOSTICS v_locked = ROW_COUNT;

  PERFORM fn_ledger_seal();
  SELECT je.chain_seq, je.chain_hash INTO v_seq, v_hash
    FROM journal_entries je WHERE je.chain_seq IS NOT NULL ORDER BY je.chain_seq DESC LIMIT 1;

  UPDATE fiscal_years
     SET status = 'closed', closed_at = now(), closed_by = p_user, result_amount = round(v_result, 2),
         chain_seq = v_seq, chain_hash = v_hash
   WHERE id = fy.id;

  INSERT INTO ledger_audit_log (event, actor, details)
  VALUES ('year_close', p_user, jsonb_build_object('year', p_year, 'result', round(v_result, 2),
          'opening_entries', v_entries, 'periods_locked', v_locked, 'chain_seq', v_seq));

  RETURN jsonb_build_object('year', p_year, 'result', round(v_result, 2), 'opening_entries', v_entries,
                            'periods_locked', v_locked, 'chain_seq', v_seq, 'chain_hash', v_hash);
END $$;

-- ═══ 6. Contrôles mensuels : caisse au solde de la fenêtre ══════════════
-- Reprise de la mig 415 : seul « caisse créditrice » change (cumul fenêtré,
-- sinon les AN compteraient deux fois l'historique).
CREATE OR REPLACE FUNCTION fn_close_checklist(p_period uuid)
RETURNS TABLE (code text, label text, item_count bigint, amount numeric, blocking boolean) LANGUAGE sql STABLE AS $$
  WITH p AS (SELECT * FROM fiscal_periods WHERE id = p_period)
  SELECT 'previous_open', 'Période précédente encore ouverte',
         count(*), NULL::numeric, true
    FROM fiscal_periods f, p WHERE f.end_date = p.start_date - 1 AND f.status = 'open'
  UNION ALL
  SELECT 'invoices_unposted', 'Factures fournisseurs sans écriture',
         count(*), COALESCE(sum(i.total_amount), 0), true
    FROM invoices i, p
   WHERE i.invoice_type = 'received' AND i.status <> 'cancelled' AND i.total_amount > 0
     AND i.invoice_date BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = i.id AND je.status = 'posted')
  UNION ALL
  SELECT 'payments_unposted', 'Paiements sans écriture',
         count(*), COALESCE(sum(pa.amount), 0), true
    FROM payments pa, p
   WHERE pa.status <> 'void' AND pa.amount > 0 AND pa.payment_method <> 'avoir'
     AND pa.payment_date BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = pa.id AND je.status = 'posted')
  UNION ALL
  SELECT 'outbox_pending', 'Comptabilisations en attente (file)',
         count(*), NULL::numeric, true
    FROM ledger_outbox o WHERE o.status <> 'posted'
  UNION ALL
  SELECT 'draft_entries', 'Écritures en brouillon dans la période',
         count(*), NULL::numeric, true
    FROM journal_entries je, p WHERE je.status = 'draft' AND je.fiscal_period_id = p.id
  UNION ALL
  SELECT 'grir_aged', 'Réceptions non facturées depuis plus de 30 jours',
         count(*), COALESCE(sum(g.open_amount), 0), false
    FROM v_grir_open_items g, p WHERE g.first_event <= p.end_date AND g.open_amount > 0 AND (p.end_date - g.first_event) > 30
  UNION ALL
  SELECT 'invoice_holds', 'Factures du mois avec blocage ouvert',
         count(DISTINCT h.invoice_id), NULL::numeric, false
    FROM invoice_holds h JOIN invoices i ON i.id = h.invoice_id, p
   WHERE h.released_at IS NULL AND i.invoice_date BETWEEN p.start_date AND p.end_date
  -- ─── Caisse (mig 415) ───
  UNION ALL
  SELECT 'pos_sessions_open', 'Sessions de caisse non fermées',
         count(*), NULL::numeric, true
    FROM cash_register_sessions cs, p
   WHERE cs.status <> 'closed'
     AND (cs.opened_at AT TIME ZONE 'Africa/Casablanca')::date BETWEEN p.start_date AND p.end_date
  UNION ALL
  SELECT 'pos_sales_unposted', 'Tickets de caisse sans écriture',
         count(*), COALESCE(sum(s.total), 0), true
    FROM sales s, p
   WHERE s.payment_status IS DISTINCT FROM 'unpaid' AND s.total > 0
     AND DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE 'Africa/Casablanca') BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = s.id AND je.status <> 'draft')
     AND NOT EXISTS (SELECT 1 FROM manual_shift_entries m
                      WHERE m.store_id = s.store_id
                        AND m.entry_date = DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE 'Africa/Casablanca'))
  UNION ALL
  SELECT 'cash_credit_balance', 'Caisse (5161) en solde créditeur en fin de période',
         (CASE WHEN c.bal < 0 THEN 1 ELSE 0 END)::bigint, c.bal, true
    FROM (SELECT COALESCE(sum(l.debit) - sum(l.credit), 0) AS bal
            FROM journal_entry_lines l
            JOIN journal_entries je ON je.id = l.journal_entry_id
            JOIN accounts a ON a.id = l.account_id, p
           WHERE a.code = '5161' AND je.status IN ('posted', 'reversed') AND je.entry_date <= p.end_date
             AND je.entry_date >= fn_ledger_window_start(p.end_date, 5)) c
  UNION ALL
  SELECT 'pos_closure_diff_unposted', 'Écarts de fermeture de caisse sans écriture',
         count(*), COALESCE(sum(cs.difference), 0), false
    FROM cash_register_sessions cs, p
   WHERE cs.status = 'closed' AND COALESCE(cs.difference, 0) <> 0
     AND (cs.closed_at AT TIME ZONE 'Africa/Casablanca')::date BETWEEN p.start_date AND p.end_date
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = cs.id AND je.source_kind = 'closure_diff' AND je.status <> 'draft')
  UNION ALL
  SELECT 'pos_days_without_sales', 'Jours sans aucune vente en caisse',
         count(*), NULL::numeric, false
    FROM p, generate_series(p.start_date, LEAST(p.end_date, CURRENT_DATE), interval '1 day') AS d(day)
   WHERE NOT EXISTS (SELECT 1 FROM sales s
                      WHERE DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE 'Africa/Casablanca') = d.day::date)
     AND NOT EXISTS (SELECT 1 FROM manual_shift_entries m WHERE m.entry_date = d.day::date)
$$;
