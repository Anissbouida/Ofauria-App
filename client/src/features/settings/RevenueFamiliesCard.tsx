import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { revenueFamiliesApi, planComptableApi, type RevenueFamily } from '../../api/ledger.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

const DEFAULT_ACCOUNT = '7111';

/**
 * Paramètres › Règles comptables : compte de produit par famille (mig 481, phase 5.3).
 * Le générateur d'écritures ventile le chiffre d'affaires par ce compte (une ligne
 * de crédit par compte au lieu d'un seul 7111). Une famille sans compte choisi
 * retombe sur 7111. La résolution va de la ligne vendue → produit → catégorie →
 * famille, donc toutes les catégories d'une famille partagent le même compte.
 */
export default function RevenueFamiliesCard() {
  const qc = useQueryClient();
  const { data: families = [], isLoading } = useQuery<RevenueFamily[]>({
    queryKey: ['revenue-families'],
    queryFn: () => revenueFamiliesApi.list(),
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ['ledger', 'accounts'],
    queryFn: () => planComptableApi.list(),
  });

  // Comptes de produits (classe 7) proposés dans le sélecteur.
  const revenueAccounts = useMemo(
    () => accounts.filter(a => a.account_class === 7 && a.is_active)
      .sort((a, b) => a.code.localeCompare(b.code)),
    [accounts],
  );

  const setAccount = useMutation({
    mutationFn: ({ family, code }: { family: string; code: string }) =>
      code ? revenueFamiliesApi.set(family, code) : revenueFamiliesApi.clear(family).then(() => undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['revenue-families'] }); notify.success('Compte de produit mis à jour'); },
    onError: e => notify.error(apiErrorMessage(e, 'Modification impossible')),
  });

  return (
    <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: '12px 16px', background: 'var(--odoo-bg)', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <BookOpen size={16} style={{ color: 'var(--theme-accent)' }} />
        <div style={{ fontWeight: 600 }}>Comptes de produits par famille</div>
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        À la comptabilisation d'une vente (ticket ou facture), le chiffre d'affaires est ventilé
        sur le compte choisi ici, par famille de catégorie. Une famille sans compte choisi reste
        sur le compte par défaut <strong>{DEFAULT_ACCOUNT}</strong>.
      </div>

      {isLoading ? (
        <div style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Chargement…</div>
      ) : families.length === 0 ? (
        <div style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
          Aucune famille de catégorie définie. Créez-les dans « Catégories de vente ».
        </div>
      ) : (
        <table className="odoo-table" style={{ margin: 0 }}>
          <thead><tr>
            <th>Famille</th>
            <th style={{ width: 90, textAlign: 'center' }}>Catégories</th>
            <th style={{ width: 320 }}>Compte de produit</th>
          </tr></thead>
          <tbody>
            {families.map(f => (
              <tr key={f.family}>
                <td>{f.family}</td>
                <td style={{ textAlign: 'center', color: 'var(--theme-text-muted)' }}>{f.category_count}</td>
                <td>
                  <select
                    className="odoo-input"
                    style={{ width: '100%' }}
                    value={f.account_code ?? ''}
                    disabled={setAccount.isPending}
                    aria-label={`Compte de produit — ${f.family}`}
                    onChange={e => setAccount.mutate({ family: f.family, code: e.target.value })}
                  >
                    <option value="">{DEFAULT_ACCOUNT} — par défaut</option>
                    {revenueAccounts.map(a => (
                      <option key={a.code} value={a.code}>{a.code} — {a.label}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
