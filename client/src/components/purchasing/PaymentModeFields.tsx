import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banknote, ShieldAlert, ShieldCheck } from 'lucide-react';
import { paymentsApi, type PaymentMode, type TreasuryAccount } from '../../api/accounting.api';
import { StatusBanner } from '../ui/StatusBanner';
import ReasonCodeDialog from './ReasonCodeDialog';
import ModalBackdrop from '../ui/ModalBackdrop';
import { useAuth } from '../../context/AuthContext';

/**
 * Règlement typé (mig 310, D7).
 *  - usePaymentModes : référentiel des modes (espèces, chèque barré, effet, virement…)
 *    et des comptes de trésorerie ;
 *  - CashLimitGauge : compteur espèces chez le fournisseur (plafond 5 000 DH/jour,
 *    50 000 DH/mois), alerte à 80 %, dérogation admin motivée quand le plafond bloque.
 */
export function usePaymentModes() {
  const q = useQuery({ queryKey: ['payment-modes'], queryFn: () => paymentsApi.modes(), staleTime: 5 * 60_000 });
  const modes: PaymentMode[] = q.data?.modes ?? [];
  const treasuryAccounts: TreasuryAccount[] = q.data?.treasuryAccounts ?? [];
  const byCode = (code: string | null | undefined) => modes.find(m => m.code === code);
  return { modes, treasuryAccounts, byCode, isLoading: q.isLoading };
}

/** Code de mode typé correspondant à une ancienne méthode (pré-remplissage). */
export function modeFromLegacy(method: string | null | undefined): string {
  switch (method) {
    case 'check': return 'cheque_barre';
    case 'traite': return 'effet';
    case 'transfer': case 'bank': return 'virement';
    case 'card': return 'carte';
    case 'mobile': return 'mobile';
    case 'cash': case null: case undefined: case '': return 'cash';
    default: return method;   // déjà un code typé
  }
}

/** Libellé lisible d'un paiement : mode typé si présent, sinon méthode héritée. */
export function paymentModeLabel(p: { payment_mode?: unknown; payment_method?: unknown }, modes: PaymentMode[]): string {
  const m = modes.find(x => x.code === p.payment_mode);
  if (m) return m.label;
  if (p.payment_method === 'avoir') return 'Avoir';
  return String(p.payment_method ?? '—');
}

