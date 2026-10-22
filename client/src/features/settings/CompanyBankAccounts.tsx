import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Landmark, Loader2 } from 'lucide-react';
import { settingsApi, type CompanyBankAccount } from '../../api/settings.api';
import { storesApi } from '../../api/stores.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';

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
const formatRib = (rib: string) => `${rib.slice(0, 3)} ${rib.slice(3, 6)} ${rib.slice(6, 22)} ${rib.slice(22)}`;

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
        ...d, rib: d.rib.replace(/\s/g, ''), swift: d.swift || null, ledgerAccount: d.ledgerAccount || null, storeId: d.storeId || null,
      });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['company-bank-accounts'] }); notify.success('Compte bancaire enregistré'); setEditing(null); },
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });

  const open = (a?: CompanyBankAccount) => setEditing(a
    ? { id: a.id, draft: { label: a.label, bankName: a.bank_name, rib: a.rib, swift: a.swift ?? '', ledgerAccount: a.ledger_account ?? '', storeId: a.store_id ?? '', isDefault: a.is_default, showOnInvoices: a.show_on_invoices, isActive: a.is_active } }
    : { id: null, draft: { ...EMPTY, isDefault: accounts.length === 0 } });

  const ribDigits = editing?.draft.rib.replace(/\s/g, '') ?? '';
  const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' };
  const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };
  const set = (k: keyof Draft, v: string | boolean) => setEditing(e => e && { ...e, draft: { ...e.draft, [k]: v } });

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Comptes bancaires</div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Le compte par défaut figure sur les factures et sert aux virements.</div>
        </div>
        {!editing && !isError && (
          <button className="odoo-btn-primary" onClick={() => open()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> Ajouter un compte
          </button>
        )}
      </div>

      {isError && <StatusBanner tone="warning" icon={Landmark} title="Comptes bancaires indisponibles">La migration 331 n'est pas appliquée sur cette base.</StatusBanner>}
      {isLoading ? <Loader2 className="animate-spin" size={16} /> : accounts.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Compte</th><th>Banque</th><th>RIB</th><th>Compte comptable</th><th>Établissement</th><th>Statut</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.6 }}>
                  <td>{a.label} {a.is_default && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 4 }}>Par défaut</span>}</td>
                  <td>{a.bank_name}</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>{formatRib(a.rib)}</td>
                  <td>{a.ledger_account ?? '—'}</td>
                  <td>{a.store_name ?? 'Tous'}</td>
                  <td><span className={`odoo-tag ${a.is_active ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>{a.is_active ? (a.show_on_invoices ? 'Actif · sur factures' : 'Actif') : 'Fermé'}</span></td>
                  <td><button className="odoo-btn-secondary" style={{ padding: '2px 8px' }} onClick={() => open(a)} aria-label={`Modifier ${a.label}`}><Pencil size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!isLoading && !isError && !accounts.length && !editing && (
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--odoo-text-muted)' }}>Aucun compte bancaire : ajoutez celui de la société pour qu'il figure sur les factures.</p>
      )}

      {editing && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 16, display: 'grid', gap: 12, background: 'var(--odoo-bg-alt)' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ ...lab, flex: '1 1 180px' }}>Libellé
              <input id="bank-label" style={field} value={editing.draft.label} onChange={e => set('label', e.target.value)} placeholder="Compte courant" maxLength={80} />
            </label>
            <label style={{ ...lab, flex: '1 1 180px' }}>Banque
              <input id="bank-name" style={field} value={editing.draft.bankName} onChange={e => set('bankName', e.target.value)} placeholder="Attijariwafa bank" maxLength={80} />
            </label>
            <label style={{ ...lab, flex: '2 1 280px' }}>RIB (24 chiffres)
              <input id="bank-rib" style={{ ...field, fontFamily: 'ui-monospace, monospace' }} value={editing.draft.rib} inputMode="numeric"
                onChange={e => set('rib', e.target.value)} placeholder="000 000 0000000000000000 00" />
              <span style={{ fontSize: '0.75rem', color: ribDigits.length === 24 || !ribDigits ? 'var(--odoo-text-muted)' : 'var(--odoo-danger, #b3261e)' }}>
                {ribDigits.length}/24 chiffres · la clé est vérifiée à l'enregistrement
              </span>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ ...lab, width: 150 }}>SWIFT / BIC
              <input id="bank-swift" style={field} value={editing.draft.swift} onChange={e => set('swift', e.target.value.toUpperCase())} maxLength={11} />
            </label>
            <label style={{ ...lab, width: 150 }}>Compte comptable
              <input id="bank-ledger" style={field} value={editing.draft.ledgerAccount} onChange={e => set('ledgerAccount', e.target.value)} placeholder="5141" maxLength={10} />
            </label>
            <label style={{ ...lab, width: 200 }}>Établissement
              <select id="bank-store" style={field} value={editing.draft.storeId} onChange={e => set('storeId', e.target.value)}>
                <option value="">Tous</option>
                {stores.map((s: Record<string, any>) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.875rem' }}>
            {([['isDefault', 'Compte par défaut'], ['showOnInvoices', 'Afficher sur les factures'], ['isActive', 'Compte ouvert']] as const).map(([k, l]) => (
              <label key={k} htmlFor={`bank-${k}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input id={`bank-${k}`} type="checkbox" checked={editing.draft[k]} onChange={e => set(k, e.target.checked)} /> {l}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="odoo-btn-secondary" onClick={() => setEditing(null)}>Annuler</button>
            <button className="odoo-btn-primary" disabled={save.isPending || ribDigits.length !== 24 || !editing.draft.label.trim() || !editing.draft.bankName.trim()}
              onClick={() => save.mutate()}>
              {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
