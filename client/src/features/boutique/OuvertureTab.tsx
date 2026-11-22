import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, Loader2, XCircle, ArrowRight, X } from 'lucide-react';
import { ROLE_GROUPS } from '@ofauria/shared';
import { openingInventoryCheckApi, type OpeningCheckPendingResponse } from '../../api/opening-inventory-check.api';
import { useAuth } from '../../context/AuthContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { EmptyRow, Loading, inputStyle, muted, toNum } from './shared';
import { DataPanel, LoadingState, SectionHeader } from '../../components/ds';

/**
 * Ouverture (ex-écran /inventory-check/validation) : la caissière compte la
 * vitrine avant d'ouvrir la caisse (/inventory-check/opening, inchangé) ; un
 * écart part en validation chez le gérant, qui approuve ou rejette ici.
 */

const REASON_LABELS: Record<string, string> = {
  theft: 'Vol',
  breakage: 'Casse',
  forgotten_recycle: 'Recyclage oublié',
  undeclared_loss: 'Perte non déclarée',
  measurement_error: 'Erreur de comptage',
  other: 'Autre',
};

const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}`;
const ecartColor = (v: number) => (v < 0 ? 'var(--ds-danger)' : v > 0 ? 'var(--ds-warning)' : 'var(--ds-ink)');

type Existing = OpeningCheckPendingResponse['existingCheck'];

/** Situation du comptage d'ouverture du jour, partagée avec la frise. */
export function useOpeningToday(enabled: boolean) {
  return useQuery({
    queryKey: ['opening-check-pending'],
    queryFn: () => openingInventoryCheckApi.getPending(),
    enabled,
  });
}

export function openingStatus(existing: Existing | undefined): { label: string; tone: 'success' | 'orange' | 'danger' | 'neutral' } {
  switch (existing?.status) {
    case 'validated': return { label: 'Validé', tone: 'success' };
    case 'awaiting_validation': return { label: 'Écart à valider', tone: 'orange' };
    case 'rejected': return { label: 'Rejeté, à recompter', tone: 'danger' };
    default: return { label: 'Comptage à faire', tone: 'neutral' };
  }
}

export default function OuvertureTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = user?.role as string | undefined;
  const canCount = !!role && (ROLE_GROUPS.CASH as string[]).includes(role);
  const canValidate = !!role && (ROLE_GROUPS.ADMIN_MANAGER as string[]).includes(role);

  const { data: today, isLoading } = useOpeningToday(canCount);
  const existing = today?.existingCheck ?? null;
  const st = openingStatus(existing);

  return (
    <>
      {canCount && (isLoading ? <Loading /> : (
        <StatusBanner
          tone={st.tone}
          icon={st.tone === 'success' ? CheckCircle2 : st.tone === 'danger' ? XCircle : st.tone === 'orange' ? Clock : ClipboardCheck}
          title={`Comptage d'ouverture du jour : ${st.label.toLowerCase()}`}
          actions={(!existing || existing.status === 'rejected') && (
            <button type="button" className="odoo-btn-primary" onClick={() => navigate('/inventory-check/opening')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Compter la vitrine <ArrowRight size={12} />
            </button>
          )}>
          {existing?.status === 'validated' && existing.validated_at
            ? `Validé le ${format(new Date(existing.validated_at), "dd/MM 'à' HH:mm")}. La caisse peut être ouverte.`
            : existing?.status === 'awaiting_validation'
              ? 'Un écart a été constaté : la caisse reste bloquée jusqu\'à la validation du gérant.'
              : existing?.status === 'rejected'
                ? `Motif du rejet : ${existing.rejection_reason || '—'}. Recomptez la vitrine.`
                : `${today?.items.length ?? 0} produit(s) attendus en vitrine depuis la dernière clôture. La caisse s'ouvre après le comptage.`}
        </StatusBanner>
      ))}
      {canValidate && <ValidationQueue />}
    </>
  );
}

/* ═══════════════════════ FILE DE VALIDATION (gérant) ═══════════════════════ */

