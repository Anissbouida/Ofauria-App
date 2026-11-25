import { money } from '../../utils/money';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History, RotateCcw, SlidersHorizontal, HelpCircle, Lock } from 'lucide-react';
import { settingsApi, type BusinessParameter, type ParamField } from '../../api/settings.api';
import { useSettings } from '../../context/SettingsContext';
import { DataPanel, EmptyState, ErrorState, LoadingState, SearchBar, Toolbar } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import { useDirtyForm, useDraft } from './DirtyForms';
import { OdooToggle, settingAnchor } from './SettingsPrimitives';

/**
 * Écran générique des paramètres métier (audit Paramètres, lot 4) : construit à
 * partir du catalogue serveur (services/parameters-catalog.ts). Chaque règle est un
 * brouillon de la barre d'enregistrement commune (refonte lot A) ; le serveur contrôle
 * les bornes et trace au journal. `keys` ou `domains` restreignent l'affichage ;
 * sans filtre, tous les paramètres visibles sont listés, avec recherche.
 *
 * Refonte des pages de règles (après S5) : les règles sont rangées par thème (une
 * carte par thème, reprise par « Sur cette page »), une règle = une ligne (libellé et
 * aide à gauche, réglage à droite), les choix courts deviennent des boutons segmentés
 * colorés (Désactivé / Avertir / Bloquer), les cases des interrupteurs.
 */

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Thème de chaque règle (ordre d'affichage = ordre de ce tableau). */
const THEMES: [string, string[]][] = [
  ['Commande', ['purchasing.po_requires_request', 'purchasing.expense_requires_po', 'purchasing.off_contract_enforcement']],
  ['Réception', ['purchasing.over_receipt_tolerance_pct', 'purchasing.lot_dlc_enforcement', 'purchasing.receipt_correction_window_hours']],
  ['Facture et paiement', ['purchasing.invoice_holds_enforcement', 'purchasing.cash_limit_enforcement']],
  ['Contrôles internes', ['purchasing.sod_mode']],
  ['Fournisseurs', ['purchasing.supplier_score']],
  ['Devis et relances', ['sales.quotes', 'sales.dunning']],
  ['Prix et remises', ['sales.pricing']],
  ['Facturation et fiscalité', ['sales.legal_mentions', 'sales.vat_regime', 'sales.stamp_duty']],
  ['Retours', ['sales.returns']],
  ['Vente en caisse', ['sales.pos_stock', 'sales.closure']],
  ['Remises et formats', ['sales.staff_discount', 'sales.person_sizes']],
  ['Coûts', ['production.fixed_charges']],
  ['Fabrication', ['production.steps_blocking']],
  ['Prix de vente', ['pricing.rounding']],
  ['Comptabilisation', ['ledger.posting_mode']],
  ['Encaissements', ['accounting.card_commission']],
  ['Pays', ['company.country_code']],
];
const THEME_OF = new Map(THEMES.flatMap(([t, keys]) => keys.map(k => [k, t] as const)));
const THEME_RANK = new Map(THEMES.map(([t], i) => [t, i]));

/** Libellé court d'une option pour un bouton segmenté (le libellé complet reste en info-bulle). */
const SHORT: Record<string, string> = {
  'Observer (journaliser sans bloquer)': 'Observer', 'Signaler sans bloquer': 'Avertir', 'Signaler seulement': 'Signaler',
  'Bloquer (poser un blocage)': 'Bloquer', 'Bloquer l\'action': 'Bloquer', 'Accepter et marquer non déductible': 'Accepter, non déductible',
  'Refuser (dérogation administrateur motivée)': 'Refuser', 'Alerte seulement': 'Alerter', 'Bloquant': 'Bloquer',
};
const shortLabel = (l: string) => SHORT[l] ?? l.replace(/\s*\(.*\)$/, '');
/** Couleur d'une valeur de contrôle. */
const tone = (v: string) => (v === 'off' ? 'off' : v === 'warn' ? 'warn' : v.startsWith('block') ? 'block' : 'accent');
const SEGMENT_MAX = 26;

/** Aperçu propre à certains paramètres (calculé avec les valeurs en cours de saisie). */
function hintFor(key: string, v: Record<string, unknown>): string | null {
  if (key === 'pricing.rounding') {
    const brut = 47.32;
    const pas = v.strategie === 'au_dh' ? 1 : v.strategie === 'au_demi_dh' ? 0.5 : v.strategie === 'au_5dh' ? 5 : 0;
    const arrondi = !pas ? brut : v.sens === 'inferieur' ? Math.floor(brut / pas) * pas
      : v.sens === 'superieur' ? Math.ceil(brut / pas) * pas : Math.round(brut / pas) * pas;
    return `Exemple : un prix calculé de ${money(brut)} devient ${money(arrondi)}.`;
  }
  if (key === 'production.fixed_charges') {
    const total = ['loyer', 'energie', 'autres'].reduce((s, k) => s + (Number(v[k]) || 0), 0);
    return `Total : ${money(total)} par mois.`;
  }
  return null;
}

const themeOf = (p: BusinessParameter) => THEME_OF.get(p.key) ?? p.domainLabel;

/** Aide courte rédigée pour l'écran (une ligne, comme Odoo) ; l'aide complète du catalogue passe dans le « ? ». */
const SHORT_HELP: Record<string, string> = {
  'purchasing.expense_requires_po': 'Dépenses « BC requis » rattachées à un bon de commande au-delà du seuil',
  'purchasing.supplier_score': 'Poids des critères, période et seuils des classes A, B et C',
  'purchasing.over_receipt_tolerance_pct': 'Écart accepté par ligne ; au-delà, la réception est refusée',
  'purchasing.sod_mode': 'Qui fait une étape ne peut pas faire celle qui la contrôle',
  'purchasing.receipt_correction_window_hours': 'Le gérant peut corriger une réception pendant ce délai',
  'purchasing.lot_dlc_enforcement': 'Si le lot ou la DLC exigés ne sont pas saisis',
  'purchasing.off_contract_enforcement': 'Prix des lignes comparé au tarif contractuel à l\'envoi du BC',
  'purchasing.po_requires_request': 'Un bon de commande doit référencer une demande d\'achat',
  'purchasing.invoice_holds_enforcement': 'Un écart de prix, de quantité ou un doublon bloque le paiement',
  'purchasing.cash_limit_enforcement': 'Au-delà du plafond légal, le paiement en espèces n\'est pas déductible',
  'accounting.card_commission': 'Retenue du terminal sur chaque vente par carte (compte 6147)',
  'ledger.posting_mode': 'Que faire si l\'écriture comptable d\'une pièce échoue',
  'sales.dunning': 'Relances des impayés et contrôle du plafond de crédit',
  'sales.pricing': 'Remises maximales et écart au prix grille autorisés',
  'sales.stamp_duty': 'Droit de timbre sur les règlements en espèces',
  'sales.closure': 'Inventaire des invendus demandé à la fermeture de caisse',
  'sales.pos_stock': 'Vendre ou non un produit dont la vitrine est à zéro',
  'sales.person_sizes': 'Nombres de parts proposés pour les entremets vendus à la part',
  'sales.returns': 'Délai et montant des retours acceptés sans approbation',
  'production.fixed_charges': 'Charges mensuelles réparties sur les plans pour le coût de revient',
  'pricing.rounding': 'Arrondi des prix de vente calculés',
};
const HELP_MAX = 95;
function shortHelp(help: string): string {
  const first = help.split(/(?<=\.)\s|\s:\s|\s;\s/)[0].replace(/\.$/, '');
  if (first.length <= HELP_MAX) return first;
  const cut = first.slice(0, HELP_MAX);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

export default function ParametersPanel({ keys, domains, searchable = !keys && !domains, extras }: {
  keys?: string[]; domains?: string[]; searchable?: boolean;
  /** Contenu ajouté au bas d'une carte de thème (ex. suivi de la séparation des tâches). */
  extras?: Record<string, ReactNode>;
}) {
  const [q, setQ] = useState('');
  const { data = [], isLoading, isError, error } = useQuery({ queryKey: ['business-parameters'], queryFn: settingsApi.parameters });

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
    for (const p of shown) m.set(themeOf(p), [...(m.get(themeOf(p)) ?? []), p]);
    for (const t of Object.keys(extras ?? {})) if (!m.has(t)) m.set(t, []);
    return [...m.entries()].sort(([a], [b]) => (THEME_RANK.get(a) ?? 99) - (THEME_RANK.get(b) ?? 99));
  }, [shown, extras]);

  if (isLoading) return <LoadingState bare />;
  if (isError) return <ErrorState error={error} title="Paramètres indisponibles" />;

  return (
    <div className="odoo-scope odoo-params">
      {searchable && (
        <Toolbar>
          <SearchBar value={q} onChange={setQ} placeholder="Rechercher un paramètre…" />
        </Toolbar>
      )}
      {!shown.length && !extras && <EmptyState icon={SlidersHorizontal} title={`Aucun paramètre ${q ? 'ne correspond à la recherche' : 'accessible'}`} />}
      {groups.map(([theme, params]) => (
        <section key={theme} id={settingAnchor(theme)} data-toc={theme} className="odoo-company-card odoo-params-group">
          <h3>{theme}</h3>
          {params.map(p => <ParameterRow key={p.key} param={p} />)}
          {extras?.[theme] && <div className="odoo-params-extra">{extras[theme]}</div>}
        </section>
      ))}
    </div>
  );
}

