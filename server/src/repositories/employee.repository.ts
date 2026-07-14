import { db } from '../config/database.js';
import { paymentRepository } from './accounting.repository.js';
import { salaryAdvanceRepository } from './salary-advance.repository.js';
import { getLocalISODate } from '../utils/timezone.js';

/**
 * Vue interne : compte les repayments d'avance rattaches a un employe.
 * Utilise par hardDelete/countDependencies : les retenues d'avance sont
 * bloquantes (il faut annuler la paie qui les a generees d'abord).
 */
async function countRepaymentsForEmployee(id: string): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM salary_advance_repayments sr
       JOIN salary_advances a ON a.id = sr.advance_id
      WHERE a.employee_id = $1`,
    [id]
  );
  return parseInt(String(r.rows[0]?.n || '0'), 10) || 0;
}

export const employeeRepository = {
  async findAll(storeId?: string) {
    const where = storeId ? 'WHERE store_id = $1' : '';
    const params = storeId ? [storeId] : [];
    const result = await db.query(`SELECT * FROM employees ${where} ORDER BY last_name, first_name`, params);
    return result.rows;
  },

  async findById(id: string) {
    const result = await db.query('SELECT * FROM employees WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data: {
    userId?: string; firstName: string; lastName: string; role: string;
    phone?: string; monthlySalary?: number; hireDate: string;
    cin?: string; address?: string; city?: string; birthDate?: string;
    cnssNumber?: string; contractType?: string; contractStart?: string; contractEnd?: string;
    emergencyContactName?: string; emergencyContactPhone?: string; notes?: string;
    storeId?: string; defaultShiftCode?: string;
    payFrequency?: string; weeklySalary?: number;
    createdBy?: string;
  }) {
    const result = await db.query(
      `INSERT INTO employees (user_id, first_name, last_name, role, phone, monthly_salary, hire_date,
        cin, address, city, birth_date, cnss_number, contract_type, contract_start, contract_end,
        emergency_contact_name, emergency_contact_phone, notes, store_id, default_shift_code,
        pay_frequency, weekly_salary, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23) RETURNING *`,
      [data.userId || null, data.firstName, data.lastName, data.role,
       data.phone || null, data.monthlySalary || null, data.hireDate,
       data.cin || null, data.address || null, data.city || null, data.birthDate || null,
       data.cnssNumber || null, data.contractType || 'cdi', data.contractStart || null, data.contractEnd || null,
       data.emergencyContactName || null, data.emergencyContactPhone || null, data.notes || null,
       data.storeId || null, data.defaultShiftCode || null,
       data.payFrequency || 'monthly', data.weeklySalary || null,
       data.createdBy || null]
    );
    return result.rows[0];
  },

  async update(id: string, data: Record<string, unknown>, updatedBy?: string) {
    const mapping: Record<string, string> = {
      firstName: 'first_name', lastName: 'last_name', role: 'role',
      phone: 'phone', monthlySalary: 'monthly_salary', isActive: 'is_active',
      cin: 'cin', address: 'address', city: 'city', birthDate: 'birth_date',
      cnssNumber: 'cnss_number', contractType: 'contract_type',
      contractStart: 'contract_start', contractEnd: 'contract_end',
      emergencyContactName: 'emergency_contact_name', emergencyContactPhone: 'emergency_contact_phone',
      notes: 'notes', seniorityYears: 'seniority_years', nbDependents: 'nb_dependents', cimrRate: 'cimr_rate',
      defaultShiftCode: 'default_shift_code',
      payFrequency: 'pay_frequency', weeklySalary: 'weekly_salary',
    };
    // Date fields: convert empty strings to null to avoid DB type errors
    const dateFields = ['birthDate', 'contractStart', 'contractEnd', 'hireDate'];
    for (const df of dateFields) {
      if (data[df] === '') data[df] = null;
    }
    // Numeric fields: convert empty strings to null
    if (data.monthlySalary === '' || data.monthlySalary === 0) data.monthlySalary = null;
    if (data.weeklySalary === '' || data.weeklySalary === 0) data.weeklySalary = null;

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return this.findById(id);
    // updated_by : trace QUI a fait le changement (utilise par le trigger
    // log_employee_salary_change pour alimenter employee_salary_history).
    if (updatedBy) { fields.push(`updated_by = $${i++}`); values.push(updatedBy); }
    values.push(id);
    const result = await db.query(`UPDATE employees SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },

  async delete(id: string) {
    await db.query('UPDATE employees SET is_active = false WHERE id = $1', [id]);
  },

  /**
   * Suppression PHYSIQUE de l'employe + cascade manuelle sur toutes les
   * tables qui le referencent (FK sans ON DELETE CASCADE en migration 009/018/019/090).
   *
   * Action irreversible. Reservee admin. A utiliser uniquement pour purger
   * un employe cree par erreur ou dont on veut effacer toute trace
   * (cas RGPD/droit a l'oubli).
   *
   * Retourne le nombre de lignes supprimees par table pour audit/log.
   */
  async hardDelete(id: string): Promise<{
    payments: number; payroll: number; weeklyPayroll: number; leaves: number;
    attendance: number; schedules: number; salaryAdvances: number;
    productionTempsTravail: number; salesUnlinked: number; employee: number;
  }> {
    // ─── Pre-validation HORS transaction ───
    // 1. Refuse si des retenues d'avance existent : l'admin doit d'abord
    //    annuler les paies concernees (sinon la suppression laisserait des
    //    ecritures 6171/3431 orphelines).
    const repayments = await countRepaymentsForEmployee(id);
    if (repayments > 0) {
      throw new Error(`${repayments} retenue(s) d'avance existent : annulez les paies concernees avant la suppression definitive.`);
    }

    // 2. Recupere la liste des paiements a supprimer AVANT d'ouvrir la
    //    transaction : chaque paymentRepository.delete ouvre sa propre
    //    transaction (reverse ledger + resync facture). On les supprime
    //    un par un et on compte, puis on fait le reste dans une transaction
    //    unique.
    const paymentIdsRes = await db.query(
      `SELECT id FROM payments WHERE employee_id = $1`, [id]
    );
    let paymentsDeleted = 0;
    for (const p of paymentIdsRes.rows) {
      // Si un DELETE echoue (periode close, contrainte), on stoppe : l'admin
      // resout d'abord (ex. reouvrir la periode) et rejoue le hard delete.
      // Les paiements deja supprimes le restent — mais aucun autre etat
      // n'a bouge, l'operation est reprenable.
      await paymentRepository.delete(p.id);
      paymentsDeleted++;
    }

    // ─── Cascade transactionnelle sur le reste ───
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const exists = await client.query('SELECT id FROM employees WHERE id = $1 FOR UPDATE', [id]);
      if (!exists.rows[0]) {
        await client.query('ROLLBACK');
        throw new Error('Employe introuvable');
      }

      // - DELETE pour les donnees 1:1 employe
      // - UPDATE NULL pour les ventes (preserve le CA)
      // - salary_advance_repayments : deja verifie count=0 ci-dessus
      // - employee_commissions : ON DELETE CASCADE au niveau DB
      const tryQuery = async (sql: string, label: string): Promise<number> => {
        try {
          const r = await client.query(sql, [id]);
          return r.rowCount || 0;
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === '42P01') return 0; // table absente sur cet env
          throw new Error(`${label}: ${(e as Error).message}`);
        }
      };

      // Order : enfants avant parents. Weekly payroll et salary_advances
      // etaient OUBLIES avant P1.4 -> FK error sur employe hebdo/avec avance.
      const payroll = await tryQuery('DELETE FROM payroll WHERE employee_id = $1', 'payroll');
      const weeklyPayroll = await tryQuery('DELETE FROM weekly_payroll WHERE employee_id = $1', 'weekly_payroll');
      const salaryAdvances = await tryQuery('DELETE FROM salary_advances WHERE employee_id = $1', 'salary_advances');
      const leaves = await tryQuery('DELETE FROM leaves WHERE employee_id = $1', 'leaves');
      const attendance = await tryQuery('DELETE FROM attendance WHERE employee_id = $1', 'attendance');
      const schedules = await tryQuery('DELETE FROM schedules WHERE employee_id = $1', 'schedules');
      const productionTempsTravail = await tryQuery(
        'DELETE FROM production_temps_travail WHERE employee_id = $1',
        'production_temps_travail'
      );
      const salesUnlinked = await tryQuery(
        'UPDATE sales SET employee_id = NULL WHERE employee_id = $1',
        'sales'
      );

      const empResult = await client.query('DELETE FROM employees WHERE id = $1', [id]);

      await client.query('COMMIT');

      return {
        payments: paymentsDeleted, payroll, weeklyPayroll, leaves, attendance,
        schedules, salaryAdvances, productionTempsTravail, salesUnlinked,
        employee: empResult.rowCount || 0,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Compte les references vers cet employe (pour previewer ce qu'un hard
   * delete supprimerait avant que l'admin confirme).
   */
  async countDependencies(id: string): Promise<{
    payments: number; payroll: number; weeklyPayroll: number; leaves: number;
    attendance: number; schedules: number; salaryAdvances: number;
    salaryAdvanceRepayments: number;
    productionTempsTravail: number; sales: number;
  }> {
    const q = async (sql: string): Promise<number> => {
      try {
        const r = await db.query(sql, [id]);
        return parseInt(String(r.rows[0]?.n || '0'), 10) || 0;
      } catch (e) {
        if ((e as { code?: string }).code === '42P01') return 0;
        throw e;
      }
    };
    // Weekly payroll, salary_advances et repayments etaient absents avant P1.4.
    const [
      payments, payroll, weeklyPayroll, leaves, attendance, schedules,
      salaryAdvances, salaryAdvanceRepayments,
      productionTempsTravail, sales,
    ] = await Promise.all([
      q('SELECT COUNT(*)::int AS n FROM payments WHERE employee_id = $1'),
      q('SELECT COUNT(*)::int AS n FROM payroll WHERE employee_id = $1'),
      q('SELECT COUNT(*)::int AS n FROM weekly_payroll WHERE employee_id = $1'),
      q('SELECT COUNT(*)::int AS n FROM leaves WHERE employee_id = $1'),
      q('SELECT COUNT(*)::int AS n FROM attendance WHERE employee_id = $1'),
      q('SELECT COUNT(*)::int AS n FROM schedules WHERE employee_id = $1'),
      q('SELECT COUNT(*)::int AS n FROM salary_advances WHERE employee_id = $1'),
      q(`SELECT COUNT(*)::int AS n FROM salary_advance_repayments sr
           JOIN salary_advances a ON a.id = sr.advance_id WHERE a.employee_id = $1`),
      q('SELECT COUNT(*)::int AS n FROM production_temps_travail WHERE employee_id = $1'),
      q('SELECT COUNT(*)::int AS n FROM sales WHERE employee_id = $1'),
    ]);
    return {
      payments, payroll, weeklyPayroll, leaves, attendance, schedules,
      salaryAdvances, salaryAdvanceRepayments, productionTempsTravail, sales,
    };
  },
};

export const scheduleRepository = {
  async findByDateRange(startDate: string, endDate: string, employeeId?: string, storeId?: string) {
    const conditions = ['s.date BETWEEN $1 AND $2'];
    const values: unknown[] = [startDate, endDate];
    let i = 3;
    if (employeeId) { conditions.push(`s.employee_id = $${i++}`); values.push(employeeId); }
    if (storeId) { conditions.push(`(e.store_id = $${i++} OR e.store_id IS NULL)`); values.push(storeId); }

    const result = await db.query(
      `SELECT s.*, e.first_name, e.last_name, e.role as employee_role
       FROM schedules s JOIN employees e ON e.id = s.employee_id
       WHERE ${conditions.join(' AND ')} ORDER BY s.date, s.start_time`,
      values
    );
    return result.rows;
  },

  async create(data: {
    employeeId: string; date: string; startTime: string; endTime: string;
    breakMinutes?: number; notes?: string; shiftCode?: string;
  }) {
    const result = await db.query(
      `INSERT INTO schedules (employee_id, date, start_time, end_time, break_minutes, notes, shift_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [data.employeeId, data.date, data.startTime, data.endTime, data.breakMinutes || 0, data.notes || null, data.shiftCode || null]
    );
    return result.rows[0];
  },

  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      date: 'date', startTime: 'start_time', endTime: 'end_time',
      breakMinutes: 'break_minutes', notes: 'notes', shiftCode: 'shift_code',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return null;
    values.push(id);
    const result = await db.query(`UPDATE schedules SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },

  async delete(id: string) {
    await db.query('DELETE FROM schedules WHERE id = $1', [id]);
  },

  /**
   * Charge la matrice hebdomadaire complete : tous les employes actifs du
   * store + leurs assignations Lun -> Dim + les jours en conge approuve.
   *
   * Forme du retour optimisee pour l'UI grille : 1 ligne par employe,
   * `assignments` indexe par date ISO (YYYY-MM-DD), `onLeaveDays` liste
   * les jours verrouilles.
   */
  async getWeek(weekStart: string, weekEnd: string, storeId?: string) {
    // Si l'admin connecte est rattache a un store, on ne montre que SES employes
    // (les employes sans store_id sont consideres globaux et toujours visibles).
    // Sinon (super admin sans store), on retourne tout.
    const employeesRes = await db.query(
      `SELECT e.id, e.first_name, e.last_name, e.role, e.default_shift_code
         FROM employees e
        WHERE e.is_active = true
          ${storeId ? 'AND (e.store_id = $1 OR e.store_id IS NULL)' : ''}
        ORDER BY e.role, e.last_name, e.first_name`,
      storeId ? [storeId] : []
    );

    const employeeIds = employeesRes.rows.map((r: { id: string }) => r.id);
    if (employeeIds.length === 0) {
      return { weekStart, weekEnd, rows: [] };
    }

    // Assignments deja en base sur la fenetre
    const schedulesRes = await db.query(
      `SELECT employee_id, to_char(date, 'YYYY-MM-DD') AS date, shift_code
         FROM schedules
        WHERE date BETWEEN $1 AND $2
          AND employee_id = ANY($3::uuid[])`,
      [weekStart, weekEnd, employeeIds]
    );

    // Conges qui chevauchent la semaine. On inclut approved ET pending :
    // - approved -> case verrouillee, fond violet
    // - pending  -> case verrouillee aussi (par securite : eviter d'affecter
    //   un employe qui sera probablement absent), fond ambre (avertissement)
    // 'rejected' est ignore (l'employe doit travailler).
    const leavesRes = await db.query(
      `SELECT employee_id,
              type,
              status,
              to_char(start_date, 'YYYY-MM-DD') AS start_date,
              to_char(end_date,   'YYYY-MM-DD') AS end_date
         FROM leaves
        WHERE status IN ('approved', 'pending')
          AND employee_id = ANY($3::uuid[])
          AND NOT (end_date < $1 OR start_date > $2)`,
      [weekStart, weekEnd, employeeIds]
    );

    // Index par employee_id
    const assignmentsByEmp = new Map<string, Record<string, string | null>>();
    for (const s of schedulesRes.rows) {
      const m = assignmentsByEmp.get(s.employee_id) ?? {};
      m[s.date] = s.shift_code ?? null;
      assignmentsByEmp.set(s.employee_id, m);
    }

    type LeaveInfo = { type: string; status: 'approved' | 'pending'; startDate: string; endDate: string };
    const leavesByEmp = new Map<string, Record<string, LeaveInfo>>();
    const weekStartMs = Date.parse(weekStart);
    const weekEndMs = Date.parse(weekEnd);
    for (const l of leavesRes.rows) {
      const lStart = Math.max(Date.parse(l.start_date), weekStartMs);
      const lEnd = Math.min(Date.parse(l.end_date), weekEndMs);
      const map = leavesByEmp.get(l.employee_id) ?? {};
      for (let d = lStart; d <= lEnd; d += 86400_000) {
        const iso = new Date(d).toISOString().slice(0, 10);
        // Si 2 conges chevauchent un meme jour, 'approved' prime sur 'pending'
        const existing = map[iso];
        if (!existing || (existing.status === 'pending' && l.status === 'approved')) {
          map[iso] = {
            type: l.type,
            status: l.status as 'approved' | 'pending',
            startDate: l.start_date,
            endDate: l.end_date,
          };
        }
      }
      leavesByEmp.set(l.employee_id, map);
    }

    const rows = employeesRes.rows.map((e: {
      id: string; first_name: string; last_name: string;
      role: string; default_shift_code: string | null;
    }) => {
      const leaveMap = leavesByEmp.get(e.id) ?? {};
      return {
        employeeId: e.id,
        firstName: e.first_name,
        lastName: e.last_name,
        role: e.role,
        defaultShiftCode: e.default_shift_code,
        assignments: assignmentsByEmp.get(e.id) ?? {},
        // Backward compat : liste des jours de conge (toutes statuts confondus)
        onLeaveDays: Object.keys(leaveMap).sort(),
        // Detail par date -> permet a l'UI d'afficher le type et le statut
        leaveDays: leaveMap,
      };
    });

    return { weekStart, weekEnd, rows };
  },

  /**
   * Upsert atomique de toute la semaine.
   * - Une assignation avec shiftCode=null supprime l'eventuelle ligne existante (repos).
   * - Refuse les jours ou un conge approuve chevauche (409).
   * - Pre-remplit attendance avec is_expected=true / status='present' (ecrasable
   *   par le pointage reel via la logique COALESCE existante dans
   *   attendanceRepository.upsert).
   */
  async bulkUpsertWeek(
    assignments: Array<{ employeeId: string; date: string; shiftCode: string | null }>
  ) {
    if (assignments.length === 0) return { updated: 0, deleted: 0, conflicts: [] as string[] };

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Charge tous les shifts utilises pour pre-calculer start/end
      const codes = Array.from(new Set(
        assignments.map(a => a.shiftCode).filter((c): c is string => !!c)
      ));
      const shiftMap = new Map<string, { start_time: string; end_time: string }>();
      if (codes.length > 0) {
        const r = await client.query(
          `SELECT code, start_time, end_time FROM shifts WHERE code = ANY($1::text[])`,
          [codes]
        );
        for (const s of r.rows) {
          shiftMap.set(s.code, { start_time: s.start_time, end_time: s.end_time });
        }
      }

      // 2. Verifie qu'aucun jour assigne ne chevauche un conge approuve
      const employeeIds = Array.from(new Set(assignments.map(a => a.employeeId)));
      const datesSet = new Set(assignments.map(a => a.date));
      const minDate = Array.from(datesSet).sort()[0];
      const maxDate = Array.from(datesSet).sort().slice(-1)[0];

      const leavesRes = await client.query(
        `SELECT employee_id,
                to_char(start_date, 'YYYY-MM-DD') AS start_date,
                to_char(end_date, 'YYYY-MM-DD') AS end_date
           FROM leaves
          WHERE status = 'approved'
            AND employee_id = ANY($1::uuid[])
            AND NOT (end_date < $2 OR start_date > $3)`,
        [employeeIds, minDate, maxDate]
      );

      const conflicts: string[] = [];
      for (const a of assignments) {
        if (!a.shiftCode) continue;
        for (const l of leavesRes.rows) {
          if (l.employee_id !== a.employeeId) continue;
          if (a.date >= l.start_date && a.date <= l.end_date) {
            conflicts.push(`${a.employeeId}@${a.date}`);
          }
        }
      }
      if (conflicts.length > 0) {
        await client.query('ROLLBACK');
        const err = new Error(`Conflit: ${conflicts.length} assignation(s) chevauchent un conge approuve`) as Error & { code?: string; conflicts?: string[] };
        err.code = 'LEAVE_CONFLICT';
        err.conflicts = conflicts;
        throw err;
      }

      // 3. Apply assignments
      let updated = 0;
      let deleted = 0;
      for (const a of assignments) {
        if (a.shiftCode === null) {
          const r = await client.query(
            `DELETE FROM schedules WHERE employee_id = $1 AND date = $2`,
            [a.employeeId, a.date]
          );
          deleted += r.rowCount || 0;
          // Supprime aussi la ligne attendance pre-remplie (sans pointage reel)
          await client.query(
            `DELETE FROM attendance
              WHERE employee_id = $1 AND date = $2
                AND is_expected = true AND check_in IS NULL`,
            [a.employeeId, a.date]
          );
          continue;
        }
        const shift = shiftMap.get(a.shiftCode);
        if (!shift) {
          throw new Error(`Shift inconnu: ${a.shiftCode}`);
        }
        await client.query(
          `INSERT INTO schedules (employee_id, date, start_time, end_time, break_minutes, shift_code)
           VALUES ($1, $2, $3, $4, 0, $5)
           ON CONFLICT (employee_id, date) DO UPDATE SET
             start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time,
             shift_code = EXCLUDED.shift_code`,
          [a.employeeId, a.date, shift.start_time, shift.end_time, a.shiftCode]
        );
        updated += 1;

        // Pre-remplit attendance attendue. Ne supplante pas un pointage reel
        // (check_in deja saisi -> COALESCE preserve la valeur existante).
        await client.query(
          `INSERT INTO attendance (employee_id, date, status, is_expected)
           VALUES ($1, $2, 'present', true)
           ON CONFLICT (employee_id, date) DO UPDATE SET
             is_expected = CASE WHEN attendance.check_in IS NULL THEN true ELSE attendance.is_expected END`,
          [a.employeeId, a.date]
        );
      }

      await client.query('COMMIT');
      return { updated, deleted, conflicts: [] };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  },
};

export const attendanceRepository = {
  async findByDateRange(startDate: string, endDate: string, employeeId?: string, storeId?: string) {
    const conditions = ['a.date BETWEEN $1 AND $2'];
    const values: unknown[] = [startDate, endDate];
    let i = 3;
    if (employeeId) { conditions.push(`a.employee_id = $${i++}`); values.push(employeeId); }
    // Scoping multi-store : un manager du magasin A ne voit pas les pointages
    // des employes du magasin B. Employes NULL restent visibles (globaux).
    if (storeId) { conditions.push(`(e.store_id = $${i++} OR e.store_id IS NULL)`); values.push(storeId); }
    // Jointure schedules pour ramener le shift planifie : permet a l'UI Pointage
    // d'afficher "Planifie: Vente 7h-14h" et de distinguer presence attendue/reelle.
    const result = await db.query(
      `SELECT a.*, e.first_name, e.last_name, e.role as employee_role,
              s.shift_code as planned_shift_code,
              s.start_time as planned_start,
              s.end_time as planned_end
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN schedules s ON s.employee_id = a.employee_id AND s.date = a.date
        WHERE ${conditions.join(' AND ')} ORDER BY a.date DESC, e.last_name`,
      values
    );
    return result.rows;
  },

  async upsert(data: {
    employeeId: string; date: string; checkIn?: string; checkOut?: string;
    status: string; overtimeMinutes?: number; notes?: string;
    checkInMethod?: string; checkInTerminal?: string;
    checkOutMethod?: string; checkOutTerminal?: string;
  }) {
    // is_expected: une ligne devient "reelle" (is_expected=false) des qu'un
    // pointage check_in/out est saisi, OU des que le statut est explicitement
    // autre que 'present' (absent/retard/demi-j = decision admin, pas une
    // simple confirmation du planning).
    const result = await db.query(
      `INSERT INTO attendance (employee_id, date, check_in, check_out, status, overtime_minutes, notes,
                               check_in_method, check_in_terminal, check_out_method, check_out_terminal,
                               is_expected)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false)
       ON CONFLICT (employee_id, date) DO UPDATE SET
         check_in = COALESCE(EXCLUDED.check_in, attendance.check_in),
         check_out = COALESCE(EXCLUDED.check_out, attendance.check_out),
         status = EXCLUDED.status,
         overtime_minutes = EXCLUDED.overtime_minutes,
         notes = EXCLUDED.notes,
         check_in_method = COALESCE(EXCLUDED.check_in_method, attendance.check_in_method),
         check_in_terminal = COALESCE(EXCLUDED.check_in_terminal, attendance.check_in_terminal),
         check_out_method = COALESCE(EXCLUDED.check_out_method, attendance.check_out_method),
         check_out_terminal = COALESCE(EXCLUDED.check_out_terminal, attendance.check_out_terminal),
         is_expected = false
       RETURNING *`,
      [data.employeeId, data.date, data.checkIn || null, data.checkOut || null,
       data.status, data.overtimeMinutes || 0, data.notes || null,
       data.checkInMethod || null, data.checkInTerminal || null,
       data.checkOutMethod || null, data.checkOutTerminal || null]
    );
    return result.rows[0];
  },

  async findToday(employeeId: string) {
    const result = await db.query(
      `SELECT * FROM attendance WHERE employee_id = $1 AND date = CURRENT_DATE`,
      [employeeId]
    );
    return result.rows[0] || null;
  },

  async findActiveOnStore(storeId: string) {
    // Employes ayant pointe leur arrivee aujourd'hui mais pas encore leur depart.
    // Sert a determiner qui est "en service" pour attribuer une vente.
    const result = await db.query(
      `SELECT a.*, e.first_name, e.last_name, e.role
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.date = CURRENT_DATE
          AND a.check_in IS NOT NULL
          AND a.check_out IS NULL
          AND e.store_id = $1
        ORDER BY a.check_in DESC`,
      [storeId]
    );
    return result.rows;
  },

  async findLastActiveEmployee(storeId: string) {
    // Le dernier employe ayant pointe son arrivee sans depart sur ce store.
    // Utilise comme fallback pour sales.employee_id si pas de selection explicite.
    const result = await db.query(
      `SELECT e.id, e.first_name, e.last_name
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.date = CURRENT_DATE
          AND a.check_in IS NOT NULL
          AND a.check_out IS NULL
          AND e.store_id = $1
        ORDER BY a.check_in DESC
        LIMIT 1`,
      [storeId]
    );
    return result.rows[0] || null;
  },

  async bulkUpsert(records: {
    employeeId: string; date: string; status: string;
    checkIn?: string; checkOut?: string; overtimeMinutes?: number; notes?: string;
  }[]) {
    const results = [];
    for (const r of records) {
      results.push(await this.upsert(r));
    }
    return results;
  },

  async monthlySummary(employeeId: string, month: number, year: number) {
    const result = await db.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'present') as present_days,
        COUNT(*) FILTER (WHERE status = 'double') as double_days,
        COUNT(*) FILTER (WHERE status = 'absent') as absent_days,
        COUNT(*) FILTER (WHERE status = 'late') as late_days,
        COUNT(*) FILTER (WHERE status = 'half_day') as half_days,
        COUNT(*) FILTER (WHERE status = 'repos') as repos_days,
        COALESCE(SUM(overtime_minutes), 0) as total_overtime_minutes
       FROM attendance
       WHERE employee_id = $1 AND EXTRACT(MONTH FROM date) = $2 AND EXTRACT(YEAR FROM date) = $3`,
      [employeeId, month, year]
    );
    return result.rows[0];
  },

  async delete(id: string) {
    await db.query('DELETE FROM attendance WHERE id = $1', [id]);
  },
};

export const leaveRepository = {
  async findAll(params: { employeeId?: string; status?: string; year?: number; activeOn?: string; storeId?: string }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (params.employeeId) { conditions.push(`l.employee_id = $${i++}`); values.push(params.employeeId); }
    if (params.status) { conditions.push(`l.status = $${i++}`); values.push(params.status); }
    if (params.year) { conditions.push(`EXTRACT(YEAR FROM l.start_date) = $${i++}`); values.push(params.year); }
    // activeOn = date YYYY-MM-DD : ne retourne que les conges qui chevauchent
    // ce jour-la (start_date <= date <= end_date). Utilise par l'onglet Pointage
    // pour afficher un badge "Conge X" a la place de "Non planifie".
    if (params.activeOn) {
      conditions.push(`l.start_date <= $${i} AND l.end_date >= $${i}`);
      values.push(params.activeOn);
      i++;
    }
    // Scoping multi-store.
    if (params.storeId) { conditions.push(`(e.store_id = $${i++} OR e.store_id IS NULL)`); values.push(params.storeId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT l.*, e.first_name, e.last_name, e.role as employee_role,
              u.first_name as approved_by_first_name, u.last_name as approved_by_last_name
       FROM leaves l
       JOIN employees e ON e.id = l.employee_id
       LEFT JOIN users u ON u.id = l.approved_by
       ${where}
       ORDER BY l.created_at DESC`,
      values
    );
    return result.rows;
  },

  async create(data: {
    employeeId: string; type: string; startDate: string; endDate: string;
    days: number; reason?: string;
  }) {
    const result = await db.query(
      `INSERT INTO leaves (employee_id, type, start_date, end_date, days, reason)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [data.employeeId, data.type, data.startDate, data.endDate, data.days, data.reason || null]
    );
    return result.rows[0];
  },

  async updateStatus(id: string, status: string, approvedBy?: string) {
    const result = await db.query(
      `UPDATE leaves SET status = $1, approved_by = $2 WHERE id = $3 RETURNING *`,
      [status, approvedBy || null, id]
    );
    return result.rows[0];
  },

  async balanceByEmployee(employeeId: string, year: number) {
    const result = await db.query(
      `SELECT type, COALESCE(SUM(days), 0) as used_days
       FROM leaves
       WHERE employee_id = $1 AND EXTRACT(YEAR FROM start_date) = $2 AND status = 'approved'
       GROUP BY type`,
      [employeeId, year]
    );
    return result.rows;
  },

  async delete(id: string) {
    await db.query('DELETE FROM leaves WHERE id = $1', [id]);
  },
};

export const payrollRepository = {
  async findAll(params: { month?: number; year?: number; employeeId?: string; storeId?: string }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (params.month) { conditions.push(`p.month = $${i++}`); values.push(params.month); }
    if (params.year) { conditions.push(`p.year = $${i++}`); values.push(params.year); }
    if (params.employeeId) { conditions.push(`p.employee_id = $${i++}`); values.push(params.employeeId); }
    // Scoping multi-store : le manager du magasin A ne voit que SES bulletins
    // (employes NULL = globaux, restent visibles pour compatibilite).
    if (params.storeId) { conditions.push(`(e.store_id = $${i++} OR e.store_id IS NULL)`); values.push(params.storeId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT p.*, e.first_name, e.last_name, e.role as employee_role, e.monthly_salary, e.seniority_years, e.nb_dependents
       FROM payroll p
       JOIN employees e ON e.id = p.employee_id
       ${where}
       ORDER BY e.last_name, e.first_name`,
      values
    );
    return result.rows;
  },

  async generate(month: number, year: number) {
    // ═══════════════════════════════════════════════════════════
    // Modele de paie marocain — CNSS / AMO / CIMR / IR 2025
    // Conforme aux regles de la CNSS et de la fiscalite marocaine
    // ═══════════════════════════════════════════════════════════

    // ─── 1. CNSS ───
    const CNSS_PLAFOND       = 6000;    // plafond mensuel
    const CNSS_RATE_EMP      = 0.0448;  // 4.48% part salariale
    const CNSS_RATE_PAT      = 0.0898;  // 8.98% part patronale

    // ─── 2. AMO (Assurance Maladie Obligatoire) ───
    const AMO_RATE_EMP       = 0.0226;  // 2.26% salariale (sans plafond)
    const AMO_RATE_PAT       = 0.0411;  // 4.11% patronale (sans plafond)

    // ─── 3. Charges patronales ───
    const ALLOC_FAM_RATE     = 0.064;   // 6.40% allocations familiales (sans plafond)
    const TAXE_FP_RATE       = 0.016;   // 1.60% taxe formation professionnelle

    // ─── 4. Frais professionnels ───
    const FRAIS_PRO_RATE     = 0.20;    // 20% du salaire net imposable
    const FRAIS_PRO_PLAFOND  = 2500;    // plafond mensuel 2,500 DH

    // ─── 5. Deduction charges familiales ───
    const DEDUCTION_FAMILLE  = 30;      // 30 DH/personne/mois (max 6 personnes)

    // ─── 6. Bareme IR annuel progressif 2025 ───
    // Calcul sur base ANNUELLE puis division par 12
    function calcIRAnnuel(baseIRMensuelle: number): number {
      const revenuAnnuel = baseIRMensuelle * 12;
      let irAnnuel = 0;

      if (revenuAnnuel <= 30000) {
        irAnnuel = 0;
      } else if (revenuAnnuel <= 50000) {
        irAnnuel = (revenuAnnuel - 30000) * 0.10;
      } else if (revenuAnnuel <= 60000) {
        irAnnuel = 2000 + (revenuAnnuel - 50000) * 0.20;
      } else if (revenuAnnuel <= 80000) {
        irAnnuel = 4000 + (revenuAnnuel - 60000) * 0.30;
      } else if (revenuAnnuel <= 180000) {
        irAnnuel = 10000 + (revenuAnnuel - 80000) * 0.34;
      } else {
        irAnnuel = 44000 + (revenuAnnuel - 180000) * 0.38;
      }

      // Retourner IR mensuel = annuel / 12
      return irAnnuel / 12;
    }

    // Prime d'anciennete (Code du travail marocain art. 350-352)
    function calcSeniorityRate(years: number): number {
      if (years < 2)  return 0;
      if (years < 5)  return 0.05;   // 5% apres 2 ans
      if (years < 12) return 0.10;   // 10% apres 5 ans
      if (years < 20) return 0.15;   // 15% apres 12 ans
      if (years < 25) return 0.20;   // 20% apres 20 ans
      return 0.25;                    // 25% apres 25 ans
    }

    const r2 = (v: number) => Math.round(v * 100) / 100;

    // Cotisations sociales et IR DESACTIVES pour le moment (demande metier
    // 07/2026 : etablissement pas encore declare) : net = brut, charges
    // patronales a 0. Repasser a true pour reactiver le calcul marocain
    // complet CNSS/AMO/CIMR/IR ci-dessous (le bareme reste en place).
    const APPLY_SOCIAL_DEDUCTIONS = false;

    // Seuls les employes payes AU MOIS : les hebdo ont leur propre paie
    // (weekly_payroll), ils ne doivent pas apparaitre dans les deux.
    const employees = await db.query(
      `SELECT * FROM employees
        WHERE is_active = true
          AND monthly_salary IS NOT NULL
          AND COALESCE(pay_frequency, 'monthly') = 'monthly'`
    );

    // Purge les bulletins generes par erreur pour des employes passes en
    // hebdo (non payes uniquement — l'historique paye n'est jamais touche).
    await db.query(
      `DELETE FROM payroll p
        USING employees e
        WHERE e.id = p.employee_id
          AND p.month = $1 AND p.year = $2
          AND p.paid = false
          AND COALESCE(e.pay_frequency, 'monthly') != 'monthly'`,
      [month, year]
    );
    const results = [];

    for (const emp of employees.rows) {
      // ─── Pointage du mois ───
      const att = await db.query(
        // 'repos' compte comme jour paye (jour de repos hebdomadaire inclus
        // dans le salaire mensuel) — regroupe avec 'present'/'late' pour le
        // decompte des jours travailles facturables.
        // 'double' = deux shifts le meme jour : compte 2 jours travailles et
        // ajoute 1 jour supplementaire au brut (taux journalier base/26).
        `SELECT
          COUNT(*) FILTER (WHERE status IN ('present', 'late', 'repos')) as present_days,
          COUNT(*) FILTER (WHERE status = 'double') as double_days,
          COUNT(*) FILTER (WHERE status = 'absent') as absent_days,
          COUNT(*) FILTER (WHERE status = 'half_day') as half_days,
          COALESCE(SUM(overtime_minutes), 0) as total_overtime
         FROM attendance
         WHERE employee_id = $1 AND EXTRACT(MONTH FROM date) = $2 AND EXTRACT(YEAR FROM date) = $3`,
        [emp.id, month, year]
      );
      const a = att.rows[0];
      const baseSalary = parseFloat(emp.monthly_salary);
      const doubleDays = parseInt(a.double_days);
      const workedDays = parseInt(a.present_days) + 2 * doubleDays + Math.floor(parseInt(a.half_days) / 2);
      const absentDays = parseInt(a.absent_days);
      const overtimeHours = parseFloat(a.total_overtime) / 60;
      const dailyRate = baseSalary / 26;
      const seniorityYears = parseInt(emp.seniority_years) || 0;
      const nbDependents = Math.min(parseInt(emp.nb_dependents) || 0, 6);
      const cimrRate = parseFloat(emp.cimr_rate) || 0;

      // ═══ ETAPE 1 : Salaire brut ═══
      const seniorityBonus = r2(baseSalary * calcSeniorityRate(seniorityYears));
      const overtimeAmount = r2(overtimeHours * (dailyRate / 8) * 1.25);
      // Double shift : le 2e service du jour est paye 1 jour supplementaire
      // (symetrique de la retenue d'absence, meme taux journalier base/26).
      const extraShiftAmount = r2(doubleDays * dailyRate);
      const absenceDeduction = r2(absentDays * dailyRate);
      const grossSalary = r2(baseSalary + seniorityBonus + overtimeAmount + extraShiftAmount - absenceDeduction);

      // ═══ ETAPE 2 : CNSS salariale (plafonnee a 6 000 DH) ═══
      const cnssBase = Math.min(grossSalary, CNSS_PLAFOND);
      const cnssEmployee = APPLY_SOCIAL_DEDUCTIONS ? r2(cnssBase * CNSS_RATE_EMP) : 0;

      // ═══ ETAPE 3 : AMO salariale (sans plafond) ═══
      const amoEmployee = APPLY_SOCIAL_DEDUCTIONS ? r2(grossSalary * AMO_RATE_EMP) : 0;

      // ═══ ETAPE 3b : CIMR salariale (si applicable) ═══
      const cimrEmployee = APPLY_SOCIAL_DEDUCTIONS ? r2(grossSalary * cimrRate / 100) : 0;

      // ═══ ETAPE 4 : Salaire net imposable ═══
      // SNI = Brut - CNSS - AMO - CIMR
      const salaireNetImposable = r2(grossSalary - cnssEmployee - amoEmployee - cimrEmployee);

      // ═══ ETAPE 5 : Frais professionnels ═══
      // 20% du SNI, plafonne a 2 500 DH/mois
      const fraisPro = APPLY_SOCIAL_DEDUCTIONS ? r2(Math.min(salaireNetImposable * FRAIS_PRO_RATE, FRAIS_PRO_PLAFOND)) : 0;

      // ═══ ETAPE 6 : Base imposable IR ═══
      const baseIR = r2(salaireNetImposable - fraisPro);

      // ═══ ETAPE 7 : IR (bareme annuel / 12) ═══
      const irBrut = APPLY_SOCIAL_DEDUCTIONS ? r2(calcIRAnnuel(baseIR)) : 0;

      // ═══ ETAPE 8 : Deduction charges familiales ═══
      const familyDeduction = APPLY_SOCIAL_DEDUCTIONS ? r2(nbDependents * DEDUCTION_FAMILLE) : 0;

      // ═══ ETAPE 9 : IR net ═══
      const irNet = r2(Math.max(irBrut - familyDeduction, 0));

      // ═══ ETAPE 10 : Salaire net a payer ═══
      // Net = SNI - IR net = Brut - CNSS - AMO - CIMR - IR net
      const netSalary = r2(salaireNetImposable - irNet);

      // ═══ Charges patronales ═══
      const cnssEmployer = APPLY_SOCIAL_DEDUCTIONS ? r2(cnssBase * CNSS_RATE_PAT) : 0;
      const amoEmployer = APPLY_SOCIAL_DEDUCTIONS ? r2(grossSalary * AMO_RATE_PAT) : 0;
      const cimrEmployer = APPLY_SOCIAL_DEDUCTIONS ? r2(grossSalary * cimrRate / 100) : 0; // meme taux que salarie par defaut
      const allocFamiliales = APPLY_SOCIAL_DEDUCTIONS ? r2(grossSalary * ALLOC_FAM_RATE) : 0;
      const taxeFP = APPLY_SOCIAL_DEDUCTIONS ? r2(grossSalary * TAXE_FP_RATE) : 0;
      const totalChargesPatron = r2(cnssEmployer + amoEmployer + cimrEmployer + allocFamiliales + taxeFP);

      const result = await db.query(
        `INSERT INTO payroll (
          employee_id, month, year, base_salary, worked_days, absent_days,
          overtime_hours, overtime_amount, seniority_bonus, gross_salary, deductions,
          cnss_employee, cnss_employer, amo_employee, amo_employer,
          cimr_employee, cimr_employer,
          frais_pro, ir_gross, ir_net, family_deduction, nb_dependents,
          alloc_familiales, taxe_fp, total_charges_patron, net_salary,
          extra_shift_days, extra_shift_amount
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
         ON CONFLICT (employee_id, month, year) DO UPDATE SET
           base_salary = EXCLUDED.base_salary, worked_days = EXCLUDED.worked_days,
           absent_days = EXCLUDED.absent_days, overtime_hours = EXCLUDED.overtime_hours,
           overtime_amount = EXCLUDED.overtime_amount, seniority_bonus = EXCLUDED.seniority_bonus,
           gross_salary = EXCLUDED.gross_salary, deductions = EXCLUDED.deductions,
           cnss_employee = EXCLUDED.cnss_employee, cnss_employer = EXCLUDED.cnss_employer,
           amo_employee = EXCLUDED.amo_employee, amo_employer = EXCLUDED.amo_employer,
           cimr_employee = EXCLUDED.cimr_employee, cimr_employer = EXCLUDED.cimr_employer,
           frais_pro = EXCLUDED.frais_pro, ir_gross = EXCLUDED.ir_gross,
           ir_net = EXCLUDED.ir_net, family_deduction = EXCLUDED.family_deduction,
           nb_dependents = EXCLUDED.nb_dependents,
           alloc_familiales = EXCLUDED.alloc_familiales, taxe_fp = EXCLUDED.taxe_fp,
           total_charges_patron = EXCLUDED.total_charges_patron,
           net_salary = EXCLUDED.net_salary,
           extra_shift_days = EXCLUDED.extra_shift_days,
           extra_shift_amount = EXCLUDED.extra_shift_amount
         RETURNING *`,
        [emp.id, month, year, baseSalary, workedDays, absentDays,
         overtimeHours, overtimeAmount, seniorityBonus, grossSalary, absenceDeduction,
         cnssEmployee, cnssEmployer, amoEmployee, amoEmployer,
         cimrEmployee, cimrEmployer,
         fraisPro, irBrut, irNet, familyDeduction, nbDependents,
         allocFamiliales, taxeFP, totalChargesPatron, netSalary,
         doubleDays, extraShiftAmount]
      );
      results.push(result.rows[0]);
    }
    return results;
  },

  /**
   * Edition d'un bulletin (primes/retenues/notes).
   *
   * INTERDIT sur un bulletin paye : le net qui a servi a la sortie de caisse
   * doit rester intangible. Toute correction sur une paie payee doit passer
   * par unmarkPaid -> update -> markPaid.
   *
   * Champs paid/paidAt/paymentMethod SUPPRIMES du mapping : le seul chemin
   * legitime pour marquer paye est POST /payroll/:id/pay (createur d'ecriture
   * comptable + retenue d'avance). Autoriser paid via PUT permettrait de
   * marquer un bulletin "paye" sans sortie de caisse ni retenue.
   *
   * Recalcul du net : formule alignee sur generate() (grossSalary - cotisations).
   * L'ancienne omettait seniority_bonus, extra_shift_amount, amo_employee,
   * cimr_employee, ir_net -> modifier une prime corrompait le net.
   */
  async update(id: string, data: Record<string, unknown>) {
    // Verrou : refuse toute modification d'un bulletin deja paye.
    const current = await db.query('SELECT paid FROM payroll WHERE id = $1', [id]);
    if (!current.rows[0]) return null;
    if (current.rows[0].paid) {
      throw new Error('Bulletin deja paye : annulez le paiement avant de modifier (unmarkPaid puis re-generation ou re-edition).');
    }

    const mapping: Record<string, string> = {
      bonuses: 'bonuses', deductions: 'deductions', notes: 'notes',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return null;
    // Formule complete alignee sur generate() : brut - cotisations sociales - IR net.
    // Bonuses est un ajustement manuel positif ; deductions inclut l'absence
    // deduction calculee par generate (peut etre surchargee ici).
    if (data.bonuses !== undefined || data.deductions !== undefined) {
      fields.push(
        `net_salary = base_salary + COALESCE(seniority_bonus, 0) + COALESCE(overtime_amount, 0)`
        + ` + COALESCE(extra_shift_amount, 0)`
        + ` + COALESCE($${i}::numeric, bonuses, 0) - COALESCE($${i + 1}::numeric, deductions, 0)`
        + ` - COALESCE(cnss_employee, 0) - COALESCE(amo_employee, 0)`
        + ` - COALESCE(cimr_employee, 0) - COALESCE(ir_net, 0)`
      );
      values.push(data.bonuses ?? null, data.deductions ?? null);
      i += 2;
    }
    values.push(id);
    const result = await db.query(`UPDATE payroll SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },

  async markPaid(id: string, paymentMethod: string, createdBy?: string, storeId?: string, advanceDeduction = 0) {
    // Lecture pre-validation (net + solde d'avances). On travaille sur un
    // snapshot : la seule chose qui compte pour l'atomicite, c'est l'UPDATE
    // conditionnel qui suit (voir plus bas). Si un autre process valide la
    // paie entre ce SELECT et le UPDATE, notre UPDATE ne matchera pas (WHERE
    // paid = false) et on ressort proprement.
    const existing = await db.query('SELECT * FROM payroll WHERE id = $1', [id]);
    const current = existing.rows[0];
    if (!current) return null;
    if (current.paid) return current;

    const net = parseFloat(current.net_salary);
    const deduction = Math.max(0, Math.round((advanceDeduction || 0) * 100) / 100);
    if (deduction > 0) {
      const outstandingRes = await salaryAdvanceRepository.outstandingByEmployee(current.employee_id);
      const outstanding = parseFloat(outstandingRes[0]?.outstanding || '0');
      if (deduction > Math.min(net, outstanding) + 0.005) {
        throw new Error(`Retenue ${deduction.toFixed(2)} DH superieure au net a payer (${net.toFixed(2)} DH) ou au solde d'avances (${outstanding.toFixed(2)} DH)`);
      }
    }

    // ─── Verrou d'idempotence atomique ───
    // WHERE paid = false RETURNING : PostgreSQL prend un verrou de ligne sur
    // le UPDATE ; deux requetes concurrentes (double-clic) : la premiere passe,
    // la seconde ne matche rien -> rowCount 0 -> on ressort avec l'etat actuel.
    // Elimine la course qui existait entre le SELECT ci-dessus et l'UPDATE.
    // paid_by (mig 239) : trace QUI a valide le paiement (conformite audit).
    const claim = await db.query(
      `UPDATE payroll SET paid = true, paid_at = NOW(), payment_method = $1,
                          advance_deduction = $2, paid_by = $3, updated_by = $3
         WHERE id = $4 AND paid = false RETURNING *`,
      [paymentMethod, deduction, createdBy || null, id]
    );
    if (claim.rowCount === 0) {
      const now = await db.query('SELECT * FROM payroll WHERE id = $1', [id]);
      return now.rows[0] || null;
    }
    const payroll = claim.rows[0];

    // Get employee info for the accounting entry description
    const emp = await db.query('SELECT first_name, last_name FROM employees WHERE id = $1', [payroll.employee_id]);
    const employee = emp.rows[0];
    const empName = employee ? `${employee.first_name} ${employee.last_name}` : '';

    // Find "Salaires" expense category
    const catResult = await db.query(`SELECT id FROM expense_categories WHERE name = 'Salaires' AND type = 'expense' LIMIT 1`);
    const categoryId = catResult.rows[0]?.id || null;

    // Decaissement reel = net moins la retenue d'avance (le cash de l'avance
    // est deja sorti a l'octroi — ne le deduire qu'UNE fois de la caisse).
    // Si une etape (paiement OU retenue) echoue, on annule TOUT :
    //  - la sortie de caisse deja creee est supprimee (paymentRepository.delete
    //    reverse aussi l'ecriture comptable) ;
    //  - le flag paid revient a false pour permettre un nouvel essai.
    let createdPaymentId: string | null = null;
    try {
      const cashOut = Math.round((net - deduction) * 100) / 100;
      if (cashOut > 0) {
        const payment = await paymentRepository.create({
          // reference VARCHAR(50) : tronque pour ne pas echouer sur un nom long
          reference: `SAL-${payroll.month}/${payroll.year}-${empName.replace(/\s+/g, '')}`.slice(0, 50),
          type: 'salary',
          categoryId,
          employeeId: payroll.employee_id,
          amount: cashOut,
          paymentMethod: paymentMethod,
          paymentDate: getLocalISODate(),
          description: `Salaire ${payroll.month}/${payroll.year} - ${empName}`
            + (deduction > 0 ? ` (retenue avance ${deduction.toFixed(2)} DH)` : ''),
          createdBy: createdBy || payroll.employee_id,
          storeId,
        });
        createdPaymentId = payment?.id ?? null;
      }

      if (deduction > 0) {
        const applied = await salaryAdvanceRepository.applyDeduction({
          employeeId: payroll.employee_id,
          amount: deduction,
          payrollId: id,
          userId: createdBy || payroll.employee_id,
          storeId,
          label: `${empName} ${payroll.month}/${payroll.year}`,
        });
        // Course avec une autre paie qui consomme le solde entre validation
        // et imputation : le cash est deja sorti pour la valeur pleine mais
        // la creance 3431 n'est eteinte que pour `applied`. Refuse plutot que
        // laisser une divergence silencieuse ; le cleanup ci-dessous annule
        // tout et l'operateur retente avec la bonne retenue.
        if (Math.abs(applied - deduction) > 0.005) {
          throw new Error(
            `Retenue partielle : ${applied.toFixed(2)} DH imputes sur ${deduction.toFixed(2)} DH demandes ` +
            `(solde d'avances insuffisant, probablement une paie concurrente).`
          );
        }
      }
    } catch (err) {
      if (createdPaymentId) {
        try { await paymentRepository.delete(createdPaymentId); }
        catch (cleanupErr) {
          // eslint-disable-next-line no-console
          console.error('[payroll.markPaid] cleanup paiement echoue', createdPaymentId, cleanupErr);
        }
      }
      await db.query(
        `UPDATE payroll SET paid = false, paid_at = NULL, payment_method = NULL, advance_deduction = 0 WHERE id = $1`,
        [id]
      );
      throw new Error(`Paiement annulé — la sortie de caisse n'a pas pu être créée : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    }

    return payroll;
  },

  /**
   * Annule le marquage paye d'un bulletin mensuel (correction d'erreur).
   * Meme nettoyage complet que l'hebdo : supprime les sorties de caisse
   * liees (reference SAL-{mois}/{annee}-..., ecritures reversees), reverse
   * les retenues d'avance (solde re-credite), reset les flags.
   */
  async unmarkPaid(id: string) {
    // Idempotence : deux annulations concurrentes ne doivent pas supprimer
    // deux fois les paiements. On revendique le passage a paid=false par un
    // UPDATE conditionnel ; si un autre process a deja annule, on ressort.
    const claim = await db.query(
      `UPDATE payroll SET paid = false, paid_at = NULL, payment_method = NULL, advance_deduction = 0
         WHERE id = $1 AND paid = true RETURNING *`,
      [id]
    );
    if (claim.rowCount === 0) {
      // Soit inexistant, soit deja non paye : retourne l'etat actuel.
      const existing = await db.query('SELECT * FROM payroll WHERE id = $1', [id]);
      return existing.rows[0] || null;
    }
    const p = claim.rows[0];

    // Cleanup : sortie caisse + retenues. Si un echec survient (periode close
    // par ex.), on RESTAURE le flag paid=true pour ne pas laisser une ligne
    // "non payee" avec un paiement en base.
    try {
      const payments = await db.query(
        `SELECT id FROM payments WHERE type = 'salary' AND employee_id = $1 AND reference LIKE $2`,
        [p.employee_id, `SAL-${p.month}/${p.year}-%`]
      );
      for (const pay of payments.rows) {
        await paymentRepository.delete(pay.id);
      }
      await salaryAdvanceRepository.reverseRepayments({ payrollId: id });
    } catch (err) {
      await db.query(
        `UPDATE payroll SET paid = true, paid_at = $1, payment_method = $2, advance_deduction = $3
           WHERE id = $4`,
        [p.paid_at, p.payment_method, p.advance_deduction, id]
      );
      throw new Error(`Annulation impossible : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    }

    const r = await db.query('SELECT * FROM payroll WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
};
