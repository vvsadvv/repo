import { authPool } from './authDatabase.js';

const PROFILE_UPDATE_REQUEST_SELECT = `
  SELECT request.id,
         request.repository_user_id,
         request.requested_changes,
         request.status,
         request.admin_comment,
         request.reviewed_by,
         request.reviewed_at,
         request.created_at,
         request.updated_at,
         requester.id AS requester_id,
         requester.name AS requester_name,
         requester.full_name AS requester_full_name,
         requester.email AS requester_email,
         requester.organization AS requester_organization,
         requester.organization_id AS requester_organization_id,
         requester.position AS requester_position,
         requester.role AS requester_role,
         requester.status AS requester_status,
         requester.created_at AS requester_created_at,
         requester_org.name_ru AS requester_organization_reference_name_ru,
         reviewer.name AS reviewer_name,
         reviewer.full_name AS reviewer_full_name
  FROM RepositoryUserProfileUpdateRequests request
  JOIN RepositoryUsers requester ON requester.id = request.repository_user_id
  LEFT JOIN RepositoryOrganizations requester_org ON requester_org.id = requester.organization_id
  LEFT JOIN RepositoryUsers reviewer ON reviewer.id = request.reviewed_by
`;

/* Делает: Создаёт ошибку репозиторного пользовательского. Применение: используется локально в файле backend/models/RepositoryUser.js. */
function createRepositoryUserError(message, httpStatus = 400, code = 'REPOSITORY_USER_ERROR') {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  error.code = code;
  return error;
}

/* Делает: Проверяет наличие значение own. Применение: используется локально в файле backend/models/RepositoryUser.js. */
function hasOwnValue(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

/* Делает: Разбирает requested changes. Применение: используется локально в файле backend/models/RepositoryUser.js. */
function parseRequestedChanges(value) {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  return value;
}

/* Делает: Преобразует запрос профиля update. Применение: используется локально в файле backend/models/RepositoryUser.js. */
function mapProfileUpdateRequest(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    repository_user_id: row.repository_user_id,
    requested_changes: parseRequestedChanges(row.requested_changes),
    status: row.status,
    admin_comment: row.admin_comment,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    user: {
      id: row.requester_id,
      name: row.requester_name,
      full_name: row.requester_full_name,
      email: row.requester_email,
      organization: row.requester_organization_reference_name_ru || row.requester_organization,
      organization_id: row.requester_organization_id,
      organization_reference_name_ru: row.requester_organization_reference_name_ru,
      position: row.requester_position,
      role: row.requester_role,
      status: row.requester_status,
      created_at: row.requester_created_at,
    },
    reviewer_name: row.reviewer_full_name || row.reviewer_name || null,
  };
}

export class RepositoryUserModel {
    /* Делает: Выполняет create. Применение: используется внутри класса RepositoryUserModel. */
  static async create(userData) {
    const {
      name,
      full_name,
      email,
      organization,
      organization_id,
      position,
      personal_data_consent = false,
      personal_data_consent_at = null,
      password,
      role = 'user',
      status = 'pending',
    } = userData;

    const result = await authPool.query(
      `INSERT INTO RepositoryUsers (name, full_name, email, organization, organization_id, position, personal_data_consent, personal_data_consent_at, password, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, name, full_name, email, organization, organization_id, position, role, status, created_at, approved_at, approved_by`,
      [
        name,
        full_name || null,
        email,
        organization || null,
        organization_id || null,
        position || null,
        Boolean(personal_data_consent),
        personal_data_consent_at || null,
        password,
        role,
        status,
      ]
    );
    return result.rows[0] || null;
  }

