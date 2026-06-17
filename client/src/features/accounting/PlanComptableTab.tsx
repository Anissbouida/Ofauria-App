import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, X, Download, Loader2, ListTree, Users, Percent, Lock,
} from 'lucide-react';
import { planComptableApi } from '../../api/ledger.api';
import { useAuth } from '../../context/AuthContext';
import type { Account } from '@ofauria/shared';

// Libelle clair par classe CGNC pour l'arbre.
const CLASS_LABELS: Record<number, string> = {
  1: 'Financement permanent',
  2: 'Actif immobilise',
  3: 'Actif circulant',
  4: 'Passif circulant',
  5: 'Tresorerie',
  6: 'Charges',
  7: 'Produits',
  8: 'Resultats',
  9: 'Analytique',
};

const TYPE_LABELS: Record<string, string> = {
  asset: 'Actif',
  liability: 'Passif',
  equity: 'Capitaux',
  revenue: 'Produit',
  expense: 'Charge',
  result: 'Resultat',
};

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const BOM = '﻿';
  const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

export default function PlanComptableTab() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<number | 'all'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const isAdmin = user?.role === 'admin';

  // Tous les hooks DOIVENT etre appeles avant tout return conditionnel
  // (regle des hooks React : meme ordre a chaque render).
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['ledger-accounts'],
    queryFn: () => planComptableApi.list(),
    enabled: isAdmin,
  });

  // Filtres et regroupement par classe -> rubrique -> compte
  const filtered = useMemo(() => {
    let list = accounts as Account[];
    if (classFilter !== 'all') list = list.filter(a => a.account_class === classFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(a =>
        a.code.toLowerCase().includes(q) ||
        a.label.toLowerCase().includes(q)
      );
    }
    return list;
  }, [accounts, search, classFilter]);

  // Regroupe par classe puis par rubrique pour l'arbre
  const tree = useMemo(() => {
    const byClass = new Map<number, Map<string, Account[]>>();
    for (const acc of filtered) {
      if (!byClass.has(acc.account_class)) byClass.set(acc.account_class, new Map());
      const byRubrique = byClass.get(acc.account_class)!;
      if (!byRubrique.has(acc.rubrique)) byRubrique.set(acc.rubrique, []);
      byRubrique.get(acc.rubrique)!.push(acc);
    }
    return Array.from(byClass.entries())
      .map(([cls, rubs]) => ({
        cls,
        rubriques: Array.from(rubs.entries())
          .map(([rub, items]) => ({ rub, items: items.sort((a, b) => a.code.localeCompare(b.code)) }))
          .sort((a, b) => a.rub.localeCompare(b.rub)),
      }))
      .sort((a, b) => a.cls - b.cls);
  }, [filtered]);

  const stats = useMemo(() => {
    const total = (accounts as Account[]).length;
    const collective = (accounts as Account[]).filter(a => a.is_collective).length;
    const tva = (accounts as Account[]).filter(a => a.tva_rate !== null).length;
    const byClassCount = (accounts as Account[]).reduce((m, a) => {
      m[a.account_class] = (m[a.account_class] || 0) + 1;
      return m;
    }, {} as Record<number, number>);
    return { total, collective, tva, byClassCount };
  }, [accounts]);

  const toggleRubrique = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const handleExport = () => {
    const rows: string[][] = filtered.map(a => [
      a.code,
      a.label,
      String(a.account_class),
      a.rubrique,
      a.poste,
      TYPE_LABELS[a.account_type] || a.account_type,
      a.normal_side,
      a.is_collective ? 'Oui' : 'Non',
      a.auxiliary_kind || '',
      a.tva_rate || '',
      a.tva_direction || '',
    ]);
    exportCSV(
      `plan_comptable_${new Date().toISOString().slice(0, 10)}.csv`,
      ['CODE', 'LIBELLE', 'CLASSE', 'RUBRIQUE', 'POSTE', 'NATURE', 'SENS', 'COLLECTIF', 'TIERS', 'TVA %', 'TVA SENS'],
      rows
    );
  };

  // Garde non-admin — apres tous les hooks (regle des hooks React)
  if (!isAdmin) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.875rem' }}>
          Le plan comptable est reserve a l'administrateur. Contactez-le pour autoriser votre acces.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        <span style={{ marginLeft: 8, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Chargement du plan comptable...</span>
      </div>
    );
  }

  return (
    <>
      {/* En-tete + stats */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><ListTree size={11} style={{ display: 'inline', marginRight: 4 }} />Comptes actifs</div>
          <div className="odoo-stat-card-value">{stats.total}</div>
          <div className="odoo-stat-card-sub">Plan CGNC Maroc</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Users size={11} style={{ display: 'inline', marginRight: 4 }} />Comptes collectifs</div>
          <div className="odoo-stat-card-value">{stats.collective}</div>
          <div className="odoo-stat-card-sub">Avec auxiliaires tiers</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Percent size={11} style={{ display: 'inline', marginRight: 4 }} />Comptes TVA</div>
          <div className="odoo-stat-card-value">{stats.tva}</div>
          <div className="odoo-stat-card-sub">20%, 14%, 10%, 7%</div>
        </div>
      </div>

      {/* Filtres */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: '1 1 220px', minWidth: 180 }}>
          <Search size={13} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
          <input type="text" placeholder="Rechercher par code ou libelle..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="odoo-search-input" style={{ flex: 1, minWidth: 0 }} />
          {search && (
            <button onClick={() => setSearch('')} title="Effacer"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--theme-text-muted)', display: 'inline-flex' }}>
              <X size={12} />
            </button>
          )}
        </div>
        <select value={classFilter} onChange={e => setClassFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10))}
          className="odoo-search-input" style={{ minWidth: 200 }}>
          <option value="all">Toutes les classes</option>
          {[1, 2, 3, 4, 5, 6, 7].map(c => (
            <option key={c} value={c}>Classe {c} - {CLASS_LABELS[c]} ({stats.byClassCount[c] || 0})</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} className="odoo-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={13} /> Exporter CSV
        </button>
      </div>

      {/* Arbre des comptes */}
      {tree.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <ListTree size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucun compte ne correspond aux filtres</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tree.map(({ cls, rubriques }) => (
            <div key={cls} className="odoo-section" style={{ padding: 0 }}>
              <div style={{
                padding: '10px 14px',
                background: 'var(--theme-bg-secondary)',
                borderBottom: '1px solid var(--theme-bg-separator)',
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: 'var(--theme-text)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <span style={{
                  display: 'inline-block', width: 24, height: 24,
                  background: 'var(--theme-bg-card)',
                  borderRadius: 4, textAlign: 'center', lineHeight: '24px',
                  fontFamily: 'ui-monospace, monospace',
                }}>{cls}</span>
                Classe {cls} — {CLASS_LABELS[cls]}
                <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>
                  {rubriques.reduce((s, r) => s + r.items.length, 0)} comptes
                </span>
              </div>

              {rubriques.map(({ rub, items }) => {
                const key = `${cls}-${rub}`;
                const isOpen = expanded.has(key) || !!search;
                return (
                  <div key={key}>
                    <button onClick={() => toggleRubrique(key)} style={{
                      width: '100%', padding: '8px 14px', textAlign: 'left',
                      background: 'transparent', border: 'none',
                      borderBottom: '1px solid var(--theme-bg-separator)',
                      cursor: 'pointer', fontSize: '0.75rem',
                      color: 'var(--theme-text-muted)',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <span style={{ fontFamily: 'ui-monospace, monospace', minWidth: 32 }}>{rub}</span>
                      <span>Rubrique {rub}</span>
                      <span style={{ marginLeft: 'auto' }}>{items.length} compte{items.length > 1 ? 's' : ''}</span>
                    </button>
                    {isOpen && (
                      <table className="odoo-table" style={{ margin: 0 }}>
                        <thead>
                          <tr>
                            <th style={{ width: 90 }}>Code</th>
                            <th>Libelle</th>
                            <th style={{ width: 90 }}>Nature</th>
                            <th style={{ width: 60 }}>Sens</th>
                            <th style={{ width: 160 }}>Tags</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(acc => (
                            <tr key={acc.id}>
                              <td style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--theme-text)' }}>
                                <strong>{acc.code}</strong>
                              </td>
                              <td>{acc.label}</td>
                              <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                                {TYPE_LABELS[acc.account_type] || acc.account_type}
                              </td>
                              <td style={{ textAlign: 'center', fontWeight: 600, color: acc.normal_side === 'D' ? '#1565c0' : '#c62828' }}>
                                {acc.normal_side}
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  {acc.is_collective && acc.auxiliary_kind && (
                                    <span style={{
                                      fontSize: '0.625rem', padding: '2px 6px',
                                      background: '#EEEDFE', color: '#3C3489',
                                      borderRadius: 4, fontWeight: 500,
                                    }}>
                                      Tiers {acc.auxiliary_kind === 'supplier' ? 'fournisseur' : 'client'}
                                    </span>
                                  )}
                                  {acc.tva_rate && (
                                    <span style={{
                                      fontSize: '0.625rem', padding: '2px 6px',
                                      background: '#FAEEDA', color: '#633806',
                                      borderRadius: 4, fontWeight: 500,
                                    }}>
                                      TVA {acc.tva_rate}% {acc.tva_direction === 'collected' ? 'collectee' : 'recup.'}
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
