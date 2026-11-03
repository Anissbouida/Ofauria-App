import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, FileArchive, FileCode2, AlertTriangle, XCircle, Info, CheckCircle2 } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { ediApi } from '../../api/ledger.api';
import type { Liasse, LiasseModel, EdiIssue } from '../../api/ledger.api';

/**
 * Télédéclarations EDI (lot Bonus 14) : fichiers à téléverser sur le portail
 * SIMPL de la DGI (menu « Envoi de fichiers EDI », profil Rédacteur). Un
 * fichier accepté charge une déclaration brouillon, à valider et déposer sur
 * le portail.
 */

const n = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
const mono = { fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MP: Record<number, string> = { 1: 'Espèces', 2: 'Chèque', 3: 'Prélèvement', 4: 'Virement', 5: 'Effet', 6: 'Compensation', 7: 'Autres' };

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="odoo-section" style={{ padding: 0 }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--theme-bg-separator)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: 'var(--theme-bg-secondary)' }}>
        <strong style={{ fontSize: '0.8125rem', flex: 1 }}>{title}</strong>{aside}
      </div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  );
}

function Issues({ issues }: { issues: EdiIssue[] }) {
  const errors = issues.filter(i => i.level === 'error'), warnings = issues.filter(i => i.level === 'warning');
  if (!issues.length) return <StatusBanner tone="success" icon={CheckCircle2} title="Aucune anomalie détectée">Le fichier peut être téléversé.</StatusBanner>;
  return (
    <>
      {errors.length > 0 && (
        <StatusBanner tone="danger" icon={XCircle} title={`${errors.length} anomalie(s) qui feront rejeter le fichier`}>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
        </StatusBanner>
      )}
      {warnings.length > 0 && (
        <StatusBanner tone="warning" icon={AlertTriangle} title="À vérifier">
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{warnings.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
        </StatusBanner>
      )}
    </>
  );
}

function Download({ run, disabled }: { run: (f: 'zip' | 'xml') => Promise<void>; disabled?: boolean }) {
  const [busy, setBusy] = useState<'zip' | 'xml' | null>(null);
  const go = async (f: 'zip' | 'xml') => {
    setBusy(f);
    try { await run(f); } catch (e) { notify.error(e instanceof Error ? e.message : 'Fichier impossible'); } finally { setBusy(null); }
  };
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button type="button" className="odoo-btn-primary" disabled={disabled || !!busy} onClick={() => go('zip')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        title="Fichier à téléverser sur le portail SIMPL">
        {busy === 'zip' ? <Loader2 size={13} className="animate-spin" /> : <FileArchive size={13} />} ZIP à déposer
      </button>
      <button type="button" className="odoo-btn-secondary" disabled={disabled || !!busy} onClick={() => go('xml')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        title="XML non compressé, pour contrôle">
        {busy === 'xml' ? <Loader2 size={13} className="animate-spin" /> : <FileCode2 size={13} />} XML
      </button>
    </span>
  );
}

export default function LiasseEdiPanel({ year, model }: { year: number; model: LiasseModel; liasse: Liasse }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <StatusBanner tone="info" icon={Info} title="Dépôt sur le portail SIMPL de la DGI">
        Téléversez le ZIP dans « Envoi de fichiers EDI » (profil Rédacteur). Un fichier accepté charge la déclaration en brouillon : contrôlez-la, puis validez et déposez-la sur le portail.
      </StatusBanner>
      <LiasseIs year={year} model={model} />
      <VatDeductions year={year} />
      <Ir9421 year={year} />
    </div>
  );
}

function LiasseIs({ year, model }: { year: number; model: LiasseModel }) {
  const { data: s, isLoading } = useQuery({ queryKey: ['edi-liasse', year, model], queryFn: () => ediApi.liasse(year, model) });
  return (
    <Section title={`Liasse fiscale IS ${year} — modèle ${model === 'simplifie' ? 'simplifié' : 'normal'} (Simpl-IS)`} aside={<Download run={f => ediApi.downloadLiasse(year, model, f)} />}>
      <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        Cellules codées selon la codification officielle de la DGI (annexes EDI Simpl-IS 2026). Le modèle suit le sélecteur en haut de la liasse. À déposer avec la déclaration du résultat fiscal, dans les trois mois suivant la clôture.
      </div>
      {isLoading || !s ? <Loader2 size={16} className="animate-spin" /> : (
        <>
          <Issues issues={s.issues} />
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table" style={{ width: '100%' }}>
              <thead>
                <tr><th style={{ width: 90 }}>Tableau DGI</th><th>Intitulé</th><th style={{ textAlign: 'right' }}>Cellules</th></tr>
              </thead>
              <tbody>
                {s.tables.map(t => (
                  <tr key={t.id}>
                    <td style={mono}>{t.id}</td><td>{t.label}</td><td style={{ ...mono, textAlign: 'right' }}>{t.cells}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, background: 'var(--theme-bg-secondary)' }}>
                  <td colSpan={2}>Total actif {n(s.totals.actif)} · passif {n(s.totals.passif)} · résultat net {n(s.totals.result)} · résultat fiscal {n(s.totals.taxable_result)}</td>
                  <td style={{ ...mono, textAlign: 'right' }}>{s.tables.reduce((a, t) => a + t.cells, 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

function VatDeductions({ year }: { year: number }) {
  const [regime, setRegime] = useState<1 | 2>(1);
  const [period, setPeriod] = useState(1);
  const { data: s, isLoading } = useQuery({ queryKey: ['edi-tva', year, regime, period], queryFn: () => ediApi.vatDeductions(year, period, regime) });
  return (
    <Section title="Relevé des déductions de TVA (Simpl-TVA)" aside={
      <>
        <select value={regime} onChange={e => { setRegime(Number(e.target.value) as 1 | 2); setPeriod(1); }} className="odoo-search-input" aria-label="Régime">
          <option value={1}>Mensuel</option><option value={2}>Trimestriel</option>
        </select>
        <select value={period} onChange={e => setPeriod(Number(e.target.value))} className="odoo-search-input" aria-label="Période">
          {(regime === 1 ? MONTHS : ['1er trimestre', '2e trimestre', '3e trimestre', '4e trimestre']).map((m, i) => <option key={m} value={i + 1}>{m} {year}</option>)}
        </select>
        <Download disabled={!s?.lines.length} run={f => ediApi.downloadVatDeductions(year, period, regime, f)} />
      </>
    }>
      <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        Factures fournisseurs dont le droit à déduction est né sur la période (date du règlement qui les solde). Créez d'abord le brouillon de la déclaration de la période sur Simpl-TVA : sans lui, le fichier est rejeté.
      </div>
      {isLoading || !s ? <Loader2 size={16} className="animate-spin" /> : (
        <>
          <Issues issues={s.issues} />
          {s.lines.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>N°</th><th>Facture</th><th>Fournisseur</th><th style={{ textAlign: 'right' }}>Taux</th>
                    <th style={{ textAlign: 'right' }}>HT</th><th style={{ textAlign: 'right' }}>TVA</th><th style={{ textAlign: 'right' }}>TTC</th>
                    <th>Paiement</th>
                  </tr>
                </thead>
                <tbody>
                  {s.lines.map(l => (
                    <tr key={`${l.ord}`}>
                      <td style={mono}>{l.ord}</td>
                      <td><span style={mono}>{l.num}</span><div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>du {fmtDate(l.dfac)}</div></td>
                      <td>{l.supplier}<div style={{ fontSize: '0.6875rem', color: l.if || l.ice ? 'var(--theme-text-muted)' : '#c62828', ...mono }}>
                        {l.if || l.ice ? [l.if && `IF ${l.if}`, l.ice && `ICE ${l.ice}`].filter(Boolean).join(' · ') : 'ni IF ni ICE'}
                      </div></td>
                      <td style={{ ...mono, textAlign: 'right' }}>{l.tx} %</td>
                      <td style={{ ...mono, textAlign: 'right' }}>{n(l.mht)}</td>
                      <td style={{ ...mono, textAlign: 'right' }}>{n(l.tva)}</td>
                      <td style={{ ...mono, textAlign: 'right' }}>{n(l.ttc)}</td>
                      <td>{MP[l.mp]}<div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>le {fmtDate(l.dpai)}</div></td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700, background: 'var(--theme-bg-secondary)' }}>
                    <td colSpan={4}>Total ({s.lines.length} ligne{s.lines.length > 1 ? 's' : ''})</td>
                    <td style={{ ...mono, textAlign: 'right' }}>{n(s.totals.ht)}</td>
                    <td style={{ ...mono, textAlign: 'right' }}>{n(s.totals.tva)}</td>
                    <td style={{ ...mono, textAlign: 'right' }}>{n(s.totals.ttc)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function Ir9421({ year }: { year: number }) {
  const { data: s, isLoading } = useQuery({ queryKey: ['edi-9421', year], queryFn: () => ediApi.ir9421(year) });
  return (
    <Section title={`État 9421 — traitements et salaires ${year} (Simpl-IR)`} aside={<Download disabled={!s?.staff.length} run={f => ediApi.download9421(year, f)} />}>
      <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        Déclaration annuelle des salaires versés et de l'IR retenu, à déposer avant fin février {year + 1}. Montants repris des bulletins déclarés de l'exercice.
      </div>
      {isLoading || !s ? <Loader2 size={16} className="animate-spin" /> : (
        <>
          <Issues issues={s.issues} />
          {s.staff.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Salarié</th><th style={{ textAlign: 'right' }}>Jours</th><th style={{ textAlign: 'right' }}>Brut</th>
                    <th style={{ textAlign: 'right' }}>Brut imposable</th><th style={{ textAlign: 'right' }}>Déductions</th>
                    <th style={{ textAlign: 'right' }}>Net imposable</th><th style={{ textAlign: 'right' }}>IR retenu</th><th>Situation</th>
                  </tr>
                </thead>
                <tbody>
                  {s.staff.map(e => (
                    <tr key={e.name + (e.cin ?? '')}>
                      <td>{e.name}<div style={{ fontSize: '0.6875rem', color: e.cin ? 'var(--theme-text-muted)' : '#c62828', ...mono }}>{e.cin ? `CIN ${e.cin}` : 'CIN manquant'}</div></td>
                      <td style={{ ...mono, textAlign: 'right' }}>{e.days}</td>
                      <td style={{ ...mono, textAlign: 'right' }}>{n(e.brut)}</td>
                      <td style={{ ...mono, textAlign: 'right' }}>{n(e.brutImposable)}</td>
                      <td style={{ ...mono, textAlign: 'right' }}>{n(e.fraisPro + e.cotisations)}</td>
                      <td style={{ ...mono, textAlign: 'right' }}>{n(e.netImposable)}</td>
                      <td style={{ ...mono, textAlign: 'right' }}>{n(e.ir)}</td>
                      <td style={{ fontSize: '0.75rem' }}>{e.situation === 'M' ? 'Marié(e)' : 'Célibataire'}, {e.dependents} à charge<div style={{ color: 'var(--theme-text-muted)', ...mono }}>{e.rate}</div></td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700, background: 'var(--theme-bg-secondary)' }}>
                    <td colSpan={2}>Total ({s.staff.length} salarié{s.staff.length > 1 ? 's' : ''})</td>
                    <td style={{ ...mono, textAlign: 'right' }}>{n(s.totals.brut)}</td>
                    <td style={{ ...mono, textAlign: 'right' }}>{n(s.totals.brutImposable)}</td>
                    <td style={{ ...mono, textAlign: 'right' }}>{n(s.totals.deductions)}</td>
                    <td style={{ ...mono, textAlign: 'right' }}>{n(s.totals.netImposable)}</td>
                    <td style={{ ...mono, textAlign: 'right' }}>{n(s.totals.ir)}</td>
                    <td style={{ fontSize: '0.75rem' }}>versé {n(s.totals.versements)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
