import crypto from 'crypto';
import { authPool } from './authDatabase.js';

export class RepositoryPasswordResetTokenModel {
  static async create(repositoryUserId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const result = await authPool.query(
      `INSERT INTO RepositoryPasswordResetTokens (repository_user_id, token, expires_at)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [repositoryUserId, token, expiresAt]
    );

    return result.rows[0] || null;
  }

  static async findByToken(token) {
    const result = await authPool.query(
      `SELECT rprt.*, ru.email, ru.name
       FROM RepositoryPasswordResetTokens rprt
       JOIN RepositoryUsers ru ON ru.id = rprt.repository_user_id
       WHERE rprt.token = $1 AND rprt.used = false AND rprt.expires_at > NOW()`,
      [token]
    );
    return result.rows[0] || null;
  }

  static async markAsUsed(token) {
    const result = await authPool.query(
      'UPDATE RepositoryPasswordResetTokens SET used = true WHERE token = $1',
      [token]
    );
    return result.rowCount > 0;
  }

  static async hasActiveToken(repositoryUserId) {
    const result = await authPool.query(
      `SELECT COUNT(*) AS count
       FROM RepositoryPasswordResetTokens
       WHERE repository_user_id = $1 AND used = false AND expires_at > NOW()`,
      [repositoryUserId]
    );
    return Number(result.rows[0]?.count || 0) > 0;
  }
}

export default RepositoryPasswordResetTokenModel;
