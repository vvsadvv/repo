import { RepositoryUserModel } from '../models/RepositoryUser.js';
import { RepositoryReferenceModel } from '../models/RepositoryReference.js';
import { repositoryService } from '../services/repositoryService.js';
import { getEmailService } from '../services/emailService.js';

const repositoryPublicBaseUrl = (process.env.REPOSITORY_PUBLIC_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

/* Делает: Форматирует пользователя репозиторного. Применение: используется локально в файле backend/controllers/repositoryAdminController.js. */
function formatRepositoryUser(user) {
  const organizationName = user.organization_reference_name_ru || user.organization;

  return {
    id: user.id,
    name: user.name,
    full_name: user.full_name,
    email: user.email,
    organization: organizationName,
    organization_id: user.organization_id ?? null,
    organizationId: user.organization_id ?? null,
    position: user.position,
    role: user.role,
    status: user.status,
    created_at: user.created_at,
    approved_at: user.approved_at,
    approver_name: user.approver_full_name || user.approver_name,
  };
}

/* Делает: Проверяет repository reference conflict. Применение: используется локально в файле backend/controllers/repositoryAdminController.js. */
function isRepositoryReferenceConflict(error) {
  return error?.code === '23505';
}

/* Делает: Получает имя репозиторного пользовательского display. Применение: используется локально в файле backend/controllers/repositoryAdminController.js. */
function getRepositoryUserDisplayName(user) {
  return String(user?.full_name || '').trim() || String(user?.name || '').trim() || 'пользователь';
}

/* Делает: Отправляет уведомление user about registration approval. Применение: используется локально в файле backend/controllers/repositoryAdminController.js. */
async function notifyUserAboutRegistrationApproval(user) {
  try {
    const recipient = String(user?.email || '').trim().toLowerCase();
    if (!recipient || !recipient.includes('@')) {
      console.warn(`Repository user approval notification skipped: email is empty for user ${user?.id || 'unknown'}`);
      return { sent: false, recipient: '', reason: 'RECIPIENT_NOT_FOUND' };
    }

    const emailService = await getEmailService();
    await emailService.sendRepositoryUserNotification({
      to: recipient,
      subject: 'Регистрация в репозитории подтверждена',
      title: 'Регистрация подтверждена',
      message: `Здравствуйте, ${getRepositoryUserDisplayName(user)}! Ваша регистрация в репозитории ФИЦ ЕГС РАС подтверждена администратором.`,
      details: [
        `Логин: ${user.name}`,
        `Роль: ${user.role}`,
        'Теперь вы можете войти в репозиторий и работать с документами.',
      ],
      actionLabel: 'Войти в репозиторий',
      actionUrl: `${repositoryPublicBaseUrl}/repository/login`,
    });

    console.log(`Repository user approval notification sent to ${recipient}`);
    return { sent: true, recipient };
  } catch (error) {
    console.error('Repository user approval notification error:', error);
    return { sent: false, recipient: String(user?.email || '').trim(), reason: error?.message || 'SEND_FAILED' };
  }
}

const profileChangeLabels = {
  full_name: 'ФИО',
  email: 'Email',
  organization: 'Организация',
  position: 'Должность',
};

/* Делает: Форматирует запрос профиля update. Применение: используется локально в файле backend/controllers/repositoryAdminController.js. */
function formatProfileUpdateRequest(request) {
  if (!request) {
    return null;
  }

  return {
    id: request.id,
    repository_user_id: request.repository_user_id,
    requested_changes: request.requested_changes || {},
    requestedChanges: request.requested_changes || {},
    status: request.status,
    admin_comment: request.admin_comment,
    reviewed_by: request.reviewed_by,
    reviewed_at: request.reviewed_at,
    created_at: request.created_at,
    updated_at: request.updated_at,
    reviewer_name: request.reviewer_name,
    user: request.user ? formatRepositoryUser(request.user) : null,
  };
}

/* Делает: Собирает profile update details. Применение: используется локально в файле backend/controllers/repositoryAdminController.js. */
function buildProfileUpdateDetails(request) {
  const changes = request?.requested_changes || {};
  return Object.entries(changes)
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри buildProfileUpdateDetails. */ ([key]) => key !== 'organization_id')
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри buildProfileUpdateDetails. */ ([key, value]) => `${profileChangeLabels[key] || key}: ${value || 'Не указано'}`);
}

