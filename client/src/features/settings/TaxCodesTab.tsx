import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, Percent } from 'lucide-react';
import { settingsApi, type TaxCode } from '../../api/settings.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Codes de TVA datés (audit Paramètres, lot 5) : un taux ne se modifie jamais,
 * on ajoute un nouveau taux à partir d'une date ; la période précédente du même
 * code est close la veille. Les factures passées gardent leur taux.
 */

const KINDS: [string, string][] = [
  ['standard', 'Taux normal'], ['reduced', 'Taux réduit'], ['zero', 'Taux zéro'],
  ['exempt_without_credit', 'Exonéré sans droit à déduction'], ['exempt_with_credit', 'Exonéré avec droit à déduction'],
  ['out_of_scope', 'Hors champ'],
];
const STATUS: Record<TaxCode['status'], { cls: string; label: string }> = {
  current: { cls: 'odoo-tag odoo-tag-green', label: 'En vigueur' },
  future: { cls: 'odoo-tag odoo-tag-blue', label: 'À venir' },
  past: { cls: 'odoo-tag odoo-tag-grey', label: 'Historique' },
};
const d = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : '—');
/** Veille d'une date AAAA-MM-JJ, calculée en UTC pour ne pas dépendre du fuseau. */
const dayBefore = (iso: string) => {
  const [y, m, dd] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd - 1)).toISOString().slice(0, 10);
};

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } | string } } };
  const er = e?.response?.data?.error;
  return typeof er === 'string' ? er : er?.message || fallback;
}

export default function TaxCodesTab() {
  const queryClient = useQueryClient();
  const { canCreate } = usePermissions();
  const [showPast, setShowPast] = useState(false);
  const [draft, setDraft] = useState<null | { code: string; label: string; rate: string; kind: string; recoverable: boolean; validFrom: string; legalRef: string }>(null);
  const { data: codes = [], isLoading } = useQuery({ queryKey: ['tax-codes'], queryFn: settingsApi.taxCodes });

  const add = useMutation({
    mutationFn: () => settingsApi.addTaxRate({ ...draft!, rate: Number(draft!.rate) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tax-codes'] }); notify.success('Taux enregistré'); setDraft(null); },
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });

  const shown = useMemo(() => codes.filter(c => showPast || c.status !== 'past'), [codes, showPast]);
  const existing = useMemo(() => [...new Map(codes.map(c => [c.code, c])).values()], [codes]);
  const today = new Date().toISOString().slice(0, 10);
  const newRateFor = (c?: TaxCode) => setDraft({
    code: c?.code ?? '', label: c?.label ?? '', rate: c ? String(Number(c.rate)) : '', kind: c?.kind ?? 'standard',
    recoverable: c?.recoverable ?? true, validFrom: today, legalRef: c?.legal_ref ?? '',
  });
  const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' };
  const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };
  const replacing = draft && existing.find(c => c.code === draft.code.trim().toUpperCase());

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12 }}>
      <StatusBanner tone="neutral" icon={Percent} title="Taux datés">
        Un taux ne se modifie pas : ajoutez le nouveau taux avec sa date d'effet, l'ancien s'arrête la veille.
        Les pièces déjà enregistrées gardent leur taux.
      </StatusBanner>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label htmlFor="tax-show-past" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.875rem' }}>
          <input id="tax-show-past" type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} /> Afficher l'historique
        </label>
        {!draft && canCreate('settings') && (
          <button className="odoo-btn-primary" onClick={() => newRateFor()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> Nouveau taux
          </button>
        )}
      </div>

      {isLoading ? <Loader2 className="animate-spin" size={16} /> : !codes.length ? (
        <StatusBanner tone="warning" icon={Percent} title="Aucun code TVA">La migration 331 n'est pas appliquée sur cette base.</StatusBanner>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Code</th><th>Libellé</th><th style={{ textAlign: 'right' }}>Taux</th><th>Nature</th><th>Déductible</th><th>Du</th><th>Au</th><th>Statut</th><th>Référence</th><th></th></tr></thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.id} style={{ opacity: c.status === 'past' ? 0.6 : 1 }}>
                  <td style={{ fontFamily: 'ui-monospace, monospace' }}>{c.code}</td>
                  <td>{c.label}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(c.rate).toLocaleString('fr-FR')} %</td>
                  <td>{KINDS.find(k => k[0] === c.kind)?.[1] ?? c.kind}</td>
                  <td>{c.recoverable ? 'Oui' : 'Non'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{d(c.valid_from)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{d(c.valid_to)}</td>
                  <td><span className={STATUS[c.status].cls}>{STATUS[c.status].label}</span></td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>{c.legal_ref ?? ''}</td>
                  <td>
                    {c.status !== 'past' && !draft && canCreate('settings') && (
                      <button className="odoo-btn-secondary" style={{ padding: '2px 8px', whiteSpace: 'nowrap' }} onClick={() => newRateFor(c)}>Changer le taux</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 16, display: 'grid', gap: 12, background: 'var(--odoo-bg-alt)' }}>
          <div style={{ fontWeight: 600 }}>{replacing ? `Nouveau taux pour ${replacing.code}` : 'Nouveau code TVA'}</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ ...lab, width: 120 }}>Code
              <input id="tax-code" style={{ ...field, fontFamily: 'ui-monospace, monospace' }} value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })} maxLength={20} />
            </label>
            <label style={{ ...lab, flex: '1 1 220px' }}>Libellé
              <input id="tax-label" style={field} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} maxLength={120} />
            </label>
            <label style={{ ...lab, width: 110 }}>Taux (%)
              <input id="tax-rate" type="number" min={0} max={100} step="0.01" style={field} value={draft.rate} onChange={e => setDraft({ ...draft, rate: e.target.value })} />
            </label>
            <label style={{ ...lab, width: 240 }}>Nature
              <select id="tax-kind" style={field} value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value })}>
                {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ ...lab, width: 170 }}>À partir du
              <input id="tax-from" type="date" style={field} value={draft.validFrom} onChange={e => setDraft({ ...draft, validFrom: e.target.value })} />
            </label>
            <label style={{ ...lab, flex: '1 1 260px' }}>Référence légale
              <input id="tax-ref" style={field} value={draft.legalRef} onChange={e => setDraft({ ...draft, legalRef: e.target.value })} placeholder="CGI art. 98, LF 2026…" />
            </label>
            <label htmlFor="tax-recoverable" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.875rem' }}>
              <input id="tax-recoverable" type="checkbox" checked={draft.recoverable} onChange={e => setDraft({ ...draft, recoverable: e.target.checked })} /> TVA déductible
            </label>
          </div>
          {replacing && replacing.status === 'current' && (
            <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
              Le taux actuel ({Number(replacing.rate).toLocaleString('fr-FR')} %) s'arrêtera le {draft.validFrom ? d(dayBefore(draft.validFrom)) : '…'}.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="odoo-btn-secondary" onClick={() => setDraft(null)}>Annuler</button>
            <button className="odoo-btn-primary" disabled={add.isPending || !draft.code.trim() || !draft.label.trim() || draft.rate === '' || !draft.validFrom}
              onClick={() => add.mutate()}>
              {add.isPending ? 'Enregistrement…' : 'Enregistrer le taux'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
