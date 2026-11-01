import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { Loader2, ShieldCheck, ShieldAlert, Fingerprint, Copy, History, ScanSearch, Stamp } from 'lucide-react';
import SearchSelect from '../../components/ui/SearchSelect';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import {
  integrityApi, type IntegrityVerifyResult, type LedgerAuditEvent, type LedgerAuditRow,
} from '../../api/ledger.api';

const EVENT_LABEL: Record<LedgerAuditEvent, string> = {
  post: 'Validation',
  reverse: 'Extourne',
  draft_delete: 'Brouillon supprimé',
  letter: 'Lettrage',
  unletter: 'Délettrage',
  reletter: 'Relettrage',
  seal: 'Scellement',
  verify: 'Vérification',
  outbox_replay: 'Rejeu de la file',
};
const EVENT_TAG: Partial<Record<LedgerAuditEvent, string>> = {
  reverse: 'odoo-tag-orange', draft_delete: 'odoo-tag-orange', seal: 'odoo-tag-blue', verify: 'odoo-tag-blue',
};

const fmt = (v: unknown) =>
  v == null ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (h: string | null | undefined) => (h ? `${h.slice(0, 16)}…` : '—');
const PAGE = 50;

function copy(hash: string) {
  navigator.clipboard?.writeText(hash).then(
    () => notify.success('Empreinte copiée'),
    () => notify.error('Copie impossible'),
  );
}

/** Résumé lisible d'une action du journal d'audit. */
function detailOf(r: LedgerAuditRow): string {
  const d = (r.details ?? {}) as Record<string, any>;
  switch (r.event) {
    case 'post': return `${d.source_kind ?? ''} · ${fmt(d.total)} DH`;
    case 'reverse': return d.reversed_by_number ? `par ${d.reversed_by_number}` : '';
    case 'letter': case 'unletter': case 'reletter':
      return Number(d.debit) > 0 ? `débit ${fmt(d.debit)}` : `crédit ${fmt(d.credit)}`;
    case 'seal': return `${d.sealed} écriture(s) · tête n° ${d.head_seq}${d.initial ? ' (historique)' : d.auto ? ' (automatique)' : ''}`;
    case 'verify': return d.ok ? `Intact · ${d.checked} écriture(s)` : `${d.anomalies} anomalie(s) sur ${d.checked}`;
    case 'outbox_replay': return `${d.posted} comptabilisée(s), ${d.failed} en échec`;
    case 'draft_delete': return d.source_kind ?? '';
    default: return '';
  }
}

/**
 * Intégrité du grand livre (mig 413) : chaînage par empreinte SHA-256 des
 * écritures comptabilisées, état des triggers de garde, ancre de la dernière
 * clôture et journal des actions comptables.
 */
