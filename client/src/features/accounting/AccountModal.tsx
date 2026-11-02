import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { X, Loader2, Save, Power, Trash2, Lock, Info } from 'lucide-react';
import type { Account } from '@ofauria/shared';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { planComptableApi } from '../../api/ledger.api';
import type { AccountInput } from '../../api/ledger.api';

/**
 * Création / modification d'un compte du plan (mig 429). Un compte mouvementé
 * ne change plus que de libellé, de TVA et d'état : les autres champs sont
 * verrouillés, avec la raison.
 */

type Kind = NonNullable<AccountInput['accountType']>;
const TYPES: { key: Kind; label: string }[] = [
  { key: 'asset', label: 'Actif' }, { key: 'liability', label: 'Passif' }, { key: 'equity', label: 'Capitaux' },
  { key: 'expense', label: 'Charge' }, { key: 'revenue', label: 'Produit' }, { key: 'result', label: 'Résultat' },
];
/** Mêmes propositions que le serveur (chart-of-accounts.repository). */
function defaultType(code: string): Kind {
  const c = Number(code[0]);
  if (c === 1) return code.startsWith('119') ? 'result' : /^1[4-8]/.test(code) ? 'liability' : 'equity';
  if (c === 2 || c === 3) return 'asset';
  if (c === 5) return code.startsWith('55') ? 'liability' : 'asset';
  if (c === 4) return 'liability';
  if (c === 6) return 'expense';
  if (c === 7) return 'revenue';
  return 'result';
}
const defaultSide = (code: string, t: Kind): 'D' | 'C' => (/^(28|29|39|59)/.test(code) ? 'C' : t === 'asset' || t === 'expense' ? 'D' : 'C');

