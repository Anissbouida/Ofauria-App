import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, FileText, SlidersHorizontal, Database, Hash, Bell, CornerDownLeft, Loader2, Zap, Clock } from 'lucide-react';
import { ACTIVATABLE_MODULES, CORE_MODULES, MODULE_LABELS } from '@ofauria/shared';
import { settingsApi } from '../../api/settings.api';
import { referentielApi } from '../../api/referentiel.api';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { settingAnchor } from './SettingsPrimitives';
import {
  normalizeSearch, pageOfParameter, staticSearchEntries,
  type SearchEntry, type SettingsPageDef, type SettingsPageKey,
} from './settingsPages';

/**
 * Recherche ⌘K / Ctrl+K des Paramètres : pages et réglages (index statique),
 * plus, chargés à l'ouverture, les paramètres métier, les tables du référentiel,
 * les séries de numérotation et les règles de notification. Seules les pages
 * permises par le droit « Paramètres » sont proposées.
 * Lot S5 : actions courantes (elles ouvrent l'endroit où agir, sans rien exécuter) et
 * dernières recherches ouvertes (retenues par navigateur).
 */

const KIND_ICON = { page: FileText, field: SlidersHorizontal, parameter: SlidersHorizontal, table: Database, series: Hash, rule: Bell, action: Zap, recent: Clock };
const KIND_GROUP: Record<SearchEntry['kind'], string> = {
  recent: 'Récents', action: 'Actions', page: 'Pages', field: 'Réglages', parameter: 'Paramètres métier', table: 'Tables du référentiel',
  series: 'Séries de numérotation', rule: 'Règles de notification',
};
const MAX_RESULTS = 40;
const RECENT_KEY = 'kalum.settings.recent';
const MAX_RECENT = 5;

/** Actions courantes : chacune ouvre la page (et le bloc) où l'on agit. */
function actionEntries(): SearchEntry[] {
  const a = (id: string, label: string, page: SettingsPageKey, words: string, anchor?: string): SearchEntry =>
    ({ id: `action:${id}`, kind: 'action', label, page, anchor, haystack: normalizeSearch(`${label} ${words}`) });
  return [
    a('sector', 'Changer de secteur d\'activité', 'sector', 'metier preregler pack', settingAnchor("Secteur d'activité")),
    a('describe', 'Décrire mon activité (assistant)', 'sector', 'ia claude proposer configuration', settingAnchor('Modèles de configuration')),
    a('export', 'Exporter ou importer la configuration', 'sector', 'modele json fichier', settingAnchor('Modèles de configuration')),
    ...ACTIVATABLE_MODULES.filter(m => !CORE_MODULES.has(m)).map(m =>
      a(`module-${m}`, `Activer ou désactiver « ${MODULE_LABELS[m]} »`, 'sector', 'module allumer eteindre masquer', settingAnchor(MODULE_LABELS[m]))),
    a('store', 'Ajouter un établissement', 'stores', 'boutique magasin laboratoire nouveau creer'),
    a('bank', 'Ajouter un compte bancaire', 'company', 'rib banque nouveau', settingAnchor('Comptes bancaires')),
    a('tax', 'Ajouter un taux de TVA', 'tax', 'taxe nouveau creer'),
    a('series', 'Créer une série de numérotation', 'numbering', 'numero piece compteur nouveau'),
    a('approval', 'Créer un circuit d\'approbation', 'approvals', 'validation seuil regle nouveau'),
    a('import', 'Importer des données', 'data', 'csv excel fichier'),
    a('audit', 'Voir le journal des modifications', 'audit', 'historique trace qui a modifie'),
  ];
}