export default function IntegrityPanel() {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<IntegrityVerifyResult | null>(null);
  const [showLog, setShowLog] = useState(false);

  const { data: s, isLoading } = useQuery({ queryKey: ['ledger-integrity'], queryFn: integrityApi.status });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['ledger-integrity'] });
    queryClient.invalidateQueries({ queryKey: ['ledger-audit-log'] });
  };
  const verify = useMutation({
    mutationFn: integrityApi.verify,
    onSuccess: (r) => {
      setResult(r);
      refresh();
      if (r.ok) notify.success(`Grand livre intact : ${r.checked} écriture(s) vérifiée(s)`);
      else notify.error(`${r.anomalies.length} anomalie(s) détectée(s)`);
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Vérification impossible')),
  });
  const seal = useMutation({
    mutationFn: integrityApi.seal,
    onSuccess: (r) => { refresh(); notify.success(`${r.sealed} écriture(s) scellée(s)`); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Scellement impossible')),
  });

  if (isLoading || !s) {
    return <div style={{ padding: 12 }}><Loader2 size={16} className="animate-spin" /></div>;
  }

  const guardsOff = s.guards.filter(g => !g.enabled);
  // La vérification du moment prime ; sinon on s'en tient à la dernière tracée.
  const broken = result ? !result.ok : s.lastVerify ? !s.lastVerify.details.ok : false;
  const anomalyCount = result ? result.anomalies.length : s.lastVerify?.details.anomalies ?? 0;

  const tone = broken || guardsOff.length ? 'danger' : s.unsealed > 0 ? 'warning' : 'success';
  const title = broken ? `${anomalyCount} anomalie(s) dans le grand livre`
    : guardsOff.length ? `${guardsOff.length} protection(s) désactivée(s)`
    : s.unsealed > 0 ? `${s.unsealed} écriture(s) en attente de scellement`
    : 'Grand livre scellé';
  const lastVerifyBy = s.lastVerify
    ? [s.lastVerify.first_name, s.lastVerify.last_name].filter(Boolean).join(' ') || 'système'
    : null;

  return (
    <div style={{ marginBottom: 16 }}>
      <StatusBanner tone={tone} icon={tone === 'success' ? ShieldCheck : ShieldAlert} title={title}
        actions={(
          <div style={{ display: 'inline-flex', gap: 6 }}>
            <button className="odoo-btn-primary" disabled={verify.isPending} onClick={() => verify.mutate()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {verify.isPending ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />} Vérifier
            </button>
            {s.unsealed > 0 && (
              <button className="odoo-btn-secondary" disabled={seal.isPending} onClick={() => seal.mutate()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {seal.isPending ? <Loader2 size={12} className="animate-spin" /> : <Stamp size={12} />} Sceller
              </button>
            )}
            <button className="odoo-btn-secondary" onClick={() => setShowLog(v => !v)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <History size={12} /> {showLog ? 'Masquer le journal' : 'Journal des actions'}
            </button>
          </div>
        )}>
        <span>
          {s.sealed} écriture(s) chaînée(s) par empreinte SHA-256 · tête n° {s.headSeq}{' '}
          {s.headHash && (
            <button type="button" className="odoo-btn-secondary" onClick={() => copy(s.headHash!)} title={`${s.headHash} — cliquer pour copier`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'ui-monospace, monospace', fontSize: '0.6875rem', padding: '1px 6px' }}>
              <Fingerprint size={11} /> {short(s.headHash)} <Copy size={10} />
            </button>
          )}
        </span>
        <br />
        <span style={{ fontSize: '0.75rem' }}>
          {s.lastVerify
            ? `Dernière vérification le ${new Date(s.lastVerify.at).toLocaleString('fr-FR')} par ${lastVerifyBy} : ${s.lastVerify.details.ok ? 'intact' : `${s.lastVerify.details.anomalies} anomalie(s)`}.`
            : 'Jamais vérifié.'}
          {s.lastAnchor && ` Dernière ancre : ${s.lastAnchor.to_status === 'locked' ? 'verrouillage' : 'clôture'} ${String(s.lastAnchor.month).padStart(2, '0')}/${s.lastAnchor.year}, n° ${s.lastAnchor.chain_seq}, ${short(s.lastAnchor.chain_hash)}.`}
          {s.unsealed > 0 && ' Les nouvelles écritures sont scellées automatiquement toutes les 15 minutes et à chaque clôture.'}
        </span>
      </StatusBanner>

      {guardsOff.length > 0 && (
        <table className="odoo-table" style={{ margin: '8px 0 0' }}>
          <thead><tr><th>Protection</th><th style={{ width: 260 }}>Trigger</th><th style={{ width: 110 }}>État</th></tr></thead>
          <tbody>
            {guardsOff.map(g => (
              <tr key={`${g.table}.${g.trigger}`}>
                <td>{g.role}</td>
                <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{g.table}.{g.trigger}</td>
                <td><span className="odoo-tag odoo-tag-red">{g.missing ? 'Supprimé' : 'Désactivé'}</span></td>
              </tr>
            ))}
            <tr><td colSpan={3} style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              Un trigger désactivé ne bloque plus les retouches : seule la vérification de la chaîne les révèle ensuite.
              Réactivez-le en base (ALTER TABLE … ENABLE TRIGGER …).
            </td></tr>
          </tbody>
        </table>
      )}

      {result && result.anomalies.length > 0 && (
        <table className="odoo-table" style={{ margin: '8px 0 0' }}>
          <thead><tr><th style={{ width: 90, textAlign: 'right' }}>Rang</th><th style={{ width: 160 }}>Écriture</th><th>Anomalie</th></tr></thead>
          <tbody>
            {result.anomalies.map((a, i) => (
              <tr key={`${a.seq}-${i}`}>
                <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{a.seq}</td>
                <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{a.entry_no ?? '—'}</td>
                <td style={{ color: '#721c24' }}>{a.problem}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showLog && <AuditLog />}
    </div>
  );
}

/** Journal ajout seul des actions comptables, du plus récent au plus ancien. */
function AuditLog() {
  const [event, setEvent] = useState<LedgerAuditEvent | ''>('');
  const q = useInfiniteQuery({
    queryKey: ['ledger-audit-log', event],
    queryFn: ({ pageParam }) => integrityApi.auditLog({ event: event || undefined, before: pageParam, limit: PAGE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];

  return (
    <div className="odoo-section" style={{ marginTop: 8, padding: 0 }}>
      <div className="odoo-search-panel" style={{ gap: 6 }}>
        <SearchSelect
          options={(Object.keys(EVENT_LABEL) as LedgerAuditEvent[]).map(k => ({ id: k, label: EVENT_LABEL[k] }))}
          value={event}
          onChange={id => setEvent(id as LedgerAuditEvent | '')}
          placeholder="Toutes les actions"
          width={200}
        />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Journal en ajout seul : aucune ligne ne peut être modifiée ni supprimée.</span>
      </div>
      {q.isLoading ? (
        <div style={{ padding: 12 }}><Loader2 size={16} className="animate-spin" /></div>
      ) : (
        <table className="odoo-table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 150 }}>Date</th>
              <th style={{ width: 140 }}>Action</th>
              <th style={{ width: 150 }}>Écriture</th>
              <th>Détail</th>
              <th style={{ width: 160 }}>Auteur</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--theme-text-muted)' }}>Aucune action tracée.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ fontSize: '0.75rem' }}>{new Date(r.at).toLocaleString('fr-FR')}</td>
                <td><span className={`odoo-tag ${EVENT_TAG[r.event] ?? 'odoo-tag-grey'}`}>{EVENT_LABEL[r.event] ?? r.event}</span></td>
                <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{r.entry_number ?? '—'}</td>
                <td style={{ fontSize: '0.75rem' }}>{detailOf(r)}</td>
                <td style={{ fontSize: '0.75rem' }} title={r.client_ip ?? undefined}>
                  {[r.first_name, r.last_name].filter(Boolean).join(' ') || <span style={{ color: 'var(--theme-text-muted)' }}>Système</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {q.hasNextPage && (
        <div style={{ padding: 8, textAlign: 'center' }}>
          <button className="odoo-btn-secondary" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            {q.isFetchingNextPage ? <Loader2 size={12} className="animate-spin" /> : 'Afficher plus'}
          </button>
        </div>
      )}
    </div>
  );
}