/** Résumé des contrôles d'une page (Achats) : bloquants, en observation, désactivés. */
export function RulesSummary({ domains, extra }: { domains: string[]; extra?: { label: string; value: number } }) {
  const { data = [] } = useQuery({ queryKey: ['business-parameters'], queryFn: settingsApi.parameters });
  const counts = { block: 0, warn: 0, off: 0 };
  for (const p of data.filter(x => domains.includes(x.domain))) {
    const v = (p.value ?? p.defaults) as Record<string, unknown>;
    const mode = p.fields.find(f => f.name === 'mode' && f.type === 'enum');
    if (mode) {
      const t = tone(String(v.mode ?? ''));
      if (t === 'block') counts.block++; else if (t === 'warn') counts.warn++; else if (t === 'off') counts.off++;
    } else if (p.fields.some(f => f.name === 'enabled' && f.type === 'boolean')) {
      if (v.enabled === true) counts.block++; else counts.off++;
    }
  }
  return (
    <div className="odoo-params-summary">
      <div className="block"><small>Contrôles bloquants</small><strong>{counts.block}</strong></div>
      <div className="warn"><small>En observation</small><strong>{counts.warn}</strong></div>
      <div className="off"><small>Désactivés</small><strong>{counts.off}</strong></div>
      {extra && <div className="info"><small>{extra.label}</small><strong>{extra.value}</strong></div>}
    </div>
  );
}

