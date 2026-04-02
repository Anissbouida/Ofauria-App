import { db } from '../config/database.js';

export const employeeRepository = {
  async findAll() {
    const result = await db.query('SELECT * FROM employees ORDER BY last_name, first_name');
    return result.rows;
  },

  async findById(id: string) {
    const result = await db.query('SELECT * FROM employees WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data: {
    userId?: string; firstName: string; lastName: string; role: string;
    phone?: string; hourlyRate?: number; hireDate: string;
  }) {
    const result = await db.query(
      `INSERT INTO employees (user_id, first_name, last_name, role, phone, hourly_rate, hire_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [data.userId || null, data.firstName, data.lastName, data.role,
       data.phone || null, data.hourlyRate || null, data.hireDate]
    );
    return result.rows[0];
  },

  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      firstName: 'first_name', lastName: 'last_name', role: 'role',
      phone: 'phone', hourlyRate: 'hourly_rate', isActive: 'is_active',
    };
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
