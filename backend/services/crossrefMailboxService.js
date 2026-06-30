import net from 'net';
import tls from 'tls';
import { repositoryPool } from '../models/repositoryDatabase.js';
import { repositoryService } from './repositoryService.js';

const DEFAULT_POP3_HOST = 'pop3.obn.gsras.ru';
const DEFAULT_POP3_USER = 'skleminos';
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_POP3_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_MESSAGES_PER_POLL = 20;
const DEFAULT_POP3_MESSAGE_RETENTION_DAYS = 14;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

/* Делает: Разбирает positive integer env. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function parsePositiveIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/* Делает: Получает crossref mailbox config. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function getCrossrefMailboxConfig() {
  const host = String(process.env.CROSSREF_POP3_HOST || DEFAULT_POP3_HOST).trim();
  const secure = process.env.CROSSREF_POP3_SECURE === 'true';
  const port = parsePositiveIntegerEnv(
    process.env.CROSSREF_POP3_PORT,
    110
  );
  const user = String(
    process.env.CROSSREF_POP3_USER ||
    process.env.REPOSITORY_DOI_DEPOSITOR_EMAIL ||
    DEFAULT_POP3_USER
  ).trim();
  const password = String(process.env.CROSSREF_POP3_PASSWORD || '').trim();

  return {
    enabled: process.env.CROSSREF_POP3_ENABLED !== 'false',
    host,
    port,
    secure,
    user,
    password,
    pollIntervalMs: parsePositiveIntegerEnv(
      process.env.CROSSREF_POP3_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS
    ),
    timeoutMs: parsePositiveIntegerEnv(
      process.env.CROSSREF_POP3_TIMEOUT_MS,
      DEFAULT_POP3_TIMEOUT_MS
    ),
    skipExistingOnStart: process.env.CROSSREF_POP3_SKIP_EXISTING_ON_START !== 'false',
    maxMessagesPerPoll: parsePositiveIntegerEnv(
      process.env.CROSSREF_POP3_MAX_MESSAGES_PER_POLL,
      DEFAULT_MAX_MESSAGES_PER_POLL
    ),
    deleteProcessed: process.env.CROSSREF_POP3_DELETE_PROCESSED === 'true',
    messageRetentionDays: parsePositiveIntegerEnv(
      process.env.CROSSREF_POP3_DELETE_OLDER_THAN_DAYS,
      DEFAULT_POP3_MESSAGE_RETENTION_DAYS
    ),
  };
}

/* Делает: Собирает connection candidates. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function buildConnectionCandidates(config) {
  const candidates = [
    { host: config.host, port: config.port, secure: config.secure, timeoutMs: config.timeoutMs },
  ];

  if (config.secure && config.port === 995) {
    candidates.push({ host: config.host, port: 110, secure: false, timeoutMs: config.timeoutMs });
  } else if (!config.secure && config.port === 110) {
    candidates.push({ host: config.host, port: 995, secure: true, timeoutMs: config.timeoutMs });
  }

  return candidates.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри buildConnectionCandidates. */ (candidate, index, list) =>
    list.findIndex(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в findIndex внутри filterCallback. */ (item) =>
      item.host === candidate.host &&
      item.port === candidate.port &&
      item.secure === candidate.secure
    ) === index
  );
}

