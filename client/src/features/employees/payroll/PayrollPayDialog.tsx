import { money } from '../../../utils/money';
import { useState } from 'react';
import { HandCoins, Wallet, Banknote } from 'lucide-react';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { HrModal, SubmitButton, Field, inputCls } from '../ui';

/* ═══════════════════════ PAY DIALOG (méthode + retenue d'avance) ═══════════════════════ */
/**
 * Dialogue de paiement commun mensuel/hebdo : choix du mode de règlement +
 * proposition de retenue sur les avances en cours de l'employé.
 * `suggested` = retenue proposée : suit le plan d'étalement de chaque avance
 * (monthly_deduction) si défini, sinon tout le solde. Toujours plafonnée au
 * net dû, et modifiable librement au moment du paiement.
 */
export default function PayrollPayDialog({ employeeName, periodLabel, net, outstanding, suggested, defaultMethod, pending, onClose, onConfirm }: {
  employeeName: string;
  periodLabel: string;
  net: number;
  outstanding: number;
  suggested: number;
  defaultMethod: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (method: string, deduction: number) => void;
}) {
  const maxDeduction = Math.min(outstanding, net);
  const proposed = Math.min(suggested, maxDeduction);
  const hasPlan = suggested < outstanding - 0.005;
  const [method, setMethod] = useState(defaultMethod);
  const [deduction, setDeduction] = useState<string>(proposed > 0 ? proposed.toFixed(2) : '0');
  const ded = Math.max(0, parseFloat(deduction) || 0);
  const cashOut = Math.max(0, Math.round((net - ded) * 100) / 100);
  const invalid = ded > maxDeduction + 0.005;

  return (
    <HrModal icon={Wallet} crumb="Paiement" title={`Payer ${employeeName}`} tag={<span className="odoo-tag odoo-tag-grey">{periodLabel}</span>}
      width={480} onClose={onClose}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <SubmitButton pending={pending} disabled={invalid} onClick={() => onConfirm(method, Math.round(ded * 100) / 100)}>
          Confirmer le paiement
        </SubmitButton>
      </>}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 14 }}>
        <span style={{ color: 'var(--ds-muted)' }}>Net dû</span>
        <strong style={{ fontSize: 16, color: 'var(--ds-ink)' }}>{money(net)}</strong>
      </div>

      <Field label="Mode de paiement">
        <select value={method} onChange={e => setMethod(e.target.value)} className={inputCls}>
          <option value="cash">Espèces</option>
          <option value="bank">Virement</option>
          <option value="check">Chèque</option>
        </select>
      </Field>

      {outstanding > 0 ? (
        <StatusBanner tone="warning" icon={HandCoins} title={`Avances en cours : ${money(outstanding)}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            <Field label={`Retenue sur cette paie (max ${money(maxDeduction)})${hasPlan ? ` — plan d'étalement : ${money(proposed)} proposés` : ''}`}
              hint="Montant modifiable — mettre 0 pour ne rien retenir sur cette paie."
              error={invalid ? 'La retenue dépasse le solde d\'avances ou le net dû.' : undefined}>
              <input type="number" step="0.01" min="0" max={maxDeduction} value={deduction}
                onChange={e => setDeduction(e.target.value)} className={inputCls} aria-invalid={invalid || undefined} />
            </Field>
          </div>
        </StatusBanner>
      ) : (
        <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Aucune avance en cours pour cet employé.</span>
      )}

      <StatusBanner tone={cashOut > 0 ? 'success' : 'neutral'} icon={Banknote}
        title={`À verser (${method === 'cash' ? 'espèces' : method === 'bank' ? 'virement' : 'chèque'}) : ${money(cashOut)}`} />
    </HrModal>
  );
}
