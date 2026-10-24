import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Pencil, Save, X, Loader2, UserRound, Briefcase, Phone, StickyNote, Banknote, Landmark, FileText,
  LogOut, CalendarClock, Palmtree, ShieldCheck, ShieldOff, AlertTriangle, Trash2, RotateCcw, Users, FileSignature,
} from 'lucide-react';
import { employeesApi, shiftsApi, payrollConfigApi, leavesApi } from '../../api/employees.api';
import { useReferentiel } from '../../hooks/useReferentiel';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { inputCls } from './ui';
import { isoDate, saveBlobResponse, apiErrorMessage } from './shared';
import EmployeeContracts from './contracts/EmployeeContracts';
import EmployeeDocuments from './contracts/EmployeeDocuments';
import EmployeeDeparture from './contracts/EmployeeDeparture';
import EmployeePayrollItems from './tabs/EmployeePayrollItems';
import EmployeeSalaryHistory from './tabs/EmployeeSalaryHistory';

/**
 * Fiche employé en pleine page (remplace les deux modales « Fiche » et
 * « Modifier » de la liste) : même grammaire que la fiche ingrédient du Stock —
 * barre de contrôle, compteurs, en-tête, onglets, sections « libellé | valeur ».
 * La modification se fait sur place ; l'état du formulaire est porté par la page
 * pour survivre au changement d'onglet. /employees/new = création.
 */

type Form = Record<string, string | boolean>;
type Tab = 'infos' | 'contrat' | 'documents' | 'depart';

