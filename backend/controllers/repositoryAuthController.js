import bcrypt from 'bcryptjs';
import { getEmailService } from '../services/emailService.js';
import { authPool } from '../models/authDatabase.js';
import { RepositoryUserModel } from '../models/RepositoryUser.js';
import { RepositoryPasswordResetTokenModel } from '../models/RepositoryPasswordResetToken.js';
import { RepositoryReferenceModel } from '../models/RepositoryReference.js';
import { signRepositoryToken } from '../middleware/repositoryAuthMiddleware.js';

const defaultOrganization = process.env.REPOSITORY_DEFAULT_ORGANIZATION || 'ФИЦ ЕГС РАН';

const validatePasswordStrength = (password) => {
  if (!password) return 'Пароль обязателен';
  if (password.length < 8) return 'Пароль должен содержать минимум 8 символов';
  if (!/[A-Z]/.test(password)) return 'Пароль должен содержать заглавную букву';
  if (!/[a-z]/.test(password)) return 'Пароль должен содержать строчную букву';
  if (!/\d/.test(password)) return 'Пароль должен содержать цифру';
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]/.test(password)) return 'Пароль должен содержать спецсимвол';
  return true;
};

function formatRepositoryUser(user) {
  return {
    id: user.id,
    name: user.name,
    full_name: user.full_name,
    email: user.email,
    organization: user.organization,
    position: user.position,
    role: user.role,
    status: user.status,
    created_at: user.created_at,
    approved_at: user.approved_at,
    approver_name: user.approver_full_name || user.approver_name,
  };
}

function getUniqueActiveAdminRecipients(admins = []) {
  const seen = new Set();
  return admins.filter((admin) => {
    const email = String(admin?.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) {
      return false;
    }

    seen.add(email);
    return true;
  });
}

