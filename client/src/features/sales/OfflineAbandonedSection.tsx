import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { salesApi } from '../../api/sales.api';
import { money } from '../../utils/money';

/**
 * Ventes hors ligne abandonnées à la caisse (G0-21, mig 596), onglet Sessions.
 * Encaissées sans réseau, refusées par le serveur au renvoi, puis abandonnées par le
 * caissier avec un motif : la marchandise est sortie, l'argent a pu être encaissé.
 * Réservé à la direction (droit d'annuler un ticket) : sans ce droit, rien ne s'affiche.
 * Rien n'est affiché non plus quand la période n'en compte aucune.
 */
export default function OfflineAbandonedSection({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const { data } = useQuery({
    queryKey: ['sales-offline-abandoned', { dateFrom, dateTo }],
    queryFn: () => salesApi.offlineAbandoned({ dateFrom, dateTo }),
    retry: false,
  });
  if (!data || data.length === 0) return null;
  const total = data.reduce((s, a) => s + (a.total != null ? parseFloat(a.total) || 0 : 0), 0);
  return (
    <section>
      <div className="kl-sec">
        <h2>Ventes hors ligne abandonnées</h2>
        <small>{data.length} vente{data.length > 1 ? 's' : ''} · {money(total)} — refusées par le serveur puis abandonnées à la caisse</small>
      </div>
      <div className="kl-group">
        {data.map(a => (
          <div key={a.id} className="kl-cell" style={{ cursor: 'default' }}>
            <span className="tx">
              <span className="t1">
                {format(new Date(a.abandoned_at), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}
                {a.total != null && <> · <span className="tabular-nums">{money(parseFloat(a.total))}</span></>}
                {' · '}Réf. HL-{a.idempotency_key.slice(0, 8).toUpperCase()}
              </span>
              <span className="t2">
                {a.summary || 'Contenu non renseigné'}
                {a.store_name ? ` · ${a.store_name}` : ''}
                {a.abandoned_by_name ? ` · abandonnée par ${a.abandoned_by_name}` : ''}
              </span>
              <span className="t2">Refus du serveur : {a.reject_reason} · Motif de l'abandon : {a.abandon_reason}</span>
              {a.sale_number && <span className="t2">Attention : une vente {a.sale_number} existe sous cette référence (passée depuis une autre caisse ?).</span>}
            </span>
            <span className={`kl-pill ${a.sale_number ? 'o' : 'r'}`}>{a.sale_number ? 'À vérifier' : 'Abandonnée'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