/* Делает: Отправляет уведомление user about profile update decision. Применение: используется локально в файле backend/controllers/repositoryAdminController.js. */
async function notifyUserAboutProfileUpdateDecision(request, options = {}) {
  try {
    const previousRequest = options.previousRequest || null;
    const approved = options.approved === true;
    const recipients = [
      String(request?.user?.email || '').trim().toLowerCase(),
      String(previousRequest?.user?.email || '').trim().toLowerCase(),
    ].filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри notifyUserAboutProfileUpdateDecision. */ (email, index, list) => email && email.includes('@') && list.indexOf(email) === index);

    if (recipients.length === 0) {
      console.warn(`Repository profile update decision notification skipped: email is empty for request ${request?.id || 'unknown'}`);
      return { sent: false, recipients: [], reason: 'RECIPIENT_NOT_FOUND' };
    }

    const emailService = await getEmailService();
    const details = buildProfileUpdateDetails(request);
    if (request.admin_comment) {
      details.push(`Комментарий администратора: ${request.admin_comment}`);
    }

    const results = await Promise.allSettled(
      recipients.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри notifyUserAboutProfileUpdateDecision. */ (recipient) =>
        emailService.sendRepositoryUserNotification({
          to: recipient,
          subject: approved ? 'Заявка на изменение профиля одобрена' : 'Заявка на изменение профиля отклонена',
          title: approved ? 'Изменения профиля одобрены' : 'Изменения профиля отклонены',
          message: approved
            ? `Здравствуйте, ${getRepositoryUserDisplayName(request.user)}! Администратор одобрил вашу заявку на изменение параметров профиля.`
            : `Здравствуйте, ${getRepositoryUserDisplayName(request.user)}! Администратор отклонил вашу заявку на изменение параметров профиля.`,
          details,
          actionLabel: 'Открыть кабинет',
          actionUrl: `${repositoryPublicBaseUrl}/repository/cabinet`,
        })
      )
    );

    const failedRecipients = results
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри notifyUserAboutProfileUpdateDecision. */ (result, index) => (result.status === 'rejected' ? recipients[index] : ''))
      .filter(Boolean);

    if (failedRecipients.length > 0) {
      console.error(`Repository profile update decision notification failed for: ${failedRecipients.join(', ')}`);
    }

    return {
      sent: failedRecipients.length < recipients.length,
      recipients,
      failedRecipients,
    };
  } catch (error) {
    console.error('Repository profile update decision notification error:', error);
    return { sent: false, recipients: [], reason: error?.message || 'SEND_FAILED' };
  }
}

export class RepositoryAdminController {
    /* Делает: Получает пользователей всех. Применение: используется внутри класса RepositoryAdminController. */
  static async getAllUsers(req, res) {
    try {
      const users = await RepositoryUserModel.findAll();
      return res.json({ users: users.map(formatRepositoryUser) });
    } catch (error) {
      console.error('Repository admin get users error:', error);
      return res.status(500).json({ message: 'Ошибка при получении пользователей репозитория' });
    }
  }

    /* Делает: Получает пользователей ожидающего. Применение: используется внутри класса RepositoryAdminController. */
  static async getPendingUsers(req, res) {
    try {
      const users = await RepositoryUserModel.getPendingUsers();
      return res.json({ users: users.map(formatRepositoryUser) });
    } catch (error) {
      console.error('Repository admin get pending users error:', error);
      return res.status(500).json({ message: 'Ошибка при получении ожидающих пользователей репозитория' });
    }
  }

