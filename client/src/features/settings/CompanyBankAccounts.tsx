import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Landmark } from 'lucide-react';
import { settingsApi, type CompanyBankAccount } from '../../api/settings.api';
import { storesApi } from '../../api/stores.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { settingAnchor } from './SettingsPrimitives';
import { DataPanel, EmptyState, FormField, FormFooter, LoadingState, SectionHeader } from '../../components/ds';
import { ribDigitsOf, ribHint, ribLiveError } from '../../utils/rib';

/**
 * Comptes bancaires de la société (audit Paramètres, lot 5, mig 331). Le RIB
 * (24 chiffres) est contrôlé par sa clé côté serveur ; le compte par défaut est
 * celui que les documents utiliseront.
 */

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } | string } } };
  const er = e?.response?.data?.error;
  return typeof er === 'string' ? er : er?.message || fallback;
}

/** RIB par blocs : banque (3), localité (3), compte (16), clé (2). */
export const formatRib = (rib: string) => `${rib.slice(0, 3)} ${rib.slice(3, 6)} ${rib.slice(6, 22)} ${rib.slice(22)}`;

type Draft = { label: string; bankName: string; rib: string; swift: string; ledgerAccount: string; storeId: string; isDefault: boolean; showOnInvoices: boolean; isActive: boolean };
const EMPTY: Draft = { label: '', bankName: '', rib: '', swift: '', ledgerAccount: '5141', storeId: '', isDefault: false, showOnInvoices: true, isActive: true };

export default function CompanyBankAccounts() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const { data: accounts = [], isLoading, isError } = useQuery({ queryKey: ['company-bank-accounts'], queryFn: settingsApi.bankAccounts, retry: false });
  const { data: stores = [] } = useQuery({ queryKey: ['stores'], queryFn: storesApi.list });

  const save = useMutation({
    mutationFn: () => {
      const d = editing!.draft;
      return settingsApi.saveBankAccount(editing!.id, {
        ...d, rib: ribDigitsOf(d.rib), swift: d.swift || null, ledgerAccount: d.ledgerAccount || null, storeId: d.storeId || null,
      });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['company-bank-accounts'] }); notify.success('Compte bancaire enregistré'); setEditing(null); },
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });

  const open = (a?: CompanyBankAccount) => setEditing(a
    ? { id: a.id, draft: { label: a.label, bankName: a.bank_name, rib: a.rib, swift: a.swift ?? '', ledgerAccount: a.ledger_account ?? '', storeId: a.store_id ?? '', isDefault: a.is_default, showOnInvoices: a.show_on_invoices, isActive: a.is_active } }
    : { id: null, draft: { ...EMPTY, isDefault: accounts.length === 0 } });

  const ribDigits = ribDigitsOf(editing?.draft.rib);
  const ribError = ribLiveError(editing?.draft.rib);
  const set = (k: keyof Draft, v: string | boolean) => setEditing(e => e && { ...e, draft: { ...e.draft, [k]: v } });

  return (
    <div id={settingAnchor('Comptes bancaires')} data-toc="Comptes bancaires" className="odoo-scope" style={{ display: 'grid', gap: 10, scrollMarginTop: '1rem' }}>
      <SectionHeader title="Comptes bancaires" note="Le compte par défaut figure sur les factures et sert aux virements.">
        {!editing && !isError && (
          <button type="button" className="odoo-btn-primary" onClick={() => open()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> Ajouter un compte
          </button>
        )}
      </SectionHeader>

      {isError && <StatusBanner tone="warning" icon={Landmark} title="Comptes bancaires indisponibles">La migration 331 n'est pas appliquée sur cette base.</StatusBanner>}
      {isLoading ? <LoadingState /> : accounts.length > 0 && (
        <DataPanel label="Comptes bancaires">
          <table className="odoo-table">
            <thead><tr><th>Compte</th><th>Banque</th><th>RIB</th><th>Compte comptable</th><th>Établissement</th><th>Statut</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.6 }}>
                  <td className="ds-strong">{a.label} {a.is_default && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 4 }}>Par défaut</span>}</td>
                  <td>{a.bank_name}</td>
                  <td className="ds-ref" style={{ whiteSpace: 'nowrap' }}>{formatRib(a.rib)}</td>
                  <td className="ds-ref">{a.ledger_account ?? '—'}</td>
                  <td>{a.store_name ?? 'Tous'}</td>
                  <td><StatusTag tone={a.is_active ? 'done' : 'cancelled'} label={a.is_active ? (a.show_on_invoices ? 'Actif · sur factures' : 'Actif') : 'Fermé'} /></td>
                  <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => open(a)} aria-label={`Modifier ${a.label}`}>Modifier</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
      {!isLoading && !isError && !accounts.length && !editing && (
        <EmptyState icon={Landmark} title="Aucun compte bancaire" text="Ajoutez celui de la société pour qu'il figure sur les factures." />
      )}

      {editing && (
        <section className="ds-panel" style={{ padding: '16px 18px', display: 'grid', gap: 12 }} aria-label={editing.id ? 'Modifier le compte bancaire' : 'Nouveau compte bancaire'}>
          <div className="ds-form-grid">
            <FormField label="Libellé" htmlFor="bank-label" required>
              <input id="bank-label" className="ds-input" value={editing.draft.label} onChange={e => set('label', e.target.value)} placeholder="Compte courant" maxLength={80} />
            </FormField>
            <FormField label="Banque" htmlFor="bank-name" required>
              <input id="bank-name" className="ds-input" value={editing.draft.bankName} onChange={e => set('bankName', e.target.value)} placeholder="Attijariwafa bank" maxLength={80} />
            </FormField>
            <FormField label="RIB (24 chiffres)" htmlFor="bank-rib" required
              hint={ribHint(editing.draft.rib)}
              error={ribError}>
              <input id="bank-rib" className="ds-input" style={{ fontFamily: 'ui-monospace, monospace' }} value={editing.draft.rib} inputMode="numeric"
                onChange={e => set('rib', e.target.value)} placeholder="000 000 0000000000000000 00" />
            </FormField>
            <FormField label="SWIFT / BIC" htmlFor="bank-swift">
              <input id="bank-swift" className="ds-input" value={editing.draft.swift} onChange={e => set('swift', e.target.value.toUpperCase())} maxLength={11} />
            </FormField>
            <FormField label="Compte comptable" htmlFor="bank-ledger">
              <input id="bank-ledger" className="ds-input" value={editing.draft.ledgerAccount} onChange={e => set('ledgerAccount', e.target.value)} placeholder="5141" maxLength={10} />
            </FormField>
            <FormField label="Établissement" htmlFor="bank-store">
              <select id="bank-store" className="ds-input" value={editing.draft.storeId} onChange={e => set('storeId', e.target.value)}>
                <option value="">Tous</option>
                {stores.map((s: Record<string, any>) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </FormField>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '14px' }}>
            {([['isDefault', 'Compte par défaut'], ['showOnInvoices', 'Afficher sur les factures'], ['isActive', 'Compte ouvert']] as const).map(([k, l]) => (
              <label key={k} htmlFor={`bank-${k}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input id={`bank-${k}`} type="checkbox" checked={editing.draft[k]} onChange={e => set(k, e.target.checked)} /> {l}
              </label>
            ))}
          </div>
          <FormFooter onCancel={() => setEditing(null)} busy={save.isPending}
            disabled={ribDigits.length !== 24 || !!ribError || !editing.draft.label.trim() || !editing.draft.bankName.trim()}
            onSubmit={() => save.mutate()} />
        </section>
      )}
    </div>
  );
}
