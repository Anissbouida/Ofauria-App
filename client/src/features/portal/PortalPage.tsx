import { money } from '../../utils/money';
import { useCallback, useEffect, useState } from 'react';
import { Download, FileText, LogOut, ShoppingBag } from 'lucide-react';
import { Alert, DataPanel, EmptyState, FormField, LoadingState, PageHeader, TableFooter, Tabs } from '../../components/ds';

/**
 * Phase 10.3 — portail client (page publique, hors app interne).
 *
 * Le client s'identifie par un jeton (fourni par le commerce) stocké dans le
 * navigateur, et consulte ses commandes, factures et relevé. Les appels visent
 * /api/v1/portal/* avec l'en-tête Bearer — jamais le cookie de session de l'app.
 */

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api/v1/portal`;
const TOKEN_KEY = 'kalum_portal_token';

interface Customer { first_name: string | null; last_name: string | null; company_name: string | null; email: string | null }
interface Invoice { id: string; invoice_number: string; invoice_date: string; total_amount: string; paid_amount: string; status: string; kind: string }
interface Order { id: string; order_number: string; type: string; status: string; total: string; created_at: string }
interface StatementLine { invoice_number: string; invoice_date: string; total_amount: string; paid_amount: string; outstanding: string }

const day = (d: string) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function PortalPage() {
  const [token, setToken] = useState<string>(() => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } });
  const [input, setInput] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [tab, setTab] = useState<'invoices' | 'orders' | 'statement'>('invoices');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [statement, setStatement] = useState<{ lines: StatementLine[]; outstanding: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const call = useCallback(async (path: string) => {
    const resp = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.status === 401) { throw new Error('unauthorized'); }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()).data;
  }, [token]);

  const logout = useCallback(() => {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    setToken(''); setCustomer(null); setInvoices([]); setOrders([]); setStatement(null);
  }, []);

  // Charge les données dès qu'un jeton est présent.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true); setError('');
    (async () => {
      try {
        const [me, inv, ord, st] = await Promise.all([
          call('/me'), call('/invoices'), call('/orders'), call('/statement'),
        ]);
        if (cancelled) return;
        setCustomer(me); setInvoices(inv); setOrders(ord); setStatement(st);
      } catch (e) {
        if (cancelled) return;
        if ((e as Error).message === 'unauthorized') { logout(); setError('Jeton invalide ou expiré. Vérifiez le jeton fourni par votre commerce.'); }
        else setError('Impossible de charger vos données pour le moment.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [token, call, logout]);

  const download = async (inv: Invoice) => {
    try {
      const resp = await fetch(`${API_BASE}/invoices/${inv.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error();
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setError('Téléchargement impossible.'); }
  };

  const connect = () => { const t = input.trim(); if (!t) return; try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } setToken(t); setInput(''); };

  const shell: React.CSSProperties = { maxWidth: 960, margin: '0 auto', padding: '24px 16px 56px', display: 'flex', flexDirection: 'column', gap: 20 };

  if (!token) {
    return (
      <div className="odoo-scope kl-apple kl-ds" style={{ minHeight: '100vh', background: 'var(--ds-bg)' }}>
        <form style={{ ...shell, maxWidth: 560 }} onSubmit={e => { e.preventDefault(); connect(); }}>
          <PageHeader title="Espace client" description="Saisissez le jeton d'accès fourni par votre commerce pour consulter vos commandes, vos factures et votre relevé." />
          <FormField label="Jeton d'accès" htmlFor="portal-token" required error={error || undefined}>
            <input id="portal-token" className="ds-input" value={input} onChange={e => setInput(e.target.value)} placeholder="kptl_…" autoComplete="off" />
          </FormField>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="odoo-btn-primary" disabled={!input.trim()}>Accéder</button>
          </div>
        </form>
      </div>
    );
  }

  const name = customer?.company_name || `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim() || 'Client';
  const count = (n: number, noun: string) => `${n} ${noun}${n > 1 ? 's' : ''}`;

  return (
    <div className="odoo-scope kl-apple kl-ds" style={{ minHeight: '100vh', background: 'var(--ds-bg)' }}>
      <div style={shell}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <PageHeader title="Espace client" description={name} />
          <button type="button" className="odoo-btn-secondary" onClick={logout}><LogOut size={14} aria-hidden="true" /> Se déconnecter</button>
        </div>

        {error && <Alert tone="danger">{error}</Alert>}

        <Tabs label="Rubriques de l'espace client" value={tab} onChange={setTab}
          tabs={[{ key: 'invoices', label: 'Factures', count: invoices.length }, { key: 'orders', label: 'Commandes', count: orders.length }, { key: 'statement', label: 'Relevé' }]} />

        {loading ? <LoadingState label="Chargement de vos documents…" /> : (
          <>
            {tab === 'invoices' && (!invoices.length ? <EmptyState icon={FileText} title="Aucune facture" text="Vos factures s'afficheront ici dès leur émission." /> : (
              <DataPanel label="Factures" footer={<TableFooter note={count(invoices.length, 'facture')} />}>
                <table className="odoo-table">
                  <thead><tr><th>Numéro</th><th>Date</th><th className="ds-num">Montant</th><th className="ds-num">Payé</th><th>Statut</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {invoices.map(i => (
                      <tr key={i.id}>
                        <td className="ds-ref">{i.invoice_number}{i.kind === 'credit_note' ? ' (avoir)' : ''}</td>
                        <td>{day(i.invoice_date)}</td>
                        <td className="ds-num ds-strong">{money(i.total_amount)}</td>
                        <td className="ds-num">{money(i.paid_amount)}</td>
                        <td>{i.status}</td>
                        <td className="ds-actions">
                          <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => download(i)}><Download size={12} aria-hidden="true" /> Télécharger</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataPanel>
            ))}

            {tab === 'orders' && (!orders.length ? <EmptyState icon={ShoppingBag} title="Aucune commande" text="Vos commandes s'afficheront ici." /> : (
              <DataPanel label="Commandes" footer={<TableFooter note={count(orders.length, 'commande')} />}>
                <table className="odoo-table">
                  <thead><tr><th>Numéro</th><th>Date</th><th>Type</th><th className="ds-num">Montant</th><th>Statut</th></tr></thead>
                  <tbody>
                    {orders.map(o => (
                      <tr key={o.id}>
                        <td className="ds-ref">{o.order_number}</td><td>{day(o.created_at)}</td><td>{o.type}</td><td className="ds-num ds-strong">{money(o.total)}</td><td>{o.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataPanel>
            ))}

            {tab === 'statement' && statement && (!statement.lines.length ? <EmptyState icon={FileText} title="Aucune facture en attente" text="Votre compte est à jour." /> : (
              <DataPanel label="Relevé" footer={<TableFooter note={count(statement.lines.length, 'facture')} />}>
                <table className="odoo-table">
                  <thead><tr><th>Facture</th><th>Date</th><th className="ds-num">Montant</th><th className="ds-num">Payé</th><th className="ds-num">Restant</th></tr></thead>
                  <tbody>
                    {statement.lines.map((l, idx) => (
                      <tr key={idx}>
                        <td className="ds-ref">{l.invoice_number}</td><td>{day(l.invoice_date)}</td><td className="ds-num">{money(l.total_amount)}</td><td className="ds-num">{money(l.paid_amount)}</td><td className="ds-num ds-strong">{money(l.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={4}>Solde dû</td><td className="ds-num">{money(statement.outstanding)}</td></tr></tfoot>
                </table>
              </DataPanel>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
