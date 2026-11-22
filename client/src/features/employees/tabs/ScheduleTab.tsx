import { Fragment, useEffect, useMemo, useState } from 'react';
import SearchSelect from '../../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { schedulesApi, shiftsApi } from '../../../api/employees.api';
import { format, startOfWeek, endOfWeek, addWeeks, eachDayOfInterval, subWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Users, CalendarOff, ChevronLeft, ChevronRight, ChevronDown, AlertTriangle, Copy, Eraser, Save, Sparkles, Printer,
} from 'lucide-react';
import { notify } from '../../../components/ui/InlineNotification';
import { ROLE_LABELS, SHIFT_SHORT_LABELS, SHIFT_HOURS } from '@ofauria/shared';
import type { ShiftCode } from '@ofauria/shared';
import { LEAVE_TYPE_LABELS, shiftStyle } from '../shared';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { EmptyState, HrHeaderActions } from '../ui';
import { Toolbar, DataPanel, TableFooter } from '../../../components/ds';

/* ═══════════════════════ SCHEDULE TAB (planning hebdomadaire) ═══════════════════════ */
type LeaveInfoUI = { type: string; status: 'approved' | 'pending'; startDate: string; endDate: string };
type WeekRow = {
  employeeId: string;
  firstName: string;
  lastName: string;
  role: string;
  defaultShiftCode: ShiftCode | null;
  assignments: Record<string, ShiftCode | null>;
  onLeaveDays: string[];
  leaveDays: Record<string, LeaveInfoUI>;
};

type WeekData = { weekStart: string; weekEnd: string; rows: WeekRow[] };

const REPOS = '__REPOS__';

function leaveLabel(info: LeaveInfoUI): string {
  const t = LEAVE_TYPE_LABELS[info.type] ?? info.type;
  return info.status === 'pending' ? `${t} (en attente)` : t;
}

function leaveTooltip(info: LeaveInfoUI): string {
  const period = info.startDate === info.endDate
    ? info.startDate
    : `du ${info.startDate} au ${info.endDate}`;
  return `${leaveLabel(info)} — ${period}`;
}

