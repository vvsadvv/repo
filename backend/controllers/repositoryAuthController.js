import bcrypt from 'bcryptjs';
import { getEmailService } from '../services/emailService.js';
import { authPool } from '../models/authDatabase.js';
import { RepositoryUserModel } from '../models/RepositoryUser.js';
import { RepositoryPasswordResetTokenModel } from '../models/RepositoryPasswordResetToken.js';
import { RepositoryReferenceModel } from '../models/RepositoryReference.js';
import { signRepositoryToken } from '../middleware/repositoryAuthMiddleware.js';

const defaultOrganization = process.env.REPOSITORY_DEFAULT_ORGANIZATION || 'ФИЦ ЕГС РАН';
const repositoryPublicBaseUrl = (process.env.REPOSITORY_PUBLIC_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordChangeIntervalMs = 24 * 60 * 60 * 1000;

/* Делает: Проверяет корректность password strength. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
const validatePasswordStrength = (password) => {
  if (!password) return 'Пароль обязателен';
  if (password.length < 8) return 'Пароль должен содержать минимум 8 символов';
  if (!/[A-Z]/.test(password)) return 'Пароль должен содержать заглавную букву';
  if (!/[a-z]/.test(password)) return 'Пароль должен содержать строчную букву';
  if (!/\d/.test(password)) return 'Пароль должен содержать цифру';
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]/.test(password)) return 'Пароль должен содержать спецсимвол';
  return true;
};

/* Делает: Нормализует ошибки поля. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
function normalizeFieldErrors(fieldErrors = {}) {
  return Object.fromEntries(
    Object.entries(fieldErrors).filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри normalizeFieldErrors. */ ([field, message]) => field && typeof message === 'string' && message.trim())
  );
}

/* Делает: Получает сообщение основного поля ошибки. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
function getPrimaryFieldErrorMessage(fieldErrors = {}) {
  return Object.values(fieldErrors).find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри getPrimaryFieldErrorMessage. */ (message) => typeof message === 'string' && message.trim()) || '';
}

/* Делает: Создаёт payload ошибки. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
function createErrorPayload({ message = '', fieldErrors = {}, retryAfterSeconds } = {}) {
  const normalizedFieldErrors = normalizeFieldErrors(fieldErrors);

  return {
    success: false,
    message: message || getPrimaryFieldErrorMessage(normalizedFieldErrors) || 'Ошибка запроса',
    ...(Object.keys(normalizedFieldErrors).length > 0 ? { fieldErrors: normalizedFieldErrors } : {}),
    ...(Number.isFinite(retryAfterSeconds) ? { retryAfterSeconds } : {}),
  };
}

/* Делает: Выполняет ответ send ошибки. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
function sendErrorResponse(res, status, options = {}) {
  return res.status(status).json(createErrorPayload(options));
}

/* Делает: Получает password change retry after seconds. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
function getPasswordChangeRetryAfterSeconds(passwordChangedAt) {
  const lastPasswordChange = passwordChangedAt ? new Date(passwordChangedAt).getTime() : null;
  if (!lastPasswordChange || Number.isNaN(lastPasswordChange)) {
    return null;
  }

  const elapsed = Date.now() - lastPasswordChange;
  if (elapsed >= passwordChangeIntervalMs) {
    return null;
  }

  return Math.ceil((passwordChangeIntervalMs - elapsed) / 1000);
}

/* Делает: Собирает payload duplicate репозиторного пользовательского. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
function buildDuplicateRepositoryUserPayload(name, email, { hasName = false, hasEmail = false } = {}) {
  const fieldErrors = {};

  if (hasName) {
    fieldErrors.name = `Пользователь с именем "${name}" уже существует`;
  }

  if (hasEmail) {
    fieldErrors.email = `Пользователь с email "${email}" уже существует`;
  }

  if (hasName && hasEmail) {
    return {
      message: `Пользователь с именем "${name}" и email "${email}" уже существует`,
      fieldErrors,
    };
  }

  return {
    message: getPrimaryFieldErrorMessage(fieldErrors) || 'Пользователь репозитория уже существует',
    fieldErrors,
  };
}

/* Делает: Формирует логин пользователя из email, если он не был введён вручную. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
function buildRepositoryLoginCandidate(name, email) {
  const normalizedName = String(name || '').trim();
  if (normalizedName) {
    return normalizedName;
  }

  const localPart = String(email || '').trim().toLowerCase().split('@')[0] || '';
  const generatedName = localPart
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!generatedName) {
    return '';
  }

  return generatedName.length >= 2 ? generatedName : `${generatedName}_user`;
}

/* Делает: Форматирует пользователя репозиторного. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
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

/* Делает: Получает unique active admin recipients. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
function getUniqueActiveAdminRecipients(admins = []) {
  const seen = new Set();
  return admins.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри getUniqueActiveAdminRecipients. */ (admin) => {
    const email = String(admin?.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) {
      return false;
    }

    seen.add(email);
    return true;
  });
}