/* Делает: Собирает mailbox actor. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function buildMailboxActor(config) {
  return {
    id: 'crossref-pop3-watcher',
    role: 'admin',
    name: 'Crossref POP3 watcher',
    fullName: 'Crossref POP3 watcher',
    email: config.user || DEFAULT_POP3_USER,
  };
}

/* Делает: Маскирует чувствительные POP3 команды в логах ошибок. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function redactPop3Command(command = '') {
  const normalized = String(command || '').trim();
  if (!normalized) {
    return '';
  }

  if (/^PASS\s+/i.test(normalized)) {
    return 'PASS [REDACTED]';
  }

  return normalized;
}

/* Делает: Разделяет headers and body. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function splitHeadersAndBody(rawMessage = '') {
  const normalized = String(rawMessage || '');
  const separatorIndex = normalized.search(/\r?\n\r?\n/);
  if (separatorIndex === -1) {
    return { headerText: normalized, bodyText: '' };
  }

  const separator = normalized.slice(separatorIndex).match(/^\r?\n\r?\n/)?.[0] || '\r\n\r\n';
  return {
    headerText: normalized.slice(0, separatorIndex),
    bodyText: normalized.slice(separatorIndex + separator.length),
  };
}

/* Делает: Разбирает mail headers. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function parseMailHeaders(headerText = '') {
  const lines = String(headerText || '').split(/\r?\n/);
  const headers = {};
  let currentKey = '';

  for (const line of lines) {
    if (/^\s/.test(line) && currentKey) {
      headers[currentKey] = `${headers[currentKey]} ${line.trim()}`.trim();
      continue;
    }

    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    currentKey = line.slice(0, separatorIndex).trim().toLowerCase();
    headers[currentKey] = line.slice(separatorIndex + 1).trim();
  }

  return headers;
}

/* Делает: Выполняет strip optional quotes. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function stripOptionalQuotes(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1);
  }

  return normalized;
}

/* Делает: Разбирает header контентного типа. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function parseContentTypeHeader(value = '') {
  const segments = String(value || '').split(';');
  const type = String(segments.shift() || 'text/plain').trim().toLowerCase();
  const params = {};

  for (const segment of segments) {
    const separatorIndex = segment.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = segment.slice(0, separatorIndex).trim().toLowerCase();
    const rawValue = segment.slice(separatorIndex + 1).trim();
    params[key] = stripOptionalQuotes(rawValue);
  }

  return { type, params };
}

/* Делает: Декодирует quoted printable bytes. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function decodeQuotedPrintableBytes(value = '') {
  const normalized = String(value || '').replace(/=(\r?\n)/g, '');
  const bytes = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index];
    const hexCandidate = normalized.slice(index + 1, index + 3);
    if (current === '=' && /^[A-Fa-f0-9]{2}$/.test(hexCandidate)) {
      bytes.push(Number.parseInt(hexCandidate, 16));
      index += 2;
      continue;
    }

    bytes.push(current.charCodeAt(0) & 0xff);
  }

  return Uint8Array.from(bytes);
}

/* Делает: Определяет decoder. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function resolveDecoder(charset = 'utf-8') {
  const normalizedCharset = String(charset || 'utf-8').trim().toLowerCase() || 'utf-8';

  try {
    return new TextDecoder(normalizedCharset, { fatal: false });
  } catch {
    return new TextDecoder('utf-8', { fatal: false });
  }
}

/* Делает: Декодирует текст transfer encoded. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function decodeTransferEncodedText(value = '', transferEncoding = '', charset = 'utf-8') {
  const normalizedEncoding = String(transferEncoding || '').trim().toLowerCase();

  try {
    if (normalizedEncoding === 'base64') {
      const bytes = Buffer.from(String(value || '').replace(/\s+/g, ''), 'base64');
      return resolveDecoder(charset).decode(bytes);
    }

    if (normalizedEncoding === 'quoted-printable') {
      return resolveDecoder(charset).decode(decodeQuotedPrintableBytes(value));
    }

    return resolveDecoder(charset).decode(Buffer.from(String(value || ''), 'latin1'));
  } catch {
    return String(value || '');
  }
}

/* Делает: Декодирует значение mime header. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function decodeMimeHeaderValue(value = '') {
  return String(value || '').replace(
    /=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g,
    /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в replace внутри decodeMimeHeaderValue. */ (_, charset, encoding, encodedValue) => {
      const normalizedEncoding = String(encoding || '').toLowerCase();

      if (normalizedEncoding === 'b') {
        return decodeTransferEncodedText(encodedValue, 'base64', charset);
      }

      const quotedPrintableValue = String(encodedValue || '').replace(/_/g, ' ');
      return decodeTransferEncodedText(quotedPrintableValue, 'quoted-printable', charset);
    }
  );
}

/* Делает: Разбирает multipart body. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function parseMultipartBody(bodyText = '', boundary = '') {
  if (!boundary) {
    return [];
  }

  const delimiter = `--${boundary}`;
  return String(bodyText || '')
    .split(delimiter)
    .slice(1)
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри parseMultipartBody. */ (part) => part.replace(/^\r?\n/, ''))
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри parseMultipartBody. */ (part) => part && !part.startsWith('--'))
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри parseMultipartBody. */ (part) => splitHeadersAndBody(part.replace(/\r?\n$/, '')));
}