function readRecent(): SearchEntry[] {
  try { return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as SearchEntry[]).slice(0, MAX_RECENT); } catch { return []; }
}
function rememberRecent(e: SearchEntry) {
  try {
    const entry = { ...e, kind: e.kind === 'recent' ? (e as SearchEntry & { from?: SearchEntry['kind'] }).from ?? 'page' : e.kind };
    const list = [entry, ...readRecent().filter(r => r.id !== entry.id)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* stockage indisponible : pas de récents */ }
}

export default function SettingsSearch({ open, onClose, pages, onSelect }: {
  open: boolean;
  onClose: () => void;
  pages: SettingsPageDef[];
  onSelect: (entry: SearchEntry) => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const allowed = useMemo(() => new Set<SettingsPageKey>(pages.map(p => p.key)), [pages]);
  const pageLabel = (k: SettingsPageKey) => {
    const p = pages.find(x => x.key === k);
    return p ? `${p.group} › ${p.label}` : '';
  };

  // Entrées chargées à la première ouverture, uniquement pour les pages permises.
  const params = useQuery({ queryKey: ['business-parameters'], queryFn: settingsApi.parameters,
    enabled: open && (allowed.has('company') || allowed.has('production') || allowed.has('purchasing') || allowed.has('ledger')) });
  const ref = useQuery({ queryKey: ['ref-dashboard'], queryFn: referentielApi.dashboard, enabled: open && allowed.has('referentiel') });
  const series = useQuery({ queryKey: ['document-sequences'], queryFn: settingsApi.documentSequences, enabled: open && allowed.has('numbering') });
  const rules = useQuery({ queryKey: ['notification-rules'], queryFn: settingsApi.notificationRules, enabled: open && allowed.has('notifications') });
  const loading = [params, ref, series, rules].some(r => r.isFetching && !r.data);

  const index = useMemo<SearchEntry[]>(() => {
    const out = [...actionEntries(), ...staticSearchEntries(pages)];
    for (const p of params.data ?? []) {
      out.push({ id: `param:${p.key}`, kind: 'parameter', label: p.label, page: pageOfParameter(p.key), anchor: `param-${p.key}`,
        haystack: normalizeSearch(`${p.label} ${p.help} ${p.domainLabel} ${p.fields.map(f => f.label).join(' ')}`) });
    }
    for (const t of ((ref.data?.tables ?? []) as Record<string, unknown>[])) {
      out.push({ id: `table:${String(t.id)}`, kind: 'table', label: String(t.label), page: 'referentiel', extra: { table: String(t.id) },
        haystack: normalizeSearch(`${String(t.label)} ${String(t.description ?? '')} referentiel table`) });
    }
    for (const s of series.data ?? []) {
      out.push({ id: `seq:${s.doc_type}`, kind: 'series', label: s.label, page: 'numbering', anchor: `seq-row-${s.doc_type}`,
        haystack: normalizeSearch(`${s.label} ${s.pattern} serie numerotation`) });
    }
    for (const r of rules.data ?? []) {
      out.push({ id: `rule:${r.type}`, kind: 'rule', label: r.label, page: 'notifications', anchor: `notif-row-${r.type}`,
        haystack: normalizeSearch(`${r.label} ${r.domain} notification`) });
    }
    return out.filter(e => allowed.has(e.page));
  }, [pages, params.data, ref.data, series.data, rules.data, allowed]);

  const results = useMemo(() => {
    const tokens = normalizeSearch(q.trim()).split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      // Sans saisie : dernières recherches ouvertes (encore permises), puis les pages.
      const recent = readRecent().filter(r => allowed.has(r.page))
        .map(r => ({ ...r, id: `recent:${r.id}`, kind: 'recent' as const, from: r.kind }));
      return [...recent, ...index.filter(e => e.kind === 'page')];
    }
    const scored = index
      .filter(e => tokens.every(t => e.haystack.includes(t)))
      .map(e => {
        const label = normalizeSearch(e.label);
        const phrase = tokens.join(' ');
        // Libellé = expression saisie, puis libellé qui la contient, puis mots du libellé ;
        // une correspondance dans la seule description vient en dernier.
        const score = (label === phrase ? 0 : label.includes(phrase) ? 1 : label.startsWith(tokens[0]) ? 2 : 3)
          - tokens.filter(t => label.includes(t)).length / (tokens.length + 1)
          + (e.kind === 'page' ? 0 : e.kind === 'action' ? 0.05 : 0.1);
        return { e, score };
      })
      .sort((a, b) => a.score - b.score);
    return scored.slice(0, MAX_RESULTS).map(s => s.e);
  }, [index, q]);

  // Regroupement par type : les groupes suivent leur meilleur résultat, l'ordre de
  // pertinence est conservé à l'intérieur de chaque groupe.
  const kinds = useMemo(() => [...new Set(results.map(r => r.kind))], [results]);
  const sorted = useMemo(() => kinds.flatMap(k => results.filter(r => r.kind === k)), [kinds, results]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const choose = (e: SearchEntry | undefined) => {
    if (!e) return;
    const original = e.kind === 'recent' ? { ...e, id: e.id.replace(/^recent:/, '') } : e;
    rememberRecent(original);
    onClose();
    onSelect(original);
  };
  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive(a => Math.min(a + 1, sorted.length - 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (ev.key === 'Home') { ev.preventDefault(); setActive(0); }
    else if (ev.key === 'End') { ev.preventDefault(); setActive(sorted.length - 1); }
    else if (ev.key === 'Enter') { ev.preventDefault(); choose(sorted[active]); }
    else if (ev.key === 'Escape') { ev.preventDefault(); onClose(); }
  };

  let idx = -1;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[80] flex justify-center p-4" style={{ background: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope odoo-cmdk" role="dialog" aria-modal="true" aria-label="Rechercher un réglage" onKeyDown={onKeyDown}>
        <div className="odoo-cmdk-input-row">
          <Search size={16} />
          <input autoFocus className="odoo-search-input" placeholder="Rechercher une page, un réglage, une table…"
            value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un réglage"
            role="combobox" aria-expanded="true" aria-controls="settings-cmdk-list" aria-activedescendant={sorted[active] ? `cmdk-${active}` : undefined} />
          {loading && <Loader2 size={14} className="animate-spin" />}
          <kbd className="odoo-settings-kbd">Échap</kbd>
        </div>
        <div className="odoo-cmdk-list" id="settings-cmdk-list" role="listbox" ref={listRef}>
          {!sorted.length && <div className="odoo-cmdk-empty">Aucun réglage ne correspond à « {q} ».</div>}
          {kinds.map(kind => {
            const items = sorted.filter(r => r.kind === kind);
            if (!items.length) return null;
            return (
              <div key={kind} role="group" aria-label={KIND_GROUP[kind]}>
                <div className="odoo-cmdk-group">{KIND_GROUP[kind]}</div>
                {items.map(e => {
                  idx++;
                  const i = idx;
                  const Icon = kind === 'page' ? (pages.find(p => p.key === e.page)?.icon ?? KIND_ICON.page) : KIND_ICON[kind];
                  return (
                    <button key={e.id} id={`cmdk-${i}`} data-idx={i} type="button" role="option" aria-selected={i === active}
                      className={`odoo-cmdk-item${i === active ? ' active' : ''}`}
                      onMouseMove={() => { if (active !== i) setActive(i); }} onClick={() => choose(e)}>
                      <Icon size={15} />
                      <span>{e.label}</span>
                      <span className="odoo-cmdk-item-path">{pageLabel(e.page)}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="odoo-cmdk-foot">
          <span>↑ ↓ naviguer</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><CornerDownLeft size={11} /> ouvrir</span>
          <span>Échap fermer</span>
        </div>
      </div>
    </ModalBackdrop>
  );
}