/* Делает: Проверяет ошибку уникального violation. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
function isUniqueViolationError(error) {
  return String(error?.code || '').trim() === '23505';
}

/* Делает: Определяет registration conflict. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
async function resolveRegistrationConflict(name, email) {
  const [existingByName, existingByEmail] = await Promise.all([
    RepositoryUserModel.findByName(name),
    RepositoryUserModel.findByEmail(email),
  ]);

  return buildDuplicateRepositoryUserPayload(name, email, {
    hasName: Boolean(existingByName),
    hasEmail: Boolean(existingByEmail),
  });
}

/* Делает: Отправляет уведомление регистрацию admins about. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
async function notifyAdminsAboutRegistration(user) {
  try {
    const adminRecipients = getUniqueActiveAdminRecipients(await RepositoryUserModel.findActiveAdmins());
    if (adminRecipients.length === 0) {
      console.warn(`Repository registration notification skipped: no active admins for user ${user.email}`);
      return;
    }

    const emailService = await getEmailService();
    const results = await Promise.allSettled(
      adminRecipients.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри notifyAdminsAboutRegistration. */ (admin) =>
        emailService.sendRepositoryAdminNotification({
          to: admin.email,
          subject: 'Новая регистрация в репозитории',
          title: 'В репозитории зарегистрирован новый пользователь',
          message: `Пользователь ${user.full_name || user.name} (${user.email}) зарегистрировался в репозитории.`,
          details: [
            `Логин: ${user.name}`,
            `ФИО: ${user.full_name || 'Не указано'}`,
            `Должность: ${user.position || 'Не указана'}`,
            `Организация: ${user.organization || 'Не указана'}`,
            `Email: ${user.email}`,
          ],
        })
      )
    );

    const failedCount = results.reduce(/* Делает: Накопляет итоговое значение при обходе коллекции. Применение: передаётся как callback в reduce внутри notifyAdminsAboutRegistration. */ (count, result, index) => {
      if (result.status === 'rejected') {
        console.error(`Repository registration notification failed for admin ${adminRecipients[index].email}:`, result.reason);
        return count + 1;
      }
      return count;
    }, 0);

    const deliveredCount = adminRecipients.length - failedCount;
    console.log(`Repository registration notification sent to ${deliveredCount}/${adminRecipients.length} admin(s) for user ${user.email}`);
  } catch (error) {
    console.error('Repository admin registration notification error:', error);
  }
}

const profileChangeLabels = {
  full_name: 'ФИО',
  email: 'Email',
  organization: 'Организация',
  position: 'Должность',
};

