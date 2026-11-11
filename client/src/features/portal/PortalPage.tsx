import { useCallback, useEffect, useState } from 'react';

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

const money = (v: string | number) => `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
const day = (d: string) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');

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

  const shell: React.CSSProperties = { maxWidth: 880, margin: '0 auto', padding: '24px 16px', fontFamily: 'system-ui, sans-serif', color: '#2b2b2b' };

  if (!token) {
    return (
      <div style={shell}>
        <h1 style={{ color: '#8E4A1F' }}>Espace client</h1>
        <p>Saisissez le jeton d'accès fourni par votre commerce pour consulter vos commandes, factures et relevé.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="kptl_…" style={{ flex: 1, minWidth: 240, padding: 8, border: '1px solid #ccc', borderRadius: 6 }} />
          <button onClick={connect} style={{ padding: '8px 16px', background: '#8E4A1F', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer' }}>Accéder</button>
        </div>
        {error && <p style={{ color: '#b00020', marginTop: 12 }}>{error}</p>}
      </div>
    );
  }

  const name = customer?.company_name || `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim() || 'Client';
  const Th = ({ children }: { children: React.ReactNode }) => <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e0d8cc', fontSize: 13 }}>{children}</th>;
  const Td = ({ children, right }: { children: React.ReactNode; right?: boolean }) => <td style={{ padding: '6px 8px', borderBottom: '1px solid #efe9e0', textAlign: right ? 'right' : 'left' }}>{children}</td>;

  return (
    <div style={shell}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ color: '#8E4A1F', margin: 0 }}>Espace client</h1>
          <div style={{ opacity: 0.8 }}>{name}</div>
        </div>
        <button onClick={logout} style={{ padding: '6px 12px', background: 'transparent', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer' }}>Se déconnecter</button>
      </div>

      <div style={{ display: 'flex', gap: 4, margin: '16px 0', borderBottom: '1px solid #e0d8cc' }}>
        {([['invoices', 'Factures'], ['orders', 'Commandes'], ['statement', 'Relevé']] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ padding: '8px 14px', border: 0, borderBottom: tab === k ? '2px solid #8E4A1F' : '2px solid transparent', background: 'transparent', cursor: 'pointer', fontWeight: tab === k ? 600 : 400, color: tab === k ? '#8E4A1F' : '#555' }}>{lbl}</button>
        ))}
      </div>

      {error && <p style={{ color: '#b00020' }}>{error}</p>}
      {loading && <p style={{ opacity: 0.7 }}>Chargement…</p>}

      {tab === 'invoices' && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><Th>Numéro</Th><Th>Date</Th><Th>Montant</Th><Th>Payé</Th><Th>Statut</Th><Th>{''}</Th></tr></thead>
          <tbody>
            {invoices.map(i => (
              <tr key={i.id}>
                <Td>{i.invoice_number}{i.kind === 'credit_note' ? ' (avoir)' : ''}</Td>
                <Td>{day(i.invoice_date)}</Td>
                <Td right>{money(i.total_amount)}</Td>
                <Td right>{money(i.paid_amount)}</Td>
                <Td>{i.status}</Td>
                <Td right><button onClick={() => download(i)} style={{ padding: '4px 10px', background: '#8E4A1F', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer' }}>Télécharger</button></Td>
              </tr>
            ))}
            {!invoices.length && !loading && <tr><Td>—</Td><Td>{''}</Td><Td>{''}</Td><Td>{''}</Td><Td>{''}</Td><Td>{''}</Td></tr>}
          </tbody>
        </table>
      )}

      {tab === 'orders' && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><Th>Numéro</Th><Th>Date</Th><Th>Type</Th><Th>Montant</Th><Th>Statut</Th></tr></thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <Td>{o.order_number}</Td><Td>{day(o.created_at)}</Td><Td>{o.type}</Td><Td right>{money(o.total)}</Td><Td>{o.status}</Td>
              </tr>
            ))}
            {!orders.length && !loading && <tr><Td>—</Td><Td>{''}</Td><Td>{''}</Td><Td>{''}</Td><Td>{''}</Td></tr>}
          </tbody>
        </table>
      )}

      {tab === 'statement' && statement && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><Th>Facture</Th><Th>Date</Th><Th>Montant</Th><Th>Payé</Th><Th>Restant</Th></tr></thead>
            <tbody>
              {statement.lines.map((l, idx) => (
                <tr key={idx}>
                  <Td>{l.invoice_number}</Td><Td>{day(l.invoice_date)}</Td><Td right>{money(l.total_amount)}</Td><Td right>{money(l.paid_amount)}</Td><Td right>{money(l.outstanding)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ textAlign: 'right', fontWeight: 600, marginTop: 12 }}>Solde dû : {money(statement.outstanding)}</p>
        </>
      )}
    </div>
  );
}
