import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Brouillons des écrans Paramètres (refonte lot A) : chaque formulaire de réglages
 * se déclare avec useDirtyForm ; une seule barre « N modifications non enregistrées
 * · Annuler · Enregistrer » enregistre ou annule tout. Les listes d'enregistrements
 * (établissements, comptes bancaires, séries…) gardent leurs propres formulaires.
 */

export interface DirtyFormEntry {
  dirty: boolean;
  /** Nombre de champs modifiés (1 par défaut). */
  changes?: number;
  /** Saisie invalide : l'enregistrement est bloqué tant qu'elle n'est pas corrigée. */
  invalid?: string | null;
  /** Doit lever une erreur en cas de refus (le message est affiché par la barre). */
  save: () => Promise<unknown>;
  reset: () => void;
}

interface DirtyFormsApi {
  register: (id: string, entry: DirtyFormEntry) => void;
  unregister: (id: string) => void;
  version: number;
  entries: () => [string, DirtyFormEntry][];
  hasChanges: () => boolean;
  resetAll: () => void;
  saveAll: () => Promise<boolean>;
}

const DirtyFormsContext = createContext<DirtyFormsApi | null>(null);

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } | string } }; message?: string };
  const er = e?.response?.data?.error;
  return typeof er === 'string' ? er : er?.message || fallback;
}

export function DirtyFormsProvider({ children }: { children: ReactNode }) {
  const map = useRef(new Map<string, DirtyFormEntry>());
  const [version, setVersion] = useState(0);

  const register = useCallback((id: string, entry: DirtyFormEntry) => {
    const prev = map.current.get(id);
    map.current.set(id, entry);
    // On ne redessine la barre que si son affichage change (pas pour une nouvelle closure save/reset).
    if (!prev || prev.dirty !== entry.dirty || prev.changes !== entry.changes || prev.invalid !== entry.invalid) {
      setVersion(v => v + 1);
    }
  }, []);
  const unregister = useCallback((id: string) => {
    if (map.current.delete(id)) setVersion(v => v + 1);
  }, []);
  const entries = useCallback(() => [...map.current.entries()].filter(([, e]) => e.dirty), []);
  const hasChanges = useCallback(() => entries().length > 0, [entries]);
  const resetAll = useCallback(() => { for (const [, e] of entries()) e.reset(); }, [entries]);
  const saveAll = useCallback(async () => {
    let saved = 0;
    for (const [, e] of entries()) {
      try {
        await e.save();
        saved++;
      } catch (err) {
        notify.error(errorMessage(err, 'Enregistrement refusé'));
        return false;
      }
    }
    if (saved) notify.success(saved > 1 ? 'Modifications enregistrées' : 'Modification enregistrée');
    return true;
  }, [entries]);

  const api = useMemo(() => ({ register, unregister, version, entries, hasChanges, resetAll, saveAll }),
    [register, unregister, version, entries, hasChanges, resetAll, saveAll]);

  // Fermeture de l'onglet ou rechargement avec des brouillons.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasChanges()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasChanges]);

  return <DirtyFormsContext.Provider value={api}>{children}</DirtyFormsContext.Provider>;
}

export function useDirtyForms() {
  return useContext(DirtyFormsContext);
}

/** Déclare un formulaire de réglages auprès de la barre d'enregistrement commune. */
export function useDirtyForm(id: string, entry: DirtyFormEntry) {
  const ctx = useContext(DirtyFormsContext);
  const latest = useRef(entry);
  latest.current = entry;
  const register = ctx?.register;
  const unregister = ctx?.unregister;
  const { dirty, changes, invalid } = entry;

  useEffect(() => {
    register?.(id, {
      dirty, changes, invalid,
      save: () => latest.current.save(),
      reset: () => latest.current.reset(),
    });
  }, [register, id, dirty, changes, invalid]);
  useEffect(() => () => unregister?.(id), [unregister, id]);
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Brouillon d'un formulaire de réglages. Quand les valeurs enregistrées changent
 * (enregistrement d'un autre formulaire, rechargement), seuls les champs non
 * modifiés sont mis à jour : un brouillon voisin n'est jamais écrasé.
 * Après `adopt()` (appelé à la fin d'un save), la prochaine version enregistrée
 * remplace tout le brouillon (valeurs normalisées par le serveur).
 */
export function useDraft<T extends Record<string, unknown>>(saved: T) {
  const [draft, setDraft] = useState<T>(saved);
  const base = useRef(saved);
  const adoptNext = useRef(false);
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    const old = base.current;
    base.current = saved;
    if (adoptNext.current) { adoptNext.current = false; setDraft(saved); return; }
    setDraft(prev => {
      const next = { ...saved };
      for (const k of Object.keys(prev) as (keyof T)[]) if (!same(prev[k], old[k])) next[k] = prev[k];
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  const changedKeys = (Object.keys(saved) as (keyof T)[]).filter(k => !same(draft[k], saved[k]));
  const set = <K extends keyof T>(key: K, value: T[K]) => setDraft(d => ({ ...d, [key]: value }));
  return {
    draft, setDraft, set,
    changes: changedKeys.length,
    reset: () => setDraft(base.current),
    adopt: () => { adoptNext.current = true; },
  };
}

export function SaveBar({ readOnly }: { readOnly?: boolean }) {
  const ctx = useDirtyForms();
  const [saving, setSaving] = useState(false);
  if (!ctx) return null;
  const dirty = ctx.entries();
  if (!dirty.length) return null;
  const count = dirty.reduce((s, [, e]) => s + (e.changes ?? 1), 0);
  const invalid = dirty.map(([, e]) => e.invalid).find(Boolean);

  const save = async () => {
    setSaving(true);
    try { await ctx.saveAll(); } finally { setSaving(false); }
  };

  return (
    <div className="odoo-savebar" role="region" aria-label="Modifications non enregistrées">
      <span className="odoo-savebar-text">
        {count} modification{count > 1 ? 's' : ''} non enregistrée{count > 1 ? 's' : ''}
      </span>
      {invalid && <span className="odoo-savebar-note">{invalid}</span>}
      {readOnly && <span className="odoo-savebar-note">Consultation seule : l'enregistrement sera refusé.</span>}
      <div className="odoo-savebar-actions">
        <button type="button" className="odoo-btn-secondary" onClick={ctx.resetAll} disabled={saving}>
          <RotateCcw size={13} /> Annuler
        </button>
        <button type="button" className="odoo-btn-primary" onClick={save} disabled={saving || !!invalid || readOnly}>
          <Save size={13} /> {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
