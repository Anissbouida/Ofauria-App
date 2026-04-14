import { db } from '../config/database.js';
import { paymentRepository } from './accounting.repository.js';
import { getLocalISODate } from '../utils/timezone.js';

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
    storeId?: string;
  }) {
    const result = await db.query(
      `INSERT INTO employees (user_id, first_name, last_name, role, phone, monthly_salary, hire_date,
        cin, address, city, birth_date, cnss_number, contract_type, contract_start, contract_end,
        emergency_contact_name, emergency_contact_phone, notes, store_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [data.userId || null, data.firstName, data.lastName, data.role,
       data.phone || null, data.monthlySalary || null, data.hireDate,
       data.cin || null, data.address || null, data.city || null, data.birthDate || null,
       data.cnssNumber || null, data.contractType || 'cdi', data.contractStart || null, data.contractEnd || null,
       data.emergencyContactName || null, data.emergencyContactPhone || null, data.notes || null,
       data.storeId || null]
    );
    return result.rows[0];
  },

  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      firstName: 'first_name', lastName: 'last_name', role: 'role',
      phone: 'phone', monthlySalary: 'monthly_salary', isActive: 'is_active',
      cin: 'cin', address: 'address', city: 'city', birthDate: 'birth_date',
      cnssNumber: 'cnss_number', contractType: 'contract_type',
      contractStart: 'contract_start', contractEnd: 'contract_end',
      emergencyContactName: 'emergency_contact_name', emergencyContactPhone: 'emergency_contact_phone',
      notes: 'notes', seniorityYears: 'seniority_years', nbDependents: 'nb_dependents', cimrRate: 'cimr_rate',
    };
    // Date fields: convert empty strings to null to avoid DB type errors
    const dateFields = ['birthDate', 'contractStart', 'contractEnd', 'hireDate'];
    for (const df of dateFields) {
      if (data[df] === '') data[df] = null;
    }
    // Numeric fields: convert empty strings to null
    if (data.monthlySalary === '' || data.monthlySalary === 0) data.monthlySalary = null;

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return this.findById(id);
    values.push(id);
    const result = await db.query(`UPDATE employees SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },

  async delete(id: string) {
    await db.query('UPDATE employees SET is_active = false WHERE id = $1', [id]);
  },
};