function ValidationQueue() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejection, setRejection] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data: pending = [], isLoading } = useQuery<Array<Record<string, any>>>({
    queryKey: ['opening-checks-awaiting'],
    queryFn: () => openingInventoryCheckApi.listAwaitingValidation(),
  });
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['opening-check-detail', selectedId],
    queryFn: () => openingInventoryCheckApi.getById(selectedId!),
    enabled: !!selectedId,
  });

  const validate = useMutation({
    mutationFn: (v: { action: 'approve' | 'reject' }) =>
      openingInventoryCheckApi.validate(selectedId!, { action: v.action, rejectionReason: v.action === 'reject' ? rejection : undefined }),
    onSuccess: (_d, v) => {
      ['opening-checks-awaiting', 'opening-check-pending'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
      setSelectedId(null);
      setRejection('');
      setMsg({ type: 'success', text: v.action === 'approve' ? 'Comptage validé : la caisse est débloquée.' : 'Comptage rejeté : la caissière doit recompter.' });
    },
    onError: (err: unknown) => setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Erreur' }),
  });

  const reject = () => {
    if (!rejection.trim()) { setMsg({ type: 'error', text: 'Indiquez le motif du rejet.' }); return; }
    validate.mutate({ action: 'reject' });
  };

  const items: Array<Record<string, any>> = detail?.items ?? [];
  const selected = pending.find(c => c.id === selectedId);

  return (
    <>
      <SectionHeader title="Écarts d'ouverture à valider" />
      {msg && (
        <StatusBanner tone={msg.type === 'error' ? 'danger' : 'success'} icon={msg.type === 'error' ? AlertTriangle : CheckCircle2}
          title={msg.type === 'error' ? 'Action impossible' : 'Enregistré'}>{msg.text}</StatusBanner>
      )}
      <DataPanel>
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Soumis le</th>
              <th>Caissière</th>
              <th className="ds-num">Lignes en écart</th>
              <th className="ds-num">Écart total</th>
              <th className="ds-actions">Prochaine action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5}><LoadingState bare /></td></tr>}
            {!isLoading && pending.length === 0 && <EmptyRow colSpan={5}>Aucun comptage en attente de validation.</EmptyRow>}
            {pending.map(c => {
              const total = toNum(c.total_discrepancy);
              const active = c.id === selectedId;
              return (
                <tr key={c.id} className={active ? 'ds-selected' : undefined}>
                  <td>{format(new Date(c.created_at), "EEE dd MMM 'à' HH:mm", { locale: fr })}</td>
                  <td className="ds-strong">{c.checked_by_first} {c.checked_by_last}</td>
                  <td className="ds-num">{c.discrepancy_lines}</td>
                  <td className="ds-num" style={{ fontWeight: 600, color: ecartColor(total) }}>{signed(total)}</td>
                  <td className="ds-actions">
                    <button type="button" className="odoo-btn-secondary ds-btn-sm" aria-expanded={active}
                      onClick={() => { setSelectedId(active ? null : c.id); setRejection(''); setMsg(null); }}>
                      {active ? 'Fermer' : 'Examiner'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DataPanel>

      {selectedId && (
        <div className="odoo-section" style={{ margin: 0 }}>
          <div className="odoo-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Détail du comptage{selected ? ` · ${selected.checked_by_first} ${selected.checked_by_last}` : ''}</span>
            <button type="button" className="odoo-pager-btn" onClick={() => setSelectedId(null)} aria-label="Fermer le détail"><X size={14} aria-hidden="true" /></button>
          </div>
          {detailLoading ? <Loading /> : (
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <DataPanel>
                <table className="odoo-table">
                  <thead>
                    <tr>
                      <th>Produit</th>
                      <th className="ds-num">Attendu</th>
                      <th className="ds-num">Compté</th>
                      <th className="ds-num">Écart</th>
                      <th>Motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...items].sort((a, b) => Math.abs(toNum(b.discrepancy)) - Math.abs(toNum(a.discrepancy))).map(it => {
                      const e = toNum(it.discrepancy);
                      return (
                        <tr key={it.id} style={{ opacity: e === 0 ? 0.6 : 1 }}>
                          <td style={{ fontWeight: e !== 0 ? 600 : 400 }}>{it.product_name}</td>
                          <td className="ds-num">{it.expected_qty}</td>
                          <td className="ds-num">{it.found_qty}</td>
                          <td className="ds-num" style={{ fontWeight: 600, color: ecartColor(e) }}>{e === 0 ? '—' : signed(e)}</td>
                          <td>{it.missing_reason ? REASON_LABELS[it.missing_reason] ?? it.missing_reason : <span style={muted}>—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </DataPanel>
              {detail?.notes && <div style={{ fontSize: 14 }}><strong>Note de la caissière :</strong> {detail.notes}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <input type="text" value={rejection} onChange={e => setRejection(e.target.value)} aria-label="Motif du rejet"
                  placeholder="Motif du rejet (obligatoire pour rejeter)" style={{ ...inputStyle, flex: '1 1 260px' }} />
                <button type="button" className="ds-btn-danger" onClick={reject} disabled={validate.isPending}>
                  <XCircle size={13} aria-hidden="true" /> Rejeter
                </button>
                <button type="button" className="odoo-btn-primary" onClick={() => validate.mutate({ action: 'approve' })} disabled={validate.isPending}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {validate.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Approuver
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <p className="klc-note">Convention : un écart négatif est un manque.</p>
    </>
  );
}