    /* Делает: Получает запросы профиля update. Применение: используется внутри класса RepositoryAdminController. */
  static async getProfileUpdateRequests(req, res) {
    try {
      const requests = await RepositoryUserModel.listPendingProfileUpdateRequests();
      return res.json({ requests: requests.map(formatProfileUpdateRequest) });
    } catch (error) {
      console.error('Repository admin get profile update requests error:', error);
      return res.status(500).json({ message: 'Ошибка при получении заявок на изменение профиля' });
    }
  }

    /* Делает: Одобряет запрос профиля update. Применение: используется внутри класса RepositoryAdminController. */
  static async approveProfileUpdateRequest(req, res) {
    try {
      const previousRequest = await RepositoryUserModel.findProfileUpdateRequestById(req.params.id);
      const result = await RepositoryUserModel.approveProfileUpdateRequest(req.params.id, req.repositoryUser.id);
      const notification = await notifyUserAboutProfileUpdateDecision(result.request, {
        approved: true,
        previousRequest,
      });

      return res.json({
        message: 'Заявка на изменение профиля одобрена',
        request: formatProfileUpdateRequest(result.request),
        user: formatRepositoryUser(result.user),
        notification,
      });
    } catch (error) {
      console.error('Repository admin approve profile update request error:', error);
      return res.status(error.httpStatus || 500).json({ message: error.message || 'Ошибка при одобрении заявки на изменение профиля' });
    }
  }

    /* Делает: Отклоняет запрос профиля update. Применение: используется внутри класса RepositoryAdminController. */
  static async rejectProfileUpdateRequest(req, res) {
    try {
      const adminComment = typeof req.body?.comment === 'string' ? req.body.comment : '';
      const request = await RepositoryUserModel.rejectProfileUpdateRequest(req.params.id, req.repositoryUser.id, adminComment);
      const notification = await notifyUserAboutProfileUpdateDecision(request, { approved: false });

      return res.json({
        message: 'Заявка на изменение профиля отклонена',
        request: formatProfileUpdateRequest(request),
        notification,
      });
    } catch (error) {
      console.error('Repository admin reject profile update request error:', error);
      return res.status(error.httpStatus || 500).json({ message: error.message || 'Ошибка при отклонении заявки на изменение профиля' });
    }
  }

    /* Делает: Получает проверку документов for. Применение: используется внутри класса RepositoryAdminController. */
  static async getDocumentsForReview(req, res) {
    try {
      const documents = await repositoryService.getDocumentsForReview();
      return res.json({ documents });
    } catch (error) {
      console.error('Repository admin get review documents error:', error);
      return res.status(500).json({ message: 'Ошибка при получении документов на регистрации' });
    }
  }

    /* Делает: Выполняет доработку send документа to. Применение: используется внутри класса RepositoryAdminController. */
  static async sendDocumentToRevision(req, res) {
    try {
      const { id } = req.params;
      const revisionComment = typeof req.body?.comment === 'string' ? req.body.comment : '';
      const result = await repositoryService.sendDocumentToRevision(id, {
        id: req.repositoryUser.id,
        role: req.repositoryUser.role,
        fullName: req.repositoryUser.full_name || req.repositoryUser.name,
        name: req.repositoryUser.name,
        email: req.repositoryUser.email,
      }, revisionComment);
      return res.json(result);
    } catch (error) {
      console.error('Repository admin send document to revision error:', error);
      return res.status(error.httpStatus || 400).json({ message: error.message || 'Ошибка при отправке документа на доработку' });
    }
  }