export default function ScheduleTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const confirm = useConfirm();

  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const prevWeekStr = format(startOfWeek(subWeeks(weekStart, 1), { weekStartsOn: 1 }), 'yyyy-MM-dd');

  const { data: week } = useQuery<WeekData>({
    queryKey: ['schedules', 'week', weekStartStr],
    queryFn: () => schedulesApi.getWeek(weekStartStr) as Promise<WeekData>,
  });

  const { data: shifts = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['shifts'],
    queryFn: shiftsApi.list as () => Promise<Record<string, any>[]>,
  });

  // Etat local : matrice editable indexee par employeeId -> dateStr -> ShiftCode|null
  // null = repos, undefined = inchange depuis la base
  const [draft, setDraft] = useState<Record<string, Record<string, ShiftCode | null>>>({});
  useEffect(() => { setDraft({}); }, [weekStartStr]);

  const rows = useMemo<WeekRow[]>(() => {
    const base = week?.rows ?? [];
    if (roleFilter === 'all') return base;
    return base.filter(r => r.role === roleFilter);
  }, [week, roleFilter]);

  const allRoles = useMemo(() => {
    const set = new Set<string>();
    (week?.rows ?? []).forEach(r => set.add(r.role));
    return Array.from(set);
  }, [week]);

  // Regroupement par profil (role) pour faciliter la planification.
  // Les groupes sont tries alphabetiquement par libelle.
  // Cas particulier : Caissier(e) + Vendeuse sont fusionnes en un seul groupe
  // "Caissière & Vendeuse" pour la vue planning (les roles restent distincts
  // dans la base et dans le reste de l'app — c'est juste un regroupement
  // visuel pour la planification de la salle).
  const groupedRows = useMemo(() => {
    const planningGroup = (role: string): { key: string; label: string } => {
      if (role === 'cashier' || role === 'saleswoman') {
        return { key: 'sales_floor', label: 'Caissière & Vendeuse' };
      }
      return { key: role, label: ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role };
    };
    const map = new Map<string, { label: string; rows: WeekRow[] }>();
    for (const r of rows) {
      const { key, label } = planningGroup(r.role);
      const bucket = map.get(key) ?? { label, rows: [] };
      bucket.rows.push(r);
      map.set(key, bucket);
    }
    return Array.from(map.entries())
      .map(([key, { label, rows: list }]) => ({ role: key, label, rows: list }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  }, [rows]);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (role: string) =>
    setCollapsedGroups(g => ({ ...g, [role]: !g[role] }));

  const getCell = (empId: string, dateStr: string): ShiftCode | null => {
    const local = draft[empId]?.[dateStr];
    if (local !== undefined) return local;
    return (week?.rows.find(r => r.employeeId === empId)?.assignments[dateStr] ?? null);
  };

  const setCell = (empId: string, dateStr: string, value: ShiftCode | null) => {
    setDraft(d => ({ ...d, [empId]: { ...(d[empId] ?? {}), [dateStr]: value } }));
  };

  const getLeaveInfo = (row: WeekRow, dateStr: string): LeaveInfoUI | null =>
    row.leaveDays?.[dateStr] ?? null;
  // Un conge approuve bloque l'edition. Un conge en attente est juste un
  // avertissement (verrouille soft : l'admin peut encore changer s'il sait
  // que le conge sera refuse).
  const isLeaveLocked = (row: WeekRow, dateStr: string) => {
    const info = getLeaveInfo(row, dateStr);
    return info?.status === 'approved';
  };

  // Bannière récap des employés en congé cette semaine — visible en haut
  const weekLeaveSummary = useMemo(() => {
    const out: Array<{ employeeId: string; name: string; days: string[]; status: 'approved' | 'pending'; type: string }> = [];
    for (const row of (week?.rows ?? [])) {
      const entries = Object.entries(row.leaveDays ?? {});
      if (entries.length === 0) continue;
      // Group by leave type+status
      const byKey = new Map<string, string[]>();
      const keyMeta = new Map<string, { type: string; status: 'approved' | 'pending' }>();
      for (const [day, info] of entries) {
        const k = `${info.type}|${info.status}`;
        keyMeta.set(k, { type: info.type, status: info.status });
        const arr = byKey.get(k) ?? [];
        arr.push(day);
        byKey.set(k, arr);
      }
      for (const [k, days] of byKey) {
        const m = keyMeta.get(k)!;
        out.push({
          employeeId: row.employeeId,
          name: `${row.firstName} ${row.lastName}`,
          days: days.sort(),
          status: m.status,
          type: m.type,
        });
      }
    }
    return out;
  }, [week]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const assignments: Array<{ employeeId: string; date: string; shiftCode: string | null }> = [];
      const allRows = week?.rows ?? [];
      for (const row of allRows) {
        const localChanges = draft[row.employeeId];
        if (!localChanges) continue;
        for (const [date, code] of Object.entries(localChanges)) {
          assignments.push({ employeeId: row.employeeId, date, shiftCode: code });
        }
      }
      if (assignments.length === 0) return { updated: 0, deleted: 0 };
      return schedulesApi.saveWeek(weekStartStr, assignments);
    },
    onSuccess: (res: { updated?: number; deleted?: number }) => {
      const u = res?.updated ?? 0;
      const d = res?.deleted ?? 0;
      if (u + d === 0) {
        notify.warning('Aucune modification a sauvegarder');
      } else {
        notify.success(`Planning sauvegarde (${u} assigne, ${d} repos)`);
      }
      setDraft({});
      queryClient.invalidateQueries({ queryKey: ['schedules', 'week', weekStartStr] });
    },
    onError: (err: any) => {
      if (err?.response?.status === 409) {
        const n = err.response.data?.error?.conflicts?.length ?? 0;
        notify.error(`Conflit congé : ${n} assignation(s) impossibles. Retirez-les avant de sauvegarder.`);
      } else if (err?.response?.status === 413) {
        notify.error('Planning trop volumineux pour une seule sauvegarde. Sauvegarde par etapes.');
      } else {
        notify.error('Erreur a la sauvegarde');
      }
    },
  });

  const applyDefaults = () => {
    const next: typeof draft = { ...draft };
    let skippedLeaves = 0;
    for (const row of rows) {
      if (!row.defaultShiftCode) continue;
      const empMap = { ...(next[row.employeeId] ?? {}) };
      for (const d of days) {
        const dateStr = format(d, 'yyyy-MM-dd');
        if (row.onLeaveDays.includes(dateStr)) { skippedLeaves++; continue; }
        if (getCell(row.employeeId, dateStr) !== null) continue;
        empMap[dateStr] = row.defaultShiftCode;
      }
      next[row.employeeId] = empMap;
    }
    setDraft(next);
    if (skippedLeaves > 0) {
      notify.warning(`Shifts par défaut appliqués. ${skippedLeaves} jour(s) ignoré(s) car employé en congé.`);
    } else {
      notify.success('Shifts par défaut appliqués sur les cellules vides');
    }
  };

  const clearWeek = async () => {
    if (!(await confirm('Vider toute la semaine affichee ? (sera sauvegardable apres validation)',
      { title: 'Vider la semaine', confirmLabel: 'Vider', danger: true }))) return;
    const next: typeof draft = { ...draft };
    for (const row of rows) {
      const empMap = { ...(next[row.employeeId] ?? {}) };
      for (const d of days) {
        const dateStr = format(d, 'yyyy-MM-dd');
        empMap[dateStr] = null;
      }
      next[row.employeeId] = empMap;
    }
    setDraft(next);
  };

  const duplicatePreviousWeek = async () => {
    try {
      const prev = await schedulesApi.getWeek(prevWeekStr) as WeekData;
      const next: typeof draft = { ...draft };
      let skippedLeaves = 0;
      for (const row of rows) {
        const prevRow = prev.rows.find(r => r.employeeId === row.employeeId);
        if (!prevRow) continue;
        const empMap = { ...(next[row.employeeId] ?? {}) };
        // Mapping PAR DATE (jour J = jour J-7). Un mapping ordinal sur
        // Object.keys(assignments) sortait faux quand la S-1 avait des
        // trous : si l'employe etait en repos lundi S-1, la position 0
        // etait mardi, et toute la semaine glissait d'un jour.
        for (const d of days) {
          const dateStr = format(d, 'yyyy-MM-dd');
          if (row.onLeaveDays.includes(dateStr)) { skippedLeaves++; continue; }
          const srcDate = format(new Date(d.getTime() - 7 * 86400_000), 'yyyy-MM-dd');
          const srcCode = prevRow.assignments[srcDate] ?? null;
          empMap[dateStr] = srcCode;
        }
        next[row.employeeId] = empMap;
      }
      setDraft(next);
      if (skippedLeaves > 0) {
        notify.warning(`Semaine précédente copiée. ${skippedLeaves} jour(s) ignoré(s) car employé en congé.`);
      } else {
        notify.success('Semaine précédente copiée dans le brouillon');
      }
    } catch {
      notify.error('Impossible de charger la semaine precedente');
    }
  };

  const hasChanges = Object.values(draft).some(m => Object.keys(m).length > 0);

  // Impression : ouvre une fenetre A4 paysage avec le planning courant
  // (affecte une fois la sauvegarde validee — on imprime y compris le brouillon).
  // Les `<select>` ne s'imprimant pas correctement, on regenere une table HTML
  // plate (libelle de shift + horaires, ou Conge/Repos).
  const printSchedule = async () => {
    if (hasChanges) {
      const ok = await confirm('Vous avez des modifications non sauvegardees. Imprimer quand meme (le brouillon sera inclus) ?',
        { title: 'Imprimer le planning', confirmLabel: 'Imprimer' });
      if (!ok) return;
    }
    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const headerCells = days
      .map(d => `<th>${escapeHtml(format(d, 'EEE dd/MM', { locale: fr }))}</th>`)
      .join('');

    const bodyHtml = groupedRows.map(group => {
      const groupHeader = `<tr class="group"><td colspan="${days.length + 1}">${escapeHtml(group.label)} (${group.rows.length})</td></tr>`;
      const rowsHtml = group.rows.map(row => {
        const empCell = `<td class="emp"><div class="name">${escapeHtml(row.firstName)} ${escapeHtml(row.lastName)}</div><div class="role">${escapeHtml(ROLE_LABELS[row.role as keyof typeof ROLE_LABELS] ?? row.role)}</div></td>`;
        const cells = days.map(d => {
          const dateStr = format(d, 'yyyy-MM-dd');
          const leave = row.leaveDays?.[dateStr];
          const code = getCell(row.employeeId, dateStr);
          if (leave?.status === 'approved') {
            return `<td class="leave"><div class="big">Congé</div><div class="small">${escapeHtml(LEAVE_TYPE_LABELS[leave.type] ?? leave.type)}</div></td>`;
          }
          if (leave?.status === 'pending' && !code) {
            return `<td class="leave-pending"><div class="big">Congé</div><div class="small">en attente</div></td>`;
          }
          if (!code) {
            return `<td class="repos"><div class="big">—</div><div class="small">Repos</div></td>`;
          }
          const label = SHIFT_SHORT_LABELS[code] ?? code;
          const h = SHIFT_HOURS[code];
          return `<td class="shift"><div class="big">${escapeHtml(label)}</div><div class="small">${escapeHtml(h.start)}-${escapeHtml(h.end)}</div></td>`;
        }).join('');
        return `<tr>${empCell}${cells}</tr>`;
      }).join('');
      return groupHeader + rowsHtml;
    }).join('');

    const subtitle = `${format(weekStart, 'dd MMM yyyy', { locale: fr })} — ${format(weekEnd, 'dd MMM yyyy', { locale: fr })}` +
      (roleFilter !== 'all' ? ` · Filtre : ${ROLE_LABELS[roleFilter as keyof typeof ROLE_LABELS] ?? roleFilter}` : '');

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Planning ${escapeHtml(format(weekStart, 'yyyy-MM-dd'))}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; margin: 0; padding: 8px; }
  h1 { font-size: 16px; margin: 0 0 2px 0; }
  .subtitle { font-size: 11px; color: #555; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #999; padding: 3px 4px; text-align: center; vertical-align: middle; }
  th { background: #ececec; font-size: 10px; }
  th.emp-h { width: 18%; text-align: left; }
  td.emp { text-align: left; }
  td.emp .name { font-weight: bold; font-size: 11px; }
  td.emp .role { font-size: 9px; color: #666; }
  tr.group td { background: #e0e7ff; font-weight: bold; text-align: left; font-size: 11px; color: #1e3a8a; padding: 4px 6px; }
  td .big { font-weight: bold; font-size: 11px; }
  td .small { font-size: 9px; color: #555; }
  td.repos .big { color: #aaa; font-weight: normal; }
  td.repos .small { color: #999; }
  td.leave { background: #f3e8ff; color: #6b21a8; }
  td.leave-pending { background: #fff7ed; color: #c2410c; }
  td.shift { background: #fff; }
  .footer { margin-top: 12px; font-size: 9px; color: #666; }
  @media print { .no-print { display: none; } body { padding: 0; } }
  .toolbar { position: fixed; top: 8px; right: 8px; display: flex; gap: 6px; }
  .toolbar button { font: inherit; padding: 6px 12px; cursor: pointer; border: 1px solid #999; background: #fff; border-radius: 4px; }
  .toolbar button.primary { background: #1e40af; color: #fff; border-color: #1e40af; }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button id="btn-print" class="primary">Imprimer</button>
    <button id="btn-close">Fermer</button>
  </div>
  <h1>Planning hebdomadaire</h1>
  <div class="subtitle">${escapeHtml(subtitle)}</div>
  <table>
    <thead>
      <tr>
        <th class="emp-h">Employé</th>
        ${headerCells}
      </tr>
    </thead>
    <tbody>
      ${bodyHtml || `<tr><td colspan="${days.length + 1}" style="text-align:center; padding: 20px; color: #999;">Aucun employé pour cette catégorie</td></tr>`}
    </tbody>
  </table>
  <div class="footer">Imprimé le ${escapeHtml(format(new Date(), 'dd/MM/yyyy à HH:mm', { locale: fr }))}${hasChanges ? ' · ⚠ contient des modifications non sauvegardées' : ''}</div>
</body>
</html>`;

    const w = window.open('', '_blank', 'width=1200,height=800');
    if (!w) {
      notify.error("Impossible d'ouvrir la fenêtre d'impression (popup bloqué ?)");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();

    // La CSP du parent (script-src 'self') s'applique au popup about:blank et
    // bloque tout JS inline. On pilote donc l'impression et les boutons depuis
    // la fenetre parente, hors contexte inline.
    const wireUp = () => {
      w.document.getElementById('btn-print')?.addEventListener('click', () => { w.focus(); w.print(); });
      w.document.getElementById('btn-close')?.addEventListener('click', () => w.close());
      setTimeout(() => { w.focus(); w.print(); }, 300);
    };
    if (w.document.readyState === 'complete') wireUp();
    else w.addEventListener('load', wireUp);
  };

  return (
    <>
      {/* En-tête de page : édition en secondaire, puis l'action principale. */}
      <HrHeaderActions>
        <button type="button" onClick={printSchedule} className="odoo-btn-secondary"
          title="Ouvre une fenêtre A4 paysage prête à imprimer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Printer size={13} aria-hidden="true" /> Imprimer
        </button>
        <button type="button" onClick={() => saveMutation.mutate()} disabled={!hasChanges || saveMutation.isPending} className="odoo-btn-primary"
          aria-busy={saveMutation.isPending || undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Save size={13} aria-hidden="true" /> {saveMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </HrHeaderActions>

      {/* Bannière récap des congés sur la semaine */}
      {weekLeaveSummary.length > 0 && (
        <StatusBanner tone="warning" icon={CalendarOff} title={`Congés cette semaine (${weekLeaveSummary.length})`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {weekLeaveSummary.map((l, i) => (
              <span
                key={i}
                className={`odoo-tag ${l.status === 'approved' ? 'odoo-tag-purple' : 'odoo-tag-orange'}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                title={`${l.name} • ${l.days.join(', ')} • ${LEAVE_TYPE_LABELS[l.type] ?? l.type}${l.status === 'pending' ? ' (en attente)' : ''}`}
              >
                <span style={{ fontWeight: 600 }}>{l.name}</span>
                <span>
                  {l.days.length === 1 ? `1 jour` : `${l.days.length} jours`}
                </span>
                {l.status === 'pending' && <><AlertTriangle size={11} aria-hidden="true" /> en attente</>}
              </span>
            ))}
          </div>
        </StatusBanner>
      )}

      {/* Barre d'outils : semaine, catégorie, puis outils de remplissage. */}
      <Toolbar>
        <div className="hr-tools">
          <button type="button" onClick={() => setWeekOffset(w => w - 1)} className="ds-icon-btn" aria-label="Semaine précédente"><ChevronLeft size={16} /></button>
          <span className="ds-strong">
            {format(weekStart, 'd MMM', { locale: fr })} — {format(weekEnd, 'd MMM yyyy', { locale: fr })}
          </span>
          <button type="button" onClick={() => setWeekOffset(w => w + 1)} className="ds-icon-btn" aria-label="Semaine suivante"><ChevronRight size={16} /></button>
          {weekOffset !== 0 && (
            <button type="button" className="ds-btn-ghost ds-btn-sm" onClick={() => setWeekOffset(0)}>
              Cette semaine
            </button>
          )}
        </div>
        <SearchSelect
          options={allRoles.map(r => ({ id: r, label: ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? r }))}
          value={roleFilter === 'all' ? '' : roleFilter}
          onChange={id => setRoleFilter(id || 'all')}
          placeholder="Toutes catégories"
          width={200}
        />
        <span className="hr-spacer" />
        <button type="button" onClick={applyDefaults} className="odoo-btn-secondary ds-btn-sm" title="Pré-remplit les cellules vides avec le shift par défaut de chaque employé">
          <Sparkles size={13} aria-hidden="true" /> Appliquer les shifts par défaut
        </button>
        <button type="button" onClick={duplicatePreviousWeek} className="odoo-btn-secondary ds-btn-sm">
          <Copy size={13} aria-hidden="true" /> Dupliquer la semaine précédente
        </button>
        <button type="button" onClick={clearWeek} className="odoo-btn-secondary ds-btn-sm">
          <Eraser size={13} aria-hidden="true" /> Vider
        </button>
      </Toolbar>

      <DataPanel label="Planning de la semaine" footer={<TableFooter note={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span><span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--ds-warning-bg)', border: '1px solid var(--ds-warning)', marginRight: 4, verticalAlign: 'middle' }} /> cellule modifiée (non enregistrée)</span>
        <span><CalendarOff size={12} aria-hidden="true" style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> congé approuvé — affectation impossible</span>
        <span><span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, border: '1px dashed var(--ds-warning)', marginRight: 4, verticalAlign: 'middle' }} /> congé en attente — modification possible avec confirmation</span>
        <span>Enregistrer pré-remplit aussi le pointage attendu.</span>
      </span>} />}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th style={{ minWidth: 200, position: 'sticky', left: 0, background: 'var(--ds-card)', zIndex: 5 }}>Employé</th>
              {days.map(d => (
                <th key={d.toISOString()} style={{ textAlign: 'center', minWidth: 130 }}>
                  <div>{format(d, 'EEE', { locale: fr })}</div>
                  <div style={{ color: 'var(--ds-muted)', fontWeight: 400 }}>{format(d, 'dd/MM')}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8}><EmptyState icon={Users}>Aucun employé pour cette catégorie</EmptyState></td></tr>
            )}
            {groupedRows.map(group => {
              const collapsed = !!collapsedGroups[group.role];
              return (
              <Fragment key={group.role}>
                <tr className="ds-group" onClick={() => toggleGroup(group.role)} style={{ cursor: 'pointer' }}>
                  <td colSpan={8} style={{ position: 'sticky', left: 0 }}>
                    <button type="button" aria-expanded={!collapsed} onClick={ev => { ev.stopPropagation(); toggleGroup(group.role); }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
                      {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                      {group.label}
                      <small>{group.rows.length} employé{group.rows.length > 1 ? 's' : ''}</small>
                    </button>
                  </td>
                </tr>
                {!collapsed && group.rows.map(row => (
              <tr key={row.employeeId}>
                <td style={{ position: 'sticky', left: 0, background: 'var(--ds-card)', zIndex: 4 }}>
                  <div className="ds-strong">{row.firstName} {row.lastName}</div>
                  <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>
                    {ROLE_LABELS[row.role as keyof typeof ROLE_LABELS] ?? row.role}
                    {row.defaultShiftCode && (
                      <span style={{ marginLeft: 4 }}>· par défaut : {SHIFT_SHORT_LABELS[row.defaultShiftCode]}</span>
                    )}
                  </div>
                </td>
                {days.map(d => {
                  const dateStr = format(d, 'yyyy-MM-dd');
                  const leaveInfo = getLeaveInfo(row, dateStr);
                  const current = getCell(row.employeeId, dateStr);
                  const dirty = draft[row.employeeId]?.[dateStr] !== undefined;
                  // Conge approuve = cellule verrouillee (interaction impossible)
                  if (leaveInfo?.status === 'approved') {
                    return (
                      <td key={dateStr} style={{ padding: 4, textAlign: 'center' }}>
                        <div
                          className="odoo-tag odoo-tag-purple"
                          style={{ display: 'block', padding: '6px 8px', cursor: 'not-allowed', fontWeight: 500 }}
                          title={leaveTooltip(leaveInfo)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            <CalendarOff size={11} aria-hidden="true" />
                            <span>Congé</span>
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>
                            {LEAVE_TYPE_LABELS[leaveInfo.type] ?? leaveInfo.type}
                          </div>
                        </div>
                      </td>
                    );
                  }
                  // Conge en attente = avertissement, mais cellule editable (l'admin peut
                  // assumer que le conge sera refuse). On confirme avant d'affecter.
                  if (leaveInfo?.status === 'pending') {
                    return (
                      <td key={dateStr} style={{ padding: 4, textAlign: 'center', background: dirty ? 'var(--ds-warning-bg)' : undefined }}>
                        <select aria-label={`Shift de ${row.firstName} ${row.lastName} le ${format(d, 'dd/MM')}`}
                          value={current ?? REPOS}
                          onChange={async e => {
                            const v = e.target.value;
                            if (v !== REPOS) {
                              const ok = await confirm(`${row.firstName} ${row.lastName} a une demande de ${LEAVE_TYPE_LABELS[leaveInfo.type] ?? 'congé'} EN ATTENTE pour ce jour (${leaveTooltip(leaveInfo)}).\n\nAffecter quand même un shift ?`,
                                { title: 'Congé en attente', confirmLabel: 'Affecter' });
                              if (!ok) return;
                            }
                            setCell(row.employeeId, dateStr, v === REPOS ? null : (v as ShiftCode));
                          }}
                          className={`ds-input sm ${current ? 'font-medium' : ''}`}
                          style={{
                            borderStyle: 'dashed', borderColor: 'var(--ds-warning)',
                            ...(current ? shiftStyle(current) : { background: 'var(--ds-card)', color: 'var(--ds-warning)' }),
                          }}
                          title={`⚠ ${leaveTooltip(leaveInfo)}`}
                        >
                          <option value={REPOS}>Congé (en attente)</option>
                          {(shifts as Record<string, any>[]).map(s => (
                            <option key={s.code as string} value={s.code as string}>
                              {SHIFT_SHORT_LABELS[s.code as ShiftCode] ?? s.label as string}
                            </option>
                          ))}
                        </select>
                        {current && (
                          <span className="odoo-tag odoo-tag-orange" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
                            <AlertTriangle size={10} aria-hidden="true" /> {SHIFT_HOURS[current].start}-{SHIFT_HOURS[current].end}
                          </span>
                        )}
                      </td>
                    );
                  }
                  return (
                    <td key={dateStr} style={{ padding: 4, textAlign: 'center', background: dirty ? 'var(--ds-warning-bg)' : undefined }}>
                      <select aria-label={`Shift de ${row.firstName} ${row.lastName} le ${format(d, 'dd/MM')}`}
                        value={current ?? REPOS}
                        onChange={e => {
                          const v = e.target.value;
                          setCell(row.employeeId, dateStr, v === REPOS ? null : (v as ShiftCode));
                        }}
                        className={`ds-input sm ${current ? 'font-medium' : ''}`}
                        style={current ? { ...shiftStyle(current), borderColor: 'transparent' } : { color: 'var(--ds-muted)' }}
                      >
                        <option value={REPOS}>Repos</option>
                        {(shifts as Record<string, any>[]).map(s => (
                          <option key={s.code as string} value={s.code as string}>
                            {SHIFT_SHORT_LABELS[s.code as ShiftCode] ?? s.label as string}
                          </option>
                        ))}
                      </select>
                      {current && (
                        <div style={{ fontSize: 11, color: 'var(--ds-muted)', marginTop: 2 }}>
                          {SHIFT_HOURS[current].start}-{SHIFT_HOURS[current].end}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </DataPanel>
    </>
  );
}
