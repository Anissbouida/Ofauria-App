import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, History, Search, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { settingsApi, type BusinessParameter, type ParamField } from '../../api/settings.api';
import { useSettings } from '../../context/SettingsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useDirtyForm, useDraft } from './DirtyForms';

/**
 * Écran générique des paramètres métier (audit Paramètres, lot 4) : construit à
 * partir du catalogue serveur (services/parameters-catalog.ts). Chaque carte est un
 * brouillon de la barre d'enregistrement commune (refonte lot A) ; le serveur contrôle
 * les bornes et trace au journal. `keys` ou `domains` restreignent l'affichage ;
 * sans filtre, tous les paramètres visibles sont listés par domaine, avec recherche.
 */

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Aperçu propre à certains paramètres (calculé avec les valeurs en cours de saisie). */
function hintFor(key: string, v: Record<string, unknown>): string | null {
  if (key === 'pricing.rounding') {
    const brut = 47.32;
    const pas = v.strategie === 'au_dh' ? 1 : v.strategie === 'au_demi_dh' ? 0.5 : v.strategie === 'au_5dh' ? 5 : 0;
    const arrondi = !pas ? brut : v.sens === 'inferieur' ? Math.floor(brut / pas) * pas
      : v.sens === 'superieur' ? Math.ceil(brut / pas) * pas : Math.round(brut / pas) * pas;
    return `Exemple : un prix calculé de ${brut.toFixed(2)} DH devient ${arrondi.toFixed(2)} DH.`;
  }
  if (key === 'production.fixed_charges') {
    const total = ['loyer', 'energie', 'autres'].reduce((s, k) => s + (Number(v[k]) || 0), 0);
    return `Total : ${total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH par mois.`;
  }
  return null;
}

export default function ParametersPanel({ keys, domains, searchable = !keys && !domains }: { keys?: string[]; domains?: string[]; searchable?: boolean }) {
  const [q, setQ] = useState('');
  const { data = [], isLoading, isError } = useQuery({ queryKey: ['business-parameters'], queryFn: settingsApi.parameters });

  const shown = useMemo(() => {
    let list = keys ? data.filter(p => keys.includes(p.key)) : data;
    if (domains) list = list.filter(p => domains.includes(p.domain));
    if (q.trim()) {
      const n = normalize(q.trim());
      list = list.filter(p => normalize(`${p.label} ${p.help} ${p.domainLabel} ${p.fields.map(f => f.label).join(' ')}`).includes(n));
    }
    return list;
  }, [data, keys, domains, q]);

  const groups = useMemo(() => {
    const m = new Map<string, BusinessParameter[]>();
    for (const p of shown) m.set(p.domainLabel, [...(m.get(p.domainLabel) ?? []), p]);
    return [...m.entries()];
  }, [shown]);

  if (isLoading) return <Loader2 className="animate-spin" size={18} />;
  if (isError) {
    return <StatusBanner tone="danger" icon={SlidersHorizontal} title="Paramètres indisponibles">Le serveur n'a pas pu charger les paramètres.</StatusBanner>;
  }

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 16 }}>
      {searchable && (
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', maxWidth: 360 }}>
          <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--odoo-text-muted)' }} />
          <input id="parameters-search" className="odoo-search-input" style={{ paddingLeft: 26, width: '100%' }}
            placeholder="Rechercher un paramètre…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un paramètre" />
        </span>
      )}
      {!shown.length && <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.875rem' }}>Aucun paramètre {q ? 'ne correspond à la recherche' : 'accessible'}.</p>}
      {groups.map(([domain, params]) => (
        <section key={domain} style={{ display: 'grid', gap: 8 }}>
          {searchable && <h3 style={{ margin: 0, fontSize: '0.8125rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--odoo-text-muted)' }}>{domain}</h3>}
          {params.map(p => <ParameterCard key={p.key} param={p} />)}
        </section>
      ))}
    </div>
  );
}

