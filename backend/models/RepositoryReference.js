import { authPool } from './authDatabase.js';

/* Делает: Нормализует текст. Применение: используется локально в файле backend/models/RepositoryReference.js. */
function normalizeText(value) {
  return String(value || '').trim();
}

/* Делает: Нормализует email. Применение: используется локально в файле backend/models/RepositoryReference.js. */
function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

/* Делает: Преобразует организацию. Применение: используется локально в файле backend/models/RepositoryReference.js. */
function mapOrganization(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name_ru: row.name_ru,
    name_en: row.name_en,
    full_name_ru: row.full_name_ru,
    full_name_en: row.full_name_en,
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

/* Делает: Группирует строки автора. Применение: используется локально в файле backend/models/RepositoryReference.js. */
function groupAuthorRows(rows) {
  const authors = new Map();

  rows.forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри groupAuthorRows. */ (row) => {
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
        full_name_ru: row.organization_full_name_ru,
        full_name_en: row.organization_full_name_en,
        link_status: row.link_status,
      });
    }
  });

  return [...authors.values()];
}

export class RepositoryReferenceModel {
    /* Делает: Возвращает список организации одобренного. Применение: используется внутри класса RepositoryReferenceModel. */
  static async listApprovedOrganizations() {
    const { rows } = await authPool.query(
      `
        SELECT id, name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email,
               approved_by, approved_at, created_at, updated_at
        FROM RepositoryOrganizations
        WHERE status = 'approved'
        ORDER BY LOWER(name_ru) ASC
      `
    );

    return rows.map(mapOrganization);
  }

    /* Делает: Возвращает список организации всех. Применение: используется внутри класса RepositoryReferenceModel. */
  static async listAllOrganizations() {
    const { rows } = await authPool.query(
      `
        SELECT id, name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email,
               approved_by, approved_at, created_at, updated_at
        FROM RepositoryOrganizations
        ORDER BY
          CASE status
            WHEN 'pending' THEN 0
            WHEN 'approved' THEN 1
            ELSE 2
          END,
          LOWER(name_ru) ASC
      `
    );

    return rows.map(mapOrganization);
  }

    /* Делает: Возвращает список организации ожидающего. Применение: используется внутри класса RepositoryReferenceModel. */
  static async listPendingOrganizations() {
    const { rows } = await authPool.query(
      `
        SELECT id, name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email,
               approved_by, approved_at, created_at, updated_at
        FROM RepositoryOrganizations
        WHERE status = 'pending'
        ORDER BY created_at DESC
      `
    );

    return rows.map(mapOrganization);
  }

    /* Делает: Находит идентификатор организации by. Применение: используется внутри класса RepositoryReferenceModel. */
  static async findOrganizationById(id) {
    const { rows } = await authPool.query(
      `
        SELECT id, name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email,
               approved_by, approved_at, created_at, updated_at
        FROM RepositoryOrganizations
        WHERE id = $1
      `,
      [id]
    );

    return mapOrganization(rows[0] || null);
  }

    /* Делает: Находит имя одобренного организации by. Применение: используется внутри класса RepositoryReferenceModel. */
  static async findApprovedOrganizationByName(name) {
    const normalized = normalizeText(name);
    if (!normalized) {
      return null;
    }

    const { rows } = await authPool.query(
      `
        SELECT id, name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email,
               approved_by, approved_at, created_at, updated_at
        FROM RepositoryOrganizations
        WHERE status = 'approved'
          AND (
            LOWER(name_ru) = LOWER($1)
            OR LOWER(COALESCE(name_en, '')) = LOWER($1)
            OR LOWER(COALESCE(full_name_ru, '')) = LOWER($1)
            OR LOWER(COALESCE(full_name_en, '')) = LOWER($1)
          )
        LIMIT 1
      `,
      [normalized]
    );

    return mapOrganization(rows[0] || null);
  }

