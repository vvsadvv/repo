import { authPool } from './authDatabase.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function mapOrganization(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name_ru: row.name_ru,
    name_en: row.name_en,
    status: row.status,
    requested_by_user_id: row.requested_by_user_id,
    requester_name: row.requester_name,
    requester_email: row.requester_email,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function groupAuthorRows(rows) {
  const authors = new Map();

  rows.forEach((row) => {
    if (!authors.has(row.id)) {
      authors.set(row.id, {
        id: row.id,
        name_ru: row.name_ru,
        name_en: row.name_en,
        status: row.status,
        requested_by_user_id: row.requested_by_user_id,
        requester_name: row.requester_name,
        requester_email: row.requester_email,
        approved_by: row.approved_by,
        approved_at: row.approved_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        organizations: [],
      });
    }

    if (row.organization_id) {
      authors.get(row.id).organizations.push({
        id: row.organization_id,
        name_ru: row.organization_name_ru,
        name_en: row.organization_name_en,
        link_status: row.link_status,
      });
    }
  });

  return [...authors.values()];
}

export class RepositoryReferenceModel {
  static async listApprovedOrganizations() {
    const { rows } = await authPool.query(
      `
        SELECT id, name_ru, name_en, status, requested_by_user_id, requester_name, requester_email,
               approved_by, approved_at, created_at, updated_at
        FROM RepositoryOrganizations
        WHERE status = 'approved'
        ORDER BY LOWER(name_ru) ASC
      `
    );

    return rows.map(mapOrganization);
  }

  static async listPendingOrganizations() {
    const { rows } = await authPool.query(
      `
        SELECT id, name_ru, name_en, status, requested_by_user_id, requester_name, requester_email,
               approved_by, approved_at, created_at, updated_at
        FROM RepositoryOrganizations
        WHERE status = 'pending'
        ORDER BY created_at DESC
      `
    );

    return rows.map(mapOrganization);
  }

  static async findOrganizationById(id) {
    const { rows } = await authPool.query(
      `
        SELECT id, name_ru, name_en, status, requested_by_user_id, requester_name, requester_email,
               approved_by, approved_at, created_at, updated_at
        FROM RepositoryOrganizations
        WHERE id = $1
      `,
      [id]
    );

    return mapOrganization(rows[0] || null);
  }

  static async findApprovedOrganizationByName(name) {
    const normalized = normalizeText(name);
    if (!normalized) {
      return null;
    }

    const { rows } = await authPool.query(
      `
        SELECT id, name_ru, name_en, status, requested_by_user_id, requester_name, requester_email,
               approved_by, approved_at, created_at, updated_at
        FROM RepositoryOrganizations
        WHERE status = 'approved'
          AND (LOWER(name_ru) = LOWER($1) OR LOWER(COALESCE(name_en, '')) = LOWER($1))
        LIMIT 1
      `,
      [normalized]
    );

    return mapOrganization(rows[0] || null);
  }

  static async createOrganizationRequest(payload) {
    const nameRu = normalizeText(payload?.name_ru);
    const nameEn = normalizeText(payload?.name_en);
    const requesterName = normalizeText(payload?.requester_name);
    const requesterEmail = normalizeEmail(payload?.requester_email);
    const requestedByUserId = payload?.requested_by_user_id || null;

    const existing = await authPool.query(
      `
        SELECT id
        FROM RepositoryOrganizations
        WHERE LOWER(name_ru) = LOWER($1)
        LIMIT 1
      `,
      [nameRu]
    );

    const { rows } = existing.rows[0]
      ? await authPool.query(
          `
            UPDATE RepositoryOrganizations
            SET name_en = COALESCE(NULLIF($2, ''), name_en),
                requested_by_user_id = COALESCE($3, requested_by_user_id),
                requester_name = COALESCE(NULLIF($4, ''), requester_name),
                requester_email = COALESCE(NULLIF($5, ''), requester_email),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING id, name_ru, name_en, status, requested_by_user_id, requester_name, requester_email,
                      approved_by, approved_at, created_at, updated_at
          `,
          [existing.rows[0].id, nameEn, requestedByUserId, requesterName, requesterEmail]
        )
      : await authPool.query(
          `
            INSERT INTO RepositoryOrganizations (
              name_ru, name_en, status, requested_by_user_id, requester_name, requester_email, created_at, updated_at
            )
            VALUES ($1, NULLIF($2, ''), 'pending', $3, NULLIF($4, ''), NULLIF($5, ''), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING id, name_ru, name_en, status, requested_by_user_id, requester_name, requester_email,
                      approved_by, approved_at, created_at, updated_at
          `,
          [nameRu, nameEn, requestedByUserId, requesterName, requesterEmail]
        );

    return mapOrganization(rows[0] || null);
  }

