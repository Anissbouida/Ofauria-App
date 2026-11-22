import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, X, ClipboardCheck, CheckCircle2, XCircle, Thermometer } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { controleApi, type ReceptionCheckRow } from '../../api/controle.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { PeriodFilter, PAGE_SIZE, periodParams, periodLabel, type PeriodKey, type StageDef } from '../../components/purchasing/ProcessBoard';
import { ListToolbar, ListEmpty } from '../sales/ListTemplate';
import { StageChips, Panel, PagerFoot, PageLoading } from './KlUi';
import { Breadcrumb, FormField, FormFooter, NoResultState } from '../../components/ds';

/**
 * Contrôles à réception : un bon de réception = un contrôle (température, aspect,
 * emballage, étiquetage / DLC, verdict). La saisie existait côté serveur
 * (reception_quality_checks, mig 056) mais aucun écran ne la proposait : la
 * conformité du registre des entrées restait vide.
 */

type Status = ReceptionCheckRow['check_status'];
const STATUSES: Array<StageDef & { key: Status }> = [
  { key: 'a_controler', label: 'À contrôler', hint: 'aucun contrôle saisi', icon: ClipboardCheck },
  { key: 'non_conforme', label: 'Non conformes', hint: 'à traiter avec le fournisseur', icon: XCircle },
  { key: 'conforme', label: 'Conformes', hint: 'contrôle validé', icon: CheckCircle2 },
];
/** Statut du contrôle en étiquette commune : à contrôler = action attendue. */
const STATUS_TAG: Record<Status, { tone: StatusTone; label: string }> = {
  a_controler: { tone: 'todo', label: 'À contrôler' }, non_conforme: { tone: 'blocked', label: 'Non conforme' }, conforme: { tone: 'done', label: 'Conforme' },
};