    /* Делает: Находит имя организации by. Применение: используется внутри класса RepositoryReferenceModel. */
  static async findOrganizationByName(name) {
    const normalized = normalizeText(name);
    if (!normalized) {
      return null;
    }

    const { rows } = await authPool.query(
      `
        SELECT id, name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email,
               approved_by, approved_at, created_at, updated_at
        FROM RepositoryOrganizations
        WHERE LOWER(name_ru) = LOWER($1)
           OR LOWER(COALESCE(name_en, '')) = LOWER($1)
           OR LOWER(COALESCE(full_name_ru, '')) = LOWER($1)
           OR LOWER(COALESCE(full_name_en, '')) = LOWER($1)
        ORDER BY
          CASE status
            WHEN 'approved' THEN 0
            WHEN 'pending' THEN 1
            ELSE 2
          END,
          id ASC
        LIMIT 1
      `,
      [normalized]
    );

    return mapOrganization(rows[0] || null);
  }

    /* Делает: Создаёт запрос организации. Применение: используется внутри класса RepositoryReferenceModel. */
  static async createOrganizationRequest(payload) {
    const nameRu = normalizeText(payload?.name_ru);
    const nameEn = normalizeText(payload?.name_en);
    const fullNameRu = payload?.full_name_ru === undefined ? null : normalizeText(payload.full_name_ru);
    const fullNameEn = payload?.full_name_en === undefined ? null : normalizeText(payload.full_name_en);
    const requesterName = normalizeText(payload?.requester_name);
    const requesterEmail = normalizeEmail(payload?.requester_email);
    const requestedByUserId = payload?.requested_by_user_id || null;

    const existing = await authPool.query(
      `
        SELECT id, name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email,
               approved_by, approved_at, created_at, updated_at
        FROM RepositoryOrganizations
        WHERE LOWER(name_ru) = LOWER($1)
        LIMIT 1
      `,
      [nameRu]
    );

    const existingOrganization = mapOrganization(existing.rows[0] || null);
    if (existingOrganization?.status === 'approved') {
      return existingOrganization;
    }

    const { rows } = existing.rows[0]
      ? await authPool.query(
          `
            UPDATE RepositoryOrganizations
            SET name_en = COALESCE(NULLIF(name_en, ''), NULLIF($2, '')),
                full_name_ru = COALESCE(NULLIF(full_name_ru, ''), NULLIF($3, '')),
                full_name_en = COALESCE(NULLIF(full_name_en, ''), NULLIF($4, '')),
                status = CASE WHEN status = 'rejected' THEN 'pending' ELSE status END,
                requested_by_user_id = COALESCE($5, requested_by_user_id),
                requester_name = COALESCE(NULLIF(requester_name, ''), NULLIF($6, '')),
                requester_email = COALESCE(NULLIF(requester_email, ''), NULLIF($7, '')),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING id, name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email,
                      approved_by, approved_at, created_at, updated_at
          `,
          [existing.rows[0].id, nameEn, fullNameRu, fullNameEn, requestedByUserId, requesterName, requesterEmail]
        )
      : await authPool.query(
          `
            INSERT INTO RepositoryOrganizations (
              name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email, created_at, updated_at
            )
            VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''), 'pending', $5, NULLIF($6, ''), NULLIF($7, ''), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING id, name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email,
                      approved_by, approved_at, created_at, updated_at
          `,
          [nameRu, nameEn, fullNameRu, fullNameEn, requestedByUserId, requesterName, requesterEmail]
        );

    return mapOrganization(rows[0] || null);
  }

    /* Делает: Одобряет организацию. Применение: используется внутри класса RepositoryReferenceModel. */
  static async approveOrganization(id, approverId) {
    const { rows } = await authPool.query(
      `
        UPDATE RepositoryOrganizations
        SET status = 'approved',
            approved_by = $2,
            approved_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email,
                  approved_by, approved_at, created_at, updated_at
      `,
      [id, approverId]
    );

    return mapOrganization(rows[0] || null);
  }

    /* Делает: Отклоняет организацию. Применение: используется внутри класса RepositoryReferenceModel. */
  static async rejectOrganization(id, approverId) {
    const { rows } = await authPool.query(
      `
        UPDATE RepositoryOrganizations
        SET status = 'rejected',
            approved_by = $2,
            approved_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email,
                  approved_by, approved_at, created_at, updated_at
      `,
      [id, approverId]
    );

    return mapOrganization(rows[0] || null);
  }