/* Делает: Проверяет значение same текста. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
function isSameTextValue(left, right) {
  return String(left || '').trim() === String(right || '').trim();
}

/* Делает: Собирает profile change details. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
function buildProfileChangeDetails(user, requestedChanges) {
  const currentValues = {
    full_name: user.full_name,
    email: user.email,
    organization: user.organization_reference_name_ru || user.organization,
    position: user.position,
  };

  return Object.entries(requestedChanges)
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри buildProfileChangeDetails. */ ([key]) => key !== 'organization_id')
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри buildProfileChangeDetails. */ ([key, nextValue]) => {
      const label = profileChangeLabels[key] || key;
      const previousValue = currentValues[key] || 'Не указано';
      const normalizedNextValue = nextValue || 'Не указано';
      return `${label}: ${previousValue} → ${normalizedNextValue}`;
    });
}

/* Делает: Отправляет уведомление запрос admins about профиля update. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
async function notifyAdminsAboutProfileUpdateRequest(user, requestedChanges) {
  try {
    const adminRecipients = getUniqueActiveAdminRecipients(await RepositoryUserModel.findActiveAdmins());
    if (adminRecipients.length === 0) {
      console.warn(`Repository profile update notification skipped: no active admins for user ${user.email}`);
      return;
    }

    const emailService = await getEmailService();
    const changeDetails = buildProfileChangeDetails(user, requestedChanges);
    const results = await Promise.allSettled(
      adminRecipients.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри notifyAdminsAboutProfileUpdateRequest. */ (admin) =>
        emailService.sendRepositoryAdminNotification({
          to: admin.email,
          subject: 'Заявка на изменение профиля репозитория',
          title: 'Получена заявка на изменение профиля',
          message: `Пользователь ${user.full_name || user.name} (${user.email}) отправил заявку на изменение параметров профиля.`,
          details: [
            `Логин: ${user.name}`,
            ...changeDetails,
          ],
          actionLabel: 'Открыть админ-панель',
          actionUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/repository/admin`,
        })
      )
    );

    const failedCount = results.reduce(/* Делает: Накопляет итоговое значение при обходе коллекции. Применение: передаётся как callback в reduce внутри notifyAdminsAboutProfileUpdateRequest. */ (count, result, index) => {
      if (result.status === 'rejected') {
        console.error(`Repository profile update notification failed for admin ${adminRecipients[index].email}:`, result.reason);
        return count + 1;
      }
      return count;
    }, 0);

    const deliveredCount = adminRecipients.length - failedCount;
    console.log(`Repository profile update notification sent to ${deliveredCount}/${adminRecipients.length} admin(s) for user ${user.email}`);
  } catch (error) {
    console.error('Repository admin profile update notification error:', error);
  }
}

/* Делает: Отправляет уведомление user about profile update received. Применение: используется локально в файле backend/controllers/repositoryAuthController.js. */
async function notifyUserAboutProfileUpdateReceived(user, requestedChanges) {
  try {
    const recipient = String(user?.email || '').trim().toLowerCase();
    if (!recipient || !recipient.includes('@')) {
      console.warn(`Repository profile update receipt notification skipped: email is empty for user ${user?.id || 'unknown'}`);
      return;
    }

    const emailService = await getEmailService();
    await emailService.sendRepositoryUserNotification({
      to: recipient,
      subject: 'Заявка на изменение профиля получена',
      title: 'Заявка на изменение профиля получена',
      message: `Здравствуйте, ${user.full_name || user.name}! Ваша заявка на изменение параметров профиля отправлена администратору.`,
      details: buildProfileChangeDetails(user, requestedChanges),
      actionLabel: 'Открыть кабинет',
      actionUrl: `${repositoryPublicBaseUrl}/repository/cabinet`,
    });

    console.log(`Repository profile update receipt notification sent to ${recipient}`);
  } catch (error) {
    console.error('Repository profile update receipt notification error:', error);
  }
}

export class RepositoryAuthController {
    /* Делает: Выполняет register. Применение: используется внутри класса RepositoryAuthController. */
  static async register(req, res) {
    try {
      const { name, fullName, email, organization, organizationId, position, personalDataConsent, password, confirmPassword } = req.body;
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const normalizedName = buildRepositoryLoginCandidate(name, normalizedEmail);

      if (!fullName || !/^[А-ЯЁа-яё\s-]+$/.test(fullName.trim())) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            fullName: 'ФИО должно содержать только русские буквы, пробелы и дефис',
          },
        });
      }
      if (fullName.trim().split(/\s+/).length < 3) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            fullName: 'Введите Фамилию, Имя и Отчество',
          },
        });
      }
      if (!normalizedEmail || !emailPattern.test(normalizedEmail)) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            email: 'Укажите корректный email',
          },
        });
      }
      if (!normalizedName || normalizedName.length < 2 || !/^[a-zA-Z0-9_]+$/.test(normalizedName)) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            name: 'Имя пользователя должно содержать минимум 2 символа и состоять только из латинских букв, цифр и _',
          },
        });
      }
      if (!organizationId && (!organization || organization.trim().length < 2)) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            organizationId: 'Выберите организацию из списка или отправьте заявку на новую',
          },
        });
      }
      if (!position || position.trim().length < 2) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            position: 'Укажите должность не короче 2 символов',
          },
        });
      }
      if (personalDataConsent !== true) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            personalDataConsent: 'Для регистрации необходимо дать согласие на обработку персональных данных',
          },
        });
      }
      if (password !== confirmPassword) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            confirmPassword: 'Пароли не совпадают',
          },
        });
      }

      const pwdErr = validatePasswordStrength(password);
      if (pwdErr !== true) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            password: pwdErr,
          },
        });
      }

      const normalizedPosition = position.trim();
      const normalizedFullName = fullName.trim();
      let normalizedOrganization = organization?.trim() || defaultOrganization;
      let normalizedOrganizationId = null;

      if (organizationId) {
        const referenceOrganization = await RepositoryReferenceModel.findOrganizationById(Number(organizationId));
        if (!referenceOrganization || referenceOrganization.status === 'rejected') {
          return sendErrorResponse(res, 400, {
            fieldErrors: {
              organizationId: 'Выберите организацию из списка',
            },
          });
        }

        normalizedOrganization = referenceOrganization.name_ru;
        normalizedOrganizationId = referenceOrganization.id;
      } else {
        const referenceOrganization = await RepositoryReferenceModel.findOrganizationByName(normalizedOrganization);
        if (!referenceOrganization || referenceOrganization.status === 'rejected') {
          return sendErrorResponse(res, 400, {
            fieldErrors: {
              organizationId: 'Организация должна быть выбрана из справочника или отправлена на добавление',
            },
          });
        }

        normalizedOrganization = referenceOrganization.name_ru;
        normalizedOrganizationId = referenceOrganization.id;
      }

      const [existingByName, existingByEmail] = await Promise.all([
        RepositoryUserModel.findByName(normalizedName),
        RepositoryUserModel.findByEmail(normalizedEmail),
      ]);

      if (existingByName || existingByEmail) {
        return sendErrorResponse(
          res,
          400,
          buildDuplicateRepositoryUserPayload(normalizedName, normalizedEmail, {
            hasName: Boolean(existingByName),
            hasEmail: Boolean(existingByEmail),
          })
        );
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      let user;

      try {
        user = await RepositoryUserModel.create({
          name: normalizedName,
          full_name: normalizedFullName,
          email: normalizedEmail,
          organization: normalizedOrganization,
          organization_id: normalizedOrganizationId,
          position: normalizedPosition,
          personal_data_consent: true,
          personal_data_consent_at: new Date(),
          password: hashedPassword,
          role: 'user',
          status: 'pending',
        });
      } catch (error) {
        if (isUniqueViolationError(error)) {
          return sendErrorResponse(res, 400, await resolveRegistrationConflict(normalizedName, normalizedEmail));
        }

        throw error;
      }

      void notifyAdminsAboutRegistration(user);

      return res.status(201).json({
        success: true,
        message: 'Регистрация в репозитории завершена. Дождитесь подтверждения администратора перед входом в систему.',
        user: formatRepositoryUser(user),
      });
    } catch (error) {
      console.error('Repository register error:', error);
      return sendErrorResponse(res, 500, { message: 'Ошибка при регистрации в репозитории' });
    }
  }

    /* Делает: Выполняет вход. Применение: используется внутри класса RepositoryAuthController. */
  static async login(req, res) {
    try {
      const { login, password } = req.body;
      const user = await RepositoryUserModel.findByLogin(login);

      if (!user || !(await bcrypt.compare(password, user.password))) {
        return sendErrorResponse(res, 400, {
          message: 'Неверный логин или пароль',
        });
      }

      if (user.status !== 'active') {
        return sendErrorResponse(res, 403, {
          message: 'Аккаунт репозитория еще не активирован. Дождитесь выдачи роли editor администратором.',
        });
      }

      const token = signRepositoryToken(user);
      return res.json({
        success: true,
        message: 'Вход в репозиторий выполнен',
        token,
        user: formatRepositoryUser(user),
      });
    } catch (error) {
      console.error('Repository login error:', error);
      return sendErrorResponse(res, 500, { message: 'Ошибка входа в репозиторий' });
    }
  }

    /* Делает: Получает профиль. Применение: используется внутри класса RepositoryAuthController. */
  static async getProfile(req, res) {
    return res.json({ user: formatRepositoryUser(req.repositoryUser) });
  }

    /* Делает: Выполняет request profile update. Применение: используется внутри класса RepositoryAuthController. */
  static async requestProfileUpdate(req, res) {
    try {
      const { fullName, email, organizationId, position } = req.body;
      const fieldErrors = {};
      const normalizedFullName = String(fullName || '').trim();
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const normalizedPosition = String(position || '').trim();
      const normalizedOrganizationId = Number(organizationId) || null;

      if (!normalizedFullName || !/^[А-ЯЁа-яё\s-]+$/.test(normalizedFullName)) {
        fieldErrors.fullName = 'ФИО должно содержать только русские буквы, пробелы и дефис';
      } else if (normalizedFullName.split(/\s+/).length < 3) {
        fieldErrors.fullName = 'Введите Фамилию, Имя и Отчество';
      }

      if (!normalizedEmail || !emailPattern.test(normalizedEmail)) {
        fieldErrors.email = 'Укажите корректный email';
      }

      if (!normalizedOrganizationId) {
        fieldErrors.organizationId = 'Выберите организацию из списка';
      }

      if (!normalizedPosition || normalizedPosition.length < 2) {
        fieldErrors.position = 'Укажите должность не короче 2 символов';
      }

      if (Object.keys(fieldErrors).length > 0) {
        return sendErrorResponse(res, 400, { fieldErrors });
      }

      const [user, referenceOrganization] = await Promise.all([
        RepositoryUserModel.findById(req.repositoryUser.id),
        RepositoryReferenceModel.findOrganizationById(normalizedOrganizationId),
      ]);

      if (!user) {
        return sendErrorResponse(res, 404, { message: 'Пользователь репозитория не найден' });
      }

      if (!referenceOrganization || referenceOrganization.status === 'rejected') {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            organizationId: 'Выберите организацию из списка',
          },
        });
      }

      const existingByEmail = await RepositoryUserModel.findByEmail(normalizedEmail);
      if (existingByEmail && Number(existingByEmail.id) !== Number(user.id)) {
        return sendErrorResponse(res, 409, {
          fieldErrors: {
            email: 'Пользователь с таким email уже существует',
          },
        });
      }

      const requestedChanges = {};
      if (!isSameTextValue(normalizedFullName, user.full_name)) {
        requestedChanges.full_name = normalizedFullName;
      }
      if (!isSameTextValue(normalizedEmail, user.email)) {
        requestedChanges.email = normalizedEmail;
      }
      if (Number(user.organization_id || 0) !== normalizedOrganizationId) {
        requestedChanges.organization_id = referenceOrganization.id;
        requestedChanges.organization = referenceOrganization.name_ru;
      }
      if (!isSameTextValue(normalizedPosition, user.position)) {
        requestedChanges.position = normalizedPosition;
      }

      if (Object.keys(requestedChanges).length === 0) {
        return sendErrorResponse(res, 400, { message: 'Измените хотя бы одно поле перед отправкой заявки' });
      }

      const request = await RepositoryUserModel.createProfileUpdateRequest(user.id, requestedChanges);
      void notifyAdminsAboutProfileUpdateRequest(user, requestedChanges);
      void notifyUserAboutProfileUpdateReceived(user, requestedChanges);

      return res.status(201).json({
        success: true,
        message: 'Заявка на изменение параметров отправлена администратору.',
        request,
      });
    } catch (error) {
      console.error('Repository profile update request error:', error);
      return sendErrorResponse(res, error.httpStatus || 500, {
        message: error.message || 'Ошибка при отправке заявки на изменение параметров',
      });
    }
  }

    /* Делает: Выполняет пароль change. Применение: используется внутри класса RepositoryAuthController. */
  static async changePassword(req, res) {
    try {
      const { oldPassword, newPassword, confirmNewPassword } = req.body;
      const fieldErrors = {};

      if (!oldPassword) {
        fieldErrors.oldPassword = 'Введите старый пароль';
      }

      const pwdErr = validatePasswordStrength(newPassword);
      if (pwdErr !== true) {
        fieldErrors.newPassword = pwdErr;
      }

      if (newPassword !== confirmNewPassword) {
        fieldErrors.confirmNewPassword = 'Пароли не совпадают';
      }

      if (Object.keys(fieldErrors).length > 0) {
        return sendErrorResponse(res, 400, { fieldErrors });
      }

      const user = await RepositoryUserModel.findById(req.repositoryUser.id);
      if (!user) {
        return sendErrorResponse(res, 404, { message: 'Пользователь репозитория не найден' });
      }

      const oldPasswordMatches = await bcrypt.compare(oldPassword, user.password);
      if (!oldPasswordMatches) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            oldPassword: 'Старый пароль указан неверно',
          },
        });
      }

      const newPasswordMatchesCurrent = await bcrypt.compare(newPassword, user.password);
      if (newPasswordMatchesCurrent) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            newPassword: 'Новый пароль должен отличаться от старого',
          },
        });
      }

      const retryAfterSeconds = getPasswordChangeRetryAfterSeconds(user.password_changed_at);
      if (retryAfterSeconds) {
        return sendErrorResponse(res, 429, {
          message: 'Сменить пароль можно не чаще одного раза в сутки',
          retryAfterSeconds,
        });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await authPool.query(
        `UPDATE RepositoryUsers
         SET password = $1,
             password_changed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [hashedPassword, user.id]
      );

      return res.json({ success: true, message: 'Пароль репозитория успешно изменен' });
    } catch (error) {
      console.error('Repository cabinet change password error:', error);
      return sendErrorResponse(res, 500, { message: 'Ошибка при смене пароля репозитория' });
    }
  }

    /* Делает: Выполняет пароль forgot. Применение: используется внутри класса RepositoryAuthController. */
  static async forgotPassword(req, res) {
    try {
      const { email } = req.body;
      if (!email) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            email: 'Введите email',
          },
        });
      }

      if (!emailPattern.test(String(email).trim())) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            email: 'Укажите корректный email',
          },
        });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = await RepositoryUserModel.findByEmail(normalizedEmail);

      if (!user) {
        return res.json({
          success: true,
          message: 'Если почта зарегистрирована в репозитории, инструкции будут отправлены',
        });
      }

      if (user.status !== 'active') {
        return sendErrorResponse(res, 403, {
          message: 'Аккаунт репозитория еще не активирован администратором',
        });
      }

      if (await RepositoryPasswordResetTokenModel.hasActiveToken(user.id)) {
        return sendErrorResponse(res, 429, {
          message: 'Запрос уже отправлен. Проверьте почту или попробуйте позже.',
        });
      }

      const resetToken = await RepositoryPasswordResetTokenModel.create(user.id);
      const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const resetLink = `${frontendBaseUrl}/repository/reset-password?token=${encodeURIComponent(resetToken.token)}`;

      try {
        const emailService = await getEmailService();
        await emailService.sendPasswordResetEmail(user.email, user.full_name || user.name, resetLink);
      } catch (emailError) {
        await RepositoryPasswordResetTokenModel.markAsUsed(resetToken.token);
        console.error('Repository forgot password email error:', emailError);
        return sendErrorResponse(res, 500, { message: 'Не удалось отправить письмо' });
      }

      return res.json({
        success: true,
        message: 'Инструкции по восстановлению пароля отправлены на email',
      });
    } catch (error) {
      console.error('Repository forgot password error:', error);
      return sendErrorResponse(res, 500, { message: 'Ошибка при восстановлении пароля репозитория' });
    }
  }

    /* Делает: Проверяет токен сброса. Применение: используется внутри класса RepositoryAuthController. */
  static async verifyResetToken(req, res) {
    try {
      const { token } = req.query;
      if (!token) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            token: 'Токен обязателен',
          },
        });
      }

      const resetToken = await RepositoryPasswordResetTokenModel.findByToken(token);
      if (!resetToken) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            token: 'Неверная или устаревшая ссылка',
          },
        });
      }

      return res.json({
        success: true,
        message: 'Токен действителен',
        email: resetToken.email,
      });
    } catch (error) {
      console.error('Repository verify reset token error:', error);
      return sendErrorResponse(res, 500, { message: 'Ошибка проверки токена' });
    }
  }

    /* Делает: Выполняет пароль сброса. Применение: используется внутри класса RepositoryAuthController. */
  static async resetPassword(req, res) {
    const client = await authPool.connect();
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return sendErrorResponse(res, 400, {
          message: 'Токен и новый пароль обязательны',
          fieldErrors: {
            ...(token ? {} : { token: 'Токен обязателен' }),
            ...(newPassword ? {} : { newPassword: 'Введите новый пароль' }),
          },
        });
      }

      const pwdErr = validatePasswordStrength(newPassword);
      if (pwdErr !== true) {
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            newPassword: pwdErr,
          },
        });
      }

      await client.query('BEGIN');
      const tokenResult = await client.query(
        `SELECT id, repository_user_id
         FROM RepositoryPasswordResetTokens
         WHERE token = $1 AND used = false AND expires_at > NOW()
         FOR UPDATE`,
        [token]
      );

      const tokenRow = tokenResult.rows[0];
      if (!tokenRow) {
        await client.query('ROLLBACK');
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            token: 'Неверная или устаревшая ссылка',
          },
        });
      }

      const userResult = await client.query(
        `SELECT password, password_changed_at
         FROM RepositoryUsers
         WHERE id = $1
         FOR UPDATE`,
        [tokenRow.repository_user_id]
      );
      const userRow = userResult.rows[0];

      if (userRow?.password && await bcrypt.compare(newPassword, userRow.password)) {
        await client.query('ROLLBACK');
        return sendErrorResponse(res, 400, {
          fieldErrors: {
            newPassword: 'Новый пароль должен отличаться от старого',
          },
        });
      }

      const retryAfterSeconds = getPasswordChangeRetryAfterSeconds(userRow?.password_changed_at);
      if (retryAfterSeconds) {
        await client.query('ROLLBACK');
        return sendErrorResponse(res, 429, {
          message: 'Сменить пароль можно не чаще одного раза в сутки',
          retryAfterSeconds,
        });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await client.query('UPDATE RepositoryUsers SET password = $1, password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
        hashedPassword,
        tokenRow.repository_user_id,
      ]);
      await client.query('UPDATE RepositoryPasswordResetTokens SET used = true WHERE id = $1', [tokenRow.id]);
      await client.query('COMMIT');

      return res.json({ success: true, message: 'Пароль репозитория успешно изменен' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Repository reset password error:', error);
      return sendErrorResponse(res, 500, { message: 'Ошибка при смене пароля репозитория' });
    } finally {
      client.release();
    }
  }
}
