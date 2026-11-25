import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Fingerprint, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Modal, EmptyState, LoadingState, ErrorState } from '../../components/ds';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { authApi, passkeyCancelled, passkeysSupported, type Passkey } from '../../api/auth.api';

const DT = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmt = (at: string | null) => (at ? DT.format(new Date(at)) : 'jamais');

/** Ajoute une passkey sur cet appareil ; rend la passkey créée, ou null si annulé / refusé. */
export async function addPasskeyHere(): Promise<Passkey | null> {
  try {
    const p = await authApi.addPasskey();
    notify.success(`Passkey ajoutée : ${p.label}`);
    return p;
  } catch (e) {
    if (passkeyCancelled(e)) return null;
    const name = (e as { name?: string })?.name;
    notify.error(name === 'InvalidStateError' ? 'Cet appareil a déjà une passkey pour votre compte' : apiErrorMessage(e, 'Ajout de la passkey impossible'));
    return null;
  }
}

/**
 * « Mes passkeys » (mig 705) : connexion par Face ID, Touch ID, empreinte ou code de l'appareil,
 * sans mot de passe ni code. Liste, ajout sur cet appareil, renommage, suppression.
 */
export default function PasskeysModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: list, isLoading, isError, error, refetch } = useQuery({ queryKey: ['my-passkeys'], queryFn: authApi.passkeys });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const supported = passkeysSupported();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['my-passkeys'] });

  const add = async () => { setBusy(true); try { if (await addPasskeyHere()) await refresh(); } finally { setBusy(false); } };
  const saveLabel = async () => {
    if (!editing?.label.trim()) return;
    setBusy(true);
    try { await authApi.renamePasskey(editing.id, editing.label.trim()); setEditing(null); await refresh(); }
    catch (e) { notify.error(apiErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const remove = async (p: Passkey) => {
    const ok = await confirm(`« ${p.label} » ne permettra plus de vous connecter. Vous pourrez en ajouter une nouvelle à tout moment.`,
      { title: 'Supprimer cette passkey ?', confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    setBusy(true);
    try { await authApi.removePasskey(p.id); notify.success('Passkey supprimée'); await refresh(); }
    catch (e) { notify.error(apiErrorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal icon={Fingerprint} subtitle="Sécurité de mon compte" title="Mes passkeys" width={560} onClose={onClose} locked={busy}
      footer={
        <>
          <button type="button" className="odoo-btn-secondary" onClick={onClose} disabled={busy}>Fermer</button>
          {supported && (
            <button type="button" className="odoo-btn-primary" onClick={() => void add()} disabled={busy}>
              <Plus size={14} /> Ajouter une passkey sur cet appareil
            </button>
          )}
        </>
      }>
      <p style={{ fontSize: 13, color: 'var(--ds-muted)', margin: '0 0 12px' }}>
        Une passkey remplace le mot de passe et le code : vous vous connectez avec Face ID, Touch ID, votre empreinte ou le code de
        l'appareil. Elle reste sur votre appareil (et vos autres appareils Apple, Google ou Microsoft si la synchronisation est active).
        Depuis un ordinateur sans lecteur, le navigateur propose de scanner un QR code avec votre téléphone.
      </p>
      {!supported && (
        <div style={{ fontSize: 13, padding: 10, borderRadius: 8, background: 'var(--ds-warning-bg)', color: 'var(--ds-warning)', marginBottom: 12 }}>
          Ce navigateur ne gère pas les passkeys. Utilisez Chrome, Safari, Edge ou Firefox récents.
        </div>
      )}
      {isLoading ? <LoadingState bare /> : isError ? <ErrorState bare error={error} onRetry={() => void refetch()} /> : !list?.length ? (
        <EmptyState bare icon={Fingerprint} title="Aucune passkey" text="Ajoutez-en une pour vous connecter sans mot de passe ni code." />
      ) : (
        <ul style={{ display: 'grid', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
          {list.map(p => (
            <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--ds-sep)', borderRadius: 10 }}>
              <Fingerprint size={18} aria-hidden="true" style={{ color: 'var(--ds-accent)', flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {editing?.id === p.id ? (
                  <input className="input" autoFocus maxLength={80} value={editing.label} aria-label="Nom de la passkey"
                    onChange={e => setEditing({ id: p.id, label: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') void saveLabel(); if (e.key === 'Escape') setEditing(null); }} />
                ) : (
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.label}</div>
                )}
                <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>
                  Ajoutée le {fmt(p.createdAt)} · dernière connexion : {fmt(p.lastUsedAt)}{p.synced ? ' · synchronisée' : ''}
                </div>
              </div>
              {editing?.id === p.id ? (
                <>
                  <button type="button" className="ds-icon-btn" aria-label="Enregistrer le nom" disabled={busy} onClick={() => void saveLabel()}><Check size={16} /></button>
                  <button type="button" className="ds-icon-btn" aria-label="Annuler" onClick={() => setEditing(null)}><X size={16} /></button>
                </>
              ) : (
                <>
                  <button type="button" className="ds-icon-btn" aria-label={`Renommer ${p.label}`} disabled={busy} onClick={() => setEditing({ id: p.id, label: p.label })}><Pencil size={15} /></button>
                  <button type="button" className="ds-icon-btn" aria-label={`Supprimer ${p.label}`} disabled={busy} onClick={() => void remove(p)}><Trash2 size={15} /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Proposition unique après une connexion par code : ajouter une passkey sur cet appareil. */
export function PasskeySuggestModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const add = async () => { setBusy(true); try { if (await addPasskeyHere()) onClose(); } finally { setBusy(false); } };
  return (
    <Modal icon={Fingerprint} subtitle="Sécurité de mon compte" title="Ne plus saisir de code ?" width={480} onClose={onClose} locked={busy}
      footer={
        <>
          <button type="button" className="odoo-btn-secondary" onClick={onClose} disabled={busy}>Plus tard</button>
          <button type="button" className="odoo-btn-primary" onClick={() => void add()} disabled={busy}><Fingerprint size={14} /> Ajouter une passkey</button>
        </>
      }>
      <p style={{ fontSize: 14, margin: 0 }}>
        Ajoutez une passkey sur cet appareil : la prochaine fois, connectez-vous avec Face ID, Touch ID ou votre empreinte,
        sans mot de passe ni code. Vous la retrouverez dans le menu de votre compte, « Mes passkeys ».
      </p>
    </Modal>
  );
}