  static async approveOrganization(id, approverId) {
    const { rows } = await authPool.query(
      `
        UPDATE RepositoryOrganizations
        SET status = 'approved',
            approved_by = $2,
            approved_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, name_ru, name_en, status, requested_by_user_id, requester_name, requester_email,
                  approved_by, approved_at, created_at, updated_at
      `,
      [id, approverId]
    );

    return mapOrganization(rows[0] || null);
  }

  static async rejectOrganization(id, approverId) {
    const { rows } = await authPool.query(
      `
        UPDATE RepositoryOrganizations
        SET status = 'rejected',
            approved_by = $2,
            approved_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, name_ru, name_en, status, requested_by_user_id, requester_name, requester_email,
                  approved_by, approved_at, created_at, updated_at
      `,
      [id, approverId]
    );

    return mapOrganization(rows[0] || null);
  }

  static async listApprovedAuthors() {
    const { rows } = await authPool.query(
      `
        SELECT a.id, a.name_ru, a.name_en, a.status, a.requested_by_user_id, a.requester_name,
               a.requester_email, a.approved_by, a.approved_at, a.created_at, a.updated_at,
               o.id AS organization_id, o.name_ru AS organization_name_ru, o.name_en AS organization_name_en,
               ao.status AS link_status
        FROM RepositoryAuthors a
        LEFT JOIN RepositoryAuthorOrganizations ao
          ON ao.author_id = a.id AND ao.status = 'approved'
        LEFT JOIN RepositoryOrganizations o
          ON o.id = ao.organization_id AND o.status = 'approved'
        WHERE a.status = 'approved'
        ORDER BY LOWER(a.name_ru) ASC, o.name_ru ASC NULLS LAST
      `
    );

    return groupAuthorRows(rows);
  }

  static async listPendingAuthors() {
    const { rows } = await authPool.query(
      `
        SELECT a.id, a.name_ru, a.name_en, a.status, a.requested_by_user_id, a.requester_name,
               a.requester_email, a.approved_by, a.approved_at, a.created_at, a.updated_at,
               o.id AS organization_id, o.name_ru AS organization_name_ru, o.name_en AS organization_name_en,
               ao.status AS link_status
        FROM RepositoryAuthors a
        LEFT JOIN RepositoryAuthorOrganizations ao
          ON ao.author_id = a.id AND ao.status = 'pending'
        LEFT JOIN RepositoryOrganizations o
          ON o.id = ao.organization_id
        WHERE a.status = 'pending'
        ORDER BY a.created_at DESC, o.name_ru ASC NULLS LAST
      `
    );

    return groupAuthorRows(rows);
  }

  static async findAuthorByNames(nameRu, nameEn) {
    const normalizedRu = normalizeText(nameRu);
    const normalizedEn = normalizeText(nameEn);
    const { rows } = await authPool.query(
      `
        SELECT id, name_ru, name_en, status, requested_by_user_id, requester_name,
               requester_email, approved_by, approved_at, created_at, updated_at
        FROM RepositoryAuthors
        WHERE LOWER(name_ru) = LOWER($1) AND LOWER(name_en) = LOWER($2)
        LIMIT 1
      `,
      [normalizedRu, normalizedEn]
    );

    return rows[0] || null;
  }

