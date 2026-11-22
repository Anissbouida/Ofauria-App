import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, Percent, CalendarClock, History, type LucideIcon } from 'lucide-react';
import { PageNote } from './SettingsPrimitives';
import { settingsApi, type TaxCode } from '../../api/settings.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { DataPanel, ErrorState, FormField, FormFooter, HeaderActions, SectionHeader, TableFooter, Toolbar } from '../../components/ds';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
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
const STATUS: Record<TaxCode['status'], { tone: StatusTone; icon?: LucideIcon; label: string }> = {
  current: { tone: 'done', label: 'En vigueur' },
  future: { tone: 'progress', icon: CalendarClock, label: 'À venir' },
  past: { tone: 'cancelled', icon: History, label: 'Historique' },
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
  const { data: codes = [], isLoading, error, refetch } = useQuery({ queryKey: ['tax-codes'], queryFn: settingsApi.taxCodes });

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
  const replacing = draft && existing.find(c => c.code === draft.code.trim().toUpperCase());

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12 }}>
      <PageNote help="Un taux ne se modifie pas : ajoutez le nouveau avec sa date d'effet, l'ancien s'arrête la veille. Les pièces déjà enregistrées gardent leur taux.">
        Taux datés : un nouveau taux remplace l'ancien à sa date d'effet.
      </PageNote>
      {!draft && canCreate('settings') && (
        <HeaderActions>
          <button type="button" className="odoo-btn-primary" onClick={() => newRateFor()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} aria-hidden="true" /> Nouveau taux
          </button>
        </HeaderActions>
      )}
      <Toolbar>
        <label htmlFor="tax-show-past" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input id="tax-show-past" type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} /> Afficher l'historique
        </label>
      </Toolbar>

      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <Loader2 className="animate-spin" size={16} /> : !codes.length ? (
        <StatusBanner tone="warning" icon={Percent} title="Aucun code TVA">La migration 331 n'est pas appliquée sur cette base.</StatusBanner>
      ) : (
        <DataPanel label="Codes TVA" footer={<TableFooter note={`${shown.length} taux affiché${shown.length > 1 ? 's' : ''} · ${codes.filter(c => c.status === 'current').length} en vigueur`} />}>
          <table className="odoo-table">
            <thead><tr><th>Code</th><th>Libellé</th><th className="ds-num">Taux (%)</th><th>Nature</th><th>Déductible</th><th>Du</th><th>Au</th><th>Statut</th><th>Référence</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.id} style={{ opacity: c.status === 'past' ? 0.6 : 1 }}>
                  <td className="ds-ref">{c.code}</td>
                  <td className="ds-strong">{c.label}</td>
                  <td className="ds-num">{Number(c.rate).toLocaleString('fr-FR')}</td>
                  <td>{KINDS.find(k => k[0] === c.kind)?.[1] ?? c.kind}</td>
                  <td>{c.recoverable ? 'Oui' : 'Non'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{d(c.valid_from)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{d(c.valid_to)}</td>
                  <td><StatusTag tone={STATUS[c.status].tone} icon={STATUS[c.status].icon} label={STATUS[c.status].label} /></td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--ds-muted)' }}>{c.legal_ref ?? ''}</td>
                  <td className="ds-actions">
                    {c.status !== 'past' && !draft && canCreate('settings') && (
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => newRateFor(c)}>Changer le taux</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}

      {draft && (
        <section className="ds-panel" style={{ padding: '16px 18px', display: 'grid', gap: 12 }} aria-label="Nouveau taux">
          <SectionHeader title={replacing ? `Nouveau taux pour ${replacing.code}` : 'Nouveau code TVA'} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ width: 120 }}>
              <FormField label="Code" htmlFor="tax-code" required>
              <input id="tax-code" className="ds-input" style={{ fontFamily: 'ui-monospace, monospace' }} value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })} maxLength={20} />
              </FormField>
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <FormField label="Libellé" htmlFor="tax-label" required>
              <input id="tax-label" className="ds-input" value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} maxLength={120} />
              </FormField>
            </div>
            <div style={{ width: 110 }}>
              <FormField label="Taux (%)" htmlFor="tax-rate" required>
              <input id="tax-rate" type="number" min={0} max={100} step="0.01" className="ds-input" value={draft.rate} onChange={e => setDraft({ ...draft, rate: e.target.value })} />
              </FormField>
            </div>
            <div style={{ width: 240 }}>
              <FormField label="Nature" htmlFor="tax-kind">
              <select id="tax-kind" className="ds-input" value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value })}>
                {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              </FormField>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ width: 170 }}>
              <FormField label="À partir du" htmlFor="tax-from" required>
              <input id="tax-from" type="date" className="ds-input" value={draft.validFrom} onChange={e => setDraft({ ...draft, validFrom: e.target.value })} />
              </FormField>
            </div>
            <div style={{ flex: '1 1 260px' }}>
              <FormField label="Référence légale" htmlFor="tax-ref">
              <input id="tax-ref" className="ds-input" value={draft.legalRef} onChange={e => setDraft({ ...draft, legalRef: e.target.value })} placeholder="CGI art. 98, LF 2026…" />
              </FormField>
            </div>
            <label htmlFor="tax-recoverable" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.875rem' }}>
              <input id="tax-recoverable" type="checkbox" checked={draft.recoverable} onChange={e => setDraft({ ...draft, recoverable: e.target.checked })} /> TVA déductible
            </label>
          </div>
          {replacing && replacing.status === 'current' && (
            <div style={{ fontSize: '0.8125rem', color: 'var(--ds-muted)' }}>
              Le taux actuel ({Number(replacing.rate).toLocaleString('fr-FR')} %) s'arrêtera le {draft.validFrom ? d(dayBefore(draft.validFrom)) : '…'}.
            </div>
          )}
          <FormFooter onCancel={() => setDraft(null)} busy={add.isPending} submitLabel="Enregistrer le taux"
            disabled={!draft.code.trim() || !draft.label.trim() || draft.rate === '' || !draft.validFrom} onSubmit={() => add.mutate()} />
        </section>
      )}
    </div>
  );
}
