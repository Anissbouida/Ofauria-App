import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiErrorMessage } from '../../api/errors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertTriangle, ShoppingCart, Package, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Onglet « À commander » du module Stock (ex-Économat, delta v1 point 5).
 * Centralise les ruptures BSI cross-plans : le magasinier voit toutes les ruptures actives
 * et peut declencher une commande fournisseur en lot (au lieu d'agir BSI par BSI dans le
 * panneau de production).
 *
 * Une ligne "deja commandee" (already_ordered=true cote serveur) est marquee visuellement
 * pour eviter les doublons de demande d'achat.
 */
export function RuptureRequestsList({ variant = 'tab' }: { variant?: 'tab' | 'compact' }) {
  const queryClient = useQueryClient();
  const [commandedLineIds, setCommandedLineIds] = useState<Set<string>>(new Set());

  const { data: rows = [], isLoading, error, isError } = useQuery<Record<string, any>[]>({
    queryKey: ['warehouse-rupture-requests'],
    queryFn: bonSortieApi.ruptureRequests,
    refetchInterval: 30000,
    retry: 1,
  });

  const commanderMutation = useMutation({
    mutationFn: (line: Record<string, any>) =>
      purchaseRequestsApi.create({
        ingredientId: line.ingredient_id as string,
        quantity: parseFloat(line.needed_quantity as string || '0'),
        unit: (line.unit || line.ingredient_unit || 'kg') as string,
        reason: 'production',
        note: `BSI ${line.bon_numero || ''} — rupture totale signalee depuis Economat`,
        supplierId: null,
      }),
    onSuccess: (_data, line) => {
      setCommandedLineIds(prev => new Set(prev).add(line.line_id as string));
      queryClient.invalidateQueries({ queryKey: ['warehouse-rupture-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests-grouped'] });
      notify.success('Ajoute a la liste d\'attente d\'achat');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || apiErrorMessage(e, 'Erreur ajout liste d\'attente')),
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--theme-accent)' }} />
      </div>
    );
  }
  if (isError) {
    const errMsg = (error as any)?.response?.data?.error || (error as any)?.message || 'Erreur inconnue';
    const status = (error as any)?.response?.status;
    return (
      <div className="odoo-alert danger">
        <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
        <div><span className="odoo-alert-title">Impossible de charger les ruptures</span> — {status ? `[${status}] ` : ''}{errMsg}</div>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <CheckCircle size={32} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Aucun ingrédient en rupture. Tous les bons de sortie actifs sont couverts.</p>
      </div>
    );
  }

  // Groupage par bon pour faciliter la lecture quand plusieurs ruptures viennent du meme bon.
  const groups = new Map<string, { bon_numero: string; plan_date?: string; plan_type?: string; lines: Record<string, any>[] }>();
  for (const r of rows) {
    const key = r.bon_id as string;
    if (!groups.has(key)) {
      groups.set(key, {
        bon_numero: r.bon_numero as string,
        plan_date: r.plan_date as string | undefined,
        plan_type: r.plan_type as string | undefined,
        lines: [],
      });
    }
    groups.get(key)!.lines.push(r);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {variant === 'tab' && (
        <div className="odoo-alert warning">
          <AlertTriangle size={14} style={{ color: '#856404', marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span className="odoo-alert-title">{rows.length} ingrédient{rows.length > 1 ? 's' : ''} en rupture sur les bons de sortie actifs</span>
            {' — '}absent du stock scellé et du stock entamé. Déclenchez la commande fournisseur ; après réception, « Actualiser le stock » sur le bon ré-alloue les lignes.
          </div>
        </div>
      )}

      {Array.from(groups.entries()).map(([bonId, g]) => (
        <div key={bonId} className="odoo-section">
          <div className="odoo-section-header">
            <Package size={12} />
            <span style={{ fontFamily: 'ui-monospace, monospace' }}>{g.bon_numero}</span>
            <span style={{ color: 'var(--theme-text-muted)' }}>·</span>
            <span>Plan du {g.plan_date ? format(new Date(g.plan_date), 'dd MMM yyyy', { locale: fr }) : '—'}</span>
            {g.plan_type && <span className="odoo-tag odoo-tag-grey">{g.plan_type}</span>}
            <div style={{ flex: 1 }} />
            <Link to={`/stock?tab=bons&bon=${bonId}`} className="odoo-btn-secondary" style={{ textDecoration: 'none' }}>Ouvrir le bon</Link>
          </div>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Ingrédient</th>
                <th style={{ textAlign: 'right' }}>Besoin</th>
                <th style={{ textAlign: 'right' }}>Disponible</th>
                <th style={{ textAlign: 'right' }}>Manque</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((l) => {
                const lineId = l.line_id as string;
                const need = parseFloat(l.needed_quantity as string || '0');
                const avail = parseFloat(l.allocated_quantity as string || '0');
                const missing = need - avail;
                const unit = (l.unit || l.ingredient_unit || 'kg') as string;
                const alreadyOrdered = !!l.already_ordered || commandedLineIds.has(lineId);
                const isPending = commanderMutation.isPending && (commanderMutation.variables as any)?.line_id === lineId;
                return (
                  <tr key={lineId} className="row-danger">
                    <td style={{ fontWeight: 500 }}>{l.ingredient_name as string}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{need.toFixed(2)} {unit}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--theme-text-muted)' }}>{avail.toFixed(2)} {unit}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: '#dc3545' }}>{missing.toFixed(2)} {unit}</td>
                    <td style={{ textAlign: 'right' }}>
                      {alreadyOrdered ? (
                        <span className="odoo-tag odoo-tag-green"><CheckCircle size={10} /> Commandé</span>
                      ) : (
                        <button type="button" onClick={() => commanderMutation.mutate(l)} disabled={isPending}
                          className="odoo-btn-primary" title={`Ajouter ${need.toFixed(2)} ${unit} à la liste d'attente d'achat`}>
                          {isPending ? <Loader2 size={12} className="animate-spin" /> : <ShoppingCart size={12} />} Commander
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
