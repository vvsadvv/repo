import { createTransport, createTestAccount, getTestMessageUrl } from 'nodemailer';

class EmailService {
    /* Делает: Инициализирует экземпляр EmailService и подготавливает его начальное состояние. Применение: вызывается при создании экземпляра класса EmailService в этом модуле. */
  constructor() {
    this.transporter = null;
    this.isInitialized = false;
    this.initializationPromise = null;
    this.fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@localhost';
    this.fromName = process.env.SMTP_FROM_NAME || 'Репозиторий ФИЦ ЕГС РАС';
  }

    /* Делает: Выполняет reset transport state. Применение: используется внутри класса EmailService. */
  resetTransportState() {
    this.transporter = null;
    this.isInitialized = false;
  }

    /* Делает: Получает transport timeouts. Применение: используется внутри класса EmailService. */
  getTransportTimeouts() {
    return {
      connectionTimeout: parseInt(process.env.SMTP_CONNECTION_TIMEOUT || '10000', 10),
      greetingTimeout: parseInt(process.env.SMTP_GREETING_TIMEOUT || '10000', 10),
      socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT || '20000', 10),
      dnsTimeout: parseInt(process.env.SMTP_DNS_TIMEOUT || '10000', 10),
      operationTimeout: parseInt(process.env.SMTP_OPERATION_TIMEOUT || '25000', 10),
    };
  }

    /* Делает: Получает configured proxy. Применение: используется внутри класса EmailService. */
  getConfiguredProxy() {
    const proxyValue = String(process.env.SMTP_PROXY || '').trim();
    if (!proxyValue) {
      return '';
    }

    return proxyValue.replace(/^socks5h:\/\//i, 'socks5://');
  }

    /* Делает: Выполняет configure proxy support if needed. Применение: используется внутри класса EmailService. */
  async configureProxySupportIfNeeded(transporter, config) {
    const proxyUrl = String(config?.proxy || '').trim();
    if (!proxyUrl || !/^socks/i.test(proxyUrl)) {
      return;
    }

    try {
      const socksModule = await import('socks');
      transporter.set('proxy_socks_module', socksModule.default || socksModule);
    } catch (error) {
      const reason = error?.message || String(error);
      throw new Error(
        `SMTP proxy ${proxyUrl} требует пакет "socks". Установите его командой "npm i socks". Причина: ${reason}`
      );
    }
  }

    /* Делает: Выполняет with timeout. Применение: используется внутри класса EmailService. */
  withTimeout(operation, timeoutMs, label) {
    const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 25000;
    const execute = typeof operation === 'function' ? operation : /* Делает: Выполняет локальный callback в текущем месте модуля. Применение: используется локально внутри withTimeout. */ () => operation;

    return new Promise(/* Делает: Выполняет локальный callback в текущем месте модуля. Применение: используется локально внутри withTimeout. */ (resolve, reject) => {
      const timer = setTimeout(/* Делает: Запускает отложенное действие по таймеру. Применение: передаётся как callback в setTimeout внутри callback. */ () => {
        reject(new Error(`${label} (timeout ${duration}ms)`));
      }, duration);

      Promise.resolve()
        .then(execute)
        .then(
          /* Делает: Обрабатывает успешный результат предыдущего промиса. Применение: передаётся как callback в then внутри callback. */ (result) => {
            clearTimeout(timer);
            resolve(result);
          },
          /* Делает: Обрабатывает успешный результат предыдущего промиса. Применение: передаётся как callback в then внутри callback. */ (error) => {
            clearTimeout(timer);
            reject(error);
          }
        );
    });
  }

    /* Делает: Получает header from. Применение: используется внутри класса EmailService. */
  getFromHeader() {
    if (String(this.fromAddress).includes('<') && String(this.fromAddress).includes('>')) {
      return this.fromAddress;
    }

    return `\"${this.fromName}\" <${this.fromAddress}>`;
  }

    /* Делает: Собирает smtp configs. Применение: используется внутри класса EmailService. */
  buildSmtpConfigs() {
    const host = process.env.SMTP_HOST;
    const basePort = parseInt(process.env.SMTP_PORT || '587', 10);
    const baseSecure = process.env.SMTP_SECURE === 'true';
    const proxy = this.getConfiguredProxy();
    const auth = {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    };

    const baseConfig = {
      host,
      port: basePort,
      secure: baseSecure,
      auth,
      tls: {
        rejectUnauthorized: false,
      },
      ...this.getTransportTimeouts(),
    };

    if (proxy) {
      baseConfig.proxy = proxy;
    }

    const configs = [baseConfig];
    const fallbackEnabled = process.env.SMTP_FALLBACK_ENABLED !== 'false';
    if (!fallbackEnabled) {
      return configs;
    }

    if (basePort === 465) {
      configs.push({
        ...baseConfig,
        port: 587,
        secure: false,
        requireTLS: true,
      });
    } else if (basePort === 587) {
      configs.push({
        ...baseConfig,
        port: 465,
        secure: true,
        requireTLS: false,
      });
    }

    return configs;
  }

    /* Делает: Определяет, нужно ли retry with reconnect. Применение: используется внутри класса EmailService. */
  shouldRetryWithReconnect(error) {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toLowerCase();
    const reconnectCodes = new Set([
      'ETIMEDOUT',
      'ESOCKET',
      'ECONNECTION',
      'ECONNRESET',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENOTFOUND',
      'EPIPE',
      'EAI_AGAIN',
    ]);

    if (reconnectCodes.has(code)) {
      return true;
    }

    return (
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('socket') ||
      message.includes('greeting')
    );
  }

    /* Делает: Гарантирует initialized. Применение: используется внутри класса EmailService. */
  async ensureInitialized({ force = false } = {}) {
    if (!force && this.isInitialized && this.transporter) {
      return;
    }

    if (!this.initializationPromise) {
      if (force) {
        this.resetTransportState();
      }

      this.initializationPromise = this.initialize().finally(/* Делает: Выполняет завершающее действие после промиса. Применение: передаётся как callback в finally внутри ensureInitialized. */ () => {
        this.initializationPromise = null;
      });
    }

    await this.initializationPromise;
  }

    /* Делает: Выполняет initialize. Применение: используется внутри класса EmailService. */
  async initialize() {
    try {
      this.resetTransportState();

      if (process.env.SMTP_HOST) {
        console.log('Инициализация продакшн SMTP...');
        const configs = this.buildSmtpConfigs();
        const errors = [];

        for (const config of configs) {
          try {
            const transporter = createTransport(config);
            await this.configureProxySupportIfNeeded(transporter, config);
            await this.withTimeout(
              /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в withTimeout внутри initialize. */ () => transporter.verify(),
              this.getTransportTimeouts().operationTimeout,
              'Проверка SMTP-соединения не завершилась вовремя'
            );
            this.transporter = transporter;
            this.isInitialized = true;
            this.fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || this.fromAddress;
            console.log(`Email сервис успешно инициализирован (${config.host}:${config.port}, secure=${config.secure})`);
            return;
          } catch (error) {
            const message = error?.message || String(error);
            errors.push(`${config.host}:${config.port} secure=${config.secure} -> ${message}`);
          }
        }

        throw new Error(`Не удалось подключиться к SMTP. Попытки: ${errors.join(' | ')}`);
      }

      console.log('Инициализация тестового email (Ethereal)...');
      const testAccount = await this.withTimeout(
        /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в withTimeout внутри initialize. */ () => createTestAccount(),
        this.getTransportTimeouts().operationTimeout,
        'Создание тестового email аккаунта не завершилось вовремя'
      );
      const transporterConfig = {
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
        ...this.getTransportTimeouts(),
      };

      this.transporter = createTransport(transporterConfig);
      await this.withTimeout(
        /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в withTimeout внутри initialize. */ () => this.transporter.verify(),
        this.getTransportTimeouts().operationTimeout,
        'Проверка тестового SMTP-соединения не завершилась вовремя'
      );
      this.isInitialized = true;
      this.fromAddress = testAccount.user;

      console.log('Тестовый аккаунт:');
      console.log(`   Email: ${testAccount.user}`);
      console.log(`   Pass: ${testAccount.pass}`);
      console.log('   Веб: https://ethereal.email');
      console.log('Email сервис успешно инициализирован');
    } catch (error) {
      console.error('Ошибка инициализации email сервиса:', error?.message || error);
      throw error;
    }
  }

    /* Делает: Выполняет send mail. Применение: используется внутри класса EmailService. */
  async sendMail(options) {
    await this.ensureInitialized();

        /* Делает: Выполняет send with current transport. Применение: используется внутри функции sendMail. */
    const sendWithCurrentTransport = async () =>
      this.withTimeout(
        /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в withTimeout внутри sendWithCurrentTransport. */ () =>
          this.transporter.sendMail({
            from: this.getFromHeader(),
            ...options,
          }),
        this.getTransportTimeouts().operationTimeout,
        'Отправка email не завершилась вовремя'
      );

    let info;
    try {
      info = await sendWithCurrentTransport();
    } catch (error) {
      if (!this.shouldRetryWithReconnect(error)) {
        throw error;
      }

      console.warn(
        `SMTP отправка завершилась ошибкой (${error?.code || 'UNKNOWN'}). Повторная инициализация и повтор отправки...`
      );
      await this.ensureInitialized({ force: true });
      info = await sendWithCurrentTransport();
    }

    const previewUrl = getTestMessageUrl(info);
    if (previewUrl) {
      console.log('Предпросмотр (Ethereal):', previewUrl);
    }

    return {
      success: true,
      messageId: info.messageId,
      previewUrl: previewUrl || null,
    };
  }

    /* Делает: Собирает message template. Применение: используется внутри класса EmailService. */
  buildMessageTemplate({ title, message, details = [], actionLabel = '', actionUrl = '' }) {
    const detailsHtml = details.length
      ? `<ul style=\"padding-left:18px; color:#4b5b73;\">${details.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри buildMessageTemplate. */ (item) => `<li>${item}</li>`).join('')}</ul>`
      : '';
    const actionHtml = actionLabel && actionUrl
      ? `<div style=\"margin:24px 0; text-align:center;\"><a href=\"${actionUrl}\" style=\"display:inline-block; background:#1f5fa4; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:600;\">${actionLabel}</a></div>`
      : '';

    return `
      <!DOCTYPE html>
      <html lang="ru">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${title}</title>
      </head>
      <body style="margin:0; padding:24px; background:#eef3f9; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color:#1f2f46;">
        <div style="max-width:640px; margin:0 auto; background:#fff; border-radius:18px; overflow:hidden; box-shadow:0 16px 36px rgba(28,56,94,0.14);">
          <div style="background:#1f5fa4; color:#fff; padding:24px 28px;">
            <h1 style="margin:0; font-size:24px;">${title}</h1>
          </div>
          <div style="padding:28px; line-height:1.6; font-size:16px;">
            <p style="margin-top:0;">${message}</p>
            ${detailsHtml}
            ${actionHtml}
            <p style="margin-bottom:0; color:#66768f; font-size:14px;">Это автоматическое сообщение. Отвечать на него не требуется.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

    /* Делает: Выполняет email send пароля сброса. Применение: используется внутри класса EmailService. */
  async sendPasswordResetEmail(userEmail, userName, resetLink) {
    return this.sendMail({
      to: userEmail,
      subject: 'Восстановление пароля — Репозиторий ФИЦ ЕГС РАС',
      html: this.buildMessageTemplate({
        title: 'Восстановление пароля',
        message: `Здравствуйте, ${userName}! Вы запросили восстановление пароля для аккаунта репозитория.`,
        details: ['Ссылка действительна в течение 1 часа.'],
        actionLabel: 'Сменить пароль',
        actionUrl: resetLink,
      }),
    });
  }

    /* Делает: Выполняет send repository admin notification. Применение: используется внутри класса EmailService. */
  async sendRepositoryAdminNotification({ to, subject, title, message, details = [], actionLabel = '', actionUrl = '' }) {
    return this.sendMail({
      to,
      subject,
      html: this.buildMessageTemplate({ title, message, details, actionLabel, actionUrl }),
    });
  }

    /* Делает: Выполняет send repository user notification. Применение: используется внутри класса EmailService. */
  async sendRepositoryUserNotification({ to, subject, title, message, details = [], actionLabel = '', actionUrl = '' }) {
    return this.sendMail({
      to,
      subject,
      html: this.buildMessageTemplate({ title, message, details, actionLabel, actionUrl }),
    });
  }
}

let emailServiceInstance = null;

/* Делает: Получает сервис email. Применение: используется локально в файле backend/services/emailService.js. */
export const getEmailService = async () => {
  if (!emailServiceInstance) {
    emailServiceInstance = new EmailService();
  }

  await emailServiceInstance.ensureInitialized();
  return emailServiceInstance;
};
