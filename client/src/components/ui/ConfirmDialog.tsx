import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import ModalBackdrop from './ModalBackdrop';

/**
 * Confirmation et saisie de motif du système (remplacent window.confirm et window.prompt) :
 * même rendu partout (Design System), et une Promise pour garder le code appelant linéaire.
 *
 *   const confirm = useConfirm();
 *   if (await confirm('Supprimer ce plan ?', { danger: true })) ...
 *
 *   const prompt = usePrompt();
 *   const motif = await prompt('Pourquoi renvoyer cette action ?', { label: 'Motif', required: true });
 *   if (motif === null) return; // annulé
 */
export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action destructive : bouton de confirmation en style danger. */
  danger?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  /** Libellé du champ (visible). */
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  /** Saisie obligatoire : le bouton reste désactivé tant que le champ est vide. */
  required?: boolean;
  /** Zone de texte sur plusieurs lignes. */
  multiline?: boolean;
  /** Type du champ sur une ligne (texte, nombre…). */
  inputType?: 'text' | 'number';
  /** Aide sous le champ. */
  hint?: string;
}

type Pending =
  | { kind: 'confirm'; message: string; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; message: string; options: PromptOptions; resolve: (v: string | null) => void };

type Api = {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  prompt: (message: string, options?: PromptOptions) => Promise<string | null>;
};

const ConfirmContext = createContext<Api | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  const pendingRef = useRef<Pending | null>(null);
  const valueRef = useRef('');

  const setVal = (v: string) => { valueRef.current = v; setValue(v); };

  const cancelCurrent = () => {
    const p = pendingRef.current;
    if (!p) return;
    if (p.kind === 'confirm') p.resolve(false); else p.resolve(null);
  };

  const confirm = useCallback((message: string, options: ConfirmOptions = {}) => new Promise<boolean>(resolve => {
    // Une seule boîte à la fois : une demande qui en écrase une autre annule la précédente.
    cancelCurrent();
    const p: Pending = { kind: 'confirm', message, options, resolve };
    pendingRef.current = p;
    setPending(p);
  }), []);

  const prompt = useCallback((message: string, options: PromptOptions = {}) => new Promise<string | null>(resolve => {
    cancelCurrent();
    const p: Pending = { kind: 'prompt', message, options, resolve };
    pendingRef.current = p;
    setVal(options.defaultValue ?? '');
    setPending(p);
  }), []);

  const close = (ok: boolean) => {
    const p = pendingRef.current;
    if (p?.kind === 'confirm') p.resolve(ok);
    if (p?.kind === 'prompt') p.resolve(ok ? valueRef.current : null);
    pendingRef.current = null;
    setPending(null);
  };

  const o = pending?.options;
  const isPrompt = pending?.kind === 'prompt';
  const po = (isPrompt ? pending.options : {}) as PromptOptions;
  const blocked = isPrompt && !!po.required && !value.trim();

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}
      {pending && o && (
        <ModalBackdrop onClose={() => close(false)} className="fixed inset-0 z-[80] flex items-center justify-center p-4 ds-scrim">
          <form className="kl-ds ds-sheet ds-modal" role="alertdialog" aria-modal="true" aria-labelledby="ds-confirm-title"
            style={{ width: 'min(460px, 100%)' }}
            onSubmit={e => { e.preventDefault(); if (!blocked) close(true); }}
            onKeyDown={e => { if (e.key === 'Escape') close(false); }}>
            <header className="ds-sheet-head">
              {o.danger && <AlertTriangle size={18} aria-hidden="true" style={{ color: 'var(--ds-danger)', marginTop: 3, flex: 'none' }} />}
              <h2 id="ds-confirm-title" className="ds-sheet-title" style={{ fontSize: 17 }}>{o.title || (isPrompt ? 'Précisez' : 'Confirmation')}</h2>
            </header>
            <div className="ds-sheet-body" style={{ gap: 14 }}>
              <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-line', color: 'var(--ds-ink)' }}>{pending.message}</p>
              {isPrompt && (
                <div className="ds-field">
                  <label htmlFor="ds-prompt-input">{po.label || 'Motif'}{po.required && <span className="ds-req" aria-hidden="true"> *</span>}</label>
                  {po.multiline
                    ? <textarea id="ds-prompt-input" className="ds-input" autoFocus value={value} placeholder={po.placeholder}
                        onChange={e => setVal(e.target.value)} aria-required={po.required || undefined} />
                    : <input id="ds-prompt-input" className="ds-input" autoFocus type={po.inputType ?? 'text'} value={value} placeholder={po.placeholder}
                        onChange={e => setVal(e.target.value)} aria-required={po.required || undefined} />}
                  {po.hint && <span className="ds-field-hint">{po.hint}</span>}
                </div>
              )}
            </div>
            <div className="ds-form-foot">
              <span className="ds-grow" />
              <button type="button" className="odoo-btn-secondary" onClick={() => close(false)} autoFocus={!isPrompt}>
                {o.cancelLabel || 'Annuler'}
              </button>
              <button type="submit" className={o.danger ? 'ds-btn-danger solid' : 'odoo-btn-primary'} disabled={blocked}>
                {o.confirmLabel || 'Confirmer'}
              </button>
            </div>
          </form>
        </ModalBackdrop>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Hors provider (tests, pages isolées) : repli sur le navigateur.
    return (message: string) => Promise.resolve(window.confirm(message));
  }
  return ctx.confirm;
}

export function usePrompt() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) return (message: string, options?: PromptOptions) => Promise.resolve(window.prompt(message, options?.defaultValue ?? ''));
  return ctx.prompt;
}
