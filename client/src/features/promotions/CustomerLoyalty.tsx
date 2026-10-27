import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Loader2, Hourglass } from 'lucide-react';
import { format } from 'date-fns';
import { loyaltyApi, LOYALTY_KIND_LABEL } from '../../api/promotions.api';
import { apiErrorMessage } from '../../api/errors';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';

const n0 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
const n2 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' };

/** Onglet Fidélité de la fiche client (mig 372) : solde, niveau, points qui expirent, historique, ajustement. */
export default function CustomerLoyalty({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isDirection = user?.role === 'admin' || user?.role === 'manager';
  const { data: l, isLoading } = useQuery({ queryKey: ['loyalty', 'customer', customerId], queryFn: () => loyaltyApi.customer(customerId) });
  const [adj, setAdj] = useState({ points: '', note: '' });
  const adjust = useMutation({
    mutationFn: () => loyaltyApi.adjust(customerId, Number(adj.points), adj.note),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loyalty'] }); qc.invalidateQueries({ queryKey: ['customer-stats', customerId] }); setAdj({ points: '', note: '' }); notify.success('Points ajustés'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  if (isLoading || !l) return <div style={{ padding: 16 }}><Loader2 className="animate-spin" size={18} /></div>;
  const toNext = l.nextTier ? l.nextTier.min_points - l.points12m : 0;
  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      {!l.enabled && <StatusBanner tone="warning" icon={Award} title="Programme de fidélité désactivé">Les points ne sont ni gagnés ni utilisables tant que le programme est arrêté (Ventes › Promotions et fidélité).</StatusBanner>}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label">Solde</div>
          <div className="odoo-stat-card-value">{n0(l.balance)}</div>
          <div className="odoo-stat-card-sub">points · {n2(l.value)} DH</div>
        </div>
        <div className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label">Niveau</div>
          <div className="odoo-stat-card-value">{l.tier?.label ?? '—'}</div>
          <div className="odoo-stat-card-sub">
            {n0(l.points12m)} pts sur 12 mois{l.tier && Number(l.tier.earn_multiplier) > 1 ? ` · points ×${Number(l.tier.earn_multiplier).toLocaleString('fr-FR')}` : ''}
            {l.nextTier && <><br />{n0(toNext)} pts avant {l.nextTier.label}</>}
          </div>
        </div>
        <div className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label">Utilisable en caisse</div>
          <div className="odoo-stat-card-value">{l.redeemable > 0 ? 'Oui' : 'Pas encore'}</div>
          <div className="odoo-stat-card-sub">dès {n0(l.minRedeemPoints)} pts, jusqu'à {l.maxRedeemPct} % du ticket</div>
        </div>
      </div>
      {l.expiringSoon > 0 && (
        <StatusBanner tone="orange" icon={Hourglass} title={`${n0(l.expiringSoon)} points expirent bientôt`}>
          Premiers points perdus le {format(new Date(l.expiringFirst!), 'dd/MM/yyyy')} s'ils ne sont pas utilisés.
        </StatusBanner>
      )}
      {isDirection && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ ...field, width: 120 }} type="number" placeholder="± points" value={adj.points} onChange={e => setAdj({ ...adj, points: e.target.value })} />
          <input style={{ ...field, flex: '1 1 220px' }} maxLength={200} placeholder="Motif (geste commercial, correction…)" value={adj.note} onChange={e => setAdj({ ...adj, note: e.target.value })} />
          <button className="odoo-btn-secondary" disabled={!Number(adj.points) || adj.note.trim().length < 3 || adjust.isPending} onClick={() => adjust.mutate()}>Ajuster</button>
        </div>
      )}
      {l.history.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', margin: 0 }}>Aucun mouvement de points.</p> : (
        <table className="odoo-table">
          <thead><tr><th>Date</th><th>Mouvement</th><th style={{ textAlign: 'right' }}>Points</th><th>Détail</th><th>Expire le</th></tr></thead>
          <tbody>{l.history.map(t => (
            <tr key={t.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(t.created_at), 'dd/MM/yyyy HH:mm')}</td>
              <td>{LOYALTY_KIND_LABEL[t.kind]}</td>
              <td style={{ textAlign: 'right', color: t.points < 0 ? '#dc3545' : '#198754', fontWeight: 600 }}>{t.points > 0 ? '+' : ''}{n0(t.points)}</td>
              <td style={{ fontSize: '0.8125rem' }}>{t.note}{t.created_by_name ? ` · ${t.created_by_name}` : ''}</td>
              <td style={{ fontSize: '0.8125rem' }}>{t.remaining && t.expires_at ? `${format(new Date(t.expires_at), 'dd/MM/yyyy')}${t.remaining < t.points ? ` (${n0(t.remaining)} restants)` : ''}` : ''}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