/* Делает: Извлекает best text from mime entity. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function extractBestTextFromMimeEntity(headerText = '', bodyText = '') {
  const headers = parseMailHeaders(headerText);
  const contentType = parseContentTypeHeader(headers['content-type']);
  const transferEncoding = headers['content-transfer-encoding'] || '';

  if (contentType.type.startsWith('multipart/') && contentType.params.boundary) {
    const textParts = parseMultipartBody(bodyText, contentType.params.boundary)
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри extractBestTextFromMimeEntity. */ (part) => extractBestTextFromMimeEntity(part.headerText, part.bodyText))
      .filter(Boolean);

    return (
      textParts.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри extractBestTextFromMimeEntity. */ (part) => part.includes('<doi_batch_diagnostic')) ||
      textParts.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри extractBestTextFromMimeEntity. */ (part) => part.includes('Successfully added')) ||
      textParts.join('\n\n').trim()
    );
  }

  return decodeTransferEncodedText(bodyText, transferEncoding, contentType.params.charset || 'utf-8');
}

/* Делает: Разбирает email сырого. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function parseRawEmail(rawMessage = '') {
  const { headerText, bodyText } = splitHeadersAndBody(rawMessage);
  const headers = parseMailHeaders(headerText);

  return {
    headers,
    subject: decodeMimeHeaderValue(headers.subject || ''),
    text: extractBestTextFromMimeEntity(headerText, bodyText),
  };
}

/* Делает: Разбирает дату email сообщения. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function parseRawEmailReceivedAt(rawMessage = '') {
  const parsed = parseRawEmail(rawMessage);
  const rawDateHeader = decodeMimeHeaderValue(parsed.headers.date || '');
  const timestamp = Date.parse(String(rawDateHeader || '').trim());

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp);
}

/* Делает: Извлекает payload crossref XML. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function extractCrossrefXmlPayload(text = '') {
  const normalized = String(text || '');
  if (!normalized) {
    return '';
  }

  const startIndex = normalized.search(/<\?xml\b|<doi_batch_diagnostic\b/i);
  const endMatch = normalized.match(/<\/doi_batch_diagnostic>/i);

  if (startIndex === -1 || !endMatch?.index) {
    return '';
  }

  return normalized.slice(startIndex, endMatch.index + endMatch[0].length).trim();
}

/* Делает: Извлекает значение XML tag. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function extractXmlTagValue(text = '', tagName = '') {
  const match = String(text || '').match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'));
  return match ? String(match[1] || '').trim() : '';
}

/* Делает: Разбирает сводку crossref подтверждающего. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function parseCrossrefConfirmationSummary(text = '') {
  return {
    doi: extractXmlTagValue(text, 'doi'),
    submissionId: extractXmlTagValue(text, 'submission_id'),
    batchId: extractXmlTagValue(text, 'batch_id'),
  };
}

/* Делает: Выполняет ошибку classify почтового ящика processing. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function classifyMailboxProcessingError(error) {
  const errorCode = String(error?.code || '').trim();

  if (errorCode === 'DOCUMENT_NOT_FOUND') {
    return {
      status: 'unmatched',
      logLevel: 'info',
    };
  }

  if (errorCode === 'DOCUMENT_ALREADY_VERIFIED') {
    return {
      status: 'already_verified',
      logLevel: 'info',
    };
  }

  if (errorCode === 'DOCUMENT_STATUS_CONFLICT') {
    return {
      status: 'status_conflict',
      logLevel: 'warn',
    };
  }

  return {
    status: 'error',
    logLevel: 'error',
  };
}

/* Делает: Определяет, нужно ли сообщения seed существующего почтового ящика. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function shouldSeedExistingMailboxMessages({
  skipExistingOnStart,
  existingProcessedCount,
  mailboxMessageCount,
}) {
  return Boolean(
    skipExistingOnStart &&
    Number(existingProcessedCount) === 0 &&
    Number(mailboxMessageCount) > 0
  );
}

/* Делает: Проверяет, старше ли письмо заданного retention. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function isMessageOlderThanDays(receivedAt, retentionDays, now = new Date()) {
  if (!(receivedAt instanceof Date) || Number.isNaN(receivedAt.getTime())) {
    return false;
  }

  const retentionMs = Number(retentionDays) * DAY_IN_MS;
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) {
    return false;
  }

  return receivedAt.getTime() < now.getTime() - retentionMs;
}

/* Делает: Проверяет сообщение crossref подтверждающего. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function isCrossrefConfirmationMessage(subject = '', text = '', rawMessage = '') {
  const normalizedSubject = String(subject || '').toLowerCase();
  const normalizedText = String(text || '').toLowerCase();
  const normalizedRaw = String(rawMessage || '').toLowerCase();

  return (
    normalizedSubject.includes('crossref submission id') ||
    normalizedText.includes('<doi_batch_diagnostic') ||
    normalizedRaw.includes('<doi_batch_diagnostic')
  );
}

/* Делает: Извлекает payload crossref подтверждающего. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
function extractCrossrefConfirmationPayload(rawMessage = '') {
  const parsed = parseRawEmail(rawMessage);
  const xmlPayload =
    extractCrossrefXmlPayload(parsed.text) ||
    extractCrossrefXmlPayload(rawMessage);

  return {
    subject: parsed.subject,
    text: parsed.text,
    payload: xmlPayload || parsed.text.trim() || String(rawMessage || '').trim(),
  };
}

class Pop3Client {
    /* Делает: Инициализирует экземпляр Pop3Client и подготавливает его начальное состояние. Применение: вызывается при создании экземпляра класса Pop3Client в этом модуле. */
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.buffer = '';
    this.pending = null;
    this.closed = false;
  }

    /* Делает: Выполняет connect. Применение: используется внутри класса Pop3Client. */
  async connect() {
    if (this.socket) {
      return;
    }

    const socket = await new Promise(/* Делает: Выполняет локальный callback в текущем месте модуля. Применение: используется локально внутри connect. */ (resolve, reject) => {
      let settled = false;
            /* Делает: Выполняет finish. Применение: используется внутри функции callback. */
      const finish = (callback) => /* Делает: Выполняет локальный callback в текущем месте модуля. Применение: используется локально внутри finish. */ (value) => {
        if (settled) {
          return;
        }
        settled = true;
        callback(value);
      };

      const onResolve = finish(resolve);
      const onReject = finish(reject);
      const options = {
        host: this.config.host,
        port: this.config.port,
      };

      const socketInstance = this.config.secure
        ? tls.connect({
            ...options,
            rejectUnauthorized: false,
          }, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в connect внутри callback. */ () => onResolve(socketInstance))
        : net.createConnection(options, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в createConnection внутри callback. */ () => onResolve(socketInstance));

      socketInstance.setTimeout(this.config.timeoutMs);
      socketInstance.on('timeout', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в on внутри callback. */ () => onReject(new Error(`POP3 timeout ${this.config.host}:${this.config.port}`)));
      socketInstance.on('error', onReject);
    });

    this.socket = socket;
    this.socket.on('data', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в on внутри connect. */ (chunk) => {
      this.buffer += Buffer.from(chunk).toString('latin1');
      this.pumpPending();
    });
    this.socket.on('error', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в on внутри connect. */ (error) => {
      if (this.pending) {
        this.pending.reject(error);
        this.pending = null;
      }
    });
    this.socket.on('close', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в on внутри connect. */ () => {
      this.closed = true;
      if (this.pending) {
        this.pending.reject(new Error('POP3 connection closed unexpectedly'));
        this.pending = null;
      }
    });

    const greeting = await this.readResponse();
    if (!greeting.startsWith('+OK')) {
      throw new Error(`POP3 greeting failed: ${greeting.trim()}`);
    }
  }

    /* Делает: Выполняет pump pending. Применение: используется внутри класса Pop3Client. */
  pumpPending() {
    if (!this.pending) {
      return;
    }

    if (this.pending.multiline) {
      if (this.buffer.startsWith('-ERR')) {
        const lineEndIndex = this.buffer.indexOf('\r\n');
        if (lineEndIndex === -1) {
          return;
        }

        const response = this.buffer.slice(0, lineEndIndex + 2);
        this.buffer = this.buffer.slice(lineEndIndex + 2);
        this.pending.resolve(response);
        this.pending = null;
        return;
      }

      const terminatorIndex = this.buffer.indexOf('\r\n.\r\n');
      if (terminatorIndex === -1) {
        return;
      }

      const response = this.buffer.slice(0, terminatorIndex + 5);
      this.buffer = this.buffer.slice(terminatorIndex + 5);
      this.pending.resolve(response);
      this.pending = null;
      return;
    }

    const lineEndIndex = this.buffer.indexOf('\r\n');
    if (lineEndIndex === -1) {
      return;
    }

    const response = this.buffer.slice(0, lineEndIndex + 2);
    this.buffer = this.buffer.slice(lineEndIndex + 2);
    this.pending.resolve(response);
    this.pending = null;
  }

    /* Делает: Читает ответ. Применение: используется внутри класса Pop3Client. */
  readResponse({ multiline = false } = {}) {
    if (this.closed) {
      return Promise.reject(new Error('POP3 connection is closed'));
    }

    if (this.pending) {
      return Promise.reject(new Error('POP3 response is already pending'));
    }

    return new Promise(/* Делает: Выполняет локальный callback в текущем месте модуля. Применение: используется локально внутри readResponse. */ (resolve, reject) => {
      this.pending = { resolve, reject, multiline };
      this.pumpPending();
    });
  }

    /* Делает: Выполняет send command. Применение: используется внутри класса Pop3Client. */
  async sendCommand(command, { multiline = false } = {}) {
    if (!this.socket) {
      throw new Error('POP3 socket is not connected');
    }

    this.socket.write(`${command}\r\n`, 'ascii');
    const response = await this.readResponse({ multiline });

    if (!response.startsWith('+OK')) {
      throw new Error(`POP3 command failed (${redactPop3Command(command)}): ${response.trim()}`);
    }

    return response;
  }

    /* Делает: Выполняет вход. Применение: используется внутри класса Pop3Client. */
  async login(user, password) {
    await this.sendCommand(`USER ${user}`);
    await this.sendCommand(`PASS ${password}`);
  }

    /* Делает: Возвращает список uids. Применение: используется внутри класса Pop3Client. */
  async listUids() {
    const response = await this.sendCommand('UIDL', { multiline: true });
    const lines = response
      .split('\r\n')
      .slice(1, -2)
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри listUids. */ (line) => line.trim())
      .filter(Boolean);

    return lines
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри listUids. */ (line) => {
        const [number, uid] = line.split(/\s+/, 2);
        return {
          number: Number.parseInt(number, 10),
          uid: String(uid || '').trim(),
        };
      })
      .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри listUids. */ (entry) => Number.isInteger(entry.number) && entry.number > 0 && entry.uid);
  }

    /* Делает: Выполняет сообщение retrieve. Применение: используется внутри класса Pop3Client. */
  async retrieveMessage(messageNumber) {
    const response = await this.sendCommand(`RETR ${messageNumber}`, { multiline: true });
    return response
      .split('\r\n')
      .slice(1, -2)
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри retrieveMessage. */ (line) => (line.startsWith('..') ? line.slice(1) : line))
      .join('\r\n');
  }

    /* Делает: Удаляет сообщение. Применение: используется внутри класса Pop3Client. */
  async deleteMessage(messageNumber) {
    await this.sendCommand(`DELE ${messageNumber}`);
  }

    /* Делает: Выполняет quit. Применение: используется внутри класса Pop3Client. */
  async quit() {
    if (!this.socket || this.closed) {
      return;
    }

    try {
      await this.sendCommand('QUIT');
    } finally {
      this.socket.end();
      this.closed = true;
    }
  }
}