const inputStyle = { width: '100%', padding: '6px 9px', border: '1px solid var(--theme-bg-separator)', borderRadius: 6, fontSize: '0.8125rem', background: 'var(--theme-bg-input)' };
const labelStyle = { fontSize: '0.75rem', color: 'var(--theme-text-muted)', display: 'block', marginBottom: 4 };
const n = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AccountModal({ account, accounts, onClose, onSaved }: {
  account: Account | null; accounts: Account[]; onClose: () => void; onSaved: () => void;
}) {
  const confirm = useConfirm();
  const [code, setCode] = useState(account?.code ?? '');
  const [label, setLabel] = useState(account?.label ?? '');
  const [type, setType] = useState<Kind | ''>(account?.account_type as Kind ?? '');
  const [side, setSide] = useState<'D' | 'C' | ''>(account?.normal_side as 'D' | 'C' ?? '');
  const [collective, setCollective] = useState(account?.is_collective ?? false);
  const [auxKind, setAuxKind] = useState<'supplier' | 'customer' | ''>(account?.auxiliary_kind as 'supplier' | 'customer' ?? '');
  const [tvaRate, setTvaRate] = useState<string>(account?.tva_rate != null ? String(Number(account.tva_rate)) : '');

  const usageQ = useQuery({ queryKey: ['account-usage', account?.id], queryFn: () => planComptableApi.usage(account!.id), enabled: !!account });
  const u = usageQ.data;
  const locked = !!u && u.lines > 0;
  const validCode = /^[1-8]\d{3,9}$/.test(code);
  const effType: Kind | '' = type || (validCode ? defaultType(code) : '');
  const effSide = side || (validCode && effType ? defaultSide(code, effType) : '');
  const canCollective = /^(34|44)/.test(code);
  const canTva = /^(3455|4455)/.test(code);
  const parent = validCode ? accounts.filter(a => code.startsWith(a.code) && a.code !== code).sort((a, b) => b.code.length - a.code.length)[0] : undefined;

  const body = (): AccountInput => ({
    code, label: label.trim(), accountType: effType || null, normalSide: effSide || null,
    isCollective: canCollective && collective, auxiliaryKind: canCollective && collective ? (auxKind || (code.startsWith('34') ? 'customer' : 'supplier')) : null,
    tvaRate: canTva && tvaRate ? Number(tvaRate) : null,
  });
  const save = useMutation({
    mutationFn: () => (account ? planComptableApi.update(account.id, body()) : planComptableApi.create(body())),
    onSuccess: (a) => { notify.success(`Compte ${a.code} ${account ? 'modifié' : 'créé'}`); onSaved(); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Enregistrement impossible')),
  });
  const toggle = useMutation({
    mutationFn: () => planComptableApi.setActive(account!.id, !account!.is_active),
    onSuccess: (a) => { notify.success(`Compte ${a.code} ${a.is_active ? 'réactivé' : 'désactivé'}`); onSaved(); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Changement d\'état impossible')),
  });
  const remove = useMutation({
    mutationFn: () => planComptableApi.remove(account!.id),
    onSuccess: () => { notify.success(`Compte ${account!.code} supprimé`); onSaved(); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Suppression impossible')),
  });
  const neverUsed = !!u && !u.lines && !u.children && !u.auxiliaries && !u.references.length && !u.history;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" role="dialog" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', borderRadius: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">{account ? `Compte ${account.code}` : 'Nouveau compte'}</span></div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {account && u && (
            locked
              ? <StatusBanner tone="neutral" icon={Lock} title={`Compte mouvementé : ${u.lines} ligne(s), solde ${n(Math.abs(u.balance))} ${u.balance >= 0 ? 'D' : 'C'}`}>
                  Code, nature, sens et caractère collectif sont figés ; le libellé et la TVA restent modifiables.
                </StatusBanner>
              : u.references.length > 0 && <StatusBanner tone="info" icon={Info} title="Compte paramétré">Utilisé par : {u.references.map(r => `${r.what} (${r.n})`).join(', ')}.</StatusBanner>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Code *</label>
              <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))} disabled={locked} inputMode="numeric" placeholder="61811" style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace' }} autoFocus={!account} />
            </div>
            <div><label style={labelStyle}>Libellé *</label><input value={label} onChange={e => setLabel(e.target.value)} maxLength={200} style={inputStyle} autoFocus={!!account} /></div>
          </div>
          {validCode && (
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              Classe {code[0]} · rubrique {code.slice(0, 2)} · poste {code.slice(0, 3)}{parent ? ` · rattaché à ${parent.code} ${parent.label}` : ''}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Nature</label>
              <select value={type} onChange={e => setType(e.target.value as Kind | '')} disabled={locked} style={inputStyle}>
                <option value="">{effType ? `Proposée : ${TYPES.find(t => t.key === effType)?.label}` : '—'}</option>
                {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Sens normal du solde</label>
              <select value={side} onChange={e => setSide(e.target.value as 'D' | 'C' | '')} disabled={locked} style={inputStyle}>
                <option value="">{effSide ? `Proposé : ${effSide === 'D' ? 'débit' : 'crédit'}` : '—'}</option>
                <option value="D">Débit</option>
                <option value="C">Crédit</option>
              </select>
            </div>
          </div>
          {canCollective && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: '0.8125rem' }}>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={collective} onChange={e => setCollective(e.target.checked)} disabled={locked} /> Compte collectif (suivi par tiers)
              </label>
              {collective && (
                <select value={auxKind} onChange={e => setAuxKind(e.target.value as typeof auxKind)} disabled={locked} style={{ ...inputStyle, width: 'auto' }}>
                  <option value="">{code.startsWith('34') ? 'Clients' : 'Fournisseurs'} (proposé)</option>
                  <option value="customer">Clients</option>
                  <option value="supplier">Fournisseurs</option>
                </select>
              )}
            </div>
          )}
          {canTva && (
            <div style={{ maxWidth: 220 }}>
              <label style={labelStyle}>Taux de TVA ({code.startsWith('3455') ? 'récupérable' : 'facturée'})</label>
              <select value={tvaRate} onChange={e => setTvaRate(e.target.value)} style={inputStyle}>
                <option value="">Aucun</option>
                {[20, 14, 10, 7].map(r => <option key={r} value={r}>{r} %</option>)}
              </select>
            </div>
          )}
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--theme-bg-separator)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {account && (
            <>
              <button type="button" className="odoo-btn-secondary" disabled={toggle.isPending} onClick={() => toggle.mutate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Power size={13} /> {account.is_active ? 'Désactiver' : 'Réactiver'}
              </button>
              {neverUsed && (
                <button type="button" className="odoo-btn-secondary" disabled={remove.isPending} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#c62828' }}
                  onClick={async () => { if (await confirm(`Supprimer le compte ${account.code} ? Il n'a jamais été utilisé.`, { danger: true, confirmLabel: 'Supprimer' })) remove.mutate(); }}>
                  <Trash2 size={13} /> Supprimer
                </button>
              )}
            </>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button type="button" onClick={() => save.mutate()} disabled={!validCode || label.trim().length < 2 || save.isPending} className="odoo-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: !validCode || label.trim().length < 2 ? 0.5 : 1 }}>
            {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Enregistrer
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
