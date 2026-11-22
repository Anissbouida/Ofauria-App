import { useQuery } from '@tanstack/react-query';
import { Globe, Lock } from 'lucide-react';
import { PageNote } from './SettingsPrimitives';
import { settingsApi, type CountryPackParameter } from '../../api/settings.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { money } from '../../utils/money';
import { DataPanel, LoadingState, SectionHeader } from '../../components/ds';

/**
 * Pack pays (G6-06, mig 606) en lecture seule : pays de la société, paramètres légaux en
 * vigueur (paie et fiscalité), barème de cotisations / IR en vigueur et taux de TVA.
 * La modification sera réservée au comptable dans une phase ultérieure.
 */

const CATEGORY_LABELS: Record<CountryPackParameter['category'], string> = {
  paie: 'Paie', fiscalite: 'Fiscalité', formats: 'Formats',
};
const FORMAT_LABELS: Record<string, string> = {
  ebds: 'e-BDS Damancom (CNSS)', edi_tva_deductions: 'EDI relevé des déductions de TVA', edi_9421: 'EDI état 9421 (IR salaires)',
  edi_liasse_is: 'EDI liasse IS', liasse: 'Liasse fiscale', vat_deduction_statement: 'Relevé des déductions de TVA',
};

const pct = (v: unknown) => `${(Number(v) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
const d = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : '—');

/** Valeur lisible d'un paramètre du pack, selon sa clé. */
function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (key === 'paie.ot_rates' && typeof value === 'object') {
    const r = value as Record<string, number>;
    return `jour ${pct(r.day)} · nuit ${pct(r.night)} · repos ${pct(r.restDay)} · repos nuit ${pct(r.restNight)}`;
  }
  if (key === 'paie.night_window' && typeof value === 'object') {
    const w = value as { start: string; end: string };
    return `${w.start} – ${w.end}`;
  }
  if (key === 'paie.seniority_brackets' && Array.isArray(value)) {
    return (value as { minYears: number; rate: number }[]).map(b => `${pct(b.rate)} dès ${b.minYears} ans`).join(' · ');
  }
  if (key === 'fiscalite.vat_rates' && Array.isArray(value)) return value.map(v => `${v} %`).join(', ');
  if (key.endsWith('_hours')) return `${Number(value).toLocaleString('fr-FR')} h`;
  if (key === 'paie.base_days') return `${value} jours`;
  if (key.endsWith('_length')) return `${value} chiffres`;
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export default function CountryPackTab() {
  const { data, isLoading } = useQuery({ queryKey: ['country-pack'], queryFn: settingsApi.countryPack });
  if (isLoading) return <LoadingState />;
  if (!data) return null;
  const s = data.payrollScale;
  const scaleRows: [string, string][] = s ? [
    ['Plafond CNSS (mensuel)', money(Number(s.cnss_plafond))],
    ['CNSS salarié / employeur', `${pct(s.cnss_rate_employee)} / ${pct(s.cnss_rate_employer)}`],
    ['AMO salarié / employeur', `${pct(s.amo_rate_employee)} / ${pct(s.amo_rate_employer)}`],
    ['Allocations familiales (employeur)', pct(s.alloc_familiales_rate)],
    ['Taxe de formation professionnelle (employeur)', pct(s.taxe_fp_rate)],
    ['Frais professionnels', s.frais_pro_rate_haut != null
      ? `${pct(s.frais_pro_rate)} jusqu'à ${money(Number(s.frais_pro_seuil_annuel))} / an, ${pct(s.frais_pro_rate_haut)} au-delà`
      : pct(s.frais_pro_rate)],
    ['Plafond annuel des frais professionnels', money(Number(s.frais_pro_plafond_annuel ?? Number(s.frais_pro_plafond) * 12))],
    ['Déduction pour charges de famille (annuelle, par personne)', money(Number(s.deduction_famille_annuelle ?? Number(s.deduction_famille) * 12))],
  ] : [];
  const groups = (['paie', 'fiscalite', 'formats'] as const).map(c => [c, data.parameters.filter(p => p.category === c)] as const).filter(([, l]) => l.length);

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12 }}>
      <PageNote help="Les paramètres du pack sont datés : une nouvelle valeur s'applique à partir de sa date d'effet. Les réglages de paie de l'entreprise (Personnel › Paramètres de paie) restent prioritaires sur la valeur légale.">
        Paramètres légaux du pays de la société, en vigueur au {d(data.date)}.
      </PageNote>
      <StatusBanner tone="info" icon={Globe} title={data.pack ? `Pack pays : ${data.pack.name} (${data.pack.code}) — devise ${data.pack.defaultCurrency}` : `Pays ${data.country} : aucun pack`}>
        {data.fallback && <>Aucun paramètre propre au pays {data.country} : les valeurs du Maroc s'appliquent par défaut. </>}
        <Lock size={12} style={{ verticalAlign: '-1px' }} /> Lecture seule : la modification sera réservée au comptable.
      </StatusBanner>

      {groups.map(([cat, list]) => (
        <section key={cat} style={{ display: 'grid', gap: 6 }}>
          <SectionHeader title={<>{CATEGORY_LABELS[cat]}</>} />
          <DataPanel>
            <table className="odoo-table">
              <thead><tr><th>Paramètre</th><th>Valeur en vigueur</th><th>Depuis</th><th>Référence</th></tr></thead>
              <tbody>
                {list.map(p => (
                  <tr key={p.key}>
                    <td className="ds-strong">{p.label}</td>
                    <td>
                      {formatValue(p.key, p.value)}
                      {p.upcoming.map(u => (
                        <div key={u.effectiveFrom} style={{ fontSize: '0.75rem', color: 'var(--ds-muted)' }}>
                          À partir du {d(u.effectiveFrom)} : {formatValue(p.key, u.value)}
                        </div>
                      ))}
                    </td>
                    <td>{d(p.effectiveFrom)}</td>
                    <td style={{ color: 'var(--ds-muted)' }}>{p.legalRef ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        </section>
      ))}

      {s && (
        <section style={{ display: 'grid', gap: 6 }}>
          <SectionHeader title={<>Cotisations sociales et IR — barème {String(s.label ?? '')} (depuis le {d(String(s.effective_from ?? ''))})</>} />
          <DataPanel>
            <table className="odoo-table">
              <thead><tr><th>Élément</th><th>Valeur</th></tr></thead>
              <tbody>{scaleRows.map(([k, v]) => <tr key={k}><td className="ds-strong">{k}</td><td>{v}</td></tr>)}</tbody>
            </table>
          </DataPanel>
          <PageNote>Le barème daté (CNSS, AMO, IR, SMIG) se tient dans Personnel › Paramètres de paie.</PageNote>
        </section>
      )}

      {data.taxCodes.length > 0 && (
        <section style={{ display: 'grid', gap: 6 }}>
          <SectionHeader title={<>Codes de TVA en vigueur</>} />
          <DataPanel>
            <table className="odoo-table">
              <thead><tr><th>Code</th><th>Libellé</th><th className="ds-num">Taux (%)</th></tr></thead>
              <tbody>{data.taxCodes.map(t => <tr key={t.id}><td className="ds-ref">{t.code}</td><td>{t.label}</td><td className="ds-num">{Number(t.rate)}</td></tr>)}</tbody>
            </table>
          </DataPanel>
        </section>
      )}

      {data.pack && data.pack.declarativeFormats.length > 0 && (
        <section style={{ display: 'grid', gap: 6 }}>
          <SectionHeader title={<>Formats déclaratifs du pays</>} />
          <PageNote>Ces fichiers suivent le format de l'administration du pays ({data.pack.name}) : ils ne sont pas produits pour une société d'un autre pays.</PageNote>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.875rem' }}>
            {data.pack.declarativeFormats.map(f => <li key={f}>{FORMAT_LABELS[f] ?? f}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