/* Делает: Выполняет connect pop3 client. Применение: используется локально в файле backend/services/crossrefMailboxService.js. */
async function connectPop3Client(config) {
  const candidates = buildConnectionCandidates(config);
  const errors = [];

  for (const candidate of candidates) {
    const client = new Pop3Client(candidate);

    try {
      await client.connect();
      return client;
    } catch (error) {
      errors.push(`${candidate.host}:${candidate.port} secure=${candidate.secure} -> ${error.message}`);
      try {
        await client.quit();
      } catch {
        // ignore close errors
      }
    }
  }

  throw new Error(`Не удалось подключиться к POP3. Попытки: ${errors.join(' | ')}`);
}

export class CrossrefMailboxService {
    /* Делает: Инициализирует экземпляр CrossrefMailboxService и подготавливает его начальное состояние. Применение: вызывается при создании экземпляра класса CrossrefMailboxService в этом модуле. */
  constructor() {
    this.pollTimer = null;
    this.pollPromise = null;
    this.disabledReason = '';
  }

    /* Делает: Получает config. Применение: используется внутри класса CrossrefMailboxService. */
  getConfig() {
    return getCrossrefMailboxConfig();
  }

    /* Делает: Гарантирует таблицу state. Применение: используется внутри класса CrossrefMailboxService. */
  async ensureStateTable() {
    await repositoryPool.query(`
      CREATE TABLE IF NOT EXISTS repository_crossref_mailbox_messages (
        uid TEXT PRIMARY KEY,
        subject TEXT,
        doi TEXT,
        document_id TEXT,
        submission_id TEXT,
        batch_id TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

    /* Делает: Определяет disabled reason. Применение: используется внутри класса CrossrefMailboxService. */
  resolveDisabledReason(config) {
    if (!config.enabled) {
      return 'service disabled by CROSSREF_POP3_ENABLED=false';
    }

    if (!config.host) {
      return 'CROSSREF_POP3_HOST is empty';
    }

    if (!config.user) {
      return 'CROSSREF_POP3_USER is empty';
    }

    if (!config.password) {
      return 'CROSSREF_POP3_PASSWORD is empty';
    }

    return '';
  }

    /* Делает: Выполняет start. Применение: используется внутри класса CrossrefMailboxService. */
  async start() {
    const config = this.getConfig();
    const disabledReason = this.resolveDisabledReason(config);

    if (disabledReason) {
      this.disabledReason = disabledReason;
      console.warn(`Crossref POP3 watcher is disabled: ${disabledReason}`);
      return { started: false, reason: disabledReason };
    }

    await this.ensureStateTable();

    if (!this.pollTimer) {
      this.pollTimer = setInterval(/* Делает: Запускает периодическое действие по таймеру. Применение: передаётся как callback в setInterval внутри start. */ () => {
        this.schedulePoll();
      }, config.pollIntervalMs);

      if (typeof this.pollTimer.unref === 'function') {
        this.pollTimer.unref();
      }
    }

    console.log(
      `Crossref POP3 watcher is scheduled to poll mailbox every ${config.pollIntervalMs}ms (${config.host}:${config.port}, secure=${config.secure})`
    );
    try {
      await this.pollNow();
    } catch (error) {
      await this.stop();
      throw error;
    }

    return { started: true };
  }

    /* Делает: Выполняет stop. Применение: используется внутри класса CrossrefMailboxService. */
  async stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.pollPromise) {
      await this.pollPromise.catch(/* Делает: Обрабатывает ошибку предыдущего промиса. Применение: передаётся как callback в catch внутри stop. */ () => {});
    }
  }

    /* Делает: Получает processed uid set. Применение: используется внутри класса CrossrefMailboxService. */
  async getProcessedUidSet(uids = []) {
    const normalizedUids = [...new Set((uids || []).map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getProcessedUidSet. */ (uid) => String(uid || '').trim()).filter(Boolean))];
    if (normalizedUids.length === 0) {
      return new Set();
    }

    const { rows } = await repositoryPool.query(
      `SELECT uid
       FROM repository_crossref_mailbox_messages
       WHERE uid = ANY($1::text[])`,
      [normalizedUids]
    );

    return new Set(rows.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getProcessedUidSet. */ (row) => String(row.uid || '').trim()).filter(Boolean));
  }

    /* Делает: Получает processed message count. Применение: используется внутри класса CrossrefMailboxService. */
  async getProcessedMessageCount() {
    const { rows } = await repositoryPool.query(
      `SELECT COUNT(*)::int AS count
       FROM repository_crossref_mailbox_messages`
    );

    return Number(rows[0]?.count || 0);
  }

    /* Делает: Сохраняет сообщение processed. Применение: используется внутри класса CrossrefMailboxService. */
  async saveProcessedMessage(record) {
    await repositoryPool.query(
      `INSERT INTO repository_crossref_mailbox_messages (
         uid, subject, doi, document_id, submission_id, batch_id, status, error_message, processed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       ON CONFLICT (uid)
       DO UPDATE SET
         subject = EXCLUDED.subject,
         doi = EXCLUDED.doi,
         document_id = EXCLUDED.document_id,
         submission_id = EXCLUDED.submission_id,
         batch_id = EXCLUDED.batch_id,
         status = EXCLUDED.status,
         error_message = EXCLUDED.error_message,
         processed_at = CURRENT_TIMESTAMP`,
      [
        String(record.uid || '').trim(),
        String(record.subject || '').trim(),
        String(record.doi || '').trim(),
        String(record.documentId || '').trim(),
        String(record.submissionId || '').trim(),
        String(record.batchId || '').trim(),
        String(record.status || 'processed').trim(),
        String(record.errorMessage || '').trim(),
      ]
    );
  }

    /* Делает: Выполняет сообщения seed существующего. Применение: используется внутри класса CrossrefMailboxService. */
  async seedExistingMessages(messages = []) {
    for (const message of messages) {
      await this.saveProcessedMessage({
        uid: message.uid,
        status: 'seeded',
      });
    }
  }

    /* Делает: Выполняет сообщение process. Применение: используется внутри класса CrossrefMailboxService. */
  async processMessage(client, message, config, rawMessage = null) {
    const messageContent = rawMessage === null ? await client.retrieveMessage(message.number) : String(rawMessage || '');
    const extracted = extractCrossrefConfirmationPayload(messageContent);

    if (!isCrossrefConfirmationMessage(extracted.subject, extracted.text, messageContent)) {
      await this.saveProcessedMessage({
        uid: message.uid,
        subject: extracted.subject,
        status: 'ignored',
      });

      if (config.deleteProcessed) {
        await client.deleteMessage(message.number);
      }

      return;
    }

    try {
      const result = await repositoryService.confirmCrossrefPublicationFromMailboxMessage(
        extracted.payload,
        buildMailboxActor(config)
      );

      await this.saveProcessedMessage({
        uid: message.uid,
        subject: extracted.subject,
        doi: result.confirmedDoi || '',
        documentId: result.matchedDocumentId || '',
        submissionId: result.submissionId || '',
        batchId: result.batchId || '',
        status: result.alreadyVerified ? 'already_verified' : 'confirmed',
      });

      if (config.deleteProcessed) {
        await client.deleteMessage(message.number);
      }

      console.log(
        `Crossref POP3 watcher processed DOI ${result.confirmedDoi || 'unknown'} for document ${result.matchedDocumentId || 'unknown'}`
      );
    } catch (error) {
      const processingError = classifyMailboxProcessingError(error);
      const parsed = parseCrossrefConfirmationSummary(extracted.payload);

      await this.saveProcessedMessage({
        uid: message.uid,
        subject: extracted.subject,
        doi: parsed?.doi || '',
        submissionId: parsed?.submissionId || '',
        batchId: parsed?.batchId || '',
        status: processingError.status,
        errorMessage: error?.message || 'MAILBOX_PROCESSING_FAILED',
      });

      if (config.deleteProcessed && processingError.status !== 'error') {
        await client.deleteMessage(message.number);
      }

      if (processingError.logLevel === 'info') {
        console.log(`Crossref POP3 watcher skipped message ${message.uid}: ${error?.message || 'SKIPPED'}`);
        return;
      }

      if (processingError.logLevel === 'warn') {
        console.warn(`Crossref POP3 watcher postponed message ${message.uid}: ${error?.message || 'POSTPONED'}`);
        return;
      }

      console.error(`Crossref POP3 watcher failed for message ${message.uid}:`, error);
    }
  }

    /* Делает: Удаляет письма старше retention и готовит к дальнейшему poll. Применение: используется внутри класса CrossrefMailboxService. */
  async filterExpiredMessages(client, messages = [], config, now = new Date()) {
    const activeMessages = [];
    const rawMessagesByUid = new Map();
    let deletedCount = 0;

    for (const message of messages) {
      let rawMessage = '';

      try {
        rawMessage = await client.retrieveMessage(message.number);
      } catch (error) {
        console.warn(`Crossref POP3 watcher could not inspect message ${message.uid}: ${error?.message || 'RETR_FAILED'}`);
        activeMessages.push(message);
        continue;
      }

      const receivedAt = parseRawEmailReceivedAt(rawMessage);
      if (isMessageOlderThanDays(receivedAt, config.messageRetentionDays, now)) {
        try {
          await client.deleteMessage(message.number);
          deletedCount += 1;
          continue;
        } catch (error) {
          console.warn(`Crossref POP3 watcher could not delete expired message ${message.uid}: ${error?.message || 'DELE_FAILED'}`);
        }
      }

      rawMessagesByUid.set(message.uid, rawMessage);
      activeMessages.push(message);
    }

    return {
      activeMessages,
      rawMessagesByUid,
      deletedCount,
    };
  }

    /* Делает: Выполняет почтовый ящик poll. Применение: используется внутри класса CrossrefMailboxService. */
  async pollMailbox() {
    const config = this.getConfig();
    const disabledReason = this.resolveDisabledReason(config);
    if (disabledReason) {
      this.disabledReason = disabledReason;
      return;
    }

    await this.ensureStateTable();
    const client = await connectPop3Client(config);

    try {
      await client.login(config.user, config.password);
      const messages = await client.listUids();
      const { activeMessages, rawMessagesByUid, deletedCount } = await this.filterExpiredMessages(client, messages, config);
      if (deletedCount > 0) {
        console.log(
          `Crossref POP3 watcher deleted ${deletedCount} mailbox message(s) older than ${config.messageRetentionDays} day(s)`
        );
      }

      const processedMessageCount = await this.getProcessedMessageCount();
      if (shouldSeedExistingMailboxMessages({
        skipExistingOnStart: config.skipExistingOnStart,
        existingProcessedCount: processedMessageCount,
        mailboxMessageCount: activeMessages.length,
      })) {
        await this.seedExistingMessages(activeMessages);
        console.log(
          `Crossref POP3 watcher seeded ${activeMessages.length} existing mailbox message(s) on first start. New messages will be processed from now on.`
        );
        return;
      }

      const processedUidSet = await this.getProcessedUidSet(activeMessages.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри pollMailbox. */ (message) => message.uid));
      const pendingMessages = activeMessages
        .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри pollMailbox. */ (message) => !processedUidSet.has(message.uid))
        .sort(/* Делает: Сравнивает элементы при сортировке. Применение: передаётся как callback в sort внутри pollMailbox. */ (left, right) => left.number - right.number)
        .slice(0, config.maxMessagesPerPoll);

      for (const message of pendingMessages) {
        await this.processMessage(client, message, config, rawMessagesByUid.get(message.uid) ?? null);
      }
    } finally {
      await client.quit().catch(/* Делает: Обрабатывает ошибку предыдущего промиса. Применение: передаётся как callback в catch внутри pollMailbox. */ () => {});
    }
  }

    /* Делает: Выполняет poll now. Применение: используется внутри класса CrossrefMailboxService. */
  async pollNow() {
    if (!this.pollPromise) {
      this.pollPromise = this.pollMailbox().finally(/* Делает: Выполняет завершающее действие после промиса. Применение: передаётся как callback в finally внутри pollNow. */ () => {
        this.pollPromise = null;
      });
    }

    return this.pollPromise;
  }

    /* Делает: Логирует ошибку планового poll без падения процесса. Применение: используется внутри класса CrossrefMailboxService. */
  logScheduledPollError(error) {
    console.warn(`Crossref POP3 watcher poll failed: ${error?.message || 'UNKNOWN_ERROR'}`);
  }

    /* Делает: Запускает poll с безопасной обработкой фоновых ошибок. Применение: используется внутри класса CrossrefMailboxService. */
  schedulePoll() {
    void this.pollNow().catch(/* Делает: Обрабатывает ошибку poll без unhandled rejection. Применение: передаётся как callback в catch внутри schedulePoll. */ (error) => {
      this.logScheduledPollError(error);
    });
  }
}

export const crossrefMailboxService = new CrossrefMailboxService();

export const crossrefMailboxServiceTestUtils = {
  classifyMailboxProcessingError,
  decodeMimeHeaderValue,
  decodeTransferEncodedText,
  extractCrossrefConfirmationPayload,
  extractCrossrefXmlPayload,
  isCrossrefConfirmationMessage,
  parseRawEmail,
  redactPop3Command,
  shouldSeedExistingMailboxMessages,
};