    /* Делает: Обновляет пользователя. Применение: используется внутри класса RepositoryAdminController. */
  static async updateUser(req, res) {
    try {
      const { id } = req.params;
      const { role, status } = req.body;
      const currentUser = req.repositoryUser;
      const user = await RepositoryUserModel.findById(id);

      if (!user) {
        return res.status(404).json({ message: 'Пользователь репозитория не найден' });
      }

      const updates = {};
      if (role !== undefined) updates.role = role;
      if (status !== undefined) updates.status = status;

      if (role === 'user' || role === 'editor' || role === 'admin') {
        updates.role = role;
        updates.status = 'active';
        updates.approved_by = currentUser.id;
      } else if (status === 'active') {
        updates.role = user.role;
        updates.status = 'active';
        updates.approved_by = currentUser.id;
      }

      const updatedUser = await RepositoryUserModel.update(id, updates);
      const shouldNotifyRegistrationApproved = user.status !== 'active' && updatedUser?.status === 'active';
      const notification = shouldNotifyRegistrationApproved
        ? await notifyUserAboutRegistrationApproval(updatedUser)
        : null;

      return res.json({
        message: 'Пользователь репозитория обновлен',
        user: formatRepositoryUser(updatedUser),
        notification,
      });
    } catch (error) {
      console.error('Repository admin update user error:', error);
      return res.status(500).json({ message: 'Ошибка при обновлении пользователя репозитория' });
    }
  }

    /* Делает: Удаляет пользователя. Применение: используется внутри класса RepositoryAdminController. */
  static async deleteUser(req, res) {
    try {
      const { id } = req.params;
      const currentUser = req.repositoryUser;
      const user = await RepositoryUserModel.findById(id);

      if (!user) {
        return res.status(404).json({ message: 'Пользователь репозитория не найден' });
      }
      if (user.role === 'admin') {
        return res.status(400).json({ message: 'Нельзя удалить администратора репозитория' });
      }
      if (currentUser.id === user.id) {
        return res.status(400).json({ message: 'Нельзя удалить свою учетную запись репозитория' });
      }

      await RepositoryUserModel.delete(id);
      return res.json({ message: 'Пользователь репозитория удален' });
    } catch (error) {
      console.error('Repository admin delete user error:', error);
      return res.status(500).json({ message: 'Ошибка при удалении пользователя репозитория' });
    }
  }

    /* Делает: Получает организации ожидающего. Применение: используется внутри класса RepositoryAdminController. */
  static async getPendingOrganizations(req, res) {
    try {
      const organizations = await RepositoryReferenceModel.listPendingOrganizations();
      return res.json({ organizations });
    } catch (error) {
      console.error('Repository admin get pending organizations error:', error);
      return res.status(500).json({ message: 'Ошибка при получении заявок на организации' });
    }
  }

    /* Делает: Получает организации. Применение: используется внутри класса RepositoryAdminController. */
  static async getOrganizations(req, res) {
    try {
      const organizations = await RepositoryReferenceModel.listAllOrganizations();
      return res.json({ organizations });
    } catch (error) {
      console.error('Repository admin get organizations error:', error);
      return res.status(500).json({ message: 'Ошибка при получении списка организаций' });
    }
  }

    /* Делает: Создаёт организацию. Применение: используется внутри класса RepositoryAdminController. */
  static async createOrganization(req, res) {
    try {
      const nameRu = String(req.body?.nameRu || '').trim();
      const nameEn = String(req.body?.nameEn || '').trim();
      const fullNameRu = String(req.body?.fullNameRu || '').trim();
      const fullNameEn = String(req.body?.fullNameEn || '').trim();
      const status = String(req.body?.status || 'approved').trim().toLowerCase();

      if (nameRu.length < 2) {
        return res.status(400).json({ message: 'Укажите название организации на русском языке' });
      }

      const organization = await RepositoryReferenceModel.createOrganization({
        name_ru: nameRu,
        name_en: nameEn,
        full_name_ru: fullNameRu,
        full_name_en: fullNameEn,
        status,
      }, req.repositoryUser.id);

      return res.status(201).json({ message: 'Организация создана', organization });
    } catch (error) {
      console.error('Repository admin create organization error:', error);
      if (isRepositoryReferenceConflict(error)) {
        return res.status(409).json({ message: 'Организация с таким названием уже существует' });
      }
      return res.status(500).json({ message: 'Ошибка при создании организации' });
    }
  }