const FREQ_LABELS: Record<string, string> = { monthly: 'Mensuelle (fin de mois)', biweekly: 'Par quinzaine (1-15 / 16-fin)', weekly: 'Hebdomadaire (lundi pour S-1)' };
const CATEGORY_LABELS: Record<string, string> = { cadre: 'Cadre (essai 3 mois)', employe: 'Employé (essai 1,5 mois)', ouvrier: 'Ouvrier (essai 15 jours)' };

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const frDate = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
const money = (v: string | number) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH` : '';
};

function toForm(e: Record<string, any> | null): Form {
  return {
    firstName: str(e?.first_name), lastName: str(e?.last_name), cin: str(e?.cin), cinExpiresOn: isoDate(e?.cin_expires_on),
    phone: str(e?.phone), birthDate: isoDate(e?.birth_date), city: str(e?.city), address: str(e?.address),
    role: str(e?.role), contractType: str(e?.contract_type) || 'cdi',
    monthlySalary: str(e?.monthly_salary), payFrequency: str(e?.pay_frequency) || 'monthly', weeklySalary: str(e?.weekly_salary),
    defaultShiftCode: str(e?.default_shift_code),
    hireDate: isoDate(e?.hire_date), contractStart: isoDate(e?.contract_start), contractEnd: isoDate(e?.contract_end),
    cnssNumber: str(e?.cnss_number), cimrRate: str(e?.cimr_rate) || '0', rib: str(e?.rib), bankName: str(e?.bank_name),
    isDeclared: e ? e.is_declared !== false : true, nbDependents: str(e?.nb_dependents) || '0',
    emergencyContactName: str(e?.emergency_contact_name), emergencyContactPhone: str(e?.emergency_contact_phone),
    notes: str(e?.notes),
    // Création seulement : premier contrat et période d'essai légale.
    category: 'employe', jobTitle: '', withTrial: true,
  };
}

/** Ancienneté lisible depuis la date d'embauche. */
function seniority(hire: string): { label: string; years: number } {
  if (!hire) return { label: '—', years: 0 };
  const h = new Date(`${hire}T00:00:00`);
  const now = new Date();
  let months = (now.getFullYear() - h.getFullYear()) * 12 + (now.getMonth() - h.getMonth());
  if (now.getDate() < h.getDate()) months -= 1;
  if (months < 0) return { label: 'À venir', years: 0 };
  const y = Math.floor(months / 12);
  const m = months % 12;
  return { label: y > 0 ? `${y} an${y > 1 ? 's' : ''}${m ? ` ${m} m` : ''}` : `${m} mois`, years: y };
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();

  const { entries: roles, getLabel: roleLabel, getColor: roleColor } = useReferentiel('employee_roles');
  const { entries: contractTypes, getLabel: contractLabel } = useReferentiel('contract_types');
  const { data: shifts = [] } = useQuery<Record<string, any>[]>({ queryKey: ['shifts'], queryFn: shiftsApi.list as () => Promise<Record<string, any>[]> });

  // Clé sous ['employees'] : les invalidations des sous-blocs (contrat, départ) rafraîchissent aussi la fiche.
  const { data: emp, isLoading, isError } = useQuery<Record<string, any>>({
    queryKey: ['employees', 'detail', id],
    queryFn: () => employeesApi.getById(id!),
    enabled: !isNew,
  });
  const { data: leave } = useQuery<Record<string, any>>({
    queryKey: ['leave-balance', id],
    queryFn: () => leavesApi.balance(id!),
    enabled: !isNew && !!emp,
    retry: false,
  });

  const [editing, setEditing] = useState(isNew || searchParams.get('edit') === '1');
  const [form, setForm] = useState<Form>(() => toForm(null));
  const [initial, setInitial] = useState<Form>(() => toForm(null));
  const tabParam = searchParams.get('onglet') as Tab | null;
  const tabs: Array<{ key: Tab; label: string; icon: typeof UserRound }> = isNew
    ? [{ key: 'infos', label: 'Informations', icon: UserRound }, { key: 'contrat', label: 'Contrat & paie', icon: Briefcase }]
    : [
        { key: 'infos', label: 'Informations', icon: UserRound },
        { key: 'contrat', label: 'Contrat & paie', icon: Briefcase },
        { key: 'documents', label: 'Documents', icon: FileText },
        { key: 'depart', label: 'Départ', icon: LogOut },
      ];
  const tab: Tab = tabParam && tabs.some(t => t.key === tabParam) ? tabParam : 'infos';
  const setTab = (t: Tab) => { searchParams.set('onglet', t); setSearchParams(searchParams, { replace: true }); };

  // (Re)charge le formulaire à l'ouverture et après chaque enregistrement, jamais pendant une saisie.
  useEffect(() => {
    if (isNew || !emp || editing && form.firstName) return;
    const f = toForm(emp);
    setForm(f); setInitial(f);
  }, [emp]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => Object.keys(form).some(k => form[k] !== initial[k]), [form, initial]);
  const set = (k: string, v: string | boolean) => setForm(prev => {
    const next = { ...prev, [k]: v };
    // Salaire hebdo proposé à partir du mensuel (mensuel × 12 ÷ 52), modifiable ensuite.
    if ((k === 'monthlySalary' || k === 'payFrequency') && next.payFrequency === 'weekly') {
      const m = parseFloat(String(next.monthlySalary));
      next.weeklySalary = m > 0 ? (m * 12 / 52).toFixed(2) : '';
    }
    return next;
  });

  const save = useMutation({
    mutationFn: () => {
      const d: Record<string, any> = { ...form };
      if (d.monthlySalary) d.monthlySalary = parseFloat(d.monthlySalary);
      if (d.weeklySalary) d.weeklySalary = parseFloat(d.weeklySalary);
      if (d.nbDependents) d.nbDependents = parseInt(d.nbDependents);
      if (d.cimrRate) d.cimrRate = parseFloat(d.cimrRate);
      if (d.defaultShiftCode === '') d.defaultShiftCode = null;
      if (d.rib === '') d.rib = null;
      if (d.bankName === '') d.bankName = null;
      if (isNew) { if (d.jobTitle === '') delete d.jobTitle; }
      else { delete d.category; delete d.jobTitle; delete d.withTrial; }
      return isNew ? employeesApi.create(d) : employeesApi.update(id!, d);
    },
    onSuccess: (saved: Record<string, any>) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['hr-alerts'] });
      notify.success(isNew ? 'Employé ajouté' : 'Fiche mise à jour');
      setEditing(false);
      setInitial(form);
      searchParams.delete('edit'); setSearchParams(searchParams, { replace: true });
      if (isNew && saved?.id) navigate(`/employees/${saved.id}`, { replace: true });
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, "Erreur lors de l'enregistrement")),
  });

  const setActive = useMutation({
    mutationFn: (active: boolean) => (active ? employeesApi.update(id!, { isActive: true }) : employeesApi.remove(id!)),
    onSuccess: (_d, active) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      notify.success(active ? 'Employé réactivé' : 'Employé désactivé, historique préservé');
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });

  const submit = () => {
    const missing = [
      !String(form.firstName).trim() && 'prénom', !String(form.lastName).trim() && 'nom', !form.role && 'rôle',
      isNew && !form.hireDate && "date d'embauche",
    ].filter(Boolean);
    if (missing.length) {
      notify.error(`Champ(s) obligatoire(s) : ${missing.join(', ')}`);
      setTab(!String(form.firstName).trim() || !String(form.lastName).trim() ? 'infos' : 'contrat');
      return;
    }
    if (form.rib && !/^[0-9 ]{24,30}$/.test(String(form.rib))) { notify.error('RIB : 24 chiffres attendus'); setTab('contrat'); return; }
    if (form.payFrequency === 'weekly' && !form.weeklySalary) { notify.error('Salaire hebdomadaire requis pour une paie hebdomadaire'); setTab('contrat'); return; }
    save.mutate();
  };

  const cancel = async () => {
    if (dirty && !(await confirm('Les modifications non enregistrées seront perdues.', { title: 'Abandonner les modifications', confirmLabel: 'Abandonner', danger: true }))) return;
    if (isNew) { navigate('/employees'); return; }
    setForm(initial); setEditing(false);
    searchParams.delete('edit'); setSearchParams(searchParams, { replace: true });
  };

  const back = async () => {
    if (editing && dirty && !(await confirm('Les modifications non enregistrées seront perdues.', { title: 'Quitter la fiche', confirmLabel: 'Quitter', danger: true }))) return;
    navigate('/employees');
  };

  if (!isNew && isLoading) {
    return <div className="odoo-scope" style={{ padding: '3rem', textAlign: 'center' }}><Loader2 className="animate-spin" size={22} style={{ color: 'var(--theme-accent)' }} /></div>;
  }
  if (!isNew && (isError || !emp)) {
    return (
      <div className="odoo-scope" style={{ padding: 24 }}>
        <StatusBanner tone="danger" icon={AlertTriangle} title="Employé introuvable"
          actions={<button type="button" className="odoo-btn-secondary" onClick={() => navigate('/employees')}>Retour à la liste</button>}>
          Cette fiche n'existe pas ou a été supprimée.
        </StatusBanner>
      </div>
    );
  }

  const name = isNew ? 'Nouvel employé' : `${emp!.first_name} ${emp!.last_name}`;
  const active = isNew || emp!.is_active !== false;
  const sen = seniority(String(form.hireDate));
  const isWeekly = form.payFrequency === 'weekly';
  const salary = isWeekly ? money(String(form.weeklySalary)) : money(String(form.monthlySalary));
  const color = roleColor(String(form.role)) || 'var(--theme-accent)';
  const initials = `${String(form.firstName).charAt(0)}${String(form.lastName).charAt(0)}`.toUpperCase() || '?';

  // Alertes de la fiche (lecture) : dossier incomplet, fin de CDD, pièce expirée.
  const missing = isNew ? [] : [
    !form.cin && 'CIN', form.isDeclared && !form.cnssNumber && 'N° CNSS', !form.phone && 'téléphone',
    !form.emergencyContactName && "contact d'urgence",
  ].filter(Boolean) as string[];
  const daysTo = (s: string) => (s ? Math.ceil((new Date(`${s}T00:00:00`).getTime() - Date.now()) / 86400000) : null);
  const cddLeft = form.contractEnd ? daysTo(String(form.contractEnd)) : null;
  const cinLeft = form.cinExpiresOn ? daysTo(String(form.cinExpiresOn)) : null;

  const p = { form, set, editing };

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      {/* ── Barre de contrôle ── */}
      <div className="odoo-control-bar" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={back} className="odoo-pager-btn" title="Retour à la liste" aria-label="Retour à la liste"><ArrowLeft size={14} /></button>
        <div className="odoo-breadcrumb">
          <Users size={14} style={{ color: 'var(--theme-accent)' }} />
          <span style={{ cursor: 'pointer' }} onClick={back}>Personnel</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">{name}</span>
          {editing && !isNew && <span className="odoo-tag odoo-tag-yellow" style={{ marginLeft: 8 }}>Modification{dirty ? ' · non enregistrée' : ''}</span>}
        </div>
        <div style={{ flex: 1 }} />
        {editing ? (
          <>
            <button type="button" onClick={cancel} className="odoo-btn-secondary" style={btn}><X size={13} /> Annuler</button>
            <button type="button" onClick={submit} disabled={save.isPending || (!isNew && !dirty)} className="odoo-btn-primary" style={btn}>
              {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {isNew ? 'Créer la fiche' : 'Enregistrer'}
            </button>
          </>
        ) : (
          <>
            {active && (['travail', 'salaire'] as const).map(kind => (
              <button key={kind} type="button" className="odoo-btn-secondary" style={btn}
                onClick={async () => {
                  try { saveBlobResponse(await payrollConfigApi.attestation(id!, kind), `attestation_${kind}.pdf`); }
                  catch (err) { notify.error(apiErrorMessage(err, 'Erreur')); }
                }}>
                <FileSignature size={13} /> Attestation de {kind}
              </button>
            ))}
            {isAdmin && (active ? (
              <button type="button" className="odoo-btn-danger" style={btn} disabled={setActive.isPending}
                onClick={async () => {
                  if (await confirm(`Désactiver ${name} ?\n\nL'employé sera masqué des listes actives. Son historique (paie, présence, paiements) reste préservé et il pourra être réactivé.`,
                    { title: "Désactiver l'employé", confirmLabel: 'Désactiver', danger: true })) setActive.mutate(false);
                }}>
                <Trash2 size={13} /> Désactiver
              </button>
            ) : (
              <button type="button" className="odoo-btn-secondary" style={btn} disabled={setActive.isPending}
                onClick={async () => {
                  if (await confirm(`Réactiver ${name} ? Il réapparaîtra dans les listes actives.`, { title: "Réactiver l'employé", confirmLabel: 'Réactiver' })) setActive.mutate(true);
                }}>
                <RotateCcw size={13} /> Réactiver
              </button>
            ))}
            <button type="button" onClick={() => setEditing(true)} className="odoo-btn-primary" style={btn}><Pencil size={13} /> Modifier</button>
          </>
        )}
      </div>

      {/* ── Alertes ── */}
      {!isNew && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 20px 0' }}>
          {!active && (
            <StatusBanner tone="neutral" icon={LogOut} title="Employé inactif">
              {emp!.exit_date ? `Sorti le ${frDate(isoDate(emp!.exit_date))}. ` : ''}La fiche reste consultable ; l'historique de paie est conservé.
            </StatusBanner>
          )}
          {active && cddLeft !== null && cddLeft <= 30 && (
            <StatusBanner tone={cddLeft < 0 ? 'danger' : 'orange'} icon={CalendarClock}
              title={cddLeft < 0 ? `Contrat échu depuis ${-cddLeft} jour(s)` : `Fin de contrat dans ${cddLeft} jour(s)`}
              actions={<button type="button" className="odoo-btn-secondary" onClick={() => setTab('contrat')}>Renouveler ou avenant</button>}>
              Fin prévue le {frDate(String(form.contractEnd))}.
            </StatusBanner>
          )}
          {active && cinLeft !== null && cinLeft <= 30 && (
            <StatusBanner tone={cinLeft < 0 ? 'danger' : 'warning'} icon={AlertTriangle} title={cinLeft < 0 ? 'CIN expirée' : `CIN expire dans ${cinLeft} jour(s)`}>
              Date d'expiration : {frDate(String(form.cinExpiresOn))}.
            </StatusBanner>
          )}
          {active && missing.length > 0 && !editing && (
            <StatusBanner tone="warning" icon={AlertTriangle} title="Dossier incomplet"
              actions={<button type="button" className="odoo-btn-secondary" onClick={() => setEditing(true)}>Compléter</button>}>
              À renseigner : {missing.join(', ')}.
            </StatusBanner>
          )}
        </div>
      )}

      {/* ── Compteurs ── */}
      {!isNew && (
        <div className="odoo-smart-button-row" style={{ marginTop: 12 }}>
          <div className="odoo-smart-button" onClick={() => setTab('contrat')}>
            <div className="odoo-smart-button-value">{sen.label}</div>
            <div className="odoo-smart-button-label"><CalendarClock size={11} /> Ancienneté</div>
          </div>
          <div className="odoo-smart-button" onClick={() => setTab('contrat')}>
            <div className="odoo-smart-button-value">{salary || '—'}</div>
            <div className="odoo-smart-button-label"><Banknote size={11} /> Salaire / {isWeekly ? 'sem.' : 'mois'}</div>
          </div>
          <div className="odoo-smart-button" onClick={() => navigate('/employees?tab=leaves')} title="Solde de congés payés acquis et non pris">
            <div className="odoo-smart-button-value" style={{ color: leave && leave.available < 0 ? '#dc3545' : undefined }}>
              {leave ? `${Number(leave.available).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j` : '—'}
            </div>
            <div className="odoo-smart-button-label"><Palmtree size={11} /> Congés dispo.</div>
          </div>
          <div className="odoo-smart-button" onClick={() => setTab('contrat')}>
            <div className="odoo-smart-button-value" style={{ color: form.isDeclared ? '#28a745' : '#b85d1a' }}>
              {form.isDeclared ? <ShieldCheck size={18} style={{ display: 'inline' }} /> : <ShieldOff size={18} style={{ display: 'inline' }} />}
            </div>
            <div className="odoo-smart-button-label">{form.isDeclared ? 'Déclaré CNSS + IR' : 'Non déclaré'}</div>
          </div>
          <div className="odoo-smart-button" onClick={() => setTab('documents')}>
            <div className="odoo-smart-button-value"><FileText size={18} style={{ display: 'inline' }} /></div>
            <div className="odoo-smart-button-label">Documents</div>
          </div>
        </div>
      )}

      {/* ── En-tête ── */}
      <div className="odoo-form-header" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div aria-hidden="true" style={{
          width: 56, height: 56, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.25rem', fontWeight: 700, color: '#fff', background: color,
        }}>{initials}</div>
        <div style={{ minWidth: 0 }}>
          <h1 className="odoo-form-title">{isNew && !form.firstName ? 'Nouvel employé' : `${form.firstName} ${form.lastName}`}</h1>
          <div className="odoo-form-subtitle" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {form.role && <span className="odoo-tag odoo-tag-purple" style={roleColor(String(form.role)) ? { backgroundColor: `${roleColor(String(form.role))}22`, color: roleColor(String(form.role)) } : undefined}>{roleLabel(String(form.role))}</span>}
            <span className="odoo-tag odoo-tag-grey">{contractLabel(String(form.contractType))}</span>
            {!isNew && <span className={`odoo-tag ${active ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>{active ? 'Actif' : 'Inactif'}</span>}
            {form.hireDate && <span>Embauché le {frDate(String(form.hireDate))}</span>}
            {form.cin && <span style={{ fontFamily: 'ui-monospace, monospace' }}>· CIN {String(form.cin)}</span>}
          </div>
        </div>
      </div>

      {/* ── Onglets ── */}
      <div className="odoo-tabs">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`odoo-tab ${tab === t.key ? 'active' : ''}`}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: editing ? '4px 0 72px' : '4px 0 24px' }}>
        {tab === 'infos' && (
          <>
            <div style={twoCols}>
              <Section icon={UserRound} title="Identité">
                <Row {...p} label="Prénom" name="firstName" required />
                <Row {...p} label="Nom" name="lastName" required />
                <Row {...p} label="CIN" name="cin" />
                <Row {...p} label="CIN valable jusqu'au" name="cinExpiresOn" type="date" />
                <Row {...p} label="Date de naissance" name="birthDate" type="date" />
              </Section>
              <Section icon={Phone} title="Coordonnées">
                <Row {...p} label="Téléphone" name="phone" />
                <Row {...p} label="Adresse" name="address" />
                <Row {...p} label="Ville" name="city" />
                <Row {...p} label="Contact d'urgence" name="emergencyContactName" />
                <Row {...p} label="Tél. d'urgence" name="emergencyContactPhone" />
              </Section>
            </div>
            <Section icon={StickyNote} title="Notes">
              {editing
                ? <textarea rows={3} value={String(form.notes)} onChange={e => set('notes', e.target.value)} className={inputCls} placeholder="Remarques internes" />
                : <div style={{ fontSize: '0.8125rem', whiteSpace: 'pre-wrap', color: form.notes ? 'var(--odoo-text)' : 'var(--odoo-text-light)' }}>{String(form.notes) || 'Aucune note'}</div>}
            </Section>
          </>
        )}

        {tab === 'contrat' && (
          <>
            <div style={twoCols}>
              <Section icon={Briefcase} title="Poste et contrat">
                <Row {...p} label="Rôle" name="role" required options={roles.map(r => ({ value: String(r.code), label: String(r.label) }))} />
                <Row {...p} label="Type de contrat" name="contractType" options={contractTypes.map(c => ({ value: String(c.code), label: String(c.label) }))} />
                <Row {...p} label="Date d'embauche" name="hireDate" type="date" required={isNew} />
                <Row {...p} label="Début du contrat" name="contractStart" type="date" />
                <Row {...p} label="Fin du contrat" name="contractEnd" type="date" hint="Vide pour un CDI" />
                <Row {...p} label="Shift par défaut" name="defaultShiftCode" emptyLabel="Aucun (choisi dans le planning)"
                  options={shifts.map(s => ({ value: String(s.code), label: String(s.label) }))} />
                {isNew && (
                  <>
                    <Row {...p} label="Catégorie" name="category" options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))} />
                    <Row {...p} label="Intitulé du poste" name="jobTitle" />
                    <Row {...p} label="Période d'essai légale" name="withTrial" type="checkbox" />
                  </>
                )}
              </Section>
              <Section icon={Banknote} title="Rémunération">
                <Row {...p} label="Fréquence de paie" name="payFrequency" options={Object.entries(FREQ_LABELS).map(([value, label]) => ({ value, label }))} />
                <Row {...p} label="Salaire mensuel" name="monthlySalary" type="number" suffix="DH"
                  hint={form.payFrequency === 'biweekly' ? 'Quinzaine : base mensuelle ÷ 26 par jour pointé' : undefined} />
                {(isWeekly || (!editing && form.weeklySalary)) && (
                  <Row {...p} label="Salaire hebdomadaire" name="weeklySalary" type="number" suffix="DH" hint="Proposé : mensuel × 12 ÷ 52, modifiable" />
                )}
                <Row {...p} label="Personnes à charge" name="nbDependents" type="number" />
                <Row {...p} label="Taux CIMR" name="cimrRate" type="number" suffix="%" />
              </Section>
            </div>
            <Section icon={Landmark} title="Déclarations et banque">
              <div style={twoColsInner}>
                <div>
                  <Row {...p} label="Salarié déclaré" name="isDeclared" type="checkbox" hint="CNSS, AMO et IR" />
                  <Row {...p} label="N° CNSS" name="cnssNumber" />
                </div>
                <div>
                  <Row {...p} label="RIB" name="rib" hint="24 chiffres, pour le virement du salaire" mono />
                  <Row {...p} label="Banque" name="bankName" />
                </div>
              </div>
            </Section>
            {!isNew && editing && (
              <div style={{ padding: '0 20px' }}>
                <StatusBanner tone="info" icon={Pencil} title="Correction directe du contrat en vigueur">
                  Un changement de conditions (salaire, poste, type de contrat) se fait par un avenant, dans la section Contrats ci-dessous, pour garder l'historique.
                </StatusBanner>
              </div>
            )}
            {!isNew && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 20px 0' }}>
                <EmployeeContracts employeeId={id!} onChanged={() => undefined} />
                {(emp!.pay_frequency ?? 'monthly') === 'monthly' && <EmployeePayrollItems employeeId={id!} />}
                <EmployeeSalaryHistory employeeId={id!} />
              </div>
            )}
          </>
        )}

        {tab === 'documents' && !isNew && (
          <div style={{ padding: '12px 20px 0' }}><EmployeeDocuments employeeId={id!} /></div>
        )}
        {tab === 'depart' && !isNew && (
          <div style={{ padding: '12px 20px 0' }}><EmployeeDeparture employee={emp!} /></div>
        )}
      </div>

      {/* En modification, Annuler / Enregistrer restent à l'écran quelle que soit la
          section affichée (la page défile au niveau du document : pas de sticky possible). */}
      {editing && (
        <div role="region" aria-label="Enregistrer la fiche" style={{
          position: 'fixed', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 20,
          display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 4,
          border: '1px solid var(--odoo-border)', background: 'var(--odoo-bg)', boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
        }}>
          <span style={{ fontSize: '0.8125rem', color: dirty ? '#b85d1a' : 'var(--odoo-text-muted)' }}>
            {isNew ? 'Nouvelle fiche' : dirty ? 'Modifications non enregistrées' : 'Aucune modification'}
          </span>
          <button type="button" onClick={cancel} className="odoo-btn-secondary" style={btn}><X size={13} /> Annuler</button>
          <button type="button" onClick={submit} disabled={save.isPending || (!isNew && !dirty)} className="odoo-btn-primary" style={btn}>
            {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {isNew ? 'Créer la fiche' : 'Enregistrer'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════ Briques de la fiche ═══════════════════════ */

const btn = { display: 'inline-flex', alignItems: 'center', gap: 4 } as const;
const twoCols = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 0 } as const;
const twoColsInner = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', columnGap: 24 } as const;

function Section({ icon: Icon, title, children }: { icon: typeof UserRound; title: string; children: ReactNode }) {
  return (
    <div className="odoo-section">
      <div className="odoo-section-header"><Icon size={12} /> {title}</div>
      <div style={{ padding: '8px 16px 12px' }}>{children}</div>
    </div>
  );
}

/** Ligne « libellé | valeur » : texte en lecture, champ en modification. */
function Row({
  form, set, editing, label, name, type = 'text', options, emptyLabel, required, hint, suffix, mono,
}: {
  form: Form; set: (k: string, v: string | boolean) => void; editing: boolean;
  label: string; name: string; type?: 'text' | 'date' | 'number' | 'checkbox';
  options?: Array<{ value: string; label: string }>; emptyLabel?: string;
  required?: boolean; hint?: string; suffix?: string; mono?: boolean;
}) {
  const v = form[name];
  let display: ReactNode;
  if (type === 'checkbox') display = v ? 'Oui' : 'Non';
  else if (options) display = options.find(o => o.value === v)?.label || (v ? String(v) : '');
  else if (type === 'date') display = frDate(String(v));
  else if (name === 'rib' && v) display = String(v).replace(/^(\d{3})(\d{3})(\d{16})(\d{2})$/, '$1 $2 $3 $4');
  else display = v ? `${v}${suffix ? ` ${suffix}` : ''}` : '';

  let control: ReactNode = null;
  if (editing) {
    if (type === 'checkbox') {
      control = <input type="checkbox" checked={!!v} onChange={e => set(name, e.target.checked)} style={{ width: 16, height: 16 }} aria-label={label} />;
    } else if (options) {
      control = (
        <select value={String(v)} onChange={e => set(name, e.target.value)} className={inputCls} aria-label={label}>
          {(emptyLabel !== undefined || !v) && <option value="">{emptyLabel ?? 'Choisir…'}</option>}
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    } else {
      control = (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type={type} value={String(v)} onChange={e => set(name, e.target.value)} className={inputCls} aria-label={label}
            step={type === 'number' ? 'any' : undefined} min={type === 'number' ? 0 : undefined}
            style={mono ? { fontFamily: 'ui-monospace, monospace' } : undefined} />
          {suffix && <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{suffix}</span>}
        </span>
      );
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, 38%) 1fr', alignItems: editing ? 'center' : 'baseline', gap: 12, padding: '5px 0', borderBottom: '1px solid var(--odoo-border-light, #f1f3f5)' }}>
      <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--odoo-text)' }}>
        {label}{required && editing && <span style={{ color: '#dc3545' }}> *</span>}
      </label>
      <div>
        {editing ? control : (
          <span style={{ fontSize: '0.8125rem', color: display ? 'var(--odoo-text)' : 'var(--odoo-text-light)', fontFamily: mono ? 'ui-monospace, monospace' : undefined }}>
            {display || '—'}
          </span>
        )}
        {hint && editing && <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>{hint}</div>}
      </div>
    </div>
  );
}