function ParameterCard({ param }: { param: BusinessParameter }) {
  const queryClient = useQueryClient();
  const { refreshSettings } = useSettings();
  const saved = param.value ?? param.defaults;
  const { draft, setDraft, reset, adopt } = useDraft<Record<string, unknown>>(saved);
  const [showHistory, setShowHistory] = useState(false);

  const changes = param.fields.filter(f => String(draft[f.name]) !== String(saved[f.name])).length;
  const isDefault = param.fields.every(f => String(saved[f.name]) === String(param.defaults[f.name]));
  const draftIsDefault = param.fields.every(f => String(draft[f.name]) === String(param.defaults[f.name]));
  const disabled = !param.available || !param.editable;

  useDirtyForm(`param:${param.key}`, {
    dirty: changes > 0, changes, reset,
    save: async () => {
      await settingsApi.updateParameter(param.key, Object.fromEntries(param.fields.map(f => [f.name, draft[f.name]])));
      adopt();
      await queryClient.invalidateQueries({ queryKey: ['business-parameters'] });
      // Les paramètres stockés dans company_settings sont aussi lus par le contexte global.
      await refreshSettings();
    },
  });

  const hint = hintFor(param.key, draft);

  return (
    <div id={`param-${param.key}`} style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: '12px 16px', display: 'grid', gap: 10, background: 'var(--odoo-bg)', opacity: param.available ? 1 : 0.6, scrollMarginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
          <div style={{ fontWeight: 600 }}>{param.label}</div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>{param.help}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          {!param.available && <span className="odoo-tag odoo-tag-grey">Non disponible sur cette base</span>}
          {param.available && !param.editable && <span className="odoo-tag odoo-tag-grey">Lecture seule</span>}
          {param.available && changes > 0 && <span className="odoo-tag odoo-tag-orange">Non enregistré</span>}
          {param.available && !isDefault && <span className="odoo-tag odoo-tag-blue">Personnalisé</span>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {param.fields.map(f => (
          <FieldInput key={f.name} id={`param-${param.key}-${f.name}`} field={f} value={draft[f.name]} disabled={disabled}
            onChange={v => setDraft({ ...draft, [f.name]: v })} />
        ))}
      </div>
      {hint && <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>{hint}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="odoo-filter-chip" onClick={() => setShowHistory(!showHistory)} disabled={!param.history.length}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <History size={12} />
          {param.history.length
            ? `Modifié le ${new Date(param.history[0].changed_at).toLocaleDateString('fr-FR')}${param.history[0].by_name ? ` par ${param.history[0].by_name}` : ''}`
            : 'Jamais modifié depuis l\'activation du journal'}
        </button>
        {!disabled && !draftIsDefault && (
          // Ne fait que préparer le brouillon : l'enregistrement passe par la barre commune.
          <button type="button" className="odoo-btn-secondary" title="Revenir à la valeur par défaut (à enregistrer ensuite)"
            onClick={() => setDraft({ ...draft, ...Object.fromEntries(param.fields.map(f => [f.name, param.defaults[f.name]])) })}>
            <RotateCcw size={12} /> Valeur par défaut
          </button>
        )}
      </div>

      {showHistory && param.history.length > 0 && (
        <table className="odoo-table">
          <thead><tr><th>Date</th><th>Par</th><th>Changement</th></tr></thead>
          <tbody>
            {param.history.map((h, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(h.changed_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{h.by_name || 'Système'}</td>
                <td style={{ fontSize: '0.8125rem' }}>
                  {Object.entries(h.diff ?? {}).map(([k, d]) => `${k} : ${JSON.stringify(d.old)} → ${JSON.stringify(d.new)}`).join(' ; ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FieldInput({ id, field, value, disabled, onChange }: {
  id: string; field: ParamField; value: unknown; disabled: boolean; onChange: (v: unknown) => void;
}) {
  const box: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' };
  const label: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };
  if (field.type === 'boolean') {
    return (
      <label htmlFor={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', color: 'var(--odoo-text)' }}>
        <input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={e => onChange(e.target.checked)} />
        {field.label}
      </label>
    );
  }
  if (field.type === 'enum') {
    return (
      <label htmlFor={id} style={label}>{field.label}
        <select id={id} style={{ ...box, minWidth: 220 }} value={String(value ?? '')} disabled={disabled} onChange={e => onChange(e.target.value)}>
          {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  if (field.type === 'list') {
    return <ListField id={id} field={field} value={value} disabled={disabled} onChange={onChange} box={box} labelStyle={label} />;
  }
  const unit = field.type === 'percent' ? '%' : field.unit;
  return (
    <label htmlFor={id} style={label}>{field.label}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <input id={id} type="number" style={{ ...box, width: 150, fontVariantNumeric: 'tabular-nums' }}
          value={value === undefined || value === null ? '' : String(value)} disabled={disabled}
          min={field.min} max={field.max} step={field.type === 'integer' ? 1 : 'any'}
          onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
        {unit && <span style={{ color: 'var(--odoo-text-muted)' }}>{unit}</span>}
      </span>
    </label>
  );
}

/** Champ « liste de nombres » (ex. tailles d'entremets « 4, 6, 8… »). État local
 *  pour ne pas casser la saisie ; resynchronise sur un changement externe
 *  (sauvegarde ou réinitialisation). */
function ListField({ id, field, value, disabled, onChange, box, labelStyle }: {
  id: string; field: ParamField; value: unknown; disabled: boolean; onChange: (v: unknown) => void;
  box: React.CSSProperties; labelStyle: React.CSSProperties;
}) {
  const arr = Array.isArray(value) ? (value as number[]) : [];
  const [text, setText] = useState(arr.join(', '));
  const parse = (t: string) => t.split(/[,;\s]+/).filter(Boolean).map(Number).filter(n => Number.isFinite(n));
  useEffect(() => {
    if (arr.join(',') !== parse(text).join(',')) setText(arr.join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label htmlFor={id} style={labelStyle}>{field.label}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <input id={id} type="text" style={{ ...box, width: 240 }} value={text} disabled={disabled}
          placeholder="4, 6, 8, 10, 12, 16" inputMode="numeric"
          onChange={e => { setText(e.target.value); onChange(parse(e.target.value)); }} />
        {field.unit && <span style={{ color: 'var(--odoo-text-muted)' }}>{field.unit}</span>}
      </span>
    </label>
  );
}