function ParameterRow({ param }: { param: BusinessParameter }) {
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
  const set = (name: string, v: unknown) => setDraft({ ...draft, [name]: v });

  // Réglage principal à droite (premier choix ou interrupteur), nombres courts à côté,
  // le reste en sous-options sous la ligne.
  const primary = param.fields.find(f => f.type === 'enum' || f.type === 'boolean');
  const numbers = param.fields.filter(f => ['number', 'percent', 'integer'].includes(f.type));
  const custom = param.key === 'purchasing.supplier_score';
  const inline = !custom && numbers.length <= 2 ? numbers : [];
  const rest = custom ? [] : param.fields.filter(f => f !== primary && !inline.includes(f));
  const helpShort = SHORT_HELP[param.key] ?? shortHelp(param.help);
  const last = param.history[0];

  return (
    <div id={`param-${param.key}`} className={`odoo-params-row${param.available ? '' : ' unavailable'}`}>
      <div className="odoo-params-row-main">
        <div className="odoo-params-label">
          <span>{param.label}</span>
          {param.help.replace(/\.$/, '') !== helpShort && (
            <span className="odoo-params-q" title={param.help} aria-label={param.help} tabIndex={0}><HelpCircle size={13} /></span>
          )}
          {param.available && !isDefault && <span className="odoo-params-custom" title="Valeur personnalisée (différente de la valeur par défaut)" />}
          {last && (
            <button type="button" className="odoo-params-icon" aria-label="Voir l'historique des modifications" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}
              title={`Modifié le ${new Date(last.changed_at).toLocaleDateString('fr-FR')}${last.by_name ? ` par ${last.by_name}` : ''} : voir l'historique`}>
              <History size={13} />
            </button>
          )}
          {!disabled && !draftIsDefault && (
            // Ne fait que préparer le brouillon : l'enregistrement passe par la barre commune.
            <button type="button" className="odoo-params-icon" title="Revenir à la valeur par défaut (à enregistrer ensuite)"
              onClick={() => setDraft({ ...draft, ...Object.fromEntries(param.fields.map(f => [f.name, param.defaults[f.name]])) })} aria-label="Revenir à la valeur par défaut (à enregistrer ensuite)">
              <RotateCcw size={13} />
            </button>
          )}
          {changes > 0 && <span className="odoo-setting-changed">Modifié</span>}
          {changes > 0 && <button type="button" className="odoo-setting-revert" onClick={reset}>Rétablir</button>}
          {!param.available && <StatusTag tone="cancelled" label="Non disponible sur cette base" />}
          {param.available && !param.editable && <StatusTag tone="draft" icon={Lock} label="Lecture seule" />}
        </div>
        <p className="odoo-params-help">{helpShort}{param.source && param.source !== 'unavailable' && <span style={{ display: 'block', marginTop: 4 }}>Origine : {param.source === 'company' ? 'Société' : 'Valeur par défaut du catalogue'}</span>}</p>
      </div>

      <div className="odoo-params-control">
        {inline.map(f => (
          <NumberField key={f.name} id={`param-${param.key}-${f.name}`} field={f} value={draft[f.name]} disabled={disabled}
            onChange={v => set(f.name, v)} showLabel={!!primary || inline.length > 1} />
        ))}
        {primary && (primary.type === 'boolean'
          ? <OdooToggle checked={draft[primary.name] === true} disabled={disabled} onChange={v => set(primary.name, v)} />
          : <ChoiceField id={`param-${param.key}-${primary.name}`} field={primary} value={draft[primary.name]} disabled={disabled}
              onChange={v => set(primary.name, v)} />)}
      </div>

      {rest.length > 0 && (
        <div className="odoo-params-sub">
          {rest.map(f => (
            <FieldInput key={f.name} id={`param-${param.key}-${f.name}`} field={f} value={draft[f.name]} disabled={disabled}
              onChange={v => set(f.name, v)} />
          ))}
        </div>
      )}
      {custom && <SupplierScore param={param} draft={draft} disabled={disabled} onChange={set} />}
      {hint && <div className="odoo-params-hint">{hint}</div>}

      {showHistory && param.history.length > 0 && (
        <DataPanel className="odoo-params-history" label={`Historique : ${param.label}`}>
        <table className="odoo-table ds-dense">
          <thead><tr><th>Date</th><th>Par</th><th>Changement</th></tr></thead>
          <tbody>
            {param.history.map((h, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(h.changed_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{h.by_name || 'Système'}</td>
                <td>
                  {Object.entries(h.diff ?? {}).map(([k, d]) => `${param.fields.find(f => f.name === k)?.label ?? k} : ${JSON.stringify(d.old)} → ${JSON.stringify(d.new)}`).join(' ; ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </DataPanel>
      )}
    </div>
  );
}

/** Choix : boutons segmentés colorés si les libellés sont courts, liste sinon. */
function ChoiceField({ id, field, value, disabled, onChange }: {
  id: string; field: ParamField; value: unknown; disabled: boolean; onChange: (v: unknown) => void;
}) {
  const opts = field.options ?? [];
  const segmented = opts.length <= 3 && opts.every(o => shortLabel(o.label).length <= SEGMENT_MAX);
  if (!segmented) {
    return (
      <select id={id} className="ds-input sm odoo-params-select" style={{ width: 'auto', maxWidth: 340 }} value={String(value ?? '')} disabled={disabled}
        onChange={e => onChange(e.target.value)} aria-label={field.label}>
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return (
    <div id={id} className="odoo-params-seg" role="radiogroup" aria-label={field.label}>
      {opts.map(o => {
        const on = String(value) === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} disabled={disabled} title={o.label}
            className={on ? `on ${tone(o.value)}` : ''} onClick={() => onChange(o.value)}>
            {shortLabel(o.label)}
          </button>
        );
      })}
    </div>
  );
}

function NumberField({ id, field, value, disabled, onChange, showLabel = true }: {
  id: string; field: ParamField; value: unknown; disabled: boolean; onChange: (v: unknown) => void; showLabel?: boolean;
}) {
  const unit = field.type === 'percent' ? '%' : field.unit;
  return (
    <label htmlFor={id} className="odoo-params-num">
      {showLabel && <span>{field.label}</span>}
      <input id={id} type="number" className="ds-input sm" style={{ width: 96, textAlign: 'right' }} value={value === undefined || value === null ? '' : String(value)}
        disabled={disabled} min={field.min} max={field.max} step={field.type === 'integer' ? 1 : 'any'} aria-label={field.label}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
      {unit && <span>{unit}</span>}
    </label>
  );
}

/** Sous-option : interrupteur, choix, nombre ou liste. */
function FieldInput({ id, field, value, disabled, onChange }: {
  id: string; field: ParamField; value: unknown; disabled: boolean; onChange: (v: unknown) => void;
}) {
  if (field.type === 'boolean') {
    return (
      <span className="odoo-params-subtoggle">
        <OdooToggle checked={value === true} disabled={disabled} onChange={onChange} />
        <span onClick={() => { if (!disabled) onChange(!(value === true)); }}>{field.label}</span>
      </span>
    );
  }
  if (field.type === 'enum') {
    return (
      <span className="odoo-params-num">
        <span>{field.label}</span>
        <ChoiceField id={id} field={field} value={value} disabled={disabled} onChange={onChange} />
      </span>
    );
  }
  if (field.type === 'list') return <ListField id={id} field={field} value={value} disabled={disabled} onChange={onChange} />;
  if (field.type === 'date') {
    return (
      <label htmlFor={id} className="odoo-params-num">
        <span>{field.label}</span>
        <input id={id} type="date" className="ds-input sm" style={{ width: 160 }} value={typeof value === 'string' ? value : ''} disabled={disabled}
          aria-label={field.label} onChange={e => onChange(e.target.value || null)} />
      </label>
    );
  }
  if (field.type === 'time') {
    return (
      <label htmlFor={id} className="odoo-params-num">
        <span>{field.label}</span>
        <input id={id} type="time" className="ds-input sm" style={{ width: 120 }} value={typeof value === 'string' ? value : ''} disabled={disabled}
          aria-label={field.label} onChange={e => onChange(e.target.value)} />
      </label>
    );
  }
  return <NumberField id={id} field={field} value={value} disabled={disabled} onChange={onChange} />;
}

/** Évaluation des fournisseurs : barre des poids (total 100), période et classes A/B/C. */
function SupplierScore({ param, draft, disabled, onChange }: {
  param: BusinessParameter; draft: Record<string, unknown>; disabled: boolean; onChange: (name: string, v: unknown) => void;
}) {
  const has = (n: string) => param.fields.some(x => x.name === n);
  const f = (n: string) => param.fields.find(x => x.name === n)!;
  const weights = ['on_time', 'fill_rate', 'quality', 'price', 'disputes'].filter(has);
  const total = weights.reduce((s, n) => s + (Number(draft[n]) || 0), 0);
  const shades = [100, 75, 52, 32, 16].map(p => `color-mix(in srgb, var(--ds-accent) ${p}%, var(--ds-card))`);
  const num = (n: string, cls?: string) => (
    <input id={`param-${param.key}-${n}`} type="number" className="ds-input sm" style={{ textAlign: 'right', fontWeight: 600, width: cls ? 64 : undefined }} min={0} max={100} step={1} disabled={disabled}
      value={draft[n] === undefined || draft[n] === null ? '' : String(draft[n])}
      onChange={e => onChange(n, e.target.value === '' ? '' : Number(e.target.value))} />
  );
  return (
    <div className="odoo-params-score">
      <div className="odoo-params-score-bar" aria-hidden="true">
        {weights.map((n, i) => <i key={n} style={{ width: `${total ? (Number(draft[n]) || 0) / total * 100 : 0}%`, background: shades[i] }} />)}
      </div>
      <div className="odoo-params-score-weights">
        {weights.map((n, i) => (
          <label key={n} htmlFor={`param-${param.key}-${n}`} style={{ borderTopColor: shades[i] }}>
            <span>{f(n).label.replace(/^Poids\s+/i, '').replace(/^./, c => c.toUpperCase())}</span>
            {num(n)}
          </label>
        ))}
      </div>
      <span className={`odoo-company-hint ${total === 100 ? 'ok' : 'warn'}`}>
        Total des poids : {total}{total === 100 ? ' ✓' : ' (la note est ramenée sur 100)'}
      </span>
      <div className="odoo-params-sub">
        {['min_orders', 'months'].filter(has).map(n => (
          <NumberField key={n} id={`param-${param.key}-${n}`} field={f(n)} value={draft[n]} disabled={disabled} onChange={v => onChange(n, v)} />
        ))}
        {([['a_min', 'A', 'ok'], ['b_min', 'B', 'info'], ['c_min', 'C', 'warn']] as const).filter(([n]) => has(n)).map(([n, cls, t]) => (
          <label key={n} htmlFor={`param-${param.key}-${n}`} className={`odoo-params-class ${t}`}>
            Classe {cls} ≥ {num(n, cls)}
          </label>
        ))}
      </div>
    </div>
  );
}

/** Champ « liste de nombres » (ex. tailles d'entremets « 4, 6, 8… »). État local
 *  pour ne pas casser la saisie ; resynchronise sur un changement externe
 *  (sauvegarde ou réinitialisation). */
function ListField({ id, field, value, disabled, onChange }: {
  id: string; field: ParamField; value: unknown; disabled: boolean; onChange: (v: unknown) => void;
}) {
  const arr = Array.isArray(value) ? (value as number[]) : [];
  const [text, setText] = useState(arr.join(', '));
  const parse = (t: string) => t.split(/[,;\s]+/).filter(Boolean).map(Number).filter(n => Number.isFinite(n));
  useEffect(() => {
    if (arr.join(',') !== parse(text).join(',')) setText(arr.join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label htmlFor={id} className="odoo-params-num">
      <span>{field.label}</span>
      <input id={id} type="text" className="ds-input sm" style={{ width: 240 }} value={text} disabled={disabled}
        placeholder="4, 6, 8, 10, 12, 16" inputMode="numeric"
        onChange={e => { setText(e.target.value); onChange(parse(e.target.value)); }} />
      {field.unit && <span>{field.unit}</span>}
    </label>
  );
}
