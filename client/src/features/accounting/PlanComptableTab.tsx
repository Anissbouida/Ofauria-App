import { useState, useMemo } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download, Lock, Plus, Pencil,
} from 'lucide-react';
import AccountModal from './AccountModal';
import { planComptableApi } from '../../api/ledger.api';
import { useAuth } from '../../context/AuthContext';
import type { Account } from '@ofauria/shared';
import { EmptyState, KpiCard, KpiGrid, DataPanel, LoadingState, NoResultState, SearchBar } from '../../components/ds';
import { AccHeaderActions } from './AccHeaderActions';
import { StatusTag } from '../../components/ui/StatusTag';

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
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const queryClient = useQueryClient();

  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

  // Tous les hooks DOIVENT etre appeles avant tout return conditionnel
  // (regle des hooks React : meme ordre a chaque render).
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['ledger-accounts', 'all'],
    queryFn: () => planComptableApi.list(true),
    enabled: isAdmin,
  });

  // Filtres et regroupement par classe -> rubrique -> compte
  const filtered = useMemo(() => {
    let list = (accounts as Account[]).filter(a => showInactive || a.is_active);
    if (classFilter !== 'all') list = list.filter(a => a.account_class === classFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(a =>
        a.code.toLowerCase().includes(q) ||
        a.label.toLowerCase().includes(q)
      );
    }
    return list;
  }, [accounts, search, classFilter, showInactive]);

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
    const total = (accounts as Account[]).filter(a => a.is_active).length;
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
      <EmptyState icon={Lock} title="Le plan comptable est reserve a l'administrateur ou au gerant. Contactez l'admin pour autoriser votre acces." />
    );
  }

  if (isLoading) {
    return (
      <LoadingState label="Chargement du plan comptable…" />
    );
  }

  return (
    <>
      {/* Indicateurs */}
      <KpiGrid>
        <KpiCard label="Comptes actifs" value={stats.total} sub="Plan CGNC Maroc" />
        <KpiCard label="Comptes collectifs" value={stats.collective} sub="Avec auxiliaires tiers" />
        <KpiCard label="Comptes TVA" value={stats.tva} sub="20%, 14%, 10%, 7%" />
      </KpiGrid>

      {/* Filtres */}
      <AccHeaderActions>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary">
          <Download size={13} aria-hidden="true" /> Exporter CSV
        </button>
        <button type="button" onClick={() => setEditing('new')} className="odoo-btn-primary">
          <Plus size={13} aria-hidden="true" /> Nouveau compte
        </button>
      </AccHeaderActions>

      <div className="prj-toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Rechercher par code ou libellé…" />
        <SearchSelect
          options={[1, 2, 3, 4, 5, 6, 7].map(c => ({
            id: String(c),
            label: `Classe ${c} - ${CLASS_LABELS[c]}`,
            detail: `${stats.byClassCount[c] || 0}`,
          }))}
          value={classFilter === 'all' ? '' : String(classFilter)}
          onChange={id => setClassFilter(id === '' ? 'all' : parseInt(id, 10))}
          placeholder="Toutes les classes"
          width={220}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Afficher les inactifs
        </label>
      </div>

      {/* Arbre des comptes */}
      {tree.length === 0 ? (
        <NoResultState text="Aucun compte ne correspond aux filtres." onReset={() => { setSearch(''); setClassFilter('all'); }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tree.map(({ cls, rubriques }) => (
            <DataPanel key={cls} label={`Classe ${cls}`}>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--ds-sep)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 className="ds-subhead">Classe {cls} — {CLASS_LABELS[cls]}</h2>
                <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ds-muted)' }}>
                  {rubriques.reduce((s, r) => s + r.items.length, 0)} comptes
                </span>
              </div>

              {rubriques.map(({ rub, items }) => {
                const key = `${cls}-${rub}`;
                const isOpen = expanded.has(key) || !!search;
                return (
                  <div key={key}>
                    <button type="button" onClick={() => toggleRubrique(key)} aria-expanded={isOpen} style={{
                      width: '100%', padding: '8px 20px', textAlign: 'left',
                      background: 'transparent', border: 'none',
                      borderBottom: '1px solid var(--ds-hair)',
                      cursor: 'pointer', fontSize: 13,
                      color: 'var(--ds-muted)',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <span className="ds-ref" style={{ minWidth: 32 }}>{rub}</span>
                      <span>Rubrique {rub}</span>
                      <span style={{ marginLeft: 'auto' }}>{items.length} compte{items.length > 1 ? 's' : ''}</span>
                    </button>
                    {isOpen && (
                      <table className="odoo-table ds-dense">
                        <thead>
                          <tr>
                            <th style={{ width: 90 }}>Code</th>
                            <th>Libellé</th>
                            <th style={{ width: 110 }}>Nature</th>
                            <th style={{ width: 70 }}>Sens</th>
                            <th style={{ width: 240 }}>Attributs</th>
                            <th className="ds-actions" style={{ width: 50 }}><span className="ds-sr-only">Actions</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(acc => (
                            <tr key={acc.id} style={{ opacity: acc.is_active ? 1 : 0.5 }}>
                              <td className="ds-ref">{acc.code}</td>
                              <td className="ds-strong">{acc.label}</td>
                              <td style={{ color: 'var(--ds-muted)' }}>
                                {TYPE_LABELS[acc.account_type] || acc.account_type}
                              </td>
                              <td title={acc.normal_side === 'D' ? 'Compte de sens débiteur' : 'Compte de sens créditeur'}>
                                {acc.normal_side === 'D' ? 'Débit' : 'Crédit'}
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                  {acc.is_collective && acc.auxiliary_kind && (
                                    <span className="ds-field-hint">Tiers {acc.auxiliary_kind === 'supplier' ? 'fournisseur' : 'client'}</span>
                                  )}
                                  {acc.tva_rate && (
                                    <span className="ds-field-hint">TVA {acc.tva_rate} % {acc.tva_direction === 'collected' ? 'collectée' : 'récupérable'}</span>
                                  )}
                                  {!acc.is_active && <StatusTag tone="draft" label="Inactif" />}
                                </div>
                              </td>
                              <td className="ds-actions">
                                <button type="button" onClick={() => setEditing(acc)} className="ds-icon-btn" title="Modifier le compte" aria-label={`Modifier le compte ${acc.code}`}><Pencil size={11} /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </DataPanel>
          ))}
        </div>
      )}
      {editing && (
        <AccountModal account={editing === 'new' ? null : editing} accounts={accounts as Account[]}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); queryClient.invalidateQueries({ queryKey: ['ledger-accounts'] }); }} />
      )}
    </>
  );
}