    /* Делает: Создаёт организацию. Применение: используется внутри класса RepositoryReferenceModel. */
  static async createOrganization(payload, approverId) {
    const nameRu = normalizeText(payload?.name_ru);
    const nameEn = normalizeText(payload?.name_en);
    const fullNameRu = normalizeText(payload?.full_name_ru);
    const fullNameEn = normalizeText(payload?.full_name_en);
    const normalizedApproverId = Number(approverId) || null;
    const normalizedStatus = String(payload?.status || 'approved').trim().toLowerCase();
    const status = ['pending', 'approved', 'rejected'].includes(normalizedStatus) ? normalizedStatus : 'approved';

    const { rows } = await authPool.query(
      `
        INSERT INTO RepositoryOrganizations (
          name_ru,
          name_en,
          full_name_ru,
          full_name_en,
          status,
          approved_by,
          approved_at,
          created_at,
          updated_at
        )
        VALUES (
          $1::varchar,
          NULLIF($2::varchar, ''),
          NULLIF($3::text, ''),
          NULLIF($4::text, ''),
          $5::varchar,
          CASE WHEN $5::varchar IN ('approved', 'rejected') THEN $6::integer ELSE NULL::integer END,
          CASE WHEN $5::varchar IN ('approved', 'rejected') THEN CURRENT_TIMESTAMP ELSE NULL::timestamp END,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING id, name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email,
                  approved_by, approved_at, created_at, updated_at
      `,
      [nameRu, nameEn, fullNameRu, fullNameEn, status, normalizedApproverId]
    );

    return mapOrganization(rows[0] || null);
  }

    /* Делает: Обновляет организацию. Применение: используется внутри класса RepositoryReferenceModel. */
  static async updateOrganization(id, payload, approverId) {
    const nameRu = normalizeText(payload?.name_ru);
    const nameEn = payload?.name_en === undefined ? null : normalizeText(payload.name_en);
    const fullNameRu = payload?.full_name_ru === undefined ? null : normalizeText(payload.full_name_ru);
    const fullNameEn = payload?.full_name_en === undefined ? null : normalizeText(payload.full_name_en);
    const normalizedStatus = payload?.status === undefined ? null : String(payload.status).trim().toLowerCase();
    const status = normalizedStatus && ['pending', 'approved', 'rejected'].includes(normalizedStatus)
      ? normalizedStatus
      : null;

    const { rows } = await authPool.query(
      `
        UPDATE RepositoryOrganizations
        SET name_ru = COALESCE(NULLIF($2::varchar, ''), name_ru),
            name_en = CASE WHEN $3::varchar IS NULL THEN name_en ELSE NULLIF($3::varchar, '') END,
            full_name_ru = CASE WHEN $4::varchar IS NULL THEN full_name_ru ELSE NULLIF($4::varchar, '') END,
            full_name_en = CASE WHEN $5::varchar IS NULL THEN full_name_en ELSE NULLIF($5::varchar, '') END,
            status = COALESCE($6::varchar, status),
            approved_by = CASE
              WHEN COALESCE($6::varchar, status) IN ('approved', 'rejected') THEN $7
              ELSE approved_by
            END,
            approved_at = CASE
              WHEN COALESCE($6::varchar, status) IN ('approved', 'rejected') THEN CURRENT_TIMESTAMP
              ELSE approved_at
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email,
                  approved_by, approved_at, created_at, updated_at
      `,
      [id, nameRu || null, nameEn, fullNameRu, fullNameEn, status, approverId]
    );

    const organization = mapOrganization(rows[0] || null);
    if (organization) {
      await authPool.query(
        `UPDATE RepositoryUsers
         SET organization = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $1`,
        [organization.id, organization.name_ru]
      );
    }

    return organization;
  }

    /* Делает: Удаляет организацию. Применение: используется внутри класса RepositoryReferenceModel. */
  static async deleteOrganization(id) {
    const client = await authPool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `
          SELECT id, name_ru, name_en, full_name_ru, full_name_en, status, requested_by_user_id, requester_name, requester_email,
                 approved_by, approved_at, created_at, updated_at
          FROM RepositoryOrganizations
          WHERE id = $1
          FOR UPDATE
        `,
        [id]
      );
      const organization = mapOrganization(rows[0] || null);