export const scheduleRepository = {
  async findByDateRange(startDate: string, endDate: string, employeeId?: string) {
    const conditions = ['s.date BETWEEN $1 AND $2'];
    const values: unknown[] = [startDate, endDate];
    if (employeeId) { conditions.push('s.employee_id = $3'); values.push(employeeId); }

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
    breakMinutes?: number; notes?: string;
  }) {
    const result = await db.query(
      `INSERT INTO schedules (employee_id, date, start_time, end_time, break_minutes, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [data.employeeId, data.date, data.startTime, data.endTime, data.breakMinutes || 0, data.notes || null]
    );
    return result.rows[0];
  },

  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      date: 'date', startTime: 'start_time', endTime: 'end_time',
      breakMinutes: 'break_minutes', notes: 'notes',
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
};

export const attendanceRepository = {
  async findByDateRange(startDate: string, endDate: string, employeeId?: string) {
    const conditions = ['a.date BETWEEN $1 AND $2'];
    const values: unknown[] = [startDate, endDate];
    if (employeeId) { conditions.push('a.employee_id = $3'); values.push(employeeId); }
    const result = await db.query(
      `SELECT a.*, e.first_name, e.last_name, e.role as employee_role
       FROM attendance a JOIN employees e ON e.id = a.employee_id
       WHERE ${conditions.join(' AND ')} ORDER BY a.date DESC, e.last_name`,
      values
    );
    return result.rows;
  },

  async upsert(data: {
    employeeId: string; date: string; checkIn?: string; checkOut?: string;
    status: string; overtimeMinutes?: number; notes?: string;
  }) {
    const result = await db.query(
      `INSERT INTO attendance (employee_id, date, check_in, check_out, status, overtime_minutes, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (employee_id, date) DO UPDATE SET
         check_in = COALESCE(EXCLUDED.check_in, attendance.check_in),
         check_out = COALESCE(EXCLUDED.check_out, attendance.check_out),
         status = EXCLUDED.status,
         overtime_minutes = EXCLUDED.overtime_minutes,
         notes = EXCLUDED.notes
       RETURNING *`,
      [data.employeeId, data.date, data.checkIn || null, data.checkOut || null,
       data.status, data.overtimeMinutes || 0, data.notes || null]
    );
    return result.rows[0];
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
        COUNT(*) FILTER (WHERE status = 'absent') as absent_days,
        COUNT(*) FILTER (WHERE status = 'late') as late_days,
        COUNT(*) FILTER (WHERE status = 'half_day') as half_days,
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
  async findAll(params: { employeeId?: string; status?: string; year?: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (params.employeeId) { conditions.push(`l.employee_id = $${i++}`); values.push(params.employeeId); }
    if (params.status) { conditions.push(`l.status = $${i++}`); values.push(params.status); }
    if (params.year) { conditions.push(`EXTRACT(YEAR FROM l.start_date) = $${i++}`); values.push(params.year); }
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
  async findAll(params: { month?: number; year?: number; employeeId?: string }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (params.month) { conditions.push(`p.month = $${i++}`); values.push(params.month); }
    if (params.year) { conditions.push(`p.year = $${i++}`); values.push(params.year); }
    if (params.employeeId) { conditions.push(`p.employee_id = $${i++}`); values.push(params.employeeId); }
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

    const employees = await db.query(
      `SELECT * FROM employees WHERE is_active = true AND monthly_salary IS NOT NULL`
    );
    const results = [];

    for (const emp of employees.rows) {
      // ─── Pointage du mois ───
      const att = await db.query(
        `SELECT
          COUNT(*) FILTER (WHERE status IN ('present', 'late')) as present_days,
          COUNT(*) FILTER (WHERE status = 'absent') as absent_days,
          COUNT(*) FILTER (WHERE status = 'half_day') as half_days,
          COALESCE(SUM(overtime_minutes), 0) as total_overtime
         FROM attendance
         WHERE employee_id = $1 AND EXTRACT(MONTH FROM date) = $2 AND EXTRACT(YEAR FROM date) = $3`,
        [emp.id, month, year]
      );
      const a = att.rows[0];
      const baseSalary = parseFloat(emp.monthly_salary);
      const workedDays = parseInt(a.present_days) + Math.floor(parseInt(a.half_days) / 2);
      const absentDays = parseInt(a.absent_days);
      const overtimeHours = parseFloat(a.total_overtime) / 60;
      const dailyRate = baseSalary / 26;
      const seniorityYears = parseInt(emp.seniority_years) || 0;
      const nbDependents = Math.min(parseInt(emp.nb_dependents) || 0, 6);
      const cimrRate = parseFloat(emp.cimr_rate) || 0;

      // ═══ ETAPE 1 : Salaire brut ═══
      const seniorityBonus = r2(baseSalary * calcSeniorityRate(seniorityYears));
      const overtimeAmount = r2(overtimeHours * (dailyRate / 8) * 1.25);
      const absenceDeduction = r2(absentDays * dailyRate);
      const grossSalary = r2(baseSalary + seniorityBonus + overtimeAmount - absenceDeduction);

      // ═══ ETAPE 2 : CNSS salariale (plafonnee a 6 000 DH) ═══
      const cnssBase = Math.min(grossSalary, CNSS_PLAFOND);
      const cnssEmployee = r2(cnssBase * CNSS_RATE_EMP);

      // ═══ ETAPE 3 : AMO salariale (sans plafond) ═══
      const amoEmployee = r2(grossSalary * AMO_RATE_EMP);

      // ═══ ETAPE 3b : CIMR salariale (si applicable) ═══
      const cimrEmployee = r2(grossSalary * cimrRate / 100);

      // ═══ ETAPE 4 : Salaire net imposable ═══
      // SNI = Brut - CNSS - AMO - CIMR
      const salaireNetImposable = r2(grossSalary - cnssEmployee - amoEmployee - cimrEmployee);

      // ═══ ETAPE 5 : Frais professionnels ═══
      // 20% du SNI, plafonne a 2 500 DH/mois
      const fraisPro = r2(Math.min(salaireNetImposable * FRAIS_PRO_RATE, FRAIS_PRO_PLAFOND));

      // ═══ ETAPE 6 : Base imposable IR ═══
      const baseIR = r2(salaireNetImposable - fraisPro);

      // ═══ ETAPE 7 : IR (bareme annuel / 12) ═══
      const irBrut = r2(calcIRAnnuel(baseIR));

      // ═══ ETAPE 8 : Deduction charges familiales ═══
      const familyDeduction = r2(nbDependents * DEDUCTION_FAMILLE);

      // ═══ ETAPE 9 : IR net ═══
      const irNet = r2(Math.max(irBrut - familyDeduction, 0));

      // ═══ ETAPE 10 : Salaire net a payer ═══
      // Net = SNI - IR net = Brut - CNSS - AMO - CIMR - IR net
      const netSalary = r2(salaireNetImposable - irNet);

      // ═══ Charges patronales ═══
      const cnssEmployer = r2(cnssBase * CNSS_RATE_PAT);
      const amoEmployer = r2(grossSalary * AMO_RATE_PAT);
      const cimrEmployer = r2(grossSalary * cimrRate / 100); // meme taux que salarie par defaut
      const allocFamiliales = r2(grossSalary * ALLOC_FAM_RATE);
      const taxeFP = r2(grossSalary * TAXE_FP_RATE);
      const totalChargesPatron = r2(cnssEmployer + amoEmployer + cimrEmployer + allocFamiliales + taxeFP);

      const result = await db.query(
        `INSERT INTO payroll (
          employee_id, month, year, base_salary, worked_days, absent_days,
          overtime_hours, overtime_amount, seniority_bonus, gross_salary, deductions,
          cnss_employee, cnss_employer, amo_employee, amo_employer,
          cimr_employee, cimr_employer,
          frais_pro, ir_gross, ir_net, family_deduction, nb_dependents,
          alloc_familiales, taxe_fp, total_charges_patron, net_salary
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
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
           net_salary = EXCLUDED.net_salary
         RETURNING *`,
        [emp.id, month, year, baseSalary, workedDays, absentDays,
         overtimeHours, overtimeAmount, seniorityBonus, grossSalary, absenceDeduction,
         cnssEmployee, cnssEmployer, amoEmployee, amoEmployer,
         cimrEmployee, cimrEmployer,
         fraisPro, irBrut, irNet, familyDeduction, nbDependents,
         allocFamiliales, taxeFP, totalChargesPatron, netSalary]
      );
      results.push(result.rows[0]);
    }
    return results;
  },

  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      bonuses: 'bonuses', deductions: 'deductions', notes: 'notes',
      paid: 'paid', paidAt: 'paid_at', paymentMethod: 'payment_method',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return null;
    // Recalculate net salary if bonuses or deductions changed
    if (data.bonuses !== undefined || data.deductions !== undefined) {
      fields.push(`net_salary = base_salary + overtime_amount + COALESCE($${i}::numeric, bonuses) - COALESCE($${i + 1}::numeric, deductions) - cnss_employee`);
      values.push(data.bonuses ?? null, data.deductions ?? null);
      i += 2;
    }
    values.push(id);
    const result = await db.query(`UPDATE payroll SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },

  async markPaid(id: string, paymentMethod: string, createdBy?: string, storeId?: string) {
    const result = await db.query(
      `UPDATE payroll SET paid = true, paid_at = NOW(), payment_method = $1 WHERE id = $2 RETURNING *`,
      [paymentMethod, id]
    );
    const payroll = result.rows[0];
    if (!payroll) return null;

    // Get employee info for the accounting entry description
    const emp = await db.query('SELECT first_name, last_name FROM employees WHERE id = $1', [payroll.employee_id]);
    const employee = emp.rows[0];
    const empName = employee ? `${employee.first_name} ${employee.last_name}` : '';

    // Find "Salaires" expense category
    const catResult = await db.query(`SELECT id FROM expense_categories WHERE name = 'Salaires' AND type = 'expense' LIMIT 1`);
    const categoryId = catResult.rows[0]?.id || null;

    // Create accounting entry (écriture comptable)
    await paymentRepository.create({
      reference: `SAL-${payroll.month}/${payroll.year}-${empName.replace(/\s+/g, '')}`,
      type: 'salary',
      categoryId,
      employeeId: payroll.employee_id,
      amount: parseFloat(payroll.net_salary),
      paymentMethod: paymentMethod,
      paymentDate: getLocalISODate(),
      description: `Salaire ${payroll.month}/${payroll.year} - ${empName}`,
      createdBy: createdBy || payroll.employee_id,
      storeId,
    });

    return payroll;
  },
};
