import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import ModalBackdrop from './ModalBackdrop';

/**
 * Confirmation du systeme (remplace window.confirm) : meme rendu partout,
 * boutons odoo-*, et une Promise<boolean> pour garder le code appelant lineaire.
 *
 *   const confirm = useConfirm();
 *   if (await confirm('Supprimer ce plan ?', { danger: true })) ...
 */
export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action destructive : bouton de confirmation en style danger. */
  danger?: boolean;
}

type Pending = { message: string; options: ConfirmOptions; resolve: (ok: boolean) => void };

const ConfirmContext = createContext<((message: string, options?: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback((message: string, options: ConfirmOptions = {}) => {
    return new Promise<boolean>((resolve) => {
      // Une seule boite a la fois : une demande qui en ecrase une autre annule la precedente.
      pendingRef.current?.resolve(false);
      const p = { message, options, resolve };
      pendingRef.current = p;
      setPending(p);
    });
  }, []);

  const close = (ok: boolean) => {
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ModalBackdrop onClose={() => close(false)} className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="odoo-scope" role="alertdialog" aria-modal="true"
            style={{ width: 'min(440px, 92vw)', borderRadius: 6, border: '1px solid var(--theme-bg-separator)', overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}>
            <div className="odoo-section-header">
              {pending.options.danger && <AlertTriangle size={12} style={{ color: '#721c24' }} />}
              {pending.options.title || 'Confirmation'}
            </div>
            <div style={{ padding: '1rem', fontSize: '0.875rem', whiteSpace: 'pre-line', color: 'var(--theme-text-strong)' }}>
              {pending.message}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.75rem 1rem', borderTop: '1px solid var(--theme-bg-separator)', background: 'var(--theme-bg-page)' }}>
              <button type="button" className="odoo-btn-secondary" onClick={() => close(false)} autoFocus>
                {pending.options.cancelLabel || 'Annuler'}
              </button>
              <button type="button" className={pending.options.danger ? 'odoo-btn-danger' : 'odoo-btn-primary'} onClick={() => close(true)}>
                {pending.options.confirmLabel || 'Confirmer'}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Hors provider (tests, pages isolees) : repli sur le navigateur.
    return (message: string) => Promise.resolve(window.confirm(message));
  }
  return ctx;
}