export default function ReceptionChecks() {
  const [status, setStatus] = useState<Status | ''>('');
  const [period, setPeriod] = useState<PeriodKey>('3m');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [checking, setChecking] = useState<ReceptionCheckRow | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [status, period, customFrom, customTo, search]);

  const params = useMemo(() => {
    const p: Record<string, string> = { ...periodParams(period, customFrom, customTo), page: String(page), pageSize: String(PAGE_SIZE) };
    if (status) p.status = status;
    if (search) p.search = search;
    return p;
  }, [status, period, customFrom, customTo, search, page]);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['controle-receptions', params], queryFn: () => controleApi.receptions(params), placeholderData: prev => prev,
  });
  const counts = data?.counts ?? {};
  const rows = data?.rows ?? [];
  const text = periodLabel(period, customFrom, customTo);

  return (
    <>
      {(counts.a_controler ?? 0) > 0 && status !== 'a_controler' && (
        <StatusBanner tone="warning" icon={ClipboardCheck}
          title={`${counts.a_controler} réception${counts.a_controler > 1 ? 's' : ''} sans contrôle`}
          actions={<button type="button" className="odoo-btn-secondary" onClick={() => setStatus('a_controler')}>Les afficher</button>}>
          Le contrôle à réception (température, aspect, emballage, étiquetage) est la première preuve HACCP de la marchandise entrée.
        </StatusBanner>
      )}


      <StageChips
        title="Contrôles à réception"
        summary={`${(counts.a_controler ?? 0) + (counts.non_conforme ?? 0) + (counts.conforme ?? 0)} réceptions · ${text}`}
        stages={STATUSES}
        stats={{
          a_controler: { count: counts.a_controler ?? 0, sub: '', late: counts.a_controler ?? 0, alertLabel: 'à contrôler' },
          non_conforme: { count: counts.non_conforme ?? 0, sub: '' },
          conforme: { count: counts.conforme ?? 0, sub: '' },
        }}
        isActive={k => status === k}
        onPick={k => setStatus(status === k ? '' : (k as Status))}
      />


      <ListToolbar search={searchInput} onSearch={setSearchInput} placeholder="Rechercher un bon, un fournisseur, un BC...">
        {isFetching && !isLoading && <Loader2 className="animate-spin" size={13} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />}
        <PeriodFilter label="Reçu" title="Date de réception"
          period={period} onPeriod={setPeriod} from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        {(status || search || period !== '3m') && (
          <button type="button" onClick={() => { setStatus(''); setSearchInput(''); setSearch(''); setPeriod('3m'); }} className="ds-btn-ghost ds-btn-sm">
            <X size={12} aria-hidden="true" /> Effacer les filtres
          </button>
        )}
      </ListToolbar>

      {isLoading ? <PageLoading /> : rows.length === 0 ? (
        (status || search || period !== '3m')
          ? <NoResultState text="Aucune réception ne correspond aux filtres." onReset={() => { setStatus(''); setSearchInput(''); setSearch(''); setPeriod('3m'); }} />
          : <ListEmpty icon={ClipboardCheck} title="Aucune réception sur la période" text="Les bons de réception à contrôler s'affichent ici dès qu'une livraison est enregistrée." />
      ) : (
        <Panel style={{ opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}
          footer={<PagerFoot page={page} total={data?.total ?? 0} onPage={setPage} note={`Réceptions · ${text}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Bon de réception</th>
                <th>Fournisseur</th>
                <th>Reçu le</th>
                <th className="ds-num">Lignes</th>
                <th>Contrôle</th>
                <th className="ds-actions">Prochaine action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>
                    <span className="ds-ref">{r.voucher_number}</span>
                    {r.order_number && <div className="ds-ref" style={{ fontSize: 12, fontWeight: 400, color: 'var(--ds-muted)' }}>{r.order_number}</div>}
                  </td>
                  <td className="ds-strong">{r.supplier_name ?? '—'}</td>
                  <td style={{ color: 'var(--ds-muted)' }}>
                    {format(new Date(r.reception_date), 'd MMM yyyy', { locale: fr })}
                    {r.received_by_name && <div style={{ fontSize: 12 }}>par {r.received_by_name}</div>}
                  </td>
                  <td className="ds-num">{r.line_count}</td>
                  <td>
                    <StatusTag tone={STATUS_TAG[r.check_status].tone} label={STATUS_TAG[r.check_status].label} />
                    {r.check_id && (
                      <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>
                        {r.temperature_value != null && <>{Number(r.temperature_value).toLocaleString('fr-FR')} °C · </>}
                        {r.checked_by_name ?? ''}{r.checked_at ? ` · ${format(new Date(r.checked_at), 'dd/MM HH:mm')}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="ds-actions">
                    <button type="button" onClick={() => setChecking(r)} className="odoo-btn-secondary ds-btn-sm">
                      {r.check_status === 'a_controler' ? 'Contrôler' : 'Modifier le contrôle'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {checking && <ReceptionCheckModal row={checking} onClose={() => setChecking(null)} />}
    </>
  );
}

/** Saisie du contrôle d'un bon de réception : chaque critère oui / non, verdict proposé automatiquement. */
function ReceptionCheckModal({ row, onClose }: { row: ReceptionCheckRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [temperatureOk, setTemperatureOk] = useState<boolean | null>(row.temperature_ok);
  const [temperatureValue, setTemperatureValue] = useState(row.temperature_value != null ? String(Number(row.temperature_value)) : '');
  const [visualOk, setVisualOk] = useState(row.visual_ok ?? true);
  const [packagingOk, setPackagingOk] = useState(row.packaging_ok ?? true);
  const [labelsOk, setLabelsOk] = useState(row.labels_ok ?? true);
  const [notes, setNotes] = useState(row.check_notes ?? '');
  // Verdict : conforme seulement si tous les critères renseignés sont bons (la température est facultative : produits secs).
  const autoConform = visualOk && packagingOk && labelsOk && temperatureOk !== false;
  const [overall, setOverall] = useState<boolean>(row.overall_conformity ?? autoConform);
  const [overallTouched, setOverallTouched] = useState(row.check_id != null);
  useEffect(() => { if (!overallTouched) setOverall(autoConform); }, [autoConform, overallTouched]);

  const save = useMutation({
    mutationFn: () => controleApi.saveReceptionCheck(row.id, {
      temperatureOk, temperatureValue: temperatureValue.trim() === '' ? null : Number(temperatureValue.replace(',', '.')),
      visualOk, packagingOk, labelsOk, overallConformity: overall, notes: notes.trim() || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['controle-receptions'] });
      queryClient.invalidateQueries({ queryKey: ['controle-overview'] });
      queryClient.invalidateQueries({ queryKey: ['goods-entry-register-board'] });
      notify.success(`Contrôle de ${row.voucher_number} enregistré : ${overall ? 'conforme' : 'non conforme'}`);
      onClose();
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Enregistrement impossible')),
  });

  const Crit = ({ label, value, onChange, optional }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void; optional?: boolean }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--odoo-border)' }}>
      <span style={{ fontSize: 14, color: 'var(--ds-ink)' }}>{label}</span>
      <span className="odoo-view-switcher" role="radiogroup" aria-label={label}>
        {([[true, 'Conforme'], [false, 'Non conforme'], ...(optional ? [[null, 'Sans objet']] as const : [])] as const).map(([v, l]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
            style={{
              padding: '0.3rem 0.65rem', fontSize: '0.75rem',
              background: value === v ? (v === false ? 'color-mix(in srgb, var(--ds-danger) 12%, transparent)' : 'var(--odoo-purple-light)') : 'transparent',
              color: value === v ? (v === false ? 'var(--ds-danger)' : 'var(--odoo-purple)') : 'var(--ds-muted)',
              fontWeight: value === v ? 600 : 400,
            }}>
            {l}
          </button>
        ))}
      </span>
    </div>
  );

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" role="dialog" aria-label="Contrôle à réception" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', borderRadius: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <Breadcrumb icon={ClipboardCheck} items={[{ label: 'Contrôle à réception' }, { label: <span className="ds-ref">{row.voucher_number}</span> }]} />
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="ds-icon-btn" aria-label="Fermer"><X size={16} aria-hidden="true" /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--ds-muted)', marginBottom: 6 }}>
            {row.supplier_name ?? 'Fournisseur inconnu'} · reçu le {format(new Date(row.reception_date), 'd MMM yyyy', { locale: fr })} · {row.line_count} ligne{row.line_count > 1 ? 's' : ''}
          </div>
          <Crit label="Température de livraison" value={temperatureOk} onChange={setTemperatureOk} optional />
          {temperatureOk !== null && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', padding: '8px 0', borderBottom: '1px solid var(--odoo-border)' }}>
              <Thermometer size={14} style={{ color: 'var(--ds-muted)' }} /> Température relevée
              <input type="number" step="0.1" value={temperatureValue} onChange={e => setTemperatureValue(e.target.value)}
                className="odoo-filter-dropdown" style={{ width: 90, textAlign: 'right' }} aria-label="Température en degrés" /> °C
            </label>
          )}
          <Crit label="Aspect visuel (couleur, odeur, intégrité)" value={visualOk} onChange={v => setVisualOk(v !== false)} />
          <Crit label="Emballage intact" value={packagingOk} onChange={v => setPackagingOk(v !== false)} />
          <Crit label="Étiquetage, lot et DLC lisibles" value={labelsOk} onChange={v => setLabelsOk(v !== false)} />
          <div style={{ marginTop: 10 }}>
            <FormField label="Observations" htmlFor="rc-notes" required={!overall}
              hint={overall ? 'Facultatif' : undefined}
              error={!overall && !notes.trim() ? 'Décrivez la non-conformité constatée.' : undefined}>
              <textarea id="rc-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="ds-input" />
            </FormField>
          </div>
          <div style={{ marginTop: 10 }}>
            <StatusBanner tone={overall ? 'success' : 'danger'} icon={overall ? CheckCircle2 : XCircle}
              title={overall ? 'Verdict : conforme' : 'Verdict : non conforme'}
              actions={<button type="button" className="odoo-btn-secondary" onClick={() => { setOverall(!overall); setOverallTouched(true); }}>
                {overall ? 'Déclarer non conforme' : 'Déclarer conforme'}
              </button>}>
              {overallTouched ? 'Verdict choisi manuellement.' : 'Proposé d\'après les critères ci-dessus.'}
            </StatusBanner>
          </div>
        </div>
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--ds-card)' }}>
          <FormFooter onCancel={onClose} onSubmit={() => save.mutate()} submitLabel="Enregistrer le contrôle"
            busy={save.isPending} disabled={!overall && !notes.trim()} />
        </div>
      </div>
    </ModalBackdrop>
  );
}
