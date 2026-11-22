import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Power, Trash2, Lock, Info } from 'lucide-react';
import type { Account } from '@ofauria/shared';
import { Modal, FormSection, FormField, FormFooter } from '../../components/ds';
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
    <Modal title={account ? `Compte ${account.code}` : 'Nouveau compte'} onClose={onClose} width={560} locked={save.isPending}
      footer={
        <FormFooter onCancel={onClose} onSubmit={() => save.mutate()} busy={save.isPending} disabled={!validCode || label.trim().length < 2}>
          {account && (
            <>
              <button type="button" className="odoo-btn-secondary" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
                <Power size={13} /> {account.is_active ? 'Désactiver' : 'Réactiver'}
              </button>
              {neverUsed && (
                <button type="button" className="ds-btn-danger" disabled={remove.isPending}
                  onClick={async () => { if (await confirm(`Supprimer le compte ${account.code} ? Il n'a jamais été utilisé.`, { danger: true, confirmLabel: 'Supprimer' })) remove.mutate(); }}>
                  <Trash2 size={13} /> Supprimer
                </button>
              )}
            </>
          )}
        </FormFooter>
      }>
      {account && u && (
        locked
          ? <StatusBanner tone="neutral" icon={Lock} title={`Compte mouvementé : ${u.lines} ligne(s), solde ${n(Math.abs(u.balance))} ${u.balance >= 0 ? 'D' : 'C'}`}>
              Code, nature, sens et caractère collectif sont figés ; le libellé et la TVA restent modifiables.
            </StatusBanner>
          : u.references.length > 0 && <StatusBanner tone="info" icon={Info} title="Compte paramétré">Utilisé par : {u.references.map(r => `${r.what} (${r.n})`).join(', ')}.</StatusBanner>
      )}
      <FormSection title="Identification">
        <div className="ds-form-grid" style={{ gridTemplateColumns: '140px minmax(0, 1fr)' }}>
          <FormField label="Code" htmlFor="acc-code" required
            hint={validCode ? undefined : 'De 4 à 10 chiffres, classe 1 à 8.'}>
            <input id="acc-code" className="ds-input" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))} disabled={locked} inputMode="numeric" placeholder="61811" style={{ fontFamily: 'ui-monospace, monospace' }} autoFocus={!account} />
          </FormField>
          <FormField label="Libellé" htmlFor="acc-label" required>
            <input id="acc-label" className="ds-input" value={label} onChange={e => setLabel(e.target.value)} maxLength={200} autoFocus={!!account} />
          </FormField>
        </div>
        {validCode && (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ds-muted)' }}>
            Classe {code[0]} · rubrique {code.slice(0, 2)} · poste {code.slice(0, 3)}{parent ? ` · rattaché à ${parent.code} ${parent.label}` : ''}
          </p>
        )}
      </FormSection>
      <FormSection title="Comportement">
        <div className="ds-form-grid">
          <FormField label="Nature" htmlFor="acc-type">
            <select id="acc-type" className="ds-input" value={type} onChange={e => setType(e.target.value as Kind | '')} disabled={locked}>
              <option value="">{effType ? `Proposée : ${TYPES.find(t => t.key === effType)?.label}` : '—'}</option>
              {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </FormField>
          <FormField label="Sens normal du solde" htmlFor="acc-side">
            <select id="acc-side" className="ds-input" value={side} onChange={e => setSide(e.target.value as 'D' | 'C' | '')} disabled={locked}>
              <option value="">{effSide ? `Proposé : ${effSide === 'D' ? 'débit' : 'crédit'}` : '—'}</option>
              <option value="D">Débit</option>
              <option value="C">Crédit</option>
            </select>
          </FormField>
          {canCollective && (
            <FormField label="Compte collectif" htmlFor="acc-collective">
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 14, minHeight: 40 }}>
                <input id="acc-collective" type="checkbox" checked={collective} onChange={e => setCollective(e.target.checked)} disabled={locked} /> Suivi par tiers
              </label>
            </FormField>
          )}
          {canCollective && collective && (
            <FormField label="Tiers suivis" htmlFor="acc-aux">
              <select id="acc-aux" className="ds-input" value={auxKind} onChange={e => setAuxKind(e.target.value as typeof auxKind)} disabled={locked}>
                <option value="">{code.startsWith('34') ? 'Clients' : 'Fournisseurs'} (proposé)</option>
                <option value="customer">Clients</option>
                <option value="supplier">Fournisseurs</option>
              </select>
            </FormField>
          )}
          {canTva && (
            <FormField label={`Taux de TVA (${code.startsWith('3455') ? 'récupérable' : 'facturée'})`} htmlFor="acc-tva">
              <select id="acc-tva" className="ds-input" value={tvaRate} onChange={e => setTvaRate(e.target.value)}>
                <option value="">Aucun</option>
                {[20, 14, 10, 7].map(r => <option key={r} value={r}>{r} %</option>)}
              </select>
            </FormField>
          )}
        </div>
      </FormSection>
    </Modal>
  );
}
