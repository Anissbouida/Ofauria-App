-- ═══════════════════════════════════════════════════════════════════════
-- 324 — Espace employé (libre-service), lot 8 refonte RH
--   Un utilisateur lié à une fiche employé (employees.user_id) consulte ses
--   bulletins, son solde de congés et ses avances, demande un congé ou une
--   avance sur salaire. La demande d'avance est validée par le gérant, qui
--   la verse (l'avance suit ensuite le circuit existant : 3431, retenue).
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS salary_advance_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id        UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount             DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  -- Étalement souhaité (retenue par paie) ; NULL = tout sur la prochaine paie.
  monthly_deduction  DECIMAL(10,2) CHECK (monthly_deduction IS NULL OR monthly_deduction > 0),
  reason             VARCHAR(300),
  status             VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by         UUID REFERENCES users(id),
  decided_at         TIMESTAMPTZ,
  decision_note      VARCHAR(300),
  advance_id         UUID REFERENCES salary_advances(id) ON DELETE SET NULL,
  requested_by       UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT salary_advance_requests_decision CHECK (status = 'pending' OR status = 'cancelled' OR decided_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_advance_requests_status ON salary_advance_requests(status, created_at DESC);
-- Une seule demande en attente par employé.
CREATE UNIQUE INDEX IF NOT EXISTS uq_advance_requests_pending ON salary_advance_requests(employee_id) WHERE status = 'pending';

-- Un utilisateur ne peut être lié qu'à une fiche employé.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_user ON employees(user_id) WHERE user_id IS NOT NULL;