async function notifyAdminsAboutRegistration(user) {
  try {
    const adminRecipients = getUniqueActiveAdminRecipients(await RepositoryUserModel.findActiveAdmins());
    if (adminRecipients.length === 0) {
      console.warn(`Repository registration notification skipped: no active admins for user ${user.email}`);
      return;
    }

    const emailService = await getEmailService();
    const results = await Promise.allSettled(
      adminRecipients.map((admin) =>
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

    const failedCount = results.reduce((count, result, index) => {
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

export class RepositoryAuthController {
  static async register(req, res) {
    try {
      const { name, fullName, email, organization, organizationId, position, password, confirmPassword } = req.body;

      if (!name || name.trim().length < 2 || !/^[a-zA-Z0-9_]+$/.test(name)) {
        return res.status(400).json({ success: false, message: 'Имя: минимум 2 символа, только латиница, цифры, _' });
      }
      if (!fullName || !/^[А-ЯЁа-яё\s-]+$/.test(fullName.trim())) {
        return res.status(400).json({ success: false, message: 'ФИО: только русские буквы, пробелы и дефис' });
      }
      if (fullName.trim().split(/\s+/).length < 3) {
        return res.status(400).json({ success: false, message: 'Введите Фамилию, Имя и Отчество' });
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, message: 'Некорректный email' });
      }
      if (!organizationId && (!organization || organization.trim().length < 2)) {
        return res.status(400).json({ success: false, message: 'Организация: минимум 2 символа' });
      }
      if (!position || position.trim().length < 2) {
        return res.status(400).json({ success: false, message: 'Должность: минимум 2 символа' });
      }
      if (password !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'Пароли не совпадают' });
      }

      const pwdErr = validatePasswordStrength(password);
      if (pwdErr !== true) {
        return res.status(400).json({ success: false, message: pwdErr });
      }

      const normalizedName = name.trim();
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedPosition = position.trim();
      const normalizedFullName = fullName.trim();
      let normalizedOrganization = organization?.trim() || defaultOrganization;

      if (organizationId) {
        const approvedOrganization = await RepositoryReferenceModel.findOrganizationById(Number(organizationId));
        if (!approvedOrganization || approvedOrganization.status !== 'approved') {
          return res.status(400).json({ success: false, message: 'Выберите организацию из списка' });
        }

        normalizedOrganization = approvedOrganization.name_ru;
      }

      const [existingByName, existingByEmail] = await Promise.all([
        RepositoryUserModel.findByName(normalizedName),
        RepositoryUserModel.findByEmail(normalizedEmail),
      ]);

      if (existingByName) {
        return res.status(400).json({ success: false, message: 'Пользователь репозитория с таким именем уже существует' });
      }
      if (existingByEmail) {
        return res.status(400).json({ success: false, message: 'Пользователь репозитория с такой почтой уже существует' });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const user = await RepositoryUserModel.create({
        name: normalizedName,
        full_name: normalizedFullName,
        email: normalizedEmail,
        organization: normalizedOrganization,
        position: normalizedPosition,
        password: hashedPassword,
        role: 'user',
        status: 'active',
      });

      void notifyAdminsAboutRegistration(user);

      return res.status(201).json({
        success: true,
        message: 'Регистрация в репозитории завершена. Теперь вы можете войти в систему.',
        user: formatRepositoryUser(user),
      });
    } catch (error) {
      console.error('Repository register error:', error);
      return res.status(500).json({ success: false, message: 'Ошибка при регистрации в репозитории' });
    }
  }

  static async login(req, res) {
    try {
      const { login, password } = req.body;
      const user = await RepositoryUserModel.findByLogin(login);

      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ success: false, message: 'Неверный логин или пароль' });
      }

      if (user.status !== 'active') {
        return res.status(403).json({
          success: false,
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
      return res.status(500).json({ success: false, message: 'Ошибка входа в репозиторий' });
    }
  }

  static async getProfile(req, res) {
    return res.json({ user: formatRepositoryUser(req.repositoryUser) });
  }

  static async forgotPassword(req, res) {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ success: false, message: 'Email обязателен' });
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
        return res.status(403).json({
          success: false,
          message: 'Аккаунт репозитория еще не активирован администратором',
        });
      }

      if (await RepositoryPasswordResetTokenModel.hasActiveToken(user.id)) {
        return res.status(429).json({
          success: false,
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
        return res.status(500).json({ success: false, message: 'Не удалось отправить письмо' });
      }

      return res.json({
        success: true,
        message: 'Инструкции по восстановлению пароля отправлены на email',
      });
    } catch (error) {
      console.error('Repository forgot password error:', error);
      return res.status(500).json({ success: false, message: 'Ошибка при восстановлении пароля репозитория' });
    }
  }

  static async verifyResetToken(req, res) {
    try {
      const { token } = req.query;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Токен обязателен' });
      }

      const resetToken = await RepositoryPasswordResetTokenModel.findByToken(token);
      if (!resetToken) {
        return res.status(400).json({ success: false, message: 'Неверная или устаревшая ссылка' });
      }

      return res.json({
        success: true,
        message: 'Токен действителен',
        email: resetToken.email,
      });
    } catch (error) {
      console.error('Repository verify reset token error:', error);
      return res.status(500).json({ success: false, message: 'Ошибка проверки токена' });
    }
  }

  static async resetPassword(req, res) {
    const client = await authPool.connect();
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({ success: false, message: 'Токен и новый пароль обязательны' });
      }

      const pwdErr = validatePasswordStrength(newPassword);
      if (pwdErr !== true) {
        return res.status(400).json({ success: false, message: pwdErr });
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
        return res.status(400).json({ success: false, message: 'Неверная или устаревшая ссылка' });
      }

      const userResult = await client.query(
        `SELECT password_changed_at
         FROM RepositoryUsers
         WHERE id = $1
         FOR UPDATE`,
        [tokenRow.repository_user_id]
      );
      const userRow = userResult.rows[0];
      const lastPasswordChange = userRow?.password_changed_at ? new Date(userRow.password_changed_at).getTime() : null;
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;

      if (lastPasswordChange && now - lastPasswordChange < oneDayMs) {
        const retryAfterSeconds = Math.ceil((oneDayMs - (now - lastPasswordChange)) / 1000);
        await client.query('ROLLBACK');
        return res.status(429).json({
          success: false,
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
      return res.status(500).json({ success: false, message: 'Ошибка при смене пароля репозитория' });
    } finally {
      client.release();
    }
  }
}