export function PaymentModeSelect({ value, onChange, name = 'paymentMode', exclude }: {
  value: string; onChange: (code: string) => void; name?: string; exclude?: string[];
}) {
  const { modes } = usePaymentModes();
  return (
    <select name={name} value={value} onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
      {modes.filter(m => !exclude?.includes(m.code)).map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
    </select>
  );
}

export type CashOverride = { reasonCodeId: string; note?: string } | null;

const fmt = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Jauge « Espèces ce jour chez X ». Ne s'affiche que pour un mode soumis au
 * plafond (espèces, chèque non barré) et un fournisseur connu.
 * onOverrideChange reçoit la dérogation saisie par un admin (ou null).
 */
export function CashLimitGauge({ supplierId, date, amount, modeCode, override, onOverrideChange }: {
  supplierId?: string | null; date?: string | null; amount: number; modeCode: string;
  override: CashOverride; onOverrideChange: (o: CashOverride) => void;
}) {
  const { byCode } = usePaymentModes();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const mode = byCode(modeCode);
  const subject = !!mode && !mode.deductible_over_cash_limit && !!supplierId && !!date;
  const [debounced, setDebounced] = useState(amount);
  useEffect(() => { const t = setTimeout(() => setDebounced(amount), 300); return () => clearTimeout(t); }, [amount]);
  const [askOverride, setAskOverride] = useState(false);

  const { data: c } = useQuery({
    queryKey: ['cash-cumul', supplierId, date, debounced],
    queryFn: () => paymentsApi.cashCumul({ supplierId: supplierId!, date: date!, amount: debounced || 0 }),
    enabled: subject,
  });
  useEffect(() => { if (!c?.exceeded && override) onOverrideChange(null); }, [c?.exceeded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!subject || !c || !c.applies) return null;
  const pct = Math.max(c.pctDay ?? 0, c.pctMonth ?? 0);
  const tone = c.exceeded ? (c.agriException ? 'warning' : 'danger') : c.warning ? 'warning' : 'neutral';
  const title = c.exceeded
    ? (c.agriException ? 'Plafond espèces dépassé — exception produits agricoles' : 'Plafond espèces dépassé')
    : c.warning ? `Plafond espèces bientôt atteint (${pct} %)` : `Espèces chez ${c.supplierName}`;

  return (
    <>
      <StatusBanner tone={tone} icon={c.exceeded ? ShieldAlert : Banknote} title={title}
        actions={c.blocked && isAdmin ? (
          override
            ? <button type="button" className="odoo-btn-secondary" onClick={() => onOverrideChange(null)}>Retirer la dérogation</button>
            : <button type="button" className="odoo-btn-danger" onClick={() => setAskOverride(true)}>Dérogation admin</button>
        ) : undefined}>
        <div>Ce jour : {fmt(c.dayAfter)} / {fmt(c.dayLimit)} DH ({c.pctDay ?? 0} %) · Ce mois : {fmt(c.monthAfter)} / {fmt(c.monthLimit)} DH</div>
        {c.exceeded && !c.agriException && !c.blocked && (
          <div>Le règlement passera mais sera marqué <strong>non déductible</strong> (IS et TVA). Préférez chèque barré, effet ou virement.</div>
        )}
        {c.blocked && !override && (
          <div>{isAdmin ? 'Réglez par chèque barré, effet ou virement, ou posez une dérogation motivée.' : 'Réglez par chèque barré, effet ou virement : seul un administrateur peut déroger.'}</div>
        )}
        {override && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><ShieldCheck size={12} /> Dérogation posée : le règlement sera tracé et marqué non déductible.</div>}
        {c.dayCount >= 2 && <div>{c.dayCount} règlements soumis au plafond déjà saisis ce jour chez ce fournisseur.</div>}
      </StatusBanner>
      {askOverride && (
        <ReasonCodeDialog title="Dérogation au plafond espèces" scope="cash_override"
          description="La dérogation est journalisée (auteur, motif, cumul) et la charge reste non déductible."
          confirmLabel="Poser la dérogation" danger
          onClose={() => setAskOverride(false)}
          onSubmit={(v) => { onOverrideChange(v); setAskOverride(false); }} />
      )}
    </>
  );
}

/**
 * Ré-émission d'un paiement annulé (chèque perdu, rejet bancaire) : nouveau
 * règlement lié à l'original, même facture, même montant.
 */
export function ReissuePaymentDialog({ payment, pending, onClose, onSubmit }: {
  payment: Record<string, unknown>; pending?: boolean; onClose: () => void;
  onSubmit: (data: { paymentMode: string; checkNumber?: string; reference?: string; checkDate?: string; paymentDate: string }) => void;
}) {
  const { byCode } = usePaymentModes();
  const [mode, setMode] = useState(modeFromLegacy(String(payment.payment_mode ?? payment.payment_method ?? 'cash')));
  const [ref, setRef] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const def = byCode(mode);
  const isInstrument = def?.legacy_method === 'check' || def?.legacy_method === 'traite';
  const valid = !!date && (!def?.requires_reference || ref.trim().length > 0);
  const amount = parseFloat(String(payment.amount ?? 0));
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 440, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">Ré-émettre le règlement de {fmt(amount)} DH</span></div>
        </div>
        <form onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onSubmit({ paymentMode: mode, paymentDate: date,
            ...(isInstrument ? { checkNumber: ref.trim(), checkDate: date } : { reference: ref.trim() || undefined }) });
        }} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
            Le nouveau règlement est lié au paiement annulé : la trace « remplace » reste dans l'historique.
          </p>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Mode de règlement *</label>
          <PaymentModeSelect value={mode} onChange={setMode} />
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>
            {isInstrument ? `N° ${def?.legacy_method === 'traite' ? 'd\'effet' : 'de chèque'} *` : def?.requires_reference ? 'Référence *' : 'Référence'}
          </label>
          <input value={ref} onChange={e => setRef(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Date *</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Retour</button>
            <button type="submit" disabled={!valid || pending} className="odoo-btn-primary">Ré-émettre</button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  );
}

/** Badge de statut d'un paiement (exécuté / annulé / contre-pièce). */
export function PaymentStatusTag({ p }: { p: Record<string, unknown> }) {
  if (p.voids_payment_id) return <span className="odoo-tag odoo-tag-red" title="Contre-pièce d'annulation">Contre-pièce</span>;
  if (p.status === 'void') return <span className="odoo-tag odoo-tag-red" title={String(p.void_note ?? '')}>Annulé</span>;
  if (p.non_deductible) return <span className="odoo-tag odoo-tag-orange" title="Espèces au-delà du plafond : charge non déductible">Non déductible</span>;
  if (p.replaces_payment_id) return <span className="odoo-tag odoo-tag-blue">Ré-émis</span>;
  return null;
}