    /* Делает: Находит идентификатор by. Применение: используется внутри класса RepositoryUserModel. */
  static async findById(id) {
    const result = await authPool.query(
      `SELECT ru.*, org.name_ru AS organization_reference_name_ru, org.name_en AS organization_reference_name_en,
              approver.name AS approver_name, approver.full_name AS approver_full_name
       FROM RepositoryUsers ru
       LEFT JOIN RepositoryOrganizations org ON org.id = ru.organization_id
       LEFT JOIN RepositoryUsers approver ON ru.approved_by = approver.id
       WHERE ru.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

    /* Делает: Находит email by. Применение: используется внутри класса RepositoryUserModel. */
  static async findByEmail(email) {
    const result = await authPool.query(
      `SELECT ru.*, org.name_ru AS organization_reference_name_ru, org.name_en AS organization_reference_name_en
       FROM RepositoryUsers ru
       LEFT JOIN RepositoryOrganizations org ON org.id = ru.organization_id
       WHERE LOWER(ru.email) = LOWER($1)`,
      [email]
    );
    return result.rows[0] || null;
  }

    /* Делает: Находит имя by. Применение: используется внутри класса RepositoryUserModel. */
  static async findByName(name) {
    const result = await authPool.query(
      `SELECT ru.*, org.name_ru AS organization_reference_name_ru, org.name_en AS organization_reference_name_en
       FROM RepositoryUsers ru
       LEFT JOIN RepositoryOrganizations org ON org.id = ru.organization_id
       WHERE LOWER(ru.name) = LOWER($1)`,
      [name]
    );
    return result.rows[0] || null;
  }

    /* Делает: Находит вход by. Применение: используется внутри класса RepositoryUserModel. */
  static async findByLogin(login) {
    const result = await authPool.query(
      `SELECT ru.*, org.name_ru AS organization_reference_name_ru, org.name_en AS organization_reference_name_en
       FROM RepositoryUsers ru
       LEFT JOIN RepositoryOrganizations org ON org.id = ru.organization_id
       WHERE LOWER(ru.email) = LOWER($1) OR LOWER(ru.name) = LOWER($1)`,
      [login]
    );
    return result.rows[0] || null;
  }

    /* Делает: Находит all. Применение: используется внутри класса RepositoryUserModel. */
  static async findAll() {
    const result = await authPool.query(
      `SELECT ru.*, org.name_ru AS organization_reference_name_ru, org.name_en AS organization_reference_name_en,
              approver.name AS approver_name, approver.full_name AS approver_full_name
       FROM RepositoryUsers ru
       LEFT JOIN RepositoryOrganizations org ON org.id = ru.organization_id
       LEFT JOIN RepositoryUsers approver ON ru.approved_by = approver.id
       ORDER BY ru.created_at DESC`
    );
    return result.rows;
  }

    /* Делает: Получает пользователей ожидающего. Применение: используется внутри класса RepositoryUserModel. */
  static async getPendingUsers() {
    const result = await authPool.query(
      `SELECT ru.*, org.name_ru AS organization_reference_name_ru, org.name_en AS organization_reference_name_en
       FROM RepositoryUsers ru
       LEFT JOIN RepositoryOrganizations org ON org.id = ru.organization_id
       WHERE ru.status = 'pending'
       ORDER BY ru.created_at DESC`
    );
    return result.rows;
  }

    /* Делает: Находит active admins. Применение: используется внутри класса RepositoryUserModel. */
  static async findActiveAdmins() {
    const result = await authPool.query(
      `SELECT ru.*, org.name_ru AS organization_reference_name_ru, org.name_en AS organization_reference_name_en
       FROM RepositoryUsers ru
       LEFT JOIN RepositoryOrganizations org ON org.id = ru.organization_id
       WHERE ru.role = 'admin' AND ru.status = 'active' AND ru.email IS NOT NULL AND ru.email <> ''
       ORDER BY ru.created_at ASC`
    );
    return result.rows;
  }

    /* Делает: Выполняет update. Применение: используется внутри класса RepositoryUserModel. */
  static async update(id, updates) {
    const { role, status, approved_by, organization, organization_id, full_name, email, position } = updates;
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

    if (organization !== undefined) {
      query += `, organization = $${index}`;
      values.push(organization || null);
      index += 1;
    }

    if (organization_id !== undefined) {
      query += `, organization_id = $${index}`;
      values.push(organization_id || null);
      index += 1;
    }

    if (full_name !== undefined) {
      query += `, full_name = $${index}`;
      values.push(full_name || null);
      index += 1;
    }

    if (email !== undefined) {
      query += `, email = $${index}`;
      values.push(email);
      index += 1;
    }

    if (position !== undefined) {
      query += `, position = $${index}`;
      values.push(position || null);
      index += 1;
    }

    if (approved_by !== undefined) {
      query += `, approved_by = $${index}, approved_at = CURRENT_TIMESTAMP`;
      values.push(approved_by);
      index += 1;
    }

    query += ` WHERE id = $${index} RETURNING id, name, full_name, email, organization, organization_id, position, role, status, created_at, approved_at, approved_by`;
    values.push(id);

    const result = await authPool.query(query, values);
    return result.rows[0] || null;
  }

    /* Делает: Находит идентификатор профиля update запроса by. Применение: используется внутри класса RepositoryUserModel. */
  static async findProfileUpdateRequestById(id) {
    const result = await authPool.query(
      `${PROFILE_UPDATE_REQUEST_SELECT}
       WHERE request.id = $1`,
      [id]
    );

    return mapProfileUpdateRequest(result.rows[0] || null);
  }

    /* Делает: Находит идентификатор ожидающего профиля update запроса by пользовательского. Применение: используется внутри класса RepositoryUserModel. */
  static async findPendingProfileUpdateRequestByUserId(userId) {
    const result = await authPool.query(
      `${PROFILE_UPDATE_REQUEST_SELECT}
       WHERE request.repository_user_id = $1 AND request.status = 'pending'
       ORDER BY request.created_at DESC
       LIMIT 1`,
      [userId]
    );

    return mapProfileUpdateRequest(result.rows[0] || null);
  }

    /* Делает: Возвращает список запросы ожидающего профиля update. Применение: используется внутри класса RepositoryUserModel. */
  static async listPendingProfileUpdateRequests() {
    const result = await authPool.query(
      `${PROFILE_UPDATE_REQUEST_SELECT}
       WHERE request.status = 'pending'
       ORDER BY request.created_at DESC`
    );

    return result.rows.map(mapProfileUpdateRequest);
  }

    /* Делает: Создаёт запрос профиля update. Применение: используется внутри класса RepositoryUserModel. */
  static async createProfileUpdateRequest(userId, requestedChanges) {
    const existingRequest = await this.findPendingProfileUpdateRequestByUserId(userId);
    if (existingRequest) {
      throw createRepositoryUserError(
        'У вас уже есть заявка на изменение параметров. Дождитесь решения администратора.',
        409,
        'PROFILE_UPDATE_REQUEST_EXISTS'
      );
    }

    try {
      const result = await authPool.query(
        `INSERT INTO RepositoryUserProfileUpdateRequests (repository_user_id, requested_changes)
         VALUES ($1, $2::jsonb)
         RETURNING id`,
        [userId, JSON.stringify(requestedChanges || {})]
      );

      return this.findProfileUpdateRequestById(result.rows[0]?.id);
    } catch (error) {
      if (error?.code === '23505') {
        throw createRepositoryUserError(
          'У вас уже есть заявка на изменение параметров. Дождитесь решения администратора.',
          409,
          'PROFILE_UPDATE_REQUEST_EXISTS'
        );
      }

      throw error;
    }
  }

    /* Делает: Одобряет запрос профиля update. Применение: используется внутри класса RepositoryUserModel. */
  static async approveProfileUpdateRequest(requestId, adminId) {
    const client = await authPool.connect();

    try {
      await client.query('BEGIN');
      const requestResult = await client.query(
        `SELECT request.*,
                requester.full_name AS current_full_name,
                requester.email AS current_email,
                requester.organization AS current_organization,
                requester.organization_id AS current_organization_id,
                requester.position AS current_position
         FROM RepositoryUserProfileUpdateRequests request
         JOIN RepositoryUsers requester ON requester.id = request.repository_user_id
         WHERE request.id = $1
         FOR UPDATE OF request`,
        [requestId]
      );

      const request = requestResult.rows[0];
      if (!request) {
        throw createRepositoryUserError('Заявка на изменение профиля не найдена', 404, 'PROFILE_UPDATE_REQUEST_NOT_FOUND');
      }

      if (request.status !== 'pending') {
        throw createRepositoryUserError('Эта заявка уже обработана', 409, 'PROFILE_UPDATE_REQUEST_ALREADY_REVIEWED');
      }

      const changes = parseRequestedChanges(request.requested_changes);
      const nextFullName = hasOwnValue(changes, 'full_name')
        ? String(changes.full_name || '').trim()
        : request.current_full_name;
      const nextEmail = hasOwnValue(changes, 'email')
        ? String(changes.email || '').trim().toLowerCase()
        : request.current_email;
      const nextPosition = hasOwnValue(changes, 'position')
        ? String(changes.position || '').trim()
        : request.current_position;
      let nextOrganizationId = hasOwnValue(changes, 'organization_id')
        ? Number(changes.organization_id) || null
        : request.current_organization_id;
      let nextOrganization = hasOwnValue(changes, 'organization')
        ? String(changes.organization || '').trim()
        : request.current_organization;

      if (hasOwnValue(changes, 'email')) {
        const emailConflict = await client.query(
          `SELECT id
           FROM RepositoryUsers
           WHERE LOWER(email) = LOWER($1) AND id <> $2
           LIMIT 1`,
          [nextEmail, request.repository_user_id]
        );

        if (emailConflict.rows[0]) {
          throw createRepositoryUserError('Пользователь с таким email уже существует', 409, 'EMAIL_ALREADY_EXISTS');
        }
      }

      if (hasOwnValue(changes, 'organization_id')) {
        const organizationResult = await client.query(
          `SELECT id, name_ru
           FROM RepositoryOrganizations
           WHERE id = $1 AND status <> 'rejected'
           LIMIT 1`,
          [nextOrganizationId]
        );

        const organization = organizationResult.rows[0];
        if (!organization) {
          throw createRepositoryUserError('Выбранная организация не найдена в справочнике', 400, 'ORGANIZATION_NOT_FOUND');
        }

        nextOrganizationId = organization.id;
        nextOrganization = organization.name_ru;
      }

      const updatedUserResult = await client.query(
        `UPDATE RepositoryUsers
         SET full_name = $1,
             email = $2,
             organization = $3,
             organization_id = $4,
             position = $5,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING id, name, full_name, email, organization, organization_id, position, role, status, created_at, approved_at, approved_by`,
        [
          nextFullName || null,
          nextEmail,
          nextOrganization || null,
          nextOrganizationId || null,
          nextPosition || null,
          request.repository_user_id,
        ]
      );

      await client.query(
        `UPDATE RepositoryUserProfileUpdateRequests
         SET status = 'approved',
             reviewed_by = $1,
             reviewed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [adminId, requestId]
      );

      await client.query('COMMIT');

      return {
        request: await this.findProfileUpdateRequestById(requestId),
        user: updatedUserResult.rows[0] || null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

    /* Делает: Отклоняет запрос профиля update. Применение: используется внутри класса RepositoryUserModel. */
  static async rejectProfileUpdateRequest(requestId, adminId, adminComment = '') {
    const result = await authPool.query(
      `UPDATE RepositoryUserProfileUpdateRequests
       SET status = 'rejected',
           admin_comment = NULLIF($3, ''),
           reviewed_by = $2,
           reviewed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [requestId, adminId, String(adminComment || '').trim()]
    );

    if (!result.rows[0]) {
      const existing = await this.findProfileUpdateRequestById(requestId);
      if (!existing) {
        throw createRepositoryUserError('Заявка на изменение профиля не найдена', 404, 'PROFILE_UPDATE_REQUEST_NOT_FOUND');
      }

      throw createRepositoryUserError('Эта заявка уже обработана', 409, 'PROFILE_UPDATE_REQUEST_ALREADY_REVIEWED');
    }

    return this.findProfileUpdateRequestById(requestId);
  }

    /* Делает: Выполняет delete. Применение: используется внутри класса RepositoryUserModel. */
  static async delete(id) {
    const result = await authPool.query('DELETE FROM RepositoryUsers WHERE id = $1', [id]);
    return result.rowCount > 0;
  }
}

export default RepositoryUserModel;