    /* Делает: Обновляет организацию. Применение: используется внутри класса RepositoryAdminController. */
  static async updateOrganization(req, res) {
    try {
      const { id } = req.params;
      const organization = await RepositoryReferenceModel.updateOrganization(id, {
        name_ru: req.body?.nameRu,
        name_en: req.body?.nameEn,
        full_name_ru: req.body?.fullNameRu,
        full_name_en: req.body?.fullNameEn,
        status: req.body?.status,
      }, req.repositoryUser.id);

      if (!organization) {
        return res.status(404).json({ message: 'Организация не найдена' });
      }

      return res.json({ message: 'Организация обновлена', organization });
    } catch (error) {
      console.error('Repository admin update organization error:', error);
      if (isRepositoryReferenceConflict(error)) {
        return res.status(409).json({ message: 'Организация с таким названием уже существует' });
      }
      return res.status(500).json({ message: 'Ошибка при обновлении организации' });
    }
  }

    /* Делает: Удаляет организацию. Применение: используется внутри класса RepositoryAdminController. */
  static async deleteOrganization(req, res) {
    try {
      const organization = await RepositoryReferenceModel.deleteOrganization(req.params.id);
      if (!organization) {
        return res.status(404).json({ message: 'Организация не найдена' });
      }

      return res.json({ message: 'Организация удалена', organization });
    } catch (error) {
      console.error('Repository admin delete organization error:', error);
      return res.status(500).json({ message: 'Ошибка при удалении организации' });
    }
  }

    /* Делает: Одобряет организацию. Применение: используется внутри класса RepositoryAdminController. */
  static async approveOrganization(req, res) {
    try {
      const organization = await RepositoryReferenceModel.approveOrganization(req.params.id, req.repositoryUser.id);
      if (!organization) {
        return res.status(404).json({ message: 'Организация не найдена' });
      }

      return res.json({ message: 'Организация одобрена', organization });
    } catch (error) {
      console.error('Repository admin approve organization error:', error);
      return res.status(500).json({ message: 'Ошибка при одобрении организации' });
    }
  }

    /* Делает: Отклоняет организацию. Применение: используется внутри класса RepositoryAdminController. */
  static async rejectOrganization(req, res) {
    try {
      const organization = await RepositoryReferenceModel.rejectOrganization(req.params.id, req.repositoryUser.id);
      if (!organization) {
        return res.status(404).json({ message: 'Организация не найдена' });
      }

      return res.json({ message: 'Заявка на организацию отклонена', organization });
    } catch (error) {
      console.error('Repository admin reject organization error:', error);
      return res.status(500).json({ message: 'Ошибка при отклонении организации' });
    }
  }

    /* Делает: Получает авторов ожидающего. Применение: используется внутри класса RepositoryAdminController. */
  static async getPendingAuthors(req, res) {
    try {
      const authors = await RepositoryReferenceModel.listPendingAuthors();
      return res.json({ authors });
    } catch (error) {
      console.error('Repository admin get pending authors error:', error);
      return res.status(500).json({ message: 'Ошибка при получении заявок на авторов' });
    }
  }

    /* Делает: Получает авторов. Применение: используется внутри класса RepositoryAdminController. */
  static async getAuthors(req, res) {
    try {
      const authors = await RepositoryReferenceModel.listAllAuthors();
      return res.json({ authors });
    } catch (error) {
      console.error('Repository admin get authors error:', error);
      return res.status(500).json({ message: 'Ошибка при получении списка авторов' });
    }
  }

