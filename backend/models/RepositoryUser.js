import { authPool } from './authDatabase.js';

export class RepositoryUserModel {
  static async create(userData) {
    const {
      name,
      full_name,
      email,
      organization,
      position,
      password,
      role = 'user',
      status = 'active',
    } = userData;

    const result = await authPool.query(
      `INSERT INTO RepositoryUsers (name, full_name, email, organization, position, password, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, full_name, email, organization, position, role, status, created_at, approved_at, approved_by`,
      [name, full_name || null, email, organization || null, position || null, password, role, status]
    );
    return result.rows[0] || null;
  }

  static async findById(id) {
    const result = await authPool.query(
      `SELECT ru.*, approver.name AS approver_name, approver.full_name AS approver_full_name
       FROM RepositoryUsers ru
       LEFT JOIN RepositoryUsers approver ON ru.approved_by = approver.id
       WHERE ru.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async findByEmail(email) {
    const result = await authPool.query(
      'SELECT * FROM RepositoryUsers WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    return result.rows[0] || null;
  }

  static async findByName(name) {
    const result = await authPool.query(
      'SELECT * FROM RepositoryUsers WHERE LOWER(name) = LOWER($1)',
      [name]
    );
    return result.rows[0] || null;
  }

  static async findByLogin(login) {
    const result = await authPool.query(
      'SELECT * FROM RepositoryUsers WHERE LOWER(email) = LOWER($1) OR LOWER(name) = LOWER($1)',
      [login]
    );
    return result.rows[0] || null;
  }

  static async findAll() {
    const result = await authPool.query(
      `SELECT ru.*, approver.name AS approver_name, approver.full_name AS approver_full_name
       FROM RepositoryUsers ru
       LEFT JOIN RepositoryUsers approver ON ru.approved_by = approver.id
       ORDER BY ru.created_at DESC`
    );
    return result.rows;
  }

  static async getPendingUsers() {
    const result = await authPool.query(
      `SELECT *
       FROM RepositoryUsers
       WHERE status = 'pending'
       ORDER BY created_at DESC`
    );
    return result.rows;
  }

  static async findActiveAdmins() {
    const result = await authPool.query(
      `SELECT *
       FROM RepositoryUsers
       WHERE role = 'admin' AND status = 'active' AND email IS NOT NULL AND email <> ''
       ORDER BY created_at ASC`
    );
    return result.rows;
  }

  static async update(id, updates) {
    const { role, status, approved_by } = updates;
    let query = 'UPDATE RepositoryUsers SET updated_at = CURRENT_TIMESTAMP';
    const values = [];
    let index = 1;

    if (role !== undefined) {
      query += `, role = $${index}`;
      values.push(role);
      index += 1;
    }

    if (status !== undefined) {
      query += `, status = $${index}`;
      values.push(status);
      index += 1;
    }

    if (approved_by !== undefined) {
      query += `, approved_by = $${index}, approved_at = CURRENT_TIMESTAMP`;
      values.push(approved_by);
      index += 1;
    }

    query += ` WHERE id = $${index} RETURNING id, name, full_name, email, organization, position, role, status, created_at, approved_at, approved_by`;
    values.push(id);

    const result = await authPool.query(query, values);
    return result.rows[0] || null;
  }

  static async delete(id) {
    const result = await authPool.query('DELETE FROM RepositoryUsers WHERE id = $1', [id]);
    return result.rowCount > 0;
  }
}

export default RepositoryUserModel;