      if (!organization) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `
          UPDATE RepositoryUsers
          SET organization_id = NULL,
              organization = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE organization_id = $1
        `,
        [id]
      );

      await client.query(`DELETE FROM RepositoryAuthorOrganizations WHERE organization_id = $1`, [id]);
      await client.query(`DELETE FROM RepositoryOrganizations WHERE id = $1`, [id]);
      await client.query('COMMIT');

      return organization;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

    /* Делает: Возвращает список авторов одобренного. Применение: используется внутри класса RepositoryReferenceModel. */
  static async listApprovedAuthors() {
    const { rows } = await authPool.query(
      `
        SELECT a.id, a.name_ru, a.name_en, a.status, a.requested_by_user_id, a.requester_name,
               a.requester_email, a.approved_by, a.approved_at, a.created_at, a.updated_at,
               o.id AS organization_id, o.name_ru AS organization_name_ru, o.name_en AS organization_name_en,
               o.full_name_ru AS organization_full_name_ru, o.full_name_en AS organization_full_name_en,
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

    /* Делает: Возвращает список авторов всех. Применение: используется внутри класса RepositoryReferenceModel. */
  static async listAllAuthors() {
    const { rows } = await authPool.query(
      `
        SELECT a.id, a.name_ru, a.name_en, a.status, a.requested_by_user_id, a.requester_name,
               a.requester_email, a.approved_by, a.approved_at, a.created_at, a.updated_at,
               o.id AS organization_id, o.name_ru AS organization_name_ru, o.name_en AS organization_name_en,
               o.full_name_ru AS organization_full_name_ru, o.full_name_en AS organization_full_name_en,
               ao.status AS link_status
        FROM RepositoryAuthors a
        LEFT JOIN RepositoryAuthorOrganizations ao
          ON ao.author_id = a.id
        LEFT JOIN RepositoryOrganizations o
          ON o.id = ao.organization_id
        ORDER BY
          CASE a.status
            WHEN 'pending' THEN 0
            WHEN 'approved' THEN 1
            ELSE 2
          END,
          LOWER(a.name_ru) ASC,
          o.name_ru ASC NULLS LAST
      `
    );

    return groupAuthorRows(rows);
  }

    /* Делает: Возвращает список авторов ожидающего. Применение: используется внутри класса RepositoryReferenceModel. */
  static async listPendingAuthors() {
    const { rows } = await authPool.query(
      `
        SELECT a.id, a.name_ru, a.name_en, a.status, a.requested_by_user_id, a.requester_name,
               a.requester_email, a.approved_by, a.approved_at, a.created_at, a.updated_at,
               o.id AS organization_id, o.name_ru AS organization_name_ru, o.name_en AS organization_name_en,
               o.full_name_ru AS organization_full_name_ru, o.full_name_en AS organization_full_name_en,
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

    /* Делает: Находит имена автора by. Применение: используется внутри класса RepositoryReferenceModel. */
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

    /* Делает: Получает идентификатор автора by. Применение: используется внутри класса RepositoryReferenceModel. */
  static async getAuthorById(id) {
    const { rows } = await authPool.query(
      `
        SELECT a.id, a.name_ru, a.name_en, a.status, a.requested_by_user_id, a.requester_name,
               a.requester_email, a.approved_by, a.approved_at, a.created_at, a.updated_at,
               o.id AS organization_id, o.name_ru AS organization_name_ru, o.name_en AS organization_name_en,
               o.full_name_ru AS organization_full_name_ru, o.full_name_en AS organization_full_name_en,
               ao.status AS link_status
        FROM RepositoryAuthors a
        LEFT JOIN RepositoryAuthorOrganizations ao
          ON ao.author_id = a.id
        LEFT JOIN RepositoryOrganizations o
          ON o.id = ao.organization_id
        WHERE a.id = $1
        ORDER BY o.name_ru ASC NULLS LAST
      `,
      [id]
    );

    return groupAuthorRows(rows)[0] || null;
  }

    /* Делает: Создаёт запрос автора. Применение: используется внутри класса RepositoryReferenceModel. */
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
    const pendingAuthor = pendingAuthors.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри createAuthorRequest. */ (author) => author.id === Number(authorId));
    if (pendingAuthor) {
      return pendingAuthor;
    }

    const approvedAuthors = await this.listApprovedAuthors();
    return approvedAuthors.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри createAuthorRequest. */ (author) => author.id === Number(authorId)) || null;
  }

    /* Делает: Создаёт автора. Применение: используется внутри класса RepositoryReferenceModel. */
  static async createAuthor(payload, approverId) {
    const nameRu = normalizeText(payload?.name_ru);
    const nameEn = normalizeText(payload?.name_en);
    const normalizedApproverId = Number(approverId) || null;
    const normalizedStatus = String(payload?.status || 'approved').trim().toLowerCase();
    const status = ['pending', 'approved', 'rejected'].includes(normalizedStatus) ? normalizedStatus : 'approved';
    const organizationIds = Array.isArray(payload?.organization_ids)
      ? payload.organization_ids
      : payload?.organization_id
        ? [payload.organization_id]
        : [];
    const normalizedOrganizationIds = [...new Set(
      organizationIds
        .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри createAuthor. */ (value) => Number(value))
        .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри createAuthor. */ (value) => Number.isInteger(value) && value > 0)
    )];

    let authorId = null;
    const client = await authPool.connect();
    try {
      await client.query('BEGIN');

      if (normalizedOrganizationIds.length > 0) {
        const organizationResult = await client.query(
          `
            SELECT id
            FROM RepositoryOrganizations
            WHERE id = ANY($1::integer[])
          `,
          [normalizedOrganizationIds]
        );

        if (organizationResult.rows.length !== normalizedOrganizationIds.length) {
          const error = new Error('Указанная организация не найдена в справочнике');
          error.code = 'REPOSITORY_ORGANIZATION_NOT_FOUND';
          throw error;
        }
      }

      const authorResult = await client.query(
        `
          INSERT INTO RepositoryAuthors (
            name_ru,
            name_en,
            status,
            approved_by,
            approved_at,
            created_at,
            updated_at
          )
          VALUES (
            $1::varchar,
            $2::varchar,
            $3::varchar,
            CASE WHEN $3::varchar IN ('approved', 'rejected') THEN $4::integer ELSE NULL::integer END,
            CASE WHEN $3::varchar IN ('approved', 'rejected') THEN CURRENT_TIMESTAMP ELSE NULL::timestamp END,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
          RETURNING id
        `,
        [nameRu, nameEn, status, normalizedApproverId]
      );

      authorId = authorResult.rows[0]?.id || null;

      for (const organizationId of normalizedOrganizationIds) {
        await client.query(
          `
            INSERT INTO RepositoryAuthorOrganizations (
              author_id,
              organization_id,
              status,
              approved_by,
              approved_at,
              created_at,
              updated_at
            )
            VALUES (
              $1::integer,
              $2::integer,
              CASE
                WHEN $3::varchar = 'pending' THEN 'pending'
                WHEN $3::varchar = 'rejected' THEN 'rejected'
                ELSE 'approved'
              END,
              CASE WHEN $3::varchar = 'pending' THEN NULL::integer ELSE $4::integer END,
              CASE WHEN $3::varchar = 'pending' THEN NULL::timestamp ELSE CURRENT_TIMESTAMP END,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            )
            ON CONFLICT (author_id, organization_id)
            DO UPDATE SET
              status = EXCLUDED.status,
              approved_by = EXCLUDED.approved_by,
              approved_at = EXCLUDED.approved_at,
              updated_at = CURRENT_TIMESTAMP
          `,
          [authorId, organizationId, status, normalizedApproverId]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return this.getAuthorById(authorId);
  }

    /* Делает: Обновляет автора. Применение: используется внутри класса RepositoryReferenceModel. */
  static async updateAuthor(id, payload, approverId) {
    const authorId = Number(id);
    const normalizedApproverId = Number(approverId) || null;
    const nameRu = normalizeText(payload?.name_ru);
    const nameEn = normalizeText(payload?.name_en);
    const normalizedStatus = payload?.status === undefined ? null : String(payload.status).trim().toLowerCase();
    const status = normalizedStatus && ['pending', 'approved', 'rejected'].includes(normalizedStatus)
      ? normalizedStatus
      : null;
    const organizationIds = Array.isArray(payload?.organization_ids)
      ? payload.organization_ids
      : payload?.organization_id
        ? [payload.organization_id]
        : [];
    const normalizedOrganizationIds = [...new Set(
      organizationIds
        .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри updateAuthor. */ (value) => Number(value))
        .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри updateAuthor. */ (value) => Number.isInteger(value) && value > 0)
    )];

    const client = await authPool.connect();
    try {
      await client.query('BEGIN');

      const authorResult = await client.query(
        `
          UPDATE RepositoryAuthors
          SET name_ru = COALESCE(NULLIF($2::varchar, ''), name_ru),
              name_en = COALESCE(NULLIF($3::varchar, ''), name_en),
              status = COALESCE($4::varchar, status),
              approved_by = CASE
                WHEN COALESCE($4::varchar, status) IN ('approved', 'rejected') THEN $5::integer
                ELSE approved_by
              END,
              approved_at = CASE
                WHEN COALESCE($4::varchar, status) IN ('approved', 'rejected') THEN CURRENT_TIMESTAMP
                ELSE approved_at
              END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::integer
          RETURNING id, status
        `,
        [authorId, nameRu || null, nameEn || null, status, normalizedApproverId]
      );

      if (!authorResult.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      if (normalizedOrganizationIds.length > 0) {
        const organizationResult = await client.query(
          `
            SELECT id
            FROM RepositoryOrganizations
            WHERE id = ANY($1::integer[])
          `,
          [normalizedOrganizationIds]
        );

        if (organizationResult.rows.length !== normalizedOrganizationIds.length) {
          const error = new Error('Указанная организация не найдена в справочнике');
          error.code = 'REPOSITORY_ORGANIZATION_NOT_FOUND';
          throw error;
        }
      }

      await client.query(
        `
          DELETE FROM RepositoryAuthorOrganizations
          WHERE author_id = $1::integer
        `,
        [authorId]
      );

      const resolvedStatus = authorResult.rows[0].status;
      for (const organizationId of normalizedOrganizationIds) {
        await client.query(
          `
            INSERT INTO RepositoryAuthorOrganizations (
              author_id,
              organization_id,
              status,
              approved_by,
              approved_at,
              created_at,
              updated_at
            )
            VALUES (
              $1::integer,
              $2::integer,
              CASE
                WHEN $3::varchar = 'pending' THEN 'pending'
                WHEN $3::varchar = 'rejected' THEN 'rejected'
                ELSE 'approved'
              END,
              CASE WHEN $3::varchar = 'pending' THEN NULL::integer ELSE $4::integer END,
              CASE WHEN $3::varchar = 'pending' THEN NULL::timestamp ELSE CURRENT_TIMESTAMP END,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            )
            ON CONFLICT (author_id, organization_id)
            DO UPDATE SET
              status = EXCLUDED.status,
              approved_by = EXCLUDED.approved_by,
              approved_at = EXCLUDED.approved_at,
              updated_at = CURRENT_TIMESTAMP
          `,
          [authorId, organizationId, resolvedStatus, normalizedApproverId]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return this.getAuthorById(authorId);
  }

    /* Делает: Удаляет автора. Применение: используется внутри класса RepositoryReferenceModel. */
  static async deleteAuthor(id) {
    const client = await authPool.connect();
    try {
      await client.query('BEGIN');

      const author = await this.getAuthorById(id);
      if (!author) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(`DELETE FROM RepositoryAuthorOrganizations WHERE author_id = $1`, [id]);
      await client.query(`DELETE FROM RepositoryAuthors WHERE id = $1`, [id]);
      await client.query('COMMIT');

      return author;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

    /* Делает: Одобряет автора. Применение: используется внутри класса RepositoryReferenceModel. */
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
    return authors.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри approveAuthor. */ (author) => author.id === Number(id)) || null;
  }

    /* Делает: Отклоняет автора. Применение: используется внутри класса RepositoryReferenceModel. */
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
    return authors.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри rejectAuthor. */ (author) => author.id === Number(id)) || null;
  }
}

export default RepositoryReferenceModel;