    /* Делает: Создаёт автора. Применение: используется внутри класса RepositoryAdminController. */
  static async createAuthor(req, res) {
    try {
      const nameRu = String(req.body?.nameRu || '').trim();
      const nameEn = String(req.body?.nameEn || '').trim();
      const organizationId = Number(req.body?.organizationId) || null;
      const status = String(req.body?.status || 'approved').trim().toLowerCase();

      if (nameRu.length < 2) {
        return res.status(400).json({ message: 'Укажите автора на русском языке' });
      }

      if (nameEn.length < 2) {
        return res.status(400).json({ message: 'Укажите автора на английском языке' });
      }

      const author = await RepositoryReferenceModel.createAuthor({
        name_ru: nameRu,
        name_en: nameEn,
        status,
        organization_id: organizationId,
      }, req.repositoryUser.id);

      return res.status(201).json({ message: 'Автор создан', author });
    } catch (error) {
      console.error('Repository admin create author error:', error);
      if (error?.code === 'REPOSITORY_ORGANIZATION_NOT_FOUND') {
        return res.status(400).json({ message: 'Выбранная организация не найдена в справочнике' });
      }
      if (isRepositoryReferenceConflict(error)) {
        return res.status(409).json({ message: 'Автор с таким набором имен уже существует' });
      }
      return res.status(500).json({ message: 'Ошибка при создании автора' });
    }
  }

    /* Делает: Обновляет автора. Применение: используется внутри класса RepositoryAdminController. */
  static async updateAuthor(req, res) {
    try {
      const { id } = req.params;
      const organizationId = Number(req.body?.organizationId) || null;
      const author = await RepositoryReferenceModel.updateAuthor(id, {
        name_ru: req.body?.nameRu,
        name_en: req.body?.nameEn,
        status: req.body?.status,
        organization_id: organizationId,
      }, req.repositoryUser.id);

      if (!author) {
        return res.status(404).json({ message: 'Автор не найден' });
      }

      return res.json({ message: 'Автор обновлен', author });
    } catch (error) {
      console.error('Repository admin update author error:', error);
      if (error?.code === 'REPOSITORY_ORGANIZATION_NOT_FOUND') {
        return res.status(400).json({ message: 'Выбранная организация не найдена в справочнике' });
      }
      if (isRepositoryReferenceConflict(error)) {
        return res.status(409).json({ message: 'Автор с таким набором имен уже существует' });
      }
      return res.status(500).json({ message: 'Ошибка при обновлении автора' });
    }
  }

    /* Делает: Удаляет автора. Применение: используется внутри класса RepositoryAdminController. */
  static async deleteAuthor(req, res) {
    try {
      const author = await RepositoryReferenceModel.deleteAuthor(req.params.id);
      if (!author) {
        return res.status(404).json({ message: 'Автор не найден' });
      }

      return res.json({ message: 'Автор удален', author });
    } catch (error) {
      console.error('Repository admin delete author error:', error);
      return res.status(500).json({ message: 'Ошибка при удалении автора' });
    }
  }

    /* Делает: Одобряет автора. Применение: используется внутри класса RepositoryAdminController. */
  static async approveAuthor(req, res) {
    try {
      const author = await RepositoryReferenceModel.approveAuthor(req.params.id, req.repositoryUser.id);
      if (!author) {
        return res.status(404).json({ message: 'Автор не найден' });
      }

      return res.json({ message: 'Автор одобрен', author });
    } catch (error) {
      console.error('Repository admin approve author error:', error);
      return res.status(500).json({ message: 'Ошибка при одобрении автора' });
    }
  }

    /* Делает: Отклоняет автора. Применение: используется внутри класса RepositoryAdminController. */
  static async rejectAuthor(req, res) {
    try {
      const author = await RepositoryReferenceModel.rejectAuthor(req.params.id, req.repositoryUser.id);
      if (!author) {
        return res.status(404).json({ message: 'Автор не найден' });
      }

      return res.json({ message: 'Заявка на автора отклонена', author });
    } catch (error) {
      console.error('Repository admin reject author error:', error);
      return res.status(500).json({ message: 'Ошибка при отклонении автора' });
    }
  }
}