  static async createAuthorRequest(payload) {
    const nameRu = normalizeText(payload?.name_ru);
    const nameEn = normalizeText(payload?.name_en);
    const requesterName = normalizeText(payload?.requester_name);
    const requesterEmail = normalizeEmail(payload?.requester_email);
    const requestedByUserId = payload?.requested_by_user_id || null;
    const organizationId = payload?.organization_id || null;
    let authorId = null;

    const client = await authPool.connect();
    try {
      await client.query('BEGIN');

      const existingAuthor = await client.query(
        `
          SELECT id
          FROM RepositoryAuthors
          WHERE LOWER(name_ru) = LOWER($1) AND LOWER(name_en) = LOWER($2)
          LIMIT 1
        `,
        [nameRu, nameEn]
      );

      const authorResult = existingAuthor.rows[0]
        ? await client.query(
            `
              UPDATE RepositoryAuthors
              SET requested_by_user_id = COALESCE($2, requested_by_user_id),
                  requester_name = COALESCE(NULLIF($3, ''), requester_name),
                  requester_email = COALESCE(NULLIF($4, ''), requester_email),
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
              RETURNING id, name_ru, name_en, status, requested_by_user_id, requester_name,
                        requester_email, approved_by, approved_at, created_at, updated_at
            `,
            [existingAuthor.rows[0].id, requestedByUserId, requesterName, requesterEmail]
          )
        : await client.query(
            `
              INSERT INTO RepositoryAuthors (
                name_ru, name_en, status, requested_by_user_id, requester_name, requester_email, created_at, updated_at
              )
              VALUES ($1, $2, 'pending', $3, NULLIF($4, ''), NULLIF($5, ''), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              RETURNING id, name_ru, name_en, status, requested_by_user_id, requester_name,
                        requester_email, approved_by, approved_at, created_at, updated_at
            `,
            [nameRu, nameEn, requestedByUserId, requesterName, requesterEmail]
          );

      const author = authorResult.rows[0];

      if (organizationId) {
        await client.query(
          `
            INSERT INTO RepositoryAuthorOrganizations (
              author_id, organization_id, status, requested_by_user_id, created_at, updated_at
            )
            VALUES ($1, $2, 'pending', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (author_id, organization_id)
            DO UPDATE SET
              requested_by_user_id = COALESCE(EXCLUDED.requested_by_user_id, RepositoryAuthorOrganizations.requested_by_user_id),
              updated_at = CURRENT_TIMESTAMP
          `,
          [author.id, organizationId, requestedByUserId]
        );
      }

      await client.query('COMMIT');
      authorId = author?.id || null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const pendingAuthors = await this.listPendingAuthors();
    const pendingAuthor = pendingAuthors.find((author) => author.id === Number(authorId));
    if (pendingAuthor) {
      return pendingAuthor;
    }

    const approvedAuthors = await this.listApprovedAuthors();
    return approvedAuthors.find((author) => author.id === Number(authorId)) || null;
  }

  static async approveAuthor(id, approverId) {
    const client = await authPool.connect();
    try {
      await client.query('BEGIN');

      const authorResult = await client.query(
        `
          UPDATE RepositoryAuthors
          SET status = 'approved',
              approved_by = $2,
              approved_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING id
        `,
        [id, approverId]
      );

      if (!authorResult.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `
          UPDATE RepositoryAuthorOrganizations
          SET status = 'approved',
              approved_by = $2,
              approved_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE author_id = $1 AND status = 'pending'
        `,
        [id, approverId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const authors = await this.listApprovedAuthors();
    return authors.find((author) => author.id === Number(id)) || null;
  }

  static async rejectAuthor(id, approverId) {
    const client = await authPool.connect();
    try {
      await client.query('BEGIN');

      const authorResult = await client.query(
        `
          UPDATE RepositoryAuthors
          SET status = 'rejected',
              approved_by = $2,
              approved_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING id
        `,
        [id, approverId]
      );

      if (!authorResult.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `
          UPDATE RepositoryAuthorOrganizations
          SET status = 'rejected',
              approved_by = $2,
              approved_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE author_id = $1 AND status = 'pending'
        `,
        [id, approverId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const authors = await this.listPendingAuthors();
    return authors.find((author) => author.id === Number(id)) || null;
  }
}

export default RepositoryReferenceModel;
