import fs from 'fs/promises';
import path from 'path';
import dns from 'dns/promises';
import net from 'net';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { authPool } from '../models/authDatabase.js';
import { repositoryPool } from '../models/repositoryDatabase.js';
import { RepositoryUserModel } from '../models/RepositoryUser.js';
import { getEmailService } from './emailService.js';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const dataDir = path.join(currentDir, '..', 'data');
const storageDir = path.join(dataDir, 'repository');
const legacyRepositoryFilePath = path.join(dataDir, 'repository.json');
const uploadsDir = process.env.REPOSITORY_UPLOADS_DIR
  ? path.resolve(process.env.REPOSITORY_UPLOADS_DIR)
  : path.join(currentDir, '..', 'uploads');
const repositoryUploadsDir = path.join(uploadsDir, 'repository');
const repositoryXmlDir = process.env.REPOSITORY_XML_DIR
  ? path.resolve(process.env.REPOSITORY_XML_DIR)
  : path.join(repositoryUploadsDir, 'xml');
const managedUploadPrefix = '/uploads/repository/';
const managedXmlPrefix = '/uploads/repository/xml/';
const managedUploadRootPath = path.resolve(repositoryUploadsDir);
const managedXmlRootPath = path.resolve(repositoryXmlDir);
const repositoryDoiPrefix = process.env.REPOSITORY_DOI_PREFIX || '10.35540';
const crossrefDepositUrl = process.env.CROSSREF_DEPOSIT_URL || 'https://doi.crossref.org/servlet/deposit';
const crossrefLoginId = process.env.CROSSREF_LOGIN_ID || '';
const crossrefLoginPassword = process.env.CROSSREF_LOGIN_PASSWORD || '';
const repositoryPublicBaseUrl = (process.env.REPOSITORY_PUBLIC_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const repositoryRegistrant = process.env.REPOSITORY_DOI_REGISTRANT || 'Geophysical Survey of the Russian Academy of Sciences';
const repositoryDepositorName = process.env.REPOSITORY_DOI_DEPOSITOR_NAME || 'Repository System';
const repositoryDepositorEmail = process.env.REPOSITORY_DOI_DEPOSITOR_EMAIL || 'repository@gsras.ru';
const repositoryPublisherName = process.env.REPOSITORY_XML_PUBLISHER_NAME || 'Geophysical Survey of the Russian Academy of Sciences';
const repositoryPublisherPlace = process.env.REPOSITORY_XML_PUBLISHER_PLACE || 'Obninsk, Russia';
const repositoryInstitutionName = process.env.REPOSITORY_XML_INSTITUTION_NAME || 'Geophysical Survey of the Russian Academy of Sciences';
const repositoryInstitutionPlace = process.env.REPOSITORY_XML_INSTITUTION_PLACE || 'Obninsk, Russia';
const repositoryContributorOrganization = process.env.REPOSITORY_XML_CONTRIBUTOR_ORGANIZATION || 'Geophysical Center RAS, Moscow, Russia ';
const crossrefSchemaVersion = process.env.CROSSREF_SCHEMA_VERSION || '4.3.7';
const repositoryMaxUploadBytes = parsePositiveIntegerEnv(
  process.env.REPOSITORY_MAX_UPLOAD_BYTES,
  50 * 1024 * 1024
);
const repositoryRemoteDownloadTimeoutMs = parsePositiveIntegerEnv(
  process.env.REPOSITORY_REMOTE_DOWNLOAD_TIMEOUT_MS,
  15000
);
const DEFAULT_DOCUMENT_CLASSIFICATION = 'dataset';
const DEFAULT_JOURNAL_CODE = 'pub';

const DOCUMENT_STATUS_DRAFT = 'draft';
const DOCUMENT_STATUS_NEEDS_REVISION = 'needs_revision';
const DOCUMENT_STATUS_UNDER_REVIEW = 'under_review';
const DOCUMENT_STATUS_VERIFIED = 'verified';
const DOCUMENT_STATUS_VALUES = new Set([
  DOCUMENT_STATUS_DRAFT,
  DOCUMENT_STATUS_NEEDS_REVISION,
  DOCUMENT_STATUS_UNDER_REVIEW,
  DOCUMENT_STATUS_VERIFIED,
]);
let flatStructureNormalized = false;
let legacyXmlResourceUrlsFixed = false;

/* Делает: Разбирает positive integer env. Применение: используется локально в файле backend/services/repositoryService.js. */
function parsePositiveIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/* Делает: Выполняет clone. Применение: используется локально в файле backend/services/repositoryService.js. */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/* Делает: Создаёт empty root. Применение: используется локально в файле backend/services/repositoryService.js. */
function createEmptyRoot() {
  return {
    id: 'root',
    name: 'Репозиторий ФИЦ ЕГС РАС',
    type: 'directory',
    children: [],
  };
}

/* Делает: Создаёт метаданные базового документа. Применение: используется локально в файле backend/services/repositoryService.js. */
function createDefaultDocumentMeta() {
  return {
    annotation: '',
    publicationDate: new Date().toISOString().slice(0, 10),
    publicationYear: '',
    authors: '',
    affiliations: '',
    organization: '',
    titleEn: '',
    authorsEn: '',
    organizationEn: '',
    descriptionEn: '',
    authorEntries: [],
    creatorUserId: '',
    creatorName: '',
    creatorEmail: '',
    reviewEditorName: '',
    reviewEditorEmail: '',
    revisionComment: '',
    revisionCommentAuthor: '',
    revisionCommentUpdatedAt: '',
    documentType: '',
    recordType: '',
    journalCode: DEFAULT_JOURNAL_CODE,
    volume: '',
    articleNumber: '',
    doi: '',
    citationLink: '',
    citationLinkEn: '',
    xmlPath: '',
    license: 'CC BY-NC 4.0',
    position: 0,
  };
}

const DOCUMENT_INFO_FIELDS = [
  'creatorName',
  'creatorEmail',
  'reviewEditorName',
  'reviewEditorEmail',
  'revisionComment',
  'revisionCommentAuthor',
  'revisionCommentUpdatedAt',
];

/* Делает: Создаёт информацию базового документа. Применение: используется локально в файле backend/services/repositoryService.js. */
function createDefaultDocumentInfo() {
  return DOCUMENT_INFO_FIELDS.reduce(/* Делает: Накопляет итоговое значение при обходе коллекции. Применение: передаётся как callback в reduce внутри createDefaultDocumentInfo. */ (acc, field) => {
    acc[field] = '';
    return acc;
  }, {});
}

/* Делает: Нормализует информацию документа. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeDocumentInfo(info = {}) {
  const normalized = createDefaultDocumentInfo();
  if (!info || typeof info !== 'object') {
    return normalized;
  }

  for (const field of DOCUMENT_INFO_FIELDS) {
    normalized[field] = typeof info[field] === 'string' ? info[field] : '';
  }

  return normalized;
}

/* Делает: Выполняет поля omit документа информации. Применение: используется локально в файле backend/services/repositoryService.js. */
function omitDocumentInfoFields(meta = {}) {
  const cleanMeta = { ...(meta || {}) };
  for (const field of DOCUMENT_INFO_FIELDS) {
    delete cleanMeta[field];
  }
  return cleanMeta;
}

/* Делает: Определяет информацию документа. Применение: используется локально в файле backend/services/repositoryService.js. */
function resolveDocumentInfo(meta = {}, info = {}) {
  const normalizedMeta = normalizeLegacyDocumentMeta(meta || {});
  const normalizedInfo = normalizeDocumentInfo(info);

  for (const field of DOCUMENT_INFO_FIELDS) {
    const metaValue = typeof normalizedMeta[field] === 'string' ? normalizedMeta[field] : '';
    if (!String(normalizedInfo[field] || '').trim() && metaValue) {
      normalizedInfo[field] = metaValue;
    }
  }

  return normalizedInfo;
}

/* Делает: Собирает хранилище документа метаданных from. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildDocumentMetaFromStorage(meta = {}, info = {}) {
  const normalizedMeta = normalizeLegacyDocumentMeta(meta || {});
  return {
    ...createDefaultDocumentMeta(),
    ...omitDocumentInfoFields(normalizedMeta),
    ...resolveDocumentInfo(normalizedMeta, info),
  };
}

/* Делает: Нормализует метаданные исторического документа. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeLegacyDocumentMeta(meta = {}) {
  if (!meta || typeof meta !== 'object') {
    return {};
  }

  const normalized = { ...(meta || {}) };
  const annotation = typeof normalized.annotation === 'string' ? normalized.annotation.trim() : '';
  const legacyDescription = typeof normalized.descriptionInfo === 'string' ? normalized.descriptionInfo.trim() : '';

  if (!annotation && legacyDescription) {
    normalized.annotation = legacyDescription;
  }

  if (!String(normalized.journalCode || '').trim()) {
    normalized.journalCode = DEFAULT_JOURNAL_CODE;
  }

  delete normalized.descriptionInfo;
  return normalized;
}

/* Делает: Извлекает хранилище документа. Применение: используется локально в файле backend/services/repositoryService.js. */
function extractDocumentStorage(meta = {}) {
  const normalizedMeta = normalizeLegacyDocumentMeta(meta || {});
  const documentInfo = resolveDocumentInfo(normalizedMeta);
  const mergedMeta = {
    ...createDefaultDocumentMeta(),
    ...omitDocumentInfoFields(normalizedMeta),
    ...documentInfo,
  };
  const documentType = typeof mergedMeta.documentType === 'string' ? mergedMeta.documentType : '';
  const doi = typeof mergedMeta.doi === 'string' ? mergedMeta.doi : '';
  const xmlPath = typeof mergedMeta.xmlPath === 'string' ? mergedMeta.xmlPath : '';
  const storedMeta = omitDocumentInfoFields(mergedMeta);

  return {
    documentType,
    doi,
    xmlPath,
    info: documentInfo,
    meta: {
      ...storedMeta,
      documentType: '',
      doi: '',
      xmlPath: '',
    },
  };
}

/* Делает: Очищает и нормализует file stem. Применение: используется локально в файле backend/services/repositoryService.js. */
function sanitizeFileStem(value, fallback = 'file') {
  const normalized = String(value || '')
    .trim()
    .normalize('NFC')
    .replace(/\.[^.]+$/u, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/\.+$/g, '');

  return normalized || fallback;
}

/* Делает: Нормализует имя loose файлового. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeLooseFileName(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  if (!path.extname(raw)) {
    const commaExtensionMatch = raw.match(/^(.*?)[,\s]+([a-zA-Z0-9]{2,10})$/u);
    if (commaExtensionMatch) {
      const [, stem, extension] = commaExtensionMatch;
      return `${String(stem || '').trim()}.${String(extension || '').trim()}`;
    }
  }

  return raw;
}

/* Делает: Нормализует file extension. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeFileExtension(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const ext = raw.startsWith('.') ? raw : `.${raw}`;
  const normalized = ext.replace(/[^a-zA-Z0-9.]+/g, '').toLowerCase();
  return normalized === '.' ? '' : normalized;
}

/* Делает: Очищает и нормализует имя файлового. Применение: используется локально в файле backend/services/repositoryService.js. */
function sanitizeFileName(fileName, mimeType = '') {
  const normalizedFileName = normalizeLooseFileName(fileName);
  const extension =
    normalizeFileExtension(path.extname(normalizedFileName)) ||
    inferExtensionFromMimeType(mimeType);
  const fileStemSource = extension ? normalizedFileName.slice(0, -extension.length) : normalizedFileName;
  return `${sanitizeFileStem(fileStemSource, 'file')}${extension}`;
}

/* Делает: Собирает document slug. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildDocumentSlug(value) {
  return slugifySegment(value || 'document', 'document').toLowerCase();
}

/* Делает: Определяет имя XML документа. Применение: используется локально в файле backend/services/repositoryService.js. */
function resolveXmlDocumentName(meta = {}, fallbackName = '') {
  const englishTitle = String(meta?.titleEn || '').trim();
  if (englishTitle) {
    return englishTitle;
  }

  const normalizedFallbackName = String(fallbackName || '').trim();
  return normalizedFallbackName || 'document';
}

/* Делает: Определяет год хранилища. Применение: используется локально в файле backend/services/repositoryService.js. */
function resolveStorageYear(createdAt, publicationDate, fallbackDate = new Date()) {
  const createdAtParsed = createdAt ? new Date(createdAt) : null;
  if (createdAtParsed && !Number.isNaN(createdAtParsed.getTime())) {
    return String(createdAtParsed.getUTCFullYear());
  }

  const publicationYearMatch = String(publicationDate || '').trim().match(/^(\d{4})/);
  if (publicationYearMatch) {
    return publicationYearMatch[1];
  }

  const parsedFallback = new Date(fallbackDate);
  if (!Number.isNaN(parsedFallback.getTime())) {
    return String(parsedFallback.getUTCFullYear());
  }

  return String(new Date().getUTCFullYear());
}

/* Делает: Нормализует ключ хранилища. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeStorageKey(value, fallback = '') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || fallback;
}

/* Делает: Определяет информацию документа хранилища. Применение: используется локально в файле backend/services/repositoryService.js. */
function resolveDocumentStorageInfo({
  documentId,
  documentName,
  publicationDate,
  createdAt,
  storageKey,
}) {
  const year = resolveStorageYear(createdAt, publicationDate, createdAt || new Date());
  const documentSlug = buildDocumentSlug(documentName);
  const directoryName =
    normalizeStorageKey(documentId) ||
    normalizeStorageKey(storageKey) ||
    `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const relativeDir = path.posix.join(year, directoryName);
  const absoluteDir = path.join(repositoryUploadsDir, year, directoryName);

  return { year, documentSlug, relativeDir, absoluteDir, directoryName };
}

/* Делает: Собирает URL управляемого загрузки. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildManagedUploadUrl(relativeDir, fileName) {
  return `${managedUploadPrefix}${path.posix.join(relativeDir, fileName)}`;
}

/* Делает: Нормализует block order. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeBlockOrder(blockOrder) {
  const numeric = Number(blockOrder);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalized = Math.floor(numeric);
  return normalized >= 1 ? normalized : null;
}

/* Делает: Собирает имя сохранённого ресурса base. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildStoredAssetBaseName({ documentSlug, blockOrder }) {
  const normalizedOrder = normalizeBlockOrder(blockOrder);
  const orderSegment = normalizedOrder
    ? String(normalizedOrder).padStart(2, '0')
    : `${Date.now()}-${randomUUID().slice(0, 8)}`;

  return `${documentSlug}-${orderSegment}`;
}

/* Делает: Выполняет path exists. Применение: используется локально в файле backend/services/repositoryService.js. */
async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/* Делает: Собирает имя уникального сохранённого файлового. Применение: используется локально в файле backend/services/repositoryService.js. */
async function buildUniqueStoredFileName({ absoluteDir, baseName, extension, ignoreFilePath = null }) {
  const normalizedExtension = normalizeFileExtension(extension);
  let index = 0;

  while (true) {
    const suffix = index === 0 ? '' : `-${String(index).padStart(2, '0')}`;
    const candidate = `${baseName}${suffix}${normalizedExtension}`;
    const candidatePath = path.join(absoluteDir, candidate);
    if (ignoreFilePath && path.resolve(ignoreFilePath) === path.resolve(candidatePath)) {
      return candidate;
    }
    if (!(await pathExists(candidatePath))) {
      return candidate;
    }

    index += 1;
  }
}

/* Делает: Определяет тип extension from mime. Применение: используется локально в файле backend/services/repositoryService.js. */
function inferExtensionFromMimeType(mimeType) {
  const normalizedMimeType = String(mimeType || '')
    .trim()
    .toLowerCase()
    .split(';', 1)[0];

  switch (normalizedMimeType) {
    case 'application/pdf':
      return '.pdf';
    case 'application/zip':
      return '.zip';
    case 'application/json':
      return '.json';
    case 'application/xml':
    case 'text/xml':
      return '.xml';
    case 'text/plain':
      return '.txt';
    case 'text/csv':
      return '.csv';
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/gif':
      return '.gif';
    case 'video/mp4':
      return '.mp4';
    default:
      return '';
  }
}

/* Делает: Преобразует segment. Применение: используется локально в файле backend/services/repositoryService.js. */
function slugifySegment(value, fallback = 'DOC') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, '')
    .replace(/_/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();

  return normalized || fallback;
}

/* Делает: Экранирует XML. Применение: используется локально в файле backend/services/repositoryService.js. */
function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* Делает: Разделяет список метаданных. Применение: используется локально в файле backend/services/repositoryService.js. */
function splitMetaList(value) {
  return String(value || '')
    .split(/\r?\n|;/)
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри splitMetaList. */ (item) => item.trim())
    .filter(Boolean);
}

/* Делает: Разделяет имя person. Применение: используется локально в файле backend/services/repositoryService.js. */
function splitPersonName(fullName, { surnameFirst = true } = {}) {
  const normalizedFullName = String(fullName || '').trim();
  if (!normalizedFullName) {
    return { givenName: 'test', surname: 'test' };
  }

  const commaParts = normalizedFullName.split(',').map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри splitPersonName. */ (part) => part.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    return {
      givenName: commaParts.slice(1).join(' ') || 'test',
      surname: commaParts[0] || 'test',
    };
  }

  const parts = normalizedFullName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { givenName: parts[0] || 'test', surname: parts[0] || 'test' };
  }

  if (surnameFirst) {
    return {
      givenName: parts.slice(1).join(' ') || 'test',
      surname: parts[0] || 'test',
    };
  }

  return {
    givenName: parts.slice(0, -1).join(' ') || 'test',
    surname: parts[parts.length - 1] || 'test',
  };
}

/* Делает: Выполняет поле XML. Применение: используется локально в файле backend/services/repositoryService.js. */
function xmlField(value, fallback = 'test') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}


/* Делает: Выполняет transliterate ru to latin. Применение: используется локально в файле backend/services/repositoryService.js. */
function transliterateRuToLatin(value) {
  const map = {
    'А': 'A', 'а': 'a', 'Б': 'B', 'б': 'b', 'В': 'V', 'в': 'v', 'Г': 'G', 'г': 'g', 'Д': 'D', 'д': 'd',
    'Е': 'E', 'е': 'e', 'Ё': 'E', 'ё': 'e', 'Ж': 'Zh', 'ж': 'zh', 'З': 'Z', 'з': 'z', 'И': 'I', 'и': 'i',
    'Й': 'Y', 'й': 'y', 'К': 'K', 'к': 'k', 'Л': 'L', 'л': 'l', 'М': 'M', 'м': 'm', 'Н': 'N', 'н': 'n',
    'О': 'O', 'о': 'o', 'П': 'P', 'п': 'p', 'Р': 'R', 'р': 'r', 'С': 'S', 'с': 's', 'Т': 'T', 'т': 't',
    'У': 'U', 'у': 'u', 'Ф': 'F', 'ф': 'f', 'Х': 'Kh', 'х': 'kh', 'Ц': 'Ts', 'ц': 'ts', 'Ч': 'Ch', 'ч': 'ch',
    'Ш': 'Sh', 'ш': 'sh', 'Щ': 'Shch', 'щ': 'shch', 'Ъ': '', 'ъ': '', 'Ы': 'Y', 'ы': 'y', 'Ь': '', 'ь': '',
    'Э': 'E', 'э': 'e', 'Ю': 'Yu', 'ю': 'yu', 'Я': 'Ya', 'я': 'ya'
  };

  return String(value || '')
    .split('')
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри transliterateRuToLatin. */ (char) => map[char] ?? char)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Делает: Выполняет имя XML person. Применение: используется локально в файле backend/services/repositoryService.js. */
function xmlPersonName(value, fallback = 'test') {
  return xmlField(transliterateRuToLatin(value), fallback);
}

/* Делает: Создаёт crossref timestamp. Применение: используется локально в файле backend/services/repositoryService.js. */
function createCrossrefTimestamp(date = new Date()) {
    /* Делает: Выполняет pad. Применение: используется внутри функции createCrossrefTimestamp. */
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}00`;
}

/* Делает: Создаёт идентификатор DOI batch. Применение: используется локально в файле backend/services/repositoryService.js. */
function createDoiBatchId(nodeId) {
  const source = String(nodeId || 'repository');
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) % 100000;
  }

  return `ESDB${String(hash).padStart(5, '0')}`;
}

/* Делает: Определяет дату публикации. Применение: используется локально в файле backend/services/repositoryService.js. */
function resolvePublicationDate(meta) {
  const parsed = meta?.publicationDate ? new Date(meta.publicationDate) : new Date();
  const publicationDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const publicationYear = String(meta?.publicationYear || '').trim();

  if (/^\d{4}$/.test(publicationYear)) {
    publicationDate.setUTCFullYear(Number(publicationYear));
  }

  return publicationDate;
}

function resolvePublicationYear(meta) {
  const explicitYear = String(meta?.publicationYear || '').trim();
  if (/^\d{4}$/.test(explicitYear)) {
    return explicitYear;
  }

  return String(meta?.publicationDate || '')
    .trim()
    .match(/^(\d{4})/)?.[1] || '';
}

/* Делает: Определяет дату creation. Применение: используется локально в файле backend/services/repositoryService.js. */
function resolveCreationDate(createdAt, publicationDate) {
  if (createdAt) {
    const parsed = new Date(createdAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return publicationDate;
}

/* Делает: Собирает DOI приблизительного. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildApproximateDoi(nodeId, name, meta) {
  const publicationYear = resolvePublicationYear(meta);
  const journalCode = String(meta?.journalCode || DEFAULT_JOURNAL_CODE)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '');
  const volume = String(meta?.volume || '')
    .trim()
    .replace(/[^\dA-Za-z.-]+/g, '');
  const articleNumber = String(meta?.articleNumber || '')
    .trim()
    .replace(/[^\dA-Za-z.-]+/g, '');

  if (!publicationYear || !journalCode || !volume || !articleNumber) {
    return typeof meta?.doi === 'string' ? meta.doi.trim() : '';
  }

  return `${repositoryDoiPrefix}/gsras.${journalCode}.${publicationYear}.${volume}.${articleNumber}`;
}

/* Делает: Определяет DOI редактируемого документа. Применение: используется локально в файле backend/services/repositoryService.js. */
function resolveEditableDocumentDoi(nodeId, name, meta) {
  return buildApproximateDoi(nodeId, name, {
    ...(meta || {}),
    doi: '',
  });
}

/* Делает: Нормализует значение DOI lookup. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeDoiLookupValue(doi = '') {
  return normalizeDoiValue(doi).toLowerCase();
}

/* Делает: Форматирует generated doi suffix. Применение: используется локально в файле backend/services/repositoryService.js. */
function formatGeneratedDoiSuffix(index) {
  return String(Math.max(0, Number(index) || 0)).padStart(2, '0');
}

/* Делает: Определяет unique doi candidate. Применение: используется локально в файле backend/services/repositoryService.js. */
function resolveUniqueDoiCandidate(baseDoi, existingDois = []) {
  const normalizedBaseDoi = normalizeDoiValue(baseDoi);
  const baseLookupValue = normalizeDoiLookupValue(normalizedBaseDoi);
  if (!normalizedBaseDoi) {
    return '';
  }

  const existingLookupValues = new Set(
    (Array.isArray(existingDois) ? existingDois : [])
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри resolveUniqueDoiCandidate. */ (doi) => normalizeDoiLookupValue(doi))
      .filter(Boolean)
  );

  if (!existingLookupValues.has(baseLookupValue)) {
    return normalizedBaseDoi;
  }

  let suffixIndex = 1;
  let nextCandidateLookupValue = `${baseLookupValue}-${formatGeneratedDoiSuffix(suffixIndex)}`;
  while (existingLookupValues.has(nextCandidateLookupValue)) {
    suffixIndex += 1;
    nextCandidateLookupValue = `${baseLookupValue}-${formatGeneratedDoiSuffix(suffixIndex)}`;
  }

  return `${normalizedBaseDoi}-${formatGeneratedDoiSuffix(suffixIndex)}`;
}

/* Делает: Получает existing document dois. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getExistingDocumentDois(excludeDocumentId = '') {
  const normalizedDocumentId = String(excludeDocumentId || '').trim();
  const repositoryQuery = normalizedDocumentId
    ? {
        sql: `SELECT id, name, doi, meta
              FROM repository_nodes
              WHERE id <> $1`,
        values: [normalizedDocumentId],
      }
    : {
        sql: `SELECT id, name, doi, meta
              FROM repository_nodes`,
        values: [],
      };
  const draftQuery = normalizedDocumentId
    ? {
        sql: `SELECT document_id, name, meta ->> 'doi' AS doi, meta
              FROM repository_personal_drafts
              WHERE document_id <> $1`,
        values: [normalizedDocumentId],
      }
    : {
        sql: `SELECT document_id, name, meta ->> 'doi' AS doi, meta
              FROM repository_personal_drafts`,
        values: [],
      };
  const [repositoryResult, draftResult] = await Promise.all([
    repositoryPool.query(repositoryQuery.sql, repositoryQuery.values),
    authPool.query(draftQuery.sql, draftQuery.values),
  ]);

  return [...repositoryResult.rows, ...draftResult.rows]
    .flatMap(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в flatMap внутри getExistingDocumentDois. */ (row) => [
      String(row?.doi || '').trim(),
      buildApproximateDoi(row?.id || row?.document_id || '', row?.name || '', row?.meta || {}),
    ])
    .filter(Boolean);
}

/* Делает: Определяет DOI уникального сгенерированного. Применение: используется локально в файле backend/services/repositoryService.js. */
async function resolveUniqueGeneratedDoi(baseDoi, excludeDocumentId = '') {
  const normalizedBaseDoi = normalizeDoiValue(baseDoi);
  if (!normalizedBaseDoi) {
    return '';
  }

  const existingDois = await getExistingDocumentDois(excludeDocumentId);
  return resolveUniqueDoiCandidate(normalizedBaseDoi, existingDois);
}

/* Делает: Определяет, нужно ли XML refresh редактируемого документа. Применение: используется локально в файле backend/services/repositoryService.js. */
function shouldRefreshEditableDocumentXml(meta) {
  return Boolean(
    String(meta?.xmlPath || '').trim() &&
    String(meta?.doi || '').trim()
  );
}

/* Делает: Нормализует значение DOI. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeDoiValue(doi = '') {
  const normalized = String(doi || '').trim();
  if (!normalized) {
    return '';
  }

  return normalized
    .replace(/^https?:\/\/doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
}

/* Делает: Собирает URL DOI. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildDoiUrl(doi = '') {
  const normalized = normalizeDoiValue(doi);
  return normalized ? `https://doi.org/${normalized}` : '';
}

/* Делает: Получает initials from name parts. Применение: используется локально в файле backend/services/repositoryService.js. */
function getInitialsFromNameParts(parts = []) {
  return parts
    .flatMap(/* Делает: Преобразует элемент и разворачивает результат. Применение: передаётся как callback в flatMap внутри getInitialsFromNameParts. */ (part) =>
      String(part || '')
        .split('-')
        .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри flatMapCallback. */ (segment) => segment.trim())
        .filter(Boolean)
        .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри flatMapCallback. */ (segment) => {
          const firstLetter = segment.match(/[A-Za-zА-Яа-яЁё]/)?.[0];
          return firstLetter ? `${firstLetter.toUpperCase()}.` : '';
        })
        .filter(Boolean)
    )
    .join('');
}

/* Делает: Форматирует автора ссылки для цитирования. Применение: используется локально в файле backend/services/repositoryService.js. */
function formatCitationAuthor(author = '') {
  const normalized = String(author || '').trim();
  if (!normalized) {
    return '';
  }

  const commaParts = normalized.split(',').map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри formatCitationAuthor. */ (part) => part.trim()).filter(Boolean);
  if (commaParts.length === 2) {
    const surname = commaParts[0];
    const givenParts = commaParts[1].split(/\s+/).filter(Boolean);
    const initials = getInitialsFromNameParts(givenParts);
    return initials ? `${surname} ${initials}` : surname;
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return normalized;
  }

  const surname = parts[0];
  const initials = getInitialsFromNameParts(parts.slice(1));
  return initials ? `${surname} ${initials}` : surname;
}

/* Делает: Гарантирует sentence period. Применение: используется локально в файле backend/services/repositoryService.js. */
function ensureSentencePeriod(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  return /[.!?…]$/.test(normalized) ? normalized : `${normalized}.`;
}

/* Делает: Собирает ссылку для цитирования документа. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildDocumentCitation(meta = {}, documentName = '', language = 'ru') {
  const authorsSource = Array.isArray(meta.authorEntries) && meta.authorEntries.length > 0
    ? meta.authorEntries
        .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри buildDocumentCitation. */ (entry) => (language === 'en' ? entry?.authorEn : entry?.authorRu))
        .filter(Boolean)
        .join('; ')
    : language === 'en'
      ? meta.authorsEn
      : meta.authors;
  const authors = splitMetaList(authorsSource)
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри buildDocumentCitation. */ (author) => formatCitationAuthor(author))
    .filter(Boolean)
    .join(', ');
  const publicationYear = resolvePublicationYear(meta);
  const title = String(
    language === 'en'
      ? (meta?.titleEn || documentName || '')
      : (documentName || '')
  ).trim();
  const normalizedDoi = normalizeDoiValue(meta?.doi);
  const doiUrl = buildDoiUrl(meta?.doi);
  if (language === 'en') {
    const repositoryLabel = 'Geophysical Data Repository, Geophysical Survey of the Russian Academy of Sciences, Obninsk,';
    return [
      authors,
      publicationYear ? `(${publicationYear}).` : '',
      title ? `${title}.` : '',
      repositoryLabel,
      doiUrl,
    ].filter(Boolean).join(' ').trim();
  }

  const resourceLabel = language === 'en' ? '[Electronic resource]' : '[Электронный ресурс]';
  const repositoryLabel = 'Репозиторий геофизических данных';
  const publisherLabel = 'Обнинск: ФИЦ ЕГС РАН';
  const segments = [];

  if (authors) {
    segments.push(ensureSentencePeriod(authors));
  }

  if (title) {
    segments.push(`${title} ${resourceLabel}`);
  }

  segments.push(`// ${repositoryLabel}.`);

  const publisherAndYear = [publisherLabel, publicationYear].filter(Boolean).join(', ');
  if (publisherAndYear) {
    segments.push(`– ${publisherAndYear}.`);
  }

  if (normalizedDoi) {
    segments.push(`– DOI: ${normalizedDoi}`);
  }

  return segments.join(' ').trim();
}

/* Делает: Синхронизирует hronize citation links. Применение: используется локально в файле backend/services/repositoryService.js. */
function synchronizeCitationLinks(meta = {}, documentName = '') {
  return {
    ...meta,
    citationLink: buildDocumentCitation(meta, documentName, 'ru'),
    citationLinkEn: buildDocumentCitation(meta, documentName, 'en'),
  };
}

/* Делает: Собирает URL документа рабочей области. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildDocumentWorkspaceUrl(nodeId) {
  return `${repositoryPublicBaseUrl}/repository/workspace#${nodeId}`;
}

/* Делает: Собирает URL документа edit. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildDocumentEditUrl(nodeId) {
  return `${repositoryPublicBaseUrl}/repository/edit#${nodeId}`;
}

/* Делает: Собирает URL документа resource. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildDocumentResourceUrl(nodeId, mode = 'workspace') {
  return mode === 'edit' ? buildDocumentEditUrl(nodeId) : buildDocumentWorkspaceUrl(nodeId);
}

/* Делает: Экранирует reg exp. Применение: используется локально в файле backend/services/repositoryService.js. */
function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Делает: Выполняет repair legacy xml resource urls. Применение: используется локально в файле backend/services/repositoryService.js. */
async function repairLegacyXmlResourceUrls() {
  const { rows } = await repositoryPool.query(`
    SELECT id, xml_path
    FROM repository_nodes
    WHERE COALESCE(xml_path, '') <> ''
  `);

  await Promise.all(
    rows.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри repairLegacyXmlResourceUrls. */ async (row) => {
      const xmlFilePath = getManagedUploadFilePath(row.xml_path);
      if (!xmlFilePath) {
        return;
      }

      try {
        const xmlContent = await fs.readFile(xmlFilePath, 'utf-8');
        const legacyResourcePattern = new RegExp(
          `(<resource>https?:\\/\\/[^<]+)\\/repository#${escapeRegExp(row.id)}(<\\/resource>)`,
          'g'
        );
        const nextXmlContent = xmlContent.replace(
          legacyResourcePattern,
          `$1/repository/workspace#${row.id}$2`
        );

        if (nextXmlContent !== xmlContent) {
          await fs.writeFile(xmlFilePath, nextXmlContent, 'utf-8');
        }
      } catch (error) {
        console.warn(`Не удалось обновить XML resource для документа ${row.id}:`, error);
      }
    })
  );
}

/* Делает: Собирает имя XML файлового. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildXmlFileName(directoryNames = [], documentName = 'document') {
  const segments = [...directoryNames, documentName]
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри buildXmlFileName. */ (segment) => slugifySegment(segment, 'DOCUMENT').toLowerCase())
    .filter(Boolean);

  return `${segments.join('--') || 'document'}.xml`;
}

/* Делает: Собирает DOI базы данных collection. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildDatabaseCollectionDoi({ meta, directoryNames = [] }) {
  const publicationYear = resolvePublicationYear(meta) || new Date().getUTCFullYear();
  const journalCode = String(meta?.journalCode || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '') || DEFAULT_JOURNAL_CODE;
  const volume = String(meta?.volume || '')
    .trim()
    .replace(/[^\dA-Za-z.-]+/g, '') || slugifySegment(directoryNames.join('-') || 'collection', 'collection').toLowerCase();

  return `${repositoryDoiPrefix}/gsras.${journalCode}.${publicationYear}.${volume}.collection`;
}

/* Делает: Собирает URL базы данных collection resource. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildDatabaseCollectionResourceUrl(directoryNames = []) {
  if (!directoryNames.length) {
    return `${repositoryPublicBaseUrl}/repository`;
  }

  return `${repositoryPublicBaseUrl}/repository?collection=${encodeURIComponent(directoryNames.join('/'))}`;
}

/* Делает: Определяет тип dataset. Применение: используется локально в файле backend/services/repositoryService.js. */
function resolveDatasetType(meta) {
  const source = `${meta?.documentType || ''} ${meta?.recordType || ''}`.toLowerCase();
  return source.includes('collection') ? 'collection' : 'record';
}

/* Делает: Определяет аффилиации. Применение: используется локально в файле backend/services/repositoryService.js. */
function resolveAffiliations(meta) {
  const rawAffiliations = splitMetaList(meta?.affiliations);
  const fallbackAffiliation = xmlField(meta?.organizationEn || meta?.organization, repositoryContributorOrganization || 'test');

  return {
    items: rawAffiliations,
    fallback: fallbackAffiliation,
  };
}

/* Делает: Собирает XML contributors. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildContributorsXml(meta, indent = '          ') {
  const authorEntries = Array.isArray(meta?.authorEntries)
    ? meta.authorEntries
      .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри buildContributorsXml. */ (entry) => entry && typeof entry === 'object')
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри buildContributorsXml. */ (entry) => ({
        name: String(entry.authorEn || entry.authorRu || '').trim(),
        affiliation: String(entry.organizationEn || entry.organizationRu || '').trim(),
      }))
      .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри buildContributorsXml. */ (entry) => entry.name)
    : [];
  const authors = authorEntries.length > 0
    ? authorEntries.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри buildContributorsXml. */ (entry) => entry.name)
    : splitMetaList(meta?.authorsEn || meta?.authors);
  const { items: affiliations, fallback: fallbackAffiliation } = resolveAffiliations(meta);
  const organization = xmlField(meta?.organizationEn || meta?.organization, repositoryContributorOrganization || 'test');
  const lines = [];

  if (authors.length === 0) {
    lines.push(`${indent}<organization sequence="first" contributor_role="author">${escapeXml(organization)}</organization>`);
    lines.push(`${indent}<person_name sequence="additional" contributor_role="author">`);
    lines.push(`${indent}  <given_name>${escapeXml('test')}</given_name>`);
    lines.push(`${indent}  <surname>${escapeXml('test')}</surname>`);
    lines.push(`${indent}  <affiliation>${escapeXml(organization)}</affiliation>`);
    lines.push(`${indent}</person_name>`);
    return lines.join('\n');
  }

  authors.forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри buildContributorsXml. */ (author, index) => {
    const { givenName, surname } = splitPersonName(author, { surnameFirst: true });
    const sequence = index === 0 ? 'first' : 'additional';
    const entryAffiliation = authorEntries[index]?.affiliation;
    const affiliation = xmlField(entryAffiliation || affiliations[index] || affiliations[0] || fallbackAffiliation);

    lines.push(`${indent}<person_name sequence="${sequence}" contributor_role="author">`);
    lines.push(`${indent}  <given_name>${escapeXml(xmlField(givenName))}</given_name>`);
    lines.push(`${indent}  <surname>${escapeXml(xmlField(surname))}</surname>`);
    lines.push(`${indent}  <affiliation>${escapeXml(affiliation)}</affiliation>`);
    lines.push(`${indent}</person_name>`);
  });

  return lines.join('\n');
}

/* Делает: Нормализует тип record. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeRecordType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['database', 'dataset', 'journal_article', 'report', 'component'].includes(normalized)) {
    return normalized;
  }

  return 'database';
}

/* Делает: Извлекает текст DOI from. Применение: используется локально в файле backend/services/repositoryService.js. */
function extractDoiFromText(value) {
  const match = String(value || '').match(/10\.\d{4,9}\/[A-Z0-9._;()/:+-]+/i);
  return match ? match[0].replace(/[.,;]+$/, '') : '';
}

/* Делает: Определяет journal title. Применение: используется локально в файле backend/services/repositoryService.js. */
function resolveJournalTitle(meta) {
  const journalCode = String(meta?.journalCode || '').trim().toLowerCase();
  const knownTitles = {
    rjs: 'The Russian Journal of Seismology',
    zse: 'Earthquakes of Northern Eurasia',
    er: 'Earthquakes of Russia',
  };

  return knownTitles[journalCode] || xmlField(meta?.organizationEn || meta?.organization || repositoryInstitutionName);
}

/* Делает: Определяет DOI component parent. Применение: используется локально в файле backend/services/repositoryService.js. */
function resolveComponentParentDoi(meta, doi) {
  return (
    extractDoiFromText(meta?.parentDoi) ||
    extractDoiFromText(meta?.citationLink) ||
    extractDoiFromText(meta?.xmlPath) ||
    `${xmlField(meta?.doi || doi, `${repositoryDoiPrefix}/gsras.parent.test`)}.parent`
  );
}

/* Делает: Собирает XML titles. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildTitlesXml(title, indent = '') {
  return `${indent}<titles>\n${indent}  <title>${escapeXml(xmlField(title))}</title>\n${indent}</titles>`;
}

/* Делает: Собирает XML публикации даты. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildPublicationDateXml(publicationDate, indent = '', attributes = '') {
  const attr = attributes ? ` ${attributes}` : '';
  return `${indent}<publication_date${attr}>\n${indent}  <month>${publicationDate.getUTCMonth() + 1}</month>\n${indent}  <day>${publicationDate.getUTCDate()}</day>\n${indent}  <year>${publicationDate.getUTCFullYear()}</year>\n${indent}</publication_date>`;
}

/* Делает: Собирает XML базы данных даты. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildDatabaseDateXml(creationDate, publicationDate, indent = '') {
  return `${indent}<database_date>\n${indent}  <creation_date>\n${indent}    <year>${creationDate.getUTCFullYear()}</year>\n${indent}  </creation_date>\n${buildPublicationDateXml(publicationDate, `${indent}  `)}\n${indent}</database_date>`;
}

/* Делает: Собирает XML publisher. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildPublisherXml(indent = '') {
  return `${indent}<publisher>\n${indent}  <publisher_name>${escapeXml(xmlField(repositoryPublisherName))}</publisher_name>\n${indent}  <publisher_place>${escapeXml(xmlField(repositoryPublisherPlace))}</publisher_place>\n${indent}</publisher>`;
}

/* Делает: Собирает XML institution. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildInstitutionXml(indent = '') {
  return `${indent}<institution>\n${indent}  <institution_name>${escapeXml(xmlField(repositoryInstitutionName))}</institution_name>\n${indent}  <institution_place>${escapeXml(xmlField(repositoryInstitutionPlace))}</institution_place>\n${indent}</institution>`;
}

/* Делает: Собирает XML DOI данных. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildDoiDataXml({ doi, timestamp, resource }, indent = '') {
  return `${indent}<doi_data>\n${indent}  <doi>${escapeXml(xmlField(doi))}</doi>\n${indent}  <timestamp>${timestamp}</timestamp>\n${indent}  <resource>${escapeXml(xmlField(resource))}</resource>\n${indent}</doi_data>`;
}

/* Делает: Собирает XML издания metadata. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildJournalMetadataXml(meta, indent = '') {
  const journalTitle = resolveJournalTitle(meta);
  const abbreviatedTitle = String(meta?.journalCode || '').trim().toUpperCase();
  const lines = [
    `${indent}<journal_metadata language="en">`,
    `${indent}  <full_title>${escapeXml(journalTitle)}</full_title>`,
  ];

  if (abbreviatedTitle) {
    lines.push(`${indent}  <abbrev_title>${escapeXml(abbreviatedTitle)}</abbrev_title>`);
  }

  lines.push(`${indent}</journal_metadata>`);
  return lines.join('\n');
}

/* Делает: Собирает XML издания issue. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildJournalIssueXml(meta, publicationDate, indent = '') {
  const volume = String(meta?.volume || '').trim();
  if (!volume) {
    return '';
  }

  return `${indent}<journal_issue>\n${buildPublicationDateXml(publicationDate, `${indent}  `, 'media_type="online"')}\n${indent}  <journal_volume>\n${indent}    <volume>${escapeXml(xmlField(volume))}</volume>\n${indent}  </journal_volume>\n${indent}</journal_issue>`;
}

/* Делает: Собирает XML record типа body. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildRecordTypeBodyXml({
  recordType,
  title,
  description,
  contributorsXml,
  publicationDate,
  creationDate,
  doi,
  timestamp,
  resource,
  meta,
  directoryNames = [],
}) {
  switch (recordType) {
    case 'dataset': {
      const databaseTitle = xmlField(meta?.organizationEn || meta?.organization || repositoryInstitutionName);
      const datasetType = resolveDatasetType(meta);
      const datasetDateXml = buildDatabaseDateXml(creationDate, publicationDate);
      const datasetDescriptionXml = description
        ? `\n<description>${escapeXml(description)}</description>`
        : '';

      return `<database>\n<database_metadata language="en">\n${buildTitlesXml(databaseTitle)}\n${buildInstitutionXml()}\n</database_metadata>\n<dataset dataset_type="${datasetType}">\n<contributors>\n${contributorsXml}\n</contributors>\n${buildTitlesXml(title)}\n${datasetDateXml}${datasetDescriptionXml}\n${buildDoiDataXml({ doi, timestamp, resource })}\n</dataset>\n</database>`;
    }
    case 'journal_article': {
      const articleNumber = String(meta?.articleNumber || '').trim();
      const journalIssueXml = buildJournalIssueXml(meta, publicationDate);
      const publisherItemXml = articleNumber
        ? `\n<publisher_item>\n  <identifier id_type="article-number">${escapeXml(articleNumber)}</identifier>\n</publisher_item>`
        : '';

      return `<journal>\n${buildJournalMetadataXml(meta)}\n${journalIssueXml ? `${journalIssueXml}\n` : ''}<journal_article publication_type="full_text">\n${buildTitlesXml(title)}\n<contributors>\n${contributorsXml}\n</contributors>\n${buildPublicationDateXml(publicationDate, '', 'media_type="online"')}${publisherItemXml}\n${buildDoiDataXml({ doi, timestamp, resource })}\n</journal_article>\n</journal>`;
    }
    case 'report': {
      const reportNumber = String(meta?.articleNumber || '').trim();
      const reportNumberXml = reportNumber
        ? `\n<publisher_item>\n  <identifier id_type="report-number">${escapeXml(reportNumber)}</identifier>\n</publisher_item>`
        : '';

      return `<report-paper>\n<report-paper_metadata language="en">\n<contributors>\n${contributorsXml}\n</contributors>\n${buildTitlesXml(title)}\n${buildPublicationDateXml(publicationDate, '', 'media_type="online"')}\n${buildPublisherXml()}\n${buildInstitutionXml()}${reportNumberXml}\n${buildDoiDataXml({ doi, timestamp, resource })}\n</report-paper_metadata>\n</report-paper>`;
    }
    case 'component': {
      const parentDoi = resolveComponentParentDoi(meta, doi);
      return `<sa_component parent_doi="${escapeXml(parentDoi)}">\n<component_list>\n<component parent_relation="isPartOf">\n${buildTitlesXml(title)}\n<description>${escapeXml(description)}</description>\n<format mime_type="text/html"/>\n${buildDoiDataXml({ doi, timestamp, resource })}\n</component>\n</component_list>\n</sa_component>`;
    }
    case 'database':
    default:
      return `<database>\n<database_metadata language="en">\n<contributors>\n${contributorsXml}\n</contributors>\n${buildTitlesXml(title)}\n${buildDatabaseDateXml(creationDate, publicationDate)}\n<description>${escapeXml(description)}</description>\n${buildPublisherXml()}\n${buildInstitutionXml()}\n${buildDoiDataXml({ doi, timestamp, resource })}\n</database_metadata>\n</database>`;
  }
}

/* Делает: Собирает XML репозиторного. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildRepositoryXml({ nodeId, name, meta, doi, resourceUrl, createdAt, directoryNames = [] }) {
  const normalizedMeta = normalizeLegacyDocumentMeta(meta);
  const publicationDate = resolvePublicationDate(normalizedMeta);
  const creationDate = resolveCreationDate(createdAt, publicationDate);
  const timestamp = createCrossrefTimestamp(new Date());
  const doiBatchId = createDoiBatchId(nodeId);
  const contributorsXml = buildContributorsXml(normalizedMeta);
  const title = xmlField(normalizedMeta?.titleEn || name);
  const description = xmlField(normalizedMeta?.descriptionEn || normalizedMeta?.annotation);
  const resource = xmlField(resourceUrl);
  const depositorName = xmlPersonName(repositoryDepositorName, 'Repository depositor');
  const depositorEmail = xmlField(repositoryDepositorEmail);
  const recordType = normalizeRecordType(normalizedMeta?.recordType);
  const bodyXml = buildRecordTypeBodyXml({
    recordType,
    title,
    description,
    contributorsXml,
    publicationDate,
    creationDate,
    doi,
    timestamp,
    resource,
    meta: normalizedMeta,
    directoryNames,
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<doi_batch xmlns="http://www.crossref.org/schema/${crossrefSchemaVersion}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="${crossrefSchemaVersion}" xsi:schemaLocation="http://www.crossref.org/schema/${crossrefSchemaVersion} http://www.crossref.org/schema/deposit/crossref${crossrefSchemaVersion}.xsd">
<head>
<doi_batch_id>${escapeXml(doiBatchId)}</doi_batch_id>
<timestamp>${timestamp}</timestamp>
<depositor>
<depositor_name>${escapeXml(depositorName)}</depositor_name>
<email_address>${escapeXml(depositorEmail)}</email_address>
</depositor>
<registrant>${escapeXml(xmlField(repositoryRegistrant))}</registrant>
</head>
<body>
${bodyXml}
</body>
</doi_batch>
`;
}

/* Делает: Создаёт или обновляет XML сгенерированного. Применение: используется локально в файле backend/services/repositoryService.js. */
async function upsertGeneratedXml({ nodeId, name, meta, doi, existingXmlPath, createdAt }) {
  await ensureUploadsInitialized();

  const existingFilePath = existingXmlPath ? getManagedUploadFilePath(existingXmlPath) : null;
  const storage = resolveDocumentStorageInfo({
    documentId: nodeId,
    documentName: resolveXmlDocumentName(meta, name),
    publicationDate: meta?.publicationDate,
    createdAt,
  });
  const fileName = `${storage.documentSlug}.xml`;
  const filePath = path.join(storage.absoluteDir, fileName);
  const resourceUrl = buildDocumentResourceUrl(nodeId);
  const xmlContent = buildRepositoryXml({ nodeId, name, meta, doi, resourceUrl, createdAt, directoryNames: [] });

  await fs.mkdir(storage.absoluteDir, { recursive: true });
  await fs.writeFile(filePath, xmlContent, 'utf-8');

  if (existingFilePath && path.resolve(existingFilePath) !== path.resolve(filePath)) {
    await deleteManagedUpload(existingXmlPath);
  }

  return buildManagedUploadUrl(storage.relativeDir, fileName);
}

/* Делает: Получает путь управляемого загрузки относительного. Применение: используется локально в файле backend/services/repositoryService.js. */
function getManagedUploadRelativePath(url) {
  if (typeof url !== 'string') {
    return null;
  }

  const normalizedUrl = String(url).trim().replace(/\\/g, '/');
  let pathname = normalizedUrl;

  try {
    if (/^[a-z]+:\/\//i.test(normalizedUrl)) {
      pathname = new URL(normalizedUrl).pathname;
    }
  } catch {
    return null;
  }

  const cleanPathname = pathname.split(/[?#]/, 1)[0];
  const decodedPathname = (/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в внешний вызов внутри getManagedUploadRelativePath. */ () => {
    try {
      return decodeURI(cleanPathname);
    } catch {
      return cleanPathname;
    }
  })();
  const normalizedPathname = decodedPathname.startsWith('/') ? decodedPathname : `/${decodedPathname}`;
  if (!normalizedPathname.startsWith(managedUploadPrefix)) {
    return null;
  }

  const relativePath = normalizedPathname.slice(1).replace(/^\/+/, '');
  return relativePath || null;
}

/* Делает: Получает каталог управляемого загрузки документа. Применение: используется локально в файле backend/services/repositoryService.js. */
function getManagedUploadDocumentDirectory(url) {
  const relativePath = getManagedUploadRelativePath(url);
  if (!relativePath) {
    return '';
  }

  const segments = relativePath.split('/').filter(Boolean);
  if (segments.length < 5) {
    return '';
  }

  if (segments[0] !== 'uploads' || segments[1] !== 'repository' || segments[2] === 'xml') {
    return '';
  }

  return String(segments[3] || '').trim();
}

/* Делает: Проверяет URL управляемого загрузки. Применение: используется локально в файле backend/services/repositoryService.js. */
function isManagedUploadUrl(url) {
  return Boolean(getManagedUploadRelativePath(url));
}

/* Делает: Получает путь управляемого загрузки файлового. Применение: используется локально в файле backend/services/repositoryService.js. */
function getManagedUploadFilePath(url) {
  if (typeof url !== 'string') {
    return null;
  }

  const normalizedUrl = String(url).trim().replace(/\\/g, '/');
  let pathname = normalizedUrl;

  try {
    if (/^[a-z]+:\/\//i.test(normalizedUrl)) {
      pathname = new URL(normalizedUrl).pathname;
    }
  } catch {
    return null;
  }

  const cleanPathname = pathname.split(/[?#]/, 1)[0];
  const decodedPathname = (/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в внешний вызов внутри getManagedUploadFilePath. */ () => {
    try {
      return decodeURI(cleanPathname);
    } catch {
      return cleanPathname;
    }
  })();
  const normalizedPathname = decodedPathname.startsWith('/') ? decodedPathname : `/${decodedPathname}`;

  if (normalizedPathname.startsWith(managedXmlPrefix)) {
    const xmlRelativePath = normalizedPathname.slice(managedXmlPrefix.length).replace(/^\/+/, '');
    if (!xmlRelativePath) {
      return null;
    }

    const xmlResolvedPath = path.resolve(repositoryXmlDir, xmlRelativePath);
    const relativeToXmlRoot = path.relative(managedXmlRootPath, xmlResolvedPath);
    if (relativeToXmlRoot.startsWith('..') || path.isAbsolute(relativeToXmlRoot)) {
      return null;
    }

    return xmlResolvedPath;
  }

  if (!normalizedPathname.startsWith(managedUploadPrefix)) {
    return null;
  }

  const relativePath = normalizedPathname.slice(managedUploadPrefix.length).replace(/^\/+/, '');
  if (!relativePath) {
    return null;
  }

  const uploadResolvedPath = path.resolve(managedUploadRootPath, relativePath);
  const relativeToUploadRoot = path.relative(managedUploadRootPath, uploadResolvedPath);
  if (relativeToUploadRoot.startsWith('..') || path.isAbsolute(relativeToUploadRoot)) {
    return null;
  }

  return uploadResolvedPath;
}

/* Делает: Удаляет загрузку управляемого. Применение: используется локально в файле backend/services/repositoryService.js. */
async function deleteManagedUpload(url) {
  const filePath = getManagedUploadFilePath(url);
  if (!filePath) {
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

/* Делает: Собирает блоки управляемого загрузки urls from. Применение: используется локально в файле backend/services/repositoryService.js. */
function collectManagedUploadUrlsFromBlocks(blocks = []) {
  return blocks
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри collectManagedUploadUrlsFromBlocks. */ (block) => (block.type === 'image' || block.type === 'file') && isManagedUploadUrl(block.url))
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри collectManagedUploadUrlsFromBlocks. */ (block) => block.url);
}

/* Делает: Собирает managed upload urls. Применение: используется локально в файле backend/services/repositoryService.js. */
function collectManagedUploadUrls(node) {
  if (!node) {
    return [];
  }

  if (node.type === 'document') {
    const xmlUrl = node.meta?.xmlPath && isManagedUploadUrl(node.meta.xmlPath) ? [node.meta.xmlPath] : [];
    return [...collectManagedUploadUrlsFromBlocks(node.blocks || []), ...xmlUrl];
  }

  return (node.children || []).flatMap(/* Делает: Преобразует элемент и разворачивает результат. Применение: передаётся как callback в flatMap внутри collectManagedUploadUrls. */ (child) => collectManagedUploadUrls(child));
}

/* Делает: Удаляет загрузки управляемого. Применение: используется локально в файле backend/services/repositoryService.js. */
async function deleteManagedUploads(urls) {
  const uniqueUrls = [...new Set((urls || []).filter(Boolean))];
  for (const url of uniqueUrls) {
    await deleteManagedUpload(url);
  }
}

/* Делает: Гарантирует uploads initialized. Применение: используется локально в файле backend/services/repositoryService.js. */
async function ensureUploadsInitialized() {
  await fs.mkdir(repositoryUploadsDir, { recursive: true });
  await fs.mkdir(repositoryXmlDir, { recursive: true });
}

/* Делает: Форматирует byte limit. Применение: используется локально в файле backend/services/repositoryService.js. */
function formatByteLimit(bytes) {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} МБ`;
}

/* Делает: Выполняет URL strip base64 данных. Применение: используется локально в файле backend/services/repositoryService.js. */
function stripBase64DataUrl(value) {
  const normalized = String(value || '').trim();
  const separatorIndex = normalized.indexOf(',');
  return normalized.startsWith('data:') && separatorIndex !== -1
    ? normalized.slice(separatorIndex + 1)
    : normalized;
}

/* Делает: Выполняет estimate base64 decoded size. Применение: используется локально в файле backend/services/repositoryService.js. */
function estimateBase64DecodedSize(value) {
  const normalized = stripBase64DataUrl(value).replace(/\s+/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

/* Делает: Декодирует контент загрузки. Применение: используется локально в файле backend/services/repositoryService.js. */
function decodeUploadContent(content) {
  const normalized = stripBase64DataUrl(content).replace(/\s+/g, '');
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw createRepositoryError('Файл должен быть передан в формате base64.', 400, 'UPLOAD_CONTENT_INVALID');
  }

  if (estimateBase64DecodedSize(normalized) > repositoryMaxUploadBytes) {
    throw createRepositoryError(
      `Размер файла превышает лимит ${formatByteLimit(repositoryMaxUploadBytes)}.`,
      413,
      'UPLOAD_TOO_LARGE'
    );
  }

  const buffer = Buffer.from(normalized, 'base64');
  if (buffer.byteLength > repositoryMaxUploadBytes) {
    throw createRepositoryError(
      `Размер файла превышает лимит ${formatByteLimit(repositoryMaxUploadBytes)}.`,
      413,
      'UPLOAD_TOO_LARGE'
    );
  }

  return buffer;
}

/* Делает: Проверяет blocked hostname. Применение: используется локально в файле backend/services/repositoryService.js. */
function isBlockedHostname(hostname) {
  const normalized = String(hostname || '').replace(/\.$/, '').toLowerCase();
  return (
    !normalized ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === 'metadata.google.internal'
  );
}

/* Делает: Проверяет private ip address. Применение: используется локально в файле backend/services/repositoryService.js. */
function isPrivateIpAddress(address) {
  const normalized = String(address || '').trim().toLowerCase();
  const mappedIpv4 = normalized.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIpv4) {
    return isPrivateIpAddress(mappedIpv4[1]);
  }

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    const [first, second] = normalized.split('.').map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри isPrivateIpAddress. */ (part) => Number(part));
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }

  if (ipVersion === 6) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('ff')
    );
  }

  return true;
}

/* Делает: Проверяет условие и выбрасывает ошибку при нарушении URL безопасного внешнего download. Применение: используется локально в файле backend/services/repositoryService.js. */
async function assertSafeExternalDownloadUrl(sourceUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(sourceUrl || '').trim());
  } catch {
    throw createRepositoryError('Укажите корректную ссылку http(s).', 400, 'FILE_SOURCE_URL_INVALID');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw createRepositoryError('Для файла укажите корректную ссылку http(s).', 400, 'FILE_SOURCE_URL_INVALID');
  }

  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(hostname)) {
    throw createRepositoryError('Ссылка на локальный или служебный адрес недоступна.', 400, 'REMOTE_FILE_URL_FORBIDDEN');
  }

  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true, verbatim: false }).catch(/* Делает: Обрабатывает ошибку предыдущего промиса. Применение: передаётся как callback в catch внутри assertSafeExternalDownloadUrl. */ () => []);

  if (!addresses.length || addresses.some(/* Делает: Проверяет наличие подходящего элемента в коллекции. Применение: передаётся как callback в some внутри assertSafeExternalDownloadUrl. */ (entry) => isPrivateIpAddress(entry.address))) {
    throw createRepositoryError('Ссылка на локальный или служебный адрес недоступна.', 400, 'REMOTE_FILE_URL_FORBIDDEN');
  }

  return parsedUrl.toString();
}

/* Делает: Запрашивает URL внешнего download. Применение: используется локально в файле backend/services/repositoryService.js. */
async function fetchExternalDownloadUrl(sourceUrl, redirectCount = 0) {
  const safeUrl = await assertSafeExternalDownloadUrl(sourceUrl);
  const response = await fetch(safeUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(repositoryRemoteDownloadTimeoutMs),
  });

  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    if (redirectCount >= 3) {
      throw createRepositoryError('Слишком много перенаправлений при скачивании файла.', 400, 'REMOTE_FILE_REDIRECT_LIMIT');
    }

    const nextUrl = new URL(response.headers.get('location'), safeUrl).toString();
    return fetchExternalDownloadUrl(nextUrl, redirectCount + 1);
  }

  return { response, finalUrl: safeUrl };
}

/* Делает: Читает response buffer with limit. Применение: используется локально в файле backend/services/repositoryService.js. */
async function readResponseBufferWithLimit(response) {
  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isInteger(contentLength) && contentLength > repositoryMaxUploadBytes) {
    throw createRepositoryError(
      `Размер файла превышает лимит ${formatByteLimit(repositoryMaxUploadBytes)}.`,
      413,
      'REMOTE_FILE_TOO_LARGE'
    );
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > repositoryMaxUploadBytes) {
      throw createRepositoryError(
        `Размер файла превышает лимит ${formatByteLimit(repositoryMaxUploadBytes)}.`,
        413,
        'REMOTE_FILE_TOO_LARGE'
      );
    }
    return buffer;
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > repositoryMaxUploadBytes) {
      throw createRepositoryError(
        `Размер файла превышает лимит ${formatByteLimit(repositoryMaxUploadBytes)}.`,
        413,
        'REMOTE_FILE_TOO_LARGE'
      );
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, totalBytes);
}

/* Делает: Получает document created at. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getDocumentCreatedAt(documentId) {
  if (!documentId || documentId === 'root') {
    return null;
  }

  const { rows } = await repositoryPool.query(
    `SELECT created_at
       FROM repository_nodes
      WHERE id = $1
      LIMIT 1`,
    [documentId]
  );

  return rows[0]?.created_at || null;
}

/* Делает: Проверяет условие и выбрасывает ошибку при нарушении документ actor can загрузки for. Применение: используется локально в файле backend/services/repositoryService.js. */
async function assertActorCanUploadForDocument(documentId, actor = null) {
  const normalizedDocumentId = String(documentId || '').trim();
  if (!normalizedDocumentId || normalizedDocumentId === 'root') {
    throw createRepositoryError('documentId is required for repository uploads.', 400, 'UPLOAD_DOCUMENT_REQUIRED');
  }

  if (!actor) {
    throw createRepositoryError('Требуется авторизация в репозитории.', 401, 'REPOSITORY_AUTH_REQUIRED');
  }

  const publishedRow = await getNodeRow(normalizedDocumentId);
  if (publishedRow) {
    ensureDocumentEditable(publishedRow, actor, 'загружать файлы для');
    return;
  }

  const actorOwnerKey = getRepositoryActorDraftOwnerKey(actor);
  let draftRow = await getPersonalDraftRowByOwner(normalizedDocumentId, actorOwnerKey);
  if (!draftRow && (actor.role === 'admin' || actor.role === 'editor')) {
    draftRow = await getLatestPersonalDraftRowByDocument(normalizedDocumentId);
  }

  if (!draftRow) {
    throw createRepositoryError('Документ для загрузки файла не найден.', 404, 'UPLOAD_DOCUMENT_NOT_FOUND');
  }

  const draftDocument = normalizeDraftDocumentRow(draftRow);
  if (!canActorViewDocument(draftDocument, actor)) {
    throw createRepositoryError('Нет доступа к документу для загрузки файла.', 403, 'UPLOAD_DOCUMENT_FORBIDDEN');
  }

  const status = normalizeDocumentStatus(draftRow.document_status);
  if (status === DOCUMENT_STATUS_UNDER_REVIEW && actor?.role !== 'admin') {
    throw createRepositoryError(
      'Документ находится в статусе, недоступном для загрузки файлов.',
      403,
      'UPLOAD_DOCUMENT_LOCKED'
    );
  }

  if (status === DOCUMENT_STATUS_VERIFIED) {
    throw createRepositoryError(
      'Документ находится в статусе, недоступном для загрузки файлов.',
      403,
      'UPLOAD_DOCUMENT_LOCKED'
    );
  }
}

/* Делает: Сохраняет ресурс загруженного. Применение: используется локально в файле backend/services/repositoryService.js. */
async function saveUploadedAsset({
  fileName,
  content,
  mimeType,
  kind,
  documentId = '',
  documentName = '',
  publicationDate = '',
  blockOrder = null,
  desiredName = '',
  storageKey = '',
  actor = null,
}) {
  await ensureUploadsInitialized();
  await assertActorCanUploadForDocument(documentId, actor);

  const safeName = sanitizeFileName(fileName, mimeType);
  const extension = normalizeFileExtension(path.extname(safeName)) || inferExtensionFromMimeType(mimeType);
  const documentCreatedAt = await getDocumentCreatedAt(documentId);
  const storage = resolveDocumentStorageInfo({
    documentId,
    documentName: documentName || safeName || kind,
    publicationDate,
    createdAt: documentCreatedAt || new Date(),
    storageKey,
  });
  const fallbackBaseName = buildStoredAssetBaseName({
    documentSlug: storage.documentSlug,
    blockOrder,
  });
  const preferredBaseName = sanitizeFileStem(desiredName || safeName, fallbackBaseName);
  const storedFileName = await buildUniqueStoredFileName({
    absoluteDir: storage.absoluteDir,
    baseName: preferredBaseName,
    extension,
  });
  const filePath = path.join(storage.absoluteDir, storedFileName);
  const buffer = decodeUploadContent(content);

  await fs.mkdir(storage.absoluteDir, { recursive: true });
  await fs.writeFile(filePath, buffer);

  return {
    fileName: storedFileName,
    fileSize: buffer.byteLength,
    mimeType: mimeType || null,
    url: buildManagedUploadUrl(storage.relativeDir, storedFileName),
  };
}

/* Делает: Удаляет ресурс загруженного. Применение: используется локально в файле backend/services/repositoryService.js. */
async function deleteUploadedAsset({ url, documentId = '', actor = null }) {
  await ensureUploadsInitialized();
  await assertActorCanUploadForDocument(documentId, actor);

  if (!isManagedUploadUrl(url)) {
    throw createRepositoryError('Удалить можно только файл, загруженный в репозиторий.', 400, 'UPLOAD_DELETE_INVALID_URL');
  }

  const uploadDocumentDirectory = getManagedUploadDocumentDirectory(url);
  const expectedDocumentDirectory = normalizeStorageKey(documentId);

  if (!uploadDocumentDirectory || uploadDocumentDirectory !== expectedDocumentDirectory) {
    throw createRepositoryError('Нет доступа к удалению этого файла.', 403, 'UPLOAD_DELETE_FORBIDDEN');
  }

  await deleteManagedUpload(url);

  return { ok: true };
}

/* Делает: Проверяет URL http. Применение: используется локально в файле backend/services/repositoryService.js. */
function isHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/* Делает: Получает URL файлового исходного. Применение: используется локально в файле backend/services/repositoryService.js. */
function getFileSourceUrl(block) {
  const sourceUrl = String(block?.sourceUrl || '').trim();
  if (sourceUrl) {
    return sourceUrl;
  }

  const legacyUrl = String(block?.url || '').trim();
  if (legacyUrl && !isManagedUploadUrl(legacyUrl) && isHttpUrl(legacyUrl)) {
    return legacyUrl;
  }

  return '';
}

/* Делает: Выполняет URL download файлового from внешнего. Применение: используется локально в файле backend/services/repositoryService.js. */
async function downloadFileFromExternalUrl({
  sourceUrl,
  desiredName,
  documentId,
  documentName,
  publicationDate,
  createdAt,
  blockOrder,
}) {
  await ensureUploadsInitialized();

  let download;
  try {
    download = await fetchExternalDownloadUrl(sourceUrl);
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw createRepositoryError('Истекло время скачивания файла по ссылке.', 408, 'REMOTE_FILE_DOWNLOAD_TIMEOUT');
    }
    throw error;
  }

  const { response, finalUrl } = download;
  if (!response.ok) {
    throw createRepositoryError(
      `Не удалось скачать файл по ссылке: ${response.status} ${response.statusText}`.trim(),
      400,
      'REMOTE_FILE_DOWNLOAD_FAILED'
    );
  }

  const contentType = response.headers.get('content-type') || '';
  const remoteFileName = (/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в внешний вызов внутри downloadFileFromExternalUrl. */ () => {
    try {
      return path.basename(new URL(finalUrl).pathname);
    } catch {
      return '';
    }
  })();
  const urlExtension = (/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в внешний вызов внутри downloadFileFromExternalUrl. */ () => {
    try {
      return normalizeFileExtension(path.extname(new URL(finalUrl).pathname));
    } catch {
      return '';
    }
  })();
  const extension = urlExtension || inferExtensionFromMimeType(contentType);
  const storage = resolveDocumentStorageInfo({
    documentId,
    documentName: documentName || desiredName || 'file',
    publicationDate,
    createdAt: createdAt || new Date(),
  });
  const fallbackBaseName = buildStoredAssetBaseName({
    documentSlug: storage.documentSlug,
    blockOrder,
  });
  const preferredBaseName = sanitizeFileStem(
    desiredName || sanitizeFileName(remoteFileName, contentType),
    fallbackBaseName
  );
  const storedFileName = await buildUniqueStoredFileName({
    absoluteDir: storage.absoluteDir,
    baseName: preferredBaseName,
    extension,
  });
  const filePath = path.join(storage.absoluteDir, storedFileName);
  const buffer = await readResponseBufferWithLimit(response);

  await fs.mkdir(storage.absoluteDir, { recursive: true });
  await fs.writeFile(filePath, buffer);

  return {
    fileName: storedFileName,
    fileSize: buffer.byteLength,
    mimeType: contentType || null,
    url: buildManagedUploadUrl(storage.relativeDir, storedFileName),
  };
}

/* Делает: Синхронизирует документ hronize управляемого файлового with. Применение: используется локально в файле backend/services/repositoryService.js. */
async function synchronizeManagedFileWithDocument({
  currentUrl,
  desiredName,
  documentId,
  documentName,
  publicationDate,
  createdAt,
  blockOrder,
  fallbackFileName = '',
}) {
  const normalizedLabel = sanitizeFileStem(desiredName || fallbackFileName, 'file');
  const currentFilePath = getManagedUploadFilePath(currentUrl);
  if (!currentFilePath) {
    return { url: currentUrl, fileName: '', fileSize: undefined, mimeType: null };
  }
  if (!(await pathExists(currentFilePath))) {
    throw createRepositoryError(
      `Прикрепленный файл "${desiredName || fallbackFileName || 'без названия'}" не найден на сервере. Прикрепите его заново и повторите сохранение.`,
      409,
      'MANAGED_FILE_MISSING'
    );
  }

  const currentExtension = normalizeFileExtension(path.extname(currentFilePath));
  const currentFileName = path.basename(currentFilePath);
  const storage = resolveDocumentStorageInfo({
    documentId,
    documentName: documentName || fallbackFileName || 'file',
    publicationDate,
    createdAt: createdAt || new Date(),
  });
  await fs.mkdir(storage.absoluteDir, { recursive: true });

  const nextFileName = await buildUniqueStoredFileName({
    absoluteDir: storage.absoluteDir,
    baseName: normalizedLabel,
    extension: currentExtension,
    ignoreFilePath: currentFilePath,
  });
  const nextFilePath = path.join(storage.absoluteDir, nextFileName);

  if (path.resolve(currentFilePath) !== path.resolve(nextFilePath)) {
    try {
      await fs.rename(currentFilePath, nextFilePath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw createRepositoryError(
          `Прикрепленный файл "${desiredName || fallbackFileName || 'без названия'}" не найден на сервере. Прикрепите его заново и повторите сохранение.`,
          409,
          'MANAGED_FILE_MISSING'
        );
      }

      throw error;
    }
  }

  const stat = await fs.stat(nextFilePath).catch(/* Делает: Обрабатывает ошибку предыдущего промиса. Применение: передаётся как callback в catch внутри synchronizeManagedFileWithDocument. */ () => null);

  return {
    url: buildManagedUploadUrl(storage.relativeDir, nextFileName),
    fileName: nextFileName,
    fileSize: stat?.size,
    mimeType: null,
  };
}

/* Делает: Синхронизирует хранилище hronize файлового блоков for. Применение: используется локально в файле backend/services/repositoryService.js. */
async function synchronizeFileBlocksForStorage({
  documentId,
  blocks,
  existingBlocks,
  documentName,
  publicationDate,
  createdAt,
}) {
  const existingBlocksById = new Map(
    Array.isArray(existingBlocks)
      ? existingBlocks.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри synchronizeFileBlocksForStorage. */ (block) => [block?.id, block])
      : []
  );

  const synchronizedBlocks = [];

  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== 'object' || block.type !== 'file') {
      synchronizedBlocks.push(block);
      continue;
    }

    const normalizedLabel = String(block.label || '').trim();
    const sourceUrl = getFileSourceUrl(block);
    const hasManagedFile = Boolean(block.url && isManagedUploadUrl(block.url));
    const previousBlock = existingBlocksById.get(block.id);
    const previousLabel = String(previousBlock?.label || '').trim();
    const previousSourceUrl = getFileSourceUrl(previousBlock);
    const blockOrder = Math.max(
      1,
      (Array.isArray(blocks) ? blocks.findIndex(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в findIndex внутри synchronizeFileBlocksForStorage. */ (item) => item?.id === block.id) : -1) + 1
    );

    if ((sourceUrl || block.url || block.fileName) && !normalizedLabel) {
      throw createRepositoryError('Для каждого файла укажите название перед сохранением.', 400, 'FILE_LABEL_REQUIRED');
    }

    if (sourceUrl && hasManagedFile && !previousSourceUrl) {
      throw createRepositoryError(
        `Для файла "${normalizedLabel || 'без названия'}" выберите только один способ: ссылка или загрузка с компьютера.`,
        400,
        'FILE_SOURCE_CONFLICT'
      );
    }

    if (!sourceUrl) {
      if (hasManagedFile && normalizedLabel) {
        const renamed = await synchronizeManagedFileWithDocument({
          currentUrl: block.url,
          desiredName: normalizedLabel,
          documentId,
          documentName,
          publicationDate,
          createdAt,
          blockOrder,
          fallbackFileName: block.fileName || previousBlock?.fileName || normalizedLabel,
        });
        synchronizedBlocks.push({
          ...block,
          url: renamed.url,
          fileName: renamed.fileName || block.fileName,
          fileSize: renamed.fileSize ?? block.fileSize,
        });
        continue;
      }

      synchronizedBlocks.push({
        ...block,
        sourceUrl: '',
      });
      continue;
    }

    if (!isHttpUrl(sourceUrl)) {
      throw createRepositoryError(
        `Для файла "${normalizedLabel || 'без названия'}" укажите корректную ссылку http(s).`,
        400,
        'FILE_SOURCE_URL_INVALID'
      );
    }

    if (
      block.url &&
      isManagedUploadUrl(block.url) &&
      sourceUrl === previousSourceUrl &&
      normalizedLabel === previousLabel
    ) {
      synchronizedBlocks.push({
        ...block,
        sourceUrl,
      });
      continue;
    }

    const downloaded = await downloadFileFromExternalUrl({
      sourceUrl,
      desiredName: normalizedLabel,
      documentId,
      documentName,
      publicationDate,
      createdAt,
      blockOrder,
    });

    synchronizedBlocks.push({
      ...block,
      sourceUrl,
      url: downloaded.url,
      fileName: downloaded.fileName,
      fileSize: downloaded.fileSize,
      mimeType: downloaded.mimeType || block.mimeType,
    });
  }

  return synchronizedBlocks;
}

/* Делает: Нормализует метаданные черновика. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeDraftMeta(meta = {}, actor = null) {
  if (!meta || typeof meta !== 'object') {
    return {};
  }

  return normalizeLegacyDocumentMeta(actor ? sanitizeMetaPatchByActor(meta, actor) : meta);
}

/* Делает: Нормализует блоки черновика. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeDraftBlocks(blocks) {
  return Array.isArray(blocks) ? clone(blocks) : [];
}

/* Делает: Нормализует optional timestamp. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeOptionalTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/* Делает: Нормализует строку персонального черновика. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizePersonalDraftRow(row) {
  if (!row) {
    return null;
  }

  return {
    name: typeof row.name === 'string' ? row.name : '',
    meta: normalizeDraftMeta(row.meta || {}),
    blocks: normalizeDraftBlocks(row.blocks),
    documentStatus: normalizeDocumentStatus(row.document_status),
    reviewRequestedAt: row.review_requested_at ? new Date(row.review_requested_at).toISOString() : undefined,
    verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : undefined,
    savedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    sourceUpdatedAt: row.source_updated_at ? new Date(row.source_updated_at).toISOString() : undefined,
  };
}

/* Делает: Нормализует строку персонального черновика db. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizePersonalDraftDbRow(row) {
  if (!row) {
    return null;
  }

  return {
    userId: String(row.user_id || ''),
    documentId: String(row.document_id || ''),
    ...normalizePersonalDraftRow(row),
  };
}

/* Делает: Получает ключ репозиторного actor черновика owner. Применение: используется локально в файле backend/services/repositoryService.js. */
function getRepositoryActorDraftOwnerKey(actor) {
  const actorId = actor?.id;
  if (actorId !== undefined && actorId !== null) {
    const normalizedId = String(actorId).trim();
    if (normalizedId) {
      return normalizedId;
    }
  }

  const actorEmail = String(actor?.email || '').trim().toLowerCase();
  if (actorEmail) {
    return `email:${actorEmail}`;
  }

  throw createRepositoryError('Требуется авторизация в репозитории.', 401, 'REPOSITORY_AUTH_REQUIRED');
}

/* Делает: Получает ключ документа creator черновика owner. Применение: используется локально в файле backend/services/repositoryService.js. */
function getDocumentCreatorDraftOwnerKey(rowOrDocument) {
  const meta = normalizeLegacyDocumentMeta(rowOrDocument?.meta || {});
  return normalizeActorId(meta.creatorUserId);
}

/* Делает: Получает ключ документа черновика owner. Применение: используется локально в файле backend/services/repositoryService.js. */
function getDocumentDraftOwnerKey(rowOrDocument, actor = null) {
  return getDocumentCreatorDraftOwnerKey(rowOrDocument) || getRepositoryActorDraftOwnerKey(actor);
}

/* Делает: Получает personal draft row by owner. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getPersonalDraftRowByOwner(documentId, userId) {
  if (!documentId || !userId) {
    return null;
  }

  const { rows } = await authPool.query(
    `SELECT user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
            created_at, updated_at, source_updated_at
     FROM repository_personal_drafts
     WHERE user_id = $1 AND document_id = $2`,
    [userId, documentId]
  );

  return rows[0] || null;
}

/* Делает: Получает документ последнего персонального черновика строки by. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getLatestPersonalDraftRowByDocument(documentId) {
  if (!documentId) {
    return null;
  }

  const { rows } = await authPool.query(
    `SELECT user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
            created_at, updated_at, source_updated_at
     FROM repository_personal_drafts
     WHERE document_id = $1
     LIMIT 1`,
    [documentId]
  );

  return rows[0] || null;
}

/* Делает: Получает DOI последнего персонального черновика строки by. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getLatestPersonalDraftRowByDoi(doi) {
  const normalizedDoi = normalizeDoiLookupValue(doi);
  if (!normalizedDoi) {
    return null;
  }

  const { rows } = await authPool.query(
    `SELECT user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
            created_at, updated_at, source_updated_at
     FROM repository_personal_drafts
     WHERE LOWER(COALESCE(meta ->> 'doi', '')) = $1
     ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
     LIMIT 1`,
    [normalizedDoi]
  );

  return rows[0] || null;
}

/* Делает: Получает DOI опубликованного строки by. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getPublishedRowByDoi(doi) {
  const normalizedDoi = normalizeDoiLookupValue(doi);
  if (!normalizedDoi) {
    return null;
  }

  const { rows } = await repositoryPool.query(
    `SELECT id, name, meta, info, document_type, doi, xml_path, blocks,
            updated_at, created_at, document_status, review_requested_at, verified_at
     FROM repository_nodes
     WHERE LOWER(COALESCE(doi, '')) = $1
     ORDER BY verified_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
     LIMIT 1`,
    [normalizedDoi]
  );

  return rows[0] || null;
}

/* Делает: Находит DOI crossref подтверждающего target by. Применение: используется локально в файле backend/services/repositoryService.js. */
async function findCrossrefConfirmationTargetByDoi(doi) {
  const normalizedDoi = normalizeDoiValue(doi);
  if (!normalizedDoi) {
    return null;
  }

  const draftRow = await getLatestPersonalDraftRowByDoi(normalizedDoi);
  if (draftRow) {
    return {
      source: 'draft',
      documentId: String(draftRow.document_id || ''),
      status: normalizeDocumentStatus(draftRow.document_status),
      draftRow,
      doi: normalizedDoi,
    };
  }

  const publishedRow = await getPublishedRowByDoi(normalizedDoi);
  if (!publishedRow) {
    return null;
  }

  return {
    source: 'published',
    documentId: String(publishedRow.id || ''),
    status: normalizeDocumentStatus(publishedRow.document_status),
    nodeRow: publishedRow,
    doi: normalizedDoi,
  };
}

/* Делает: Получает строку документа черновика. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getDocumentDraftRow(rowOrDocument, actor = null) {
  const documentId = rowOrDocument?.id;
  if (!documentId || documentId === 'root') {
    return null;
  }

  return getLatestPersonalDraftRowByDocument(documentId);
}

/* Делает: Выполняет документ apply персонального черновика to. Применение: используется локально в файле backend/services/repositoryService.js. */
function applyPersonalDraftToDocument(document, draftRow) {
  const draft = normalizePersonalDraftDbRow(draftRow);
  if (!draft) {
    return document;
  }

  const mergedMeta = {
    ...createDefaultDocumentMeta(),
    ...(document.meta || {}),
    ...(draft.meta || {}),
  };

  return {
    ...document,
    name: draft.name || document.name,
    meta: mergedMeta,
    blocks: draft.blocks || [],
    updatedAt: draft.savedAt || document.updatedAt,
    documentStatus: draft.documentStatus || document.documentStatus,
    reviewRequestedAt: draft.reviewRequestedAt,
    verifiedAt: draft.verifiedAt,
    creatorName: mergedMeta.creatorName || document.creatorName || '',
    creatorEmail: mergedMeta.creatorEmail || document.creatorEmail || '',
    documentType: mergedMeta.documentType || document.documentType || '',
  };
}

/* Делает: Читает файл json. Применение: используется локально в файле backend/services/repositoryService.js. */
async function readJsonFile(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/* Делает: Читает directory node from json. Применение: используется локально в файле backend/services/repositoryService.js. */
async function readDirectoryNodeFromJson(directoryId) {
  return readJsonFile(path.join(storageDir, `${directoryId}.json`));
}

/* Делает: Загружает directory tree from json. Применение: используется локально в файле backend/services/repositoryService.js. */
async function loadDirectoryTreeFromJson(directoryId = 'root') {
  const directory = await readDirectoryNodeFromJson(directoryId);
  const children = [];

  for (const child of directory.children || []) {
    if (child.type === 'directory') {
      children.push(await loadDirectoryTreeFromJson(child.id));
    } else {
      children.push({
        ...child,
        meta: child.meta || createDefaultDocumentMeta(),
        blocks: child.blocks || [],
      });
    }
  }

  return {
    ...directory,
    children,
  };
}

/* Делает: Загружает repository tree from json. Применение: используется локально в файле backend/services/repositoryService.js. */
async function loadRepositoryTreeFromJson() {
  try {
    await fs.access(path.join(storageDir, 'root.json'));
    return await loadDirectoryTreeFromJson('root');
  } catch {}

  try {
    await fs.access(legacyRepositoryFilePath);
    const tree = await readJsonFile(legacyRepositoryFilePath);
    return tree;
  } catch {
    return createEmptyRoot();
  }
}

/* Делает: Проверяет наличие repository column. Применение: используется локально в файле backend/services/repositoryService.js. */
async function hasRepositoryColumn(client, columnName) {
  const { rows } = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'repository_nodes'
          AND column_name = $1
      ) AS present
    `,
    [columnName]
  );
  return Boolean(rows[0]?.present);
}

/* Делает: Проверяет наличие таблицу репозиторного персонального черновиков. Применение: используется локально в файле backend/services/repositoryService.js. */
async function hasRepositoryPersonalDraftsTable(client) {
  const { rows } = await client.query(`
    SELECT to_regclass('repository_personal_drafts') IS NOT NULL AS present
  `);
  return Boolean(rows[0]?.present);
}

/* Делает: Получает repository personal draft primary key columns. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getRepositoryPersonalDraftPrimaryKeyColumns(client) {
  const { rows } = await client.query(`
    SELECT attribute.attname
    FROM pg_constraint constraint_info
    JOIN pg_class table_info
      ON table_info.oid = constraint_info.conrelid
    JOIN pg_namespace schema_info
      ON schema_info.oid = table_info.relnamespace
    JOIN unnest(constraint_info.conkey) WITH ORDINALITY AS key_columns(attnum, ordinality)
      ON TRUE
    JOIN pg_attribute attribute
      ON attribute.attrelid = table_info.oid
     AND attribute.attnum = key_columns.attnum
    WHERE constraint_info.contype = 'p'
      AND schema_info.nspname = current_schema()
      AND table_info.relname = 'repository_personal_drafts'
    ORDER BY key_columns.ordinality
  `);

  return rows.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getRepositoryPersonalDraftPrimaryKeyColumns. */ (row) => String(row.attname || ''));
}

/* Делает: Гарантирует ключ репозиторного персонального черновиков основного. Применение: используется локально в файле backend/services/repositoryService.js. */
async function ensureRepositoryPersonalDraftsPrimaryKey(client) {
  await client.query(`
    DELETE FROM repository_personal_drafts drafts
    USING (
      SELECT ctid
      FROM (
        SELECT ctid,
               ROW_NUMBER() OVER (
                 PARTITION BY document_id
                 ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, user_id ASC
               ) AS row_number
        FROM repository_personal_drafts
      ) duplicates
      WHERE duplicates.row_number > 1
    ) duplicates_to_delete
    WHERE drafts.ctid = duplicates_to_delete.ctid;
  `);

  const primaryKeyColumns = await getRepositoryPersonalDraftPrimaryKeyColumns(client);
  if (primaryKeyColumns.length === 1 && primaryKeyColumns[0] === 'document_id') {
    return;
  }

  await client.query(`ALTER TABLE repository_personal_drafts DROP CONSTRAINT IF EXISTS repository_personal_drafts_pkey`);
  await client.query(`ALTER TABLE repository_personal_drafts ADD CONSTRAINT repository_personal_drafts_pkey PRIMARY KEY (document_id)`);
}

/* Делает: Гарантирует auth personal drafts schema. Применение: используется локально в файле backend/services/repositoryService.js. */
async function ensureAuthPersonalDraftsSchema() {
  await authPool.query(`
    CREATE TABLE IF NOT EXISTS repository_personal_drafts (
      user_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
      document_status VARCHAR(32) NOT NULL DEFAULT 'draft',
      review_requested_at TIMESTAMP,
      verified_at TIMESTAMP,
      source_updated_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (document_id),
      CONSTRAINT repository_personal_drafts_document_status_check
        CHECK (document_status IN ('draft', 'needs_revision', 'under_review', 'verified'))
    );
  `);
  await authPool.query(`ALTER TABLE repository_personal_drafts ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMP`);
  await authPool.query(`ALTER TABLE repository_personal_drafts ADD COLUMN IF NOT EXISTS document_status VARCHAR(32) NOT NULL DEFAULT 'draft'`);
  await authPool.query(`ALTER TABLE repository_personal_drafts ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMP`);
  await authPool.query(`ALTER TABLE repository_personal_drafts ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP`);
  await authPool.query(`ALTER TABLE repository_personal_drafts ALTER COLUMN user_id TYPE TEXT USING user_id::text`);
  await authPool.query(`ALTER TABLE repository_personal_drafts DROP CONSTRAINT IF EXISTS repository_personal_drafts_document_status_check`);
  await authPool.query(`
    UPDATE repository_personal_drafts
    SET document_status = 'draft'
    WHERE document_status IS NULL
       OR document_status NOT IN ('draft', 'needs_revision', 'under_review', 'verified')
  `);
  await authPool.query(`
    ALTER TABLE repository_personal_drafts
    ADD CONSTRAINT repository_personal_drafts_document_status_check
    CHECK (document_status IN ('draft', 'needs_revision', 'under_review', 'verified'))
  `);
  await ensureRepositoryPersonalDraftsPrimaryKey(authPool);
  await authPool.query(`DROP INDEX IF EXISTS repository_personal_drafts_document_idx`);
  await authPool.query(`
    CREATE INDEX IF NOT EXISTS repository_personal_drafts_user_idx
    ON repository_personal_drafts(user_id, updated_at DESC)
  `);
  await authPool.query(`
    CREATE INDEX IF NOT EXISTS repository_personal_drafts_status_idx
    ON repository_personal_drafts(document_status, updated_at DESC)
  `);
}

/* Делает: Получает метаданные черновика owner ключа from. Применение: используется локально в файле backend/services/repositoryService.js. */
function getDraftOwnerKeyFromMeta(meta = {}, documentId = '') {
  const normalizedMeta = normalizeLegacyDocumentMeta(meta || {});
  const creatorUserId = normalizeActorId(normalizedMeta.creatorUserId);
  if (creatorUserId) {
    return creatorUserId;
  }

  const creatorEmail = String(normalizedMeta.creatorEmail || '').trim().toLowerCase();
  if (creatorEmail) {
    return `email:${creatorEmail}`;
  }

  return `legacy:${documentId || randomUUID()}`;
}

/* Делает: Переносит базу данных персонального черновиков to авторизационного. Применение: используется локально в файле backend/services/repositoryService.js. */
async function migratePersonalDraftsToAuthDatabase() {
  await ensureAuthPersonalDraftsSchema();

  const repositoryClient = await repositoryPool.connect();
  try {
    if (!(await hasRepositoryPersonalDraftsTable(repositoryClient))) {
      return;
    }

    await repositoryClient.query(`ALTER TABLE repository_personal_drafts ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMP`);
    await repositoryClient.query(`ALTER TABLE repository_personal_drafts ADD COLUMN IF NOT EXISTS document_status VARCHAR(32) NOT NULL DEFAULT 'draft'`);
    await repositoryClient.query(`ALTER TABLE repository_personal_drafts ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMP`);
    await repositoryClient.query(`ALTER TABLE repository_personal_drafts ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP`);
    await repositoryClient.query(`ALTER TABLE repository_personal_drafts ALTER COLUMN user_id TYPE TEXT USING user_id::text`);

    const { rows } = await repositoryClient.query(`
      SELECT user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
             source_updated_at, created_at, updated_at
      FROM repository_personal_drafts
    `);

    const authClient = await authPool.connect();
    try {
      await authClient.query('BEGIN');

      for (const row of rows) {
        await authClient.query(
          `INSERT INTO repository_personal_drafts (
             user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
             source_updated_at, created_at, updated_at
           )
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::timestamp, $8::timestamp, $9::timestamp, $10::timestamp, $11::timestamp)
           ON CONFLICT (document_id)
           DO UPDATE SET
             user_id = EXCLUDED.user_id,
             name = EXCLUDED.name,
             meta = EXCLUDED.meta,
             blocks = EXCLUDED.blocks,
             document_status = EXCLUDED.document_status,
             review_requested_at = EXCLUDED.review_requested_at,
             verified_at = EXCLUDED.verified_at,
             source_updated_at = EXCLUDED.source_updated_at,
             created_at = LEAST(repository_personal_drafts.created_at, EXCLUDED.created_at),
             updated_at = EXCLUDED.updated_at
           WHERE repository_personal_drafts.updated_at <= EXCLUDED.updated_at`,
          [
            String(row.user_id || ''),
            String(row.document_id || ''),
            row.name || '',
            JSON.stringify(row.meta || {}),
            JSON.stringify(Array.isArray(row.blocks) ? row.blocks : []),
            normalizeDocumentStatus(row.document_status),
            row.review_requested_at || null,
            row.verified_at || null,
            row.source_updated_at || null,
            row.created_at || new Date(),
            row.updated_at || new Date(),
          ]
        );
      }

      await authClient.query('COMMIT');
    } catch (error) {
      await authClient.query('ROLLBACK');
      throw error;
    } finally {
      authClient.release();
    }

    await repositoryClient.query(`DROP TABLE IF EXISTS repository_personal_drafts`);
  } finally {
    repositoryClient.release();
  }
}

/* Делает: Переносит черновики unpublished репозиторного узлов to. Применение: используется локально в файле backend/services/repositoryService.js. */
async function migrateUnpublishedRepositoryNodesToDrafts(client) {
  const { rows } = await client.query(`
    SELECT id, name, meta, info, document_type, doi, xml_path, blocks, document_status,
           review_requested_at, verified_at, created_at, updated_at
    FROM repository_nodes
    WHERE document_status IS DISTINCT FROM $1
  `, [DOCUMENT_STATUS_VERIFIED]);

  if (rows.length === 0) {
    return;
  }

  const authClient = await authPool.connect();
  try {
    await authClient.query('BEGIN');

    for (const row of rows) {
      const meta = {
        ...createDefaultDocumentMeta(),
        ...buildDocumentMetaFromStorage(row.meta || {}, row.info || {}),
        documentType: row.document_type || '',
        doi: row.doi || '',
        xmlPath: row.xml_path || '',
      };
      const ownerKey = getDraftOwnerKeyFromMeta(meta, row.id);
      await authClient.query(
        `INSERT INTO repository_personal_drafts (
           user_id, document_id, name, meta, blocks, document_status,
           review_requested_at, verified_at, source_updated_at, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::timestamp, $8::timestamp,
                 $9::timestamp, $10::timestamp, $11::timestamp)
         ON CONFLICT (document_id)
         DO UPDATE SET
           user_id = EXCLUDED.user_id,
           name = EXCLUDED.name,
           meta = EXCLUDED.meta,
           blocks = EXCLUDED.blocks,
           document_status = EXCLUDED.document_status,
           review_requested_at = EXCLUDED.review_requested_at,
           verified_at = EXCLUDED.verified_at,
           source_updated_at = EXCLUDED.source_updated_at,
           created_at = LEAST(repository_personal_drafts.created_at, EXCLUDED.created_at),
           updated_at = EXCLUDED.updated_at
         WHERE repository_personal_drafts.updated_at <= EXCLUDED.updated_at`,
        [
          ownerKey,
          row.id,
          row.name || '',
          JSON.stringify(meta),
          JSON.stringify(Array.isArray(row.blocks) ? row.blocks : []),
          normalizeDocumentStatus(row.document_status),
          row.review_requested_at || null,
          row.verified_at || null,
          row.updated_at || null,
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );
    }

    await authClient.query('COMMIT');
  } catch (error) {
    await authClient.query('ROLLBACK');
    throw error;
  } finally {
    authClient.release();
  }

  await client.query(`DELETE FROM repository_nodes WHERE document_status IS DISTINCT FROM $1`, [DOCUMENT_STATUS_VERIFIED]);
}

/* Делает: Гарантирует repository schema. Применение: используется локально в файле backend/services/repositoryService.js. */
async function ensureRepositorySchema() {
  await repositoryPool.query(`
    CREATE TABLE IF NOT EXISTS repository_nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      meta JSONB,
      info JSONB NOT NULL DEFAULT '{}'::jsonb,
      document_type TEXT,
      doi TEXT,
      xml_path TEXT,
      document_status VARCHAR(32) NOT NULL DEFAULT 'draft',
      review_requested_at TIMESTAMP,
      verified_at TIMESTAMP,
      blocks JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

  await migratePersonalDraftsToAuthDatabase();

  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS info JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await repositoryPool.query(`UPDATE repository_nodes SET info = '{}'::jsonb WHERE info IS NULL`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ALTER COLUMN info SET DEFAULT '{}'::jsonb`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ALTER COLUMN info SET NOT NULL`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS document_type TEXT`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS doi TEXT`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS xml_path TEXT`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS document_status VARCHAR(32) NOT NULL DEFAULT 'draft'`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ALTER COLUMN document_status SET DEFAULT 'draft'`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMP`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP`);

  const client = await repositoryPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DROP INDEX IF EXISTS repository_nodes_parent_idx`);
    await client.query(`DROP INDEX IF EXISTS repository_nodes_document_status_idx`);

    const hasType = await hasRepositoryColumn(client, 'type');
    if (hasType) {
      await client.query(`DELETE FROM repository_nodes WHERE type IS DISTINCT FROM 'document'`);
    }

    await client.query(`DELETE FROM repository_nodes WHERE id = 'root'`);

    if (await hasRepositoryColumn(client, 'parent_id')) {
      await client.query(`ALTER TABLE repository_nodes DROP COLUMN parent_id`);
    }

    if (await hasRepositoryColumn(client, 'sort_order')) {
      await client.query(`ALTER TABLE repository_nodes DROP COLUMN sort_order`);
    }

    if (hasType) {
      await client.query(`ALTER TABLE repository_nodes DROP COLUMN type`);
    }

    await client.query(`ALTER TABLE repository_nodes DROP CONSTRAINT IF EXISTS repository_nodes_document_status_check`);

    await client.query(`
      UPDATE repository_nodes
      SET info = COALESCE(info, '{}'::jsonb) || jsonb_build_object(
        'creatorName', COALESCE(NULLIF(info ->> 'creatorName', ''), meta ->> 'creatorName', ''),
        'creatorEmail', COALESCE(NULLIF(info ->> 'creatorEmail', ''), meta ->> 'creatorEmail', ''),
        'reviewEditorName', COALESCE(NULLIF(info ->> 'reviewEditorName', ''), meta ->> 'reviewEditorName', ''),
        'reviewEditorEmail', COALESCE(NULLIF(info ->> 'reviewEditorEmail', ''), meta ->> 'reviewEditorEmail', ''),
        'revisionComment', COALESCE(NULLIF(info ->> 'revisionComment', ''), meta ->> 'revisionComment', ''),
        'revisionCommentAuthor', COALESCE(NULLIF(info ->> 'revisionCommentAuthor', ''), meta ->> 'revisionCommentAuthor', ''),
        'revisionCommentUpdatedAt', COALESCE(NULLIF(info ->> 'revisionCommentUpdatedAt', ''), meta ->> 'revisionCommentUpdatedAt', '')
      ),
          meta = COALESCE(meta, '{}'::jsonb)
            - 'creatorName'
            - 'creatorEmail'
            - 'reviewEditorName'
            - 'reviewEditorEmail'
            - 'revisionComment'
            - 'revisionCommentAuthor'
            - 'revisionCommentUpdatedAt'
    `);

    await client.query(`
      UPDATE repository_nodes
      SET document_status = CASE
        WHEN document_status IN ('draft', 'needs_revision', 'under_review', 'verified') THEN document_status
        ELSE 'draft'
      END
    `);

    await client.query(`
      ALTER TABLE repository_nodes
      ADD CONSTRAINT repository_nodes_document_status_check
      CHECK (document_status IN ('draft', 'needs_revision', 'under_review', 'verified'))
    `);

    await migrateUnpublishedRepositoryNodesToDrafts(client);

      await client.query(`
        CREATE INDEX IF NOT EXISTS repository_nodes_document_status_idx
        ON repository_nodes(document_status, updated_at DESC)
      `);

      await client.query('COMMIT');
    } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/* Делает: Выполняет insert tree into db. Применение: используется локально в файле backend/services/repositoryService.js. */
async function insertTreeIntoDb(client, node) {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (node.type === 'document') {
    const stored = extractDocumentStorage(node.meta || {});
    await client.query(
      `
        INSERT INTO repository_nodes (id, name, meta, info, document_type, doi, xml_path, blocks, updated_at)
        VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8::jsonb, COALESCE($9::timestamp, CURRENT_TIMESTAMP))
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          meta = EXCLUDED.meta,
          info = EXCLUDED.info,
          document_type = EXCLUDED.document_type,
          doi = EXCLUDED.doi,
          xml_path = EXCLUDED.xml_path,
          blocks = EXCLUDED.blocks,
          updated_at = EXCLUDED.updated_at;
      `,
      [
        node.id,
        node.name,
        JSON.stringify(stored.meta),
        JSON.stringify(stored.info),
        stored.documentType,
        stored.doi,
        stored.xmlPath,
        JSON.stringify(node.blocks || []),
        node.updatedAt || null,
      ]
    );
  }

  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    await insertTreeIntoDb(client, child);
  }
}

/* Делает: Переносит json repository if needed. Применение: используется локально в файле backend/services/repositoryService.js. */
async function migrateJsonRepositoryIfNeeded() {
  await ensureRepositorySchema();
  await ensureUploadsInitialized();

  const { rows } = await repositoryPool.query('SELECT COUNT(*)::int AS count FROM repository_nodes');
  if (rows[0]?.count > 0) {
    await normalizeRepositoryStructureIfNeeded();
    return;
  }

  const tree = await loadRepositoryTreeFromJson();
  const client = await repositoryPool.connect();
  try {
    await client.query('BEGIN');
    await insertTreeIntoDb(client, tree);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await ensureRepositorySchema();
  await normalizeRepositoryStructureIfNeeded();
}

/* Делает: Нормализует repository structure if needed. Применение: используется локально в файле backend/services/repositoryService.js. */
async function normalizeRepositoryStructureIfNeeded() {
  if (flatStructureNormalized && legacyXmlResourceUrlsFixed) {
    return;
  }

  flatStructureNormalized = true;
  if (!legacyXmlResourceUrlsFixed) {
    await repairLegacyXmlResourceUrls();
    legacyXmlResourceUrlsFixed = true;
  }
}

/* Делает: Нормализует статус документа. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeDocumentStatus(status) {
  return DOCUMENT_STATUS_VALUES.has(status) ? status : DOCUMENT_STATUS_DRAFT;
}

/* Делает: Создаёт ошибку репозиторного. Применение: используется локально в файле backend/services/repositoryService.js. */
function createRepositoryError(message, httpStatus = 400, code = '') {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  if (code) {
    error.code = code;
  }
  return error;
}

/* Делает: Проверяет условие и выбрасывает ошибку при нарушении admin actor. Применение: используется локально в файле backend/services/repositoryService.js. */
function assertAdminActor(actor, actionLabel = 'выполнять действие') {
  if (actor?.role === 'admin') {
    return;
  }

  throw createRepositoryError(
    `Только администратор репозитория может ${actionLabel}.`,
    403,
    'ADMIN_REQUIRED'
  );
}

const EDITOR_RESTRICTED_META_FIELDS = [
  'creatorUserId',
  'revisionComment',
  'revisionCommentAuthor',
  'revisionCommentUpdatedAt',
  'creatorName',
  'creatorEmail',
  'reviewEditorName',
  'reviewEditorEmail',
  'doi',
  'xmlPath',
];

/* Делает: Очищает и нормализует meta patch by actor. Применение: используется локально в файле backend/services/repositoryService.js. */
function sanitizeMetaPatchByActor(metaPatch, actor) {
  if (!metaPatch || typeof metaPatch !== 'object') {
    return {};
  }

  const sanitized = { ...metaPatch };
  if (actor?.role === 'admin') {
    return sanitized;
  }

  for (const field of EDITOR_RESTRICTED_META_FIELDS) {
    delete sanitized[field];
  }

  return sanitized;
}

const CYRILLIC_REGEX = /[А-Яа-яЁё]/;
const LATIN_REGEX = /[A-Za-z]/;

/* Делает: Проверяет корректность значение русского метаданных. Применение: используется локально в файле backend/services/repositoryService.js. */
function validateRussianMetaValue(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  if (!CYRILLIC_REGEX.test(normalized) || LATIN_REGEX.test(normalized)) {
    return `Поле "${label}" должно содержать русский текст.`;
  }

  return null;
}

/* Делает: Проверяет корректность значение english метаданных. Применение: используется локально в файле backend/services/repositoryService.js. */
function validateEnglishMetaValue(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  if (!LATIN_REGEX.test(normalized) || CYRILLIC_REGEX.test(normalized)) {
    return `Поле "${label}" должно содержать английский текст.`;
  }

  return null;
}

/* Делает: Собирает ошибки метаданных языка validation. Применение: используется локально в файле backend/services/repositoryService.js. */
function collectMetaLanguageValidationErrors(meta) {
  const errors = [];
  const authorEntries = Array.isArray(meta?.authorEntries) ? meta.authorEntries : [];

  if (authorEntries.length > 0) {
    authorEntries.forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри collectMetaLanguageValidationErrors. */ (entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }

      const row = index + 1;
      const authorRuError = validateRussianMetaValue(entry.authorRu, `Автор ${row} (RU)`);
      if (authorRuError) {
        errors.push(authorRuError);
      }

      const authorEnError = validateEnglishMetaValue(entry.authorEn, `Автор ${row} (EN)`);
      if (authorEnError) {
        errors.push(authorEnError);
      }

      const organizationRuError = validateRussianMetaValue(entry.organizationRu, `Организация автора ${row} (RU)`);
      if (organizationRuError) {
        errors.push(organizationRuError);
      }

      const organizationEnError = validateEnglishMetaValue(entry.organizationEn, `Организация автора ${row} (EN)`);
      if (organizationEnError) {
        errors.push(organizationEnError);
      }
    });
  } else {
    const authorsRuError = validateRussianMetaValue(meta?.authors, 'Авторы (RU)');
    if (authorsRuError) {
      errors.push(authorsRuError);
    }

    const authorsEnError = validateEnglishMetaValue(meta?.authorsEn, 'Авторы (EN)');
    if (authorsEnError) {
      errors.push(authorsEnError);
    }

    const organizationRuError = validateRussianMetaValue(meta?.organization, 'Организация (RU)');
    if (organizationRuError) {
      errors.push(organizationRuError);
    }

    const organizationEnError = validateEnglishMetaValue(meta?.organizationEn, 'Организация (EN)');
    if (organizationEnError) {
      errors.push(organizationEnError);
    }
  }

  const titleEnError = validateEnglishMetaValue(meta?.titleEn, 'Название (EN)');
  if (titleEnError) {
    errors.push(titleEnError);
  }

  const annotationEnError = validateEnglishMetaValue(meta?.descriptionEn, 'Аннотация (EN)');
  if (annotationEnError) {
    errors.push(annotationEnError);
  }

  const documentTypeError = validateEnglishMetaValue(meta?.documentType, 'Тип документа');
  if (documentTypeError) {
    errors.push(documentTypeError);
  }

  const licenseError = validateEnglishMetaValue(meta?.license, 'Лицензия');
  if (licenseError) {
    errors.push(licenseError);
  }

  return errors;
}

/* Делает: Проверяет условие и выбрасывает ошибку при нарушении meta language constraints. Применение: используется локально в файле backend/services/repositoryService.js. */
function assertMetaLanguageConstraints(meta) {
  const errors = collectMetaLanguageValidationErrors(meta);
  if (!errors.length) {
    return;
  }

  throw createRepositoryError(errors.join(' '), 400, 'META_LANGUAGE_VALIDATION_FAILED');
}

const REQUIRED_DOCUMENT_META_FIELDS = [
  'annotation',
  'descriptionEn',
  'publicationDate',
  'authors',
  'authorsEn',
  'organization',
  'organizationEn',
  'documentType',
  'titleEn',
  'journalCode',
  'volume',
  'articleNumber',
  'license',
];

const REQUIRED_DOCUMENT_META_FIELD_LABELS = {
  annotation: 'Аннотация',
  descriptionEn: 'Аннотация на английском языке',
  publicationDate: 'Дата публикации',
  authors: 'Авторы документа',
  authorsEn: 'Авторы документа (EN)',
  organization: 'Аффилиации',
  organizationEn: 'Аффилиации (EN)',
  documentType: 'Тип документа',
  titleEn: 'Название материалов на английском языке',
  journalCode: 'Наименование издания',
  volume: 'Том',
  articleNumber: 'Номер статьи',
  license: 'Лицензия',
};

/* Делает: Собирает required meta field labels. Применение: используется локально в файле backend/services/repositoryService.js. */
function collectRequiredMetaFieldLabels(meta) {
  return REQUIRED_DOCUMENT_META_FIELDS
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри collectRequiredMetaFieldLabels. */ (field) => !String(meta?.[field] || '').trim())
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри collectRequiredMetaFieldLabels. */ (field) => REQUIRED_DOCUMENT_META_FIELD_LABELS[field]);
}

/* Делает: Проверяет условие и выбрасывает ошибку при нарушении метаданные complete документа. Применение: используется локально в файле backend/services/repositoryService.js. */
function assertCompleteDocumentMeta(meta, blocks = []) {
  const missingLabels = collectRequiredMetaFieldLabels(meta);
  const fileErrors = [];

  (Array.isArray(blocks) ? blocks : []).forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри assertCompleteDocumentMeta. */ (block, index) => {
    if (!block || typeof block !== 'object' || block.type !== 'file') {
      return;
    }

    const label = String(block.label || '').trim();
    const sourceUrl = getFileSourceUrl(block);
    const hasManagedFile = Boolean(block.url && isManagedUploadUrl(block.url));
    if (!(label || sourceUrl || hasManagedFile || block.fileName)) {
      return;
    }

    if (!label) {
      fileErrors.push(`Для файла ${index + 1} укажите название файла.`);
    }

    if (sourceUrl && !isHttpUrl(sourceUrl)) {
      fileErrors.push(`Для файла ${index + 1} укажите корректную ссылку http(s).`);
    }

    if (label && !sourceUrl && !hasManagedFile) {
      fileErrors.push(`Для файла ${index + 1} прикрепите файл с компьютера или укажите ссылку.`);
    }
  });

  if (!missingLabels.length && !fileErrors.length) {
    return;
  }

  const parts = [];
  if (missingLabels.length) {
    parts.push(`Заполните обязательные поля: ${missingLabels.join(', ')}.`);
  }
  if (fileErrors.length) {
    parts.push(fileErrors.join(' '));
  }

  throw createRepositoryError(parts.join(' ').trim(), 400, 'DOCUMENT_METADATA_INCOMPLETE');
}

/* Делает: Получает подпись документа статуса. Применение: используется локально в файле backend/services/repositoryService.js. */
function getDocumentStatusLabel(status) {
  switch (normalizeDocumentStatus(status)) {
    case DOCUMENT_STATUS_DRAFT:
      return 'Черновик';
    case DOCUMENT_STATUS_UNDER_REVIEW:
      return 'На регистрации';
    case DOCUMENT_STATUS_VERIFIED:
      return 'Опубликован';
    default:
      return 'На доработке';
  }
}

/* Делает: Нормализует идентификатор actor. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeActorId(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

/* Делает: Проверяет document owned by actor. Применение: используется локально в файле backend/services/repositoryService.js. */
function isDocumentOwnedByActor(row, actor) {
  if (!row || !actor) {
    return false;
  }

  const meta = buildDocumentMetaFromStorage(row.meta || {}, row.info || {});
  const actorId = normalizeActorId(actor.id);
  const creatorUserId = normalizeActorId(meta.creatorUserId);
  if (actorId && creatorUserId && actorId === creatorUserId) {
    return true;
  }

  const actorEmail = String(actor.email || '').trim().toLowerCase();
  const creatorEmail = String(meta.creatorEmail || '').trim().toLowerCase();
  if (actorEmail && creatorEmail && actorEmail === creatorEmail) {
    return true;
  }

  return false;
}

/* Делает: Гарантирует document editable. Применение: используется локально в файле backend/services/repositoryService.js. */
function ensureDocumentEditable(row, actor, actionLabel = 'редактировать') {
  if (!row) {
    return;
  }

  if (actor?.role === 'admin') {
    return;
  }

  if (actor?.role === 'user' && !isDocumentOwnedByActor(row, actor)) {
    throw createRepositoryError(
      `Пользователь может ${actionLabel} только собственный документ.`,
      403,
      'DOCUMENT_OWNERSHIP_REQUIRED'
    );
  }

  const status = normalizeDocumentStatus(row.document_status);
  if (status === DOCUMENT_STATUS_UNDER_REVIEW) {
    throw createRepositoryError(
      'Документ находится на регистрации. Изменения недоступны до смены статуса.',
      403,
      'DOCUMENT_UNDER_REVIEW'
    );
  }

  if (status === DOCUMENT_STATUS_VERIFIED) {
    throw createRepositoryError(
      'Документ уже проверен. Изменения недоступны.',
      403,
      'DOCUMENT_VERIFIED'
    );
  }
}

/* Делает: Получает имя actor display. Применение: используется локально в файле backend/services/repositoryService.js. */
function getActorDisplayName(actor, fallback = 'Пользователь репозитория') {
  if (!actor || typeof actor !== 'object') {
    return fallback;
  }

  return (
    String(actor.fullName || '').trim() ||
    String(actor.name || '').trim() ||
    String(actor.email || '').trim() ||
    fallback
  );
}

/* Делает: Получает unique active admin recipients. Применение: используется локально в файле backend/services/repositoryService.js. */
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

/* Делает: Отправляет уведомление проверку admins about документа. Применение: используется локально в файле backend/services/repositoryService.js. */
async function notifyAdminsAboutDocumentReview(documentSummary) {
  try {
    if (!documentSummary?.id) {
      return;
    }

    const adminRecipients = getUniqueActiveAdminRecipients(await RepositoryUserModel.findActiveAdmins());
    if (adminRecipients.length === 0) {
      console.warn(`Repository review notification skipped: no active admins for document ${documentSummary.id}`);
      return;
    }

    const emailService = await getEmailService();
    const results = await Promise.allSettled(
      adminRecipients.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри notifyAdminsAboutDocumentReview. */ (admin) =>
        emailService.sendRepositoryAdminNotification({
          to: admin.email,
          subject: 'Новый документ на регистрации',
          title: 'Документ отправлен на регистрацию',
          message: `Документ "${documentSummary.name}" ожидает регистрации администратором.`,
          details: [
            `Статус: ${getDocumentStatusLabel(documentSummary.documentStatus)}`,
            `Тип документа: ${documentSummary.documentType || 'Не указан'}`,
            `Заполнитель: ${documentSummary.creatorName || 'Не указан'}`,
            `Email заполнителя: ${documentSummary.creatorEmail || 'Не указан'}`,
            `Расположение: ${documentSummary.parentPath?.join(' / ') || 'Корневой каталог'}`,
          ],
          actionLabel: 'Открыть документ',
          actionUrl: buildDocumentResourceUrl(documentSummary.id, 'edit'),
        })
      )
    );

    const failedCount = results.reduce(/* Делает: Накопляет итоговое значение при обходе коллекции. Применение: передаётся как callback в reduce внутри notifyAdminsAboutDocumentReview. */ (count, result, index) => {
      if (result.status === 'rejected') {
        console.error(`Repository review notification failed for admin ${adminRecipients[index].email}:`, result.reason);
        return count + 1;
      }
      return count;
    }, 0);

    const deliveredCount = adminRecipients.length - failedCount;
    console.log(`Repository review notification sent to ${deliveredCount}/${adminRecipients.length} admin(s) for document ${documentSummary.id}`);
  } catch (error) {
    console.error('Repository review submit notification error:', error);
  }
}

/* Делает: Определяет email редактора recipient. Применение: используется локально в файле backend/services/repositoryService.js. */
async function resolveEditorRecipientEmail(documentSummary) {
  const candidates = [
    String(documentSummary?.meta?.reviewEditorEmail || '').trim().toLowerCase(),
    String(documentSummary?.meta?.creatorEmail || '').trim().toLowerCase(),
    String(documentSummary?.creatorEmail || '').trim().toLowerCase(),
  ].filter(Boolean);

  const uniqueCandidates = [...new Set(candidates)].filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри resolveEditorRecipientEmail. */ (email) => email.includes('@'));
  if (uniqueCandidates.length === 0) {
    return '';
  }

  for (const email of uniqueCandidates) {
    try {
      const user = await RepositoryUserModel.findByEmail(email);
      if (!user || user.role !== 'admin') {
        return email;
      }
    } catch (error) {
      console.error('Repository recipient resolve error:', error);
    }
  }

  return '';
}

/* Делает: Отправляет уведомление доработку creator about. Применение: используется локально в файле backend/services/repositoryService.js. */
async function notifyCreatorAboutRevision(documentSummary, actor, revisionComment = '') {
  try {
    const recipient = await resolveEditorRecipientEmail(documentSummary);
    if (!recipient) {
      console.warn(`Repository revision notification skipped: editor email is empty for document ${documentSummary?.id || 'unknown'}`);
      return { sent: false, recipient: '', reason: 'RECIPIENT_NOT_FOUND' };
    }

    const normalizedComment = String(revisionComment || '').trim();
    const emailService = await getEmailService();
    const details = [
      `Статус: ${getDocumentStatusLabel(DOCUMENT_STATUS_NEEDS_REVISION)}`,
      `Проверяющий: ${getActorDisplayName(actor, 'Администратор репозитория')}`,
    ];
    if (normalizedComment) {
      details.push(`Комментарий администратора: ${normalizedComment}`);
    }

    await emailService.sendRepositoryUserNotification({
      to: recipient,
      subject: 'Документ отправлен на доработку',
      title: 'Документ требует доработки',
      message: `Документ "${documentSummary.name}" возвращён на доработку.`,
      details,
      actionLabel: 'Открыть документ',
      actionUrl: buildDocumentResourceUrl(documentSummary.id, 'edit'),
    });
    console.log(`Repository revision notification sent to ${recipient} for document ${documentSummary.id}`);
    return { sent: true, recipient };
  } catch (error) {
    console.error('Repository revision notification error:', error);
    return { sent: false, recipient: '', reason: error?.message || 'SEND_FAILED' };
  }
}

/* Делает: Определяет email репозиторного notification recipient. Применение: используется локально в файле backend/services/repositoryService.js. */
function resolveRepositoryNotificationRecipientEmail() {
  const recipient = String(repositoryDepositorEmail || '').trim().toLowerCase();
  return recipient.includes('@') ? recipient : '';
}

/* Делает: Отправляет уведомление подтверждение crossref deposit awaiting. Применение: используется локально в файле backend/services/repositoryService.js. */
async function notifyCrossrefDepositAwaitingConfirmation(documentSummary, actor) {
  try {
    const recipient = resolveRepositoryNotificationRecipientEmail();
    if (!recipient) {
      console.warn(`Repository Crossref notification skipped: depositor email is empty for document ${documentSummary?.id || 'unknown'}`);
      return;
    }

    const emailService = await getEmailService();
    const normalizedDoi = normalizeDoiValue(documentSummary?.meta?.doi || documentSummary?.doi || '');
    const details = [
      `Статус: ${getDocumentStatusLabel(DOCUMENT_STATUS_UNDER_REVIEW)}`,
      `Администратор: ${getActorDisplayName(actor, 'Администратор репозитория')}`,
    ];
    if (normalizedDoi) {
      details.push(`DOI: ${normalizedDoi}`);
    }

    await emailService.sendRepositoryUserNotification({
      to: recipient,
      subject: 'XML отправлен в Crossref',
      title: 'Ожидается подтверждение DOI',
      message: `XML документа "${documentSummary.name}" отправлен в Crossref. Статус "Опубликован" будет выставлен после письма с подтверждением создания DOI.`,
      details,
      actionLabel: 'Открыть документ',
      actionUrl: buildDocumentResourceUrl(documentSummary.id, 'edit'),
    });
    console.log(`Repository Crossref notification sent to ${recipient} for document ${documentSummary.id}`);
  } catch (error) {
    console.error('Repository Crossref notification error:', error);
  }
}

/* Делает: Определяет email документа creator recipient. Применение: используется локально в файле backend/services/repositoryService.js. */
function resolveDocumentCreatorRecipientEmail(documentSummary) {
  const candidates = [
    String(documentSummary?.meta?.creatorEmail || '').trim().toLowerCase(),
    String(documentSummary?.creatorEmail || '').trim().toLowerCase(),
    String(documentSummary?.meta?.reviewEditorEmail || '').trim().toLowerCase(),
  ];

  return candidates.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри resolveDocumentCreatorRecipientEmail. */ (email) => email.includes('@')) || '';
}

/* Делает: Отправляет уведомление публикацию creator about. Применение: используется локально в файле backend/services/repositoryService.js. */
async function notifyCreatorAboutPublication(documentSummary, confirmation = {}) {
  try {
    const recipient = resolveDocumentCreatorRecipientEmail(documentSummary);
    if (!recipient) {
      console.warn(`Repository publication notification skipped: creator email is empty for document ${documentSummary?.id || 'unknown'}`);
      return { sent: false, recipient: '', reason: 'RECIPIENT_NOT_FOUND' };
    }

    const normalizedDoi = normalizeDoiValue(
      confirmation?.doi || confirmation?.confirmedDoi || documentSummary?.meta?.doi || documentSummary?.doi || ''
    );
    const details = [
      `Статус: ${getDocumentStatusLabel(DOCUMENT_STATUS_VERIFIED)}`,
    ];
    if (normalizedDoi) {
      details.push(`DOI: ${normalizedDoi}`);
    }
    if (confirmation?.submissionId) {
      details.push(`Submission ID: ${confirmation.submissionId}`);
    }
    if (confirmation?.batchId) {
      details.push(`Batch ID: ${confirmation.batchId}`);
    }

    const emailService = await getEmailService();
    await emailService.sendRepositoryUserNotification({
      to: recipient,
      subject: 'Документ опубликован в репозитории',
      title: 'Документ успешно опубликован',
      message: `Документ "${documentSummary.name}" успешно опубликован после подтверждения DOI от Crossref.`,
      details,
      actionLabel: 'Открыть документ',
      actionUrl: buildDocumentResourceUrl(documentSummary.id),
    });

    console.log(`Repository publication notification sent to ${recipient} for document ${documentSummary.id}`);
    return { sent: true, recipient };
  } catch (error) {
    console.error('Repository publication notification error:', error);
    return { sent: false, recipient: '', reason: error?.message || 'SEND_FAILED' };
  }
}

/* Делает: Нормализует строку. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeRow(row) {
  const meta = {
    ...buildDocumentMetaFromStorage(row.meta || {}, row.info || {}),
    documentType: row.document_type || '',
    doi: row.doi || '',
    xmlPath: row.xml_path || '',
  };

  return {
    id: row.id,
    name: row.name,
    type: 'document',
    meta,
    blocks: row.blocks || [],
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
    documentStatus: normalizeDocumentStatus(row.document_status),
    reviewRequestedAt: row.review_requested_at ? new Date(row.review_requested_at).toISOString() : undefined,
    verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : undefined,
  };
}

/* Делает: Нормализует строку черновика документа. Применение: используется локально в файле backend/services/repositoryService.js. */
function normalizeDraftDocumentRow(row) {
  const draft = normalizePersonalDraftDbRow(row);
  if (!draft) {
    return null;
  }

  const meta = {
    ...createDefaultDocumentMeta(),
    ...normalizeLegacyDocumentMeta(draft.meta || {}),
  };
  if (!String(meta.creatorUserId || '').trim() && draft.userId && !String(draft.userId).includes(':')) {
    meta.creatorUserId = String(draft.userId);
  }

  return {
    id: draft.documentId,
    name: draft.name || meta.title || 'Документ',
    type: 'document',
    meta,
    blocks: draft.blocks || [],
    updatedAt: draft.savedAt,
    documentStatus: normalizeDocumentStatus(draft.documentStatus),
    reviewRequestedAt: draft.reviewRequestedAt,
    verifiedAt: draft.verifiedAt,
    parentPath: [],
    creatorName: meta.creatorName || '',
    creatorEmail: meta.creatorEmail || '',
    documentType: meta.documentType || '',
  };
}

/* Делает: Собирает строки дерева from. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildTreeFromRows(rows) {
  return {
    id: 'root',
    name: 'Репозиторий ФИЦ ЕГС РАС',
    type: 'directory',
    children: rows.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри buildTreeFromRows. */ (row) => normalizeRow(row)),
  };
}

/* Делает: Возвращает список документы. Применение: используется локально в файле backend/services/repositoryService.js. */
function listDocuments(node, parents = []) {
  if (node.type === 'document') {
    return [
      {
        id: node.id,
        name: node.name,
        type: node.type,
        meta: node.meta || createDefaultDocumentMeta(),
        blocks: node.blocks || [],
        updatedAt: node.updatedAt,
        documentStatus: normalizeDocumentStatus(node.documentStatus),
        reviewRequestedAt: node.reviewRequestedAt,
        verifiedAt: node.verifiedAt,
        parentPath: parents,
        creatorName: node.meta?.creatorName || '',
        creatorEmail: node.meta?.creatorEmail || '',
        documentType: node.meta?.documentType || '',
      },
    ];
  }

  return (node.children || []).flatMap(/* Делает: Преобразует элемент и разворачивает результат. Применение: передаётся как callback в flatMap внутри listDocuments. */ (child) =>
    listDocuments(child, node.id === 'root' ? parents : [...parents, node.name])
  );
}

/* Делает: Собирает дерево плоского. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildFlatTree(rootName, documents) {
  return {
    id: 'root',
    name: rootName || 'Репозиторий ФИЦ ЕГС РАН',
    type: 'directory',
    children: documents.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри buildFlatTree. */ (document) => ({
      id: document.id,
      name: document.name,
      type: 'document',
      meta: document.meta || createDefaultDocumentMeta(),
      blocks: document.blocks || [],
      updatedAt: document.updatedAt,
      documentStatus: normalizeDocumentStatus(document.documentStatus),
      reviewRequestedAt: document.reviewRequestedAt,
      verifiedAt: document.verifiedAt,
    })),
  };
}

/* Делает: Получает строки всех. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getAllRows() {
  await migrateJsonRepositoryIfNeeded();
  const { rows } = await repositoryPool.query(`
    SELECT id, name, meta, info, document_type, doi, xml_path, blocks,
           updated_at, created_at, document_status, review_requested_at, verified_at
    FROM repository_nodes
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id ASC
  `);
  return rows;
}

/* Делает: Загружает tree from db. Применение: используется локально в файле backend/services/repositoryService.js. */
async function loadTreeFromDb() {
  const rows = await getAllRows();
  const tree = buildTreeFromRows(rows);
  if (!tree) {
    throw new Error('Repository root not found');
  }
  return tree;
}

/* Делает: Получает строку узла. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getNodeRow(nodeId) {
  await migrateJsonRepositoryIfNeeded();
  const { rows } = await repositoryPool.query(
    `SELECT id, name, meta, info, document_type, doi, xml_path, blocks,
            updated_at, created_at, document_status, review_requested_at, verified_at
     FROM repository_nodes
     WHERE id = $1`,
    [nodeId]
  );
  return rows[0] || null;
}

/* Делает: Получает идентификатор каталога имён by parent. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getDirectoryNamesByParentId(client, parentId) {
  return [];
}

const RESTRICTED_META_FIELDS_FOR_GUESTS = ['revisionComment', 'revisionCommentAuthor', 'revisionCommentUpdatedAt'];

/* Делает: Проверяет возможность комментарий view доработки. Применение: используется локально в файле backend/services/repositoryService.js. */
function canViewRevisionComment(actor, meta = null) {
  if (actor?.role === 'admin' || actor?.role === 'editor') {
    return true;
  }

  if (actor?.role !== 'user' || !meta) {
    return false;
  }

  return isDocumentOwnedByActor({ meta }, actor);
}

/* Делает: Очищает и нормализует meta for public. Применение: используется локально в файле backend/services/repositoryService.js. */
function sanitizeMetaForPublic(meta, actor = null) {
  if (!meta || typeof meta !== 'object') {
    return createDefaultDocumentMeta();
  }

  const sanitizedMeta = { ...meta };
  if (!canViewRevisionComment(actor, meta)) {
    for (const field of RESTRICTED_META_FIELDS_FOR_GUESTS) {
      delete sanitizedMeta[field];
    }
  }

  return sanitizedMeta;
}

/* Делает: Очищает и нормализует tree for public. Применение: используется локально в файле backend/services/repositoryService.js. */
function sanitizeTreeForPublic(node, actor = null) {
  if (!node || typeof node !== 'object') {
    return node;
  }

  if (node.type === 'document') {
    return {
      ...node,
      meta: sanitizeMetaForPublic(node.meta, actor),
    };
  }

  return {
    ...node,
    children: (node.children || []).map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри sanitizeTreeForPublic. */ (child) => sanitizeTreeForPublic(child, actor)),
  };
}

/* Делает: Очищает и нормализует documents for public. Применение: используется локально в файле backend/services/repositoryService.js. */
function sanitizeDocumentsForPublic(documents, actor = null) {
  return documents.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри sanitizeDocumentsForPublic. */ (document) => ({
    ...document,
    meta: sanitizeMetaForPublic(document.meta, actor),
  }));
}

/* Делает: Проверяет возможность документ actor view. Применение: используется локально в файле backend/services/repositoryService.js. */
function canActorViewDocument(document, actor = null) {
  const status = normalizeDocumentStatus(document?.documentStatus);
  if (status === DOCUMENT_STATUS_VERIFIED) {
    return true;
  }

  if (!actor) {
    return false;
  }

  const isOwner = isDocumentOwnedByActor({ meta: document?.meta || {} }, actor);
  if (status === DOCUMENT_STATUS_DRAFT) {
    return isOwner;
  }

  if (status === DOCUMENT_STATUS_UNDER_REVIEW || status === DOCUMENT_STATUS_NEEDS_REVISION) {
    return actor.role === 'admin' || actor.role === 'editor' || isOwner;
  }

  return false;
}

/* Делает: Получает personal draft rows by document ids. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getPersonalDraftRowsByDocumentIds(documentIds = []) {
  const ids = [...new Set(documentIds.filter(Boolean))];
  if (ids.length === 0) {
    return new Map();
  }

  const { rows } = await authPool.query(
    `SELECT user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
            created_at, updated_at, source_updated_at
     FROM repository_personal_drafts
     WHERE document_id = ANY($1::text[])`,
    [ids]
  );

  return rows.reduce(/* Делает: Накопляет итоговое значение при обходе коллекции. Применение: передаётся как callback в reduce внутри getPersonalDraftRowsByDocumentIds. */ (acc, row) => acc.set(String(row.document_id || ''), row), new Map());
}

/* Делает: Выполняет документ выбора черновика строки for. Применение: используется локально в файле backend/services/repositoryService.js. */
function selectDraftRowForDocument(document, draftRowsByDocumentId) {
  return draftRowsByDocumentId.get(document.id) || null;
}

/* Делает: Сортирует документы репозиторного. Применение: используется локально в файле backend/services/repositoryService.js. */
function sortRepositoryDocuments(documents = []) {
  return [...documents].sort(/* Делает: Сравнивает элементы при сортировке. Применение: передаётся как callback в sort внутри sortRepositoryDocuments. */ (left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.meta?.publicationDate || '') || 0;
    const rightTime = Date.parse(right.updatedAt || right.meta?.publicationDate || '') || 0;
    return rightTime - leftTime;
  });
}

/* Делает: Получает visible draft rows for actor. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getVisibleDraftRowsForActor(actor = null) {
  if (!actor) {
    return [];
  }

  const isPrivileged = actor.role === 'admin' || actor.role === 'editor';
  let actorOwnerKey = '';
  try {
    actorOwnerKey = getRepositoryActorDraftOwnerKey(actor);
  } catch {
    if (!isPrivileged) {
      throw createRepositoryError('Требуется авторизация в репозитории.', 401, 'REPOSITORY_AUTH_REQUIRED');
    }
  }
  const query = isPrivileged
    ? actorOwnerKey
      ? `SELECT user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
                created_at, updated_at, source_updated_at
         FROM repository_personal_drafts
         WHERE document_status IN ($2, $3)
            OR user_id = $1
         ORDER BY updated_at DESC`
      : `SELECT user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
                created_at, updated_at, source_updated_at
         FROM repository_personal_drafts
         WHERE document_status IN ($1, $2)
         ORDER BY updated_at DESC`
    : `SELECT user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
              created_at, updated_at, source_updated_at
       FROM repository_personal_drafts
       WHERE user_id = $1
       ORDER BY updated_at DESC`;
  const values = isPrivileged && !actorOwnerKey
    ? [DOCUMENT_STATUS_UNDER_REVIEW, DOCUMENT_STATUS_NEEDS_REVISION]
    : isPrivileged
      ? [actorOwnerKey, DOCUMENT_STATUS_UNDER_REVIEW, DOCUMENT_STATUS_NEEDS_REVISION]
    : [actorOwnerKey];
  const { rows } = await authPool.query(query, values);

  return rows.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри getVisibleDraftRowsForActor. */ (row) => normalizeDocumentStatus(row.document_status) !== DOCUMENT_STATUS_VERIFIED);
}

/* Делает: Получает visible draft documents for actor. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getVisibleDraftDocumentsForActor(actor = null) {
  const rows = await getVisibleDraftRowsForActor(actor);
  return rows
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getVisibleDraftDocumentsForActor. */ (row) => normalizeDraftDocumentRow(row))
    .filter(Boolean)
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри getVisibleDraftDocumentsForActor. */ (document) => canActorViewDocument(document, actor));
}

/* Делает: Получает visible documents for actor. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getVisibleDocumentsForActor(actor = null) {
  const tree = await loadTreeFromDb();
  const publishedDocuments = listDocuments(tree).filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри getVisibleDocumentsForActor. */ (document) => canActorViewDocument(document, actor));
  const draftDocuments = await getVisibleDraftDocumentsForActor(actor);
  const documentsById = new Map();

  for (const document of publishedDocuments) {
    documentsById.set(document.id, document);
  }

  for (const document of draftDocuments) {
    if (!documentsById.has(document.id)) {
      documentsById.set(document.id, document);
    }
  }

  return { tree, documents: sortRepositoryDocuments([...documentsById.values()]) };
}

/* Делает: Получает сводку репозиторного. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getRepositorySummary(actor = null) {
  const { tree, documents } = await getVisibleDocumentsForActor(actor);
  const flatTree = buildFlatTree(tree?.name, documents);

  if (actor?.role === 'admin' || actor?.role === 'editor') {
    return {
      tree: flatTree,
      documents,
    };
  }

  return {
    tree: sanitizeTreeForPublic(flatTree, actor),
    documents: sanitizeDocumentsForPublic(documents, actor),
  };
}

/* Делает: Получает документы репозиторного пользовательского. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getRepositoryUserDocuments(actor = null) {
  const actorId = normalizeActorId(actor?.id);
  if (!actorId) {
    throw createRepositoryError('Требуется авторизация в репозитории', 401, 'AUTH_REQUIRED');
  }

  const { documents } = await getVisibleDocumentsForActor(actor);
  const ownDocuments = documents
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри getRepositoryUserDocuments. */ (document) => normalizeActorId(document.meta?.creatorUserId) === actorId)
    .sort(/* Делает: Сравнивает элементы при сортировке. Применение: передаётся как callback в sort внутри getRepositoryUserDocuments. */ (left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.meta?.publicationDate || '') || 0;
      const rightTime = Date.parse(right.updatedAt || right.meta?.publicationDate || '') || 0;
      return rightTime - leftTime;
    });

  return { documents: ownDocuments };
}

/* Делает: Получает черновик персонального. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getPersonalDraft(nodeId, actor = null) {
  await migrateJsonRepositoryIfNeeded();
  const actorOwnerKey = getRepositoryActorDraftOwnerKey(actor);
  const ownDraft = await getPersonalDraftRowByOwner(nodeId, actorOwnerKey);
  const draftRow = ownDraft || ((actor?.role === 'admin' || actor?.role === 'editor')
    ? await getLatestPersonalDraftRowByDocument(nodeId)
    : null);

  if (!draftRow || nodeId === 'root') {
    const existing = await getNodeRow(nodeId);
    if (existing) {
      return null;
    }
    throw createRepositoryError('Документ не найден', 404, 'DOCUMENT_NOT_FOUND');
  }

  const draftDocument = normalizeDraftDocumentRow(draftRow);
  if (!canActorViewDocument(draftDocument, actor)) {
    throw createRepositoryError('Нет доступа к черновику документа.', 403, 'DOCUMENT_DRAFT_FORBIDDEN');
  }

  return normalizePersonalDraftRow(draftRow);
}

/* Делает: Сохраняет черновик персонального. Применение: используется локально в файле backend/services/repositoryService.js. */
async function savePersonalDraft(nodeId, draft, actor = null) {
  await migrateJsonRepositoryIfNeeded();

  if (nodeId === 'root') {
    throw createRepositoryError('Документ не найден', 404, 'DOCUMENT_NOT_FOUND');
  }

  const actorOwnerKey = getRepositoryActorDraftOwnerKey(actor);
  let draftRow = await getPersonalDraftRowByOwner(nodeId, actorOwnerKey);
  if (!draftRow && (actor?.role === 'admin' || actor?.role === 'editor')) {
    draftRow = await getLatestPersonalDraftRowByDocument(nodeId);
  }

  const publishedRow = await getNodeRow(nodeId);
  if (!draftRow) {
    if (publishedRow) {
      throw createRepositoryError('Опубликованный документ нельзя сохранить как черновик.', 403, 'DOCUMENT_VERIFIED');
    }
    throw createRepositoryError('Документ не найден', 404, 'DOCUMENT_NOT_FOUND');
  }

  const currentStatus = normalizeDocumentStatus(draftRow.document_status);
  const draftDocument = normalizeDraftDocumentRow(draftRow);
  if (!canActorViewDocument(draftDocument, actor)) {
    throw createRepositoryError('Нет доступа к черновику документа.', 403, 'DOCUMENT_DRAFT_FORBIDDEN');
  }

  if (currentStatus === DOCUMENT_STATUS_UNDER_REVIEW && actor?.role !== 'admin') {
    throw createRepositoryError(
      'Документ находится на регистрации. Изменения недоступны до смены статуса.',
      403,
      'DOCUMENT_UNDER_REVIEW'
    );
  }

  if (currentStatus === DOCUMENT_STATUS_VERIFIED || publishedRow) {
    throw createRepositoryError('Документ уже опубликован. Изменения недоступны.', 403, 'DOCUMENT_VERIFIED');
  }

  if (actor?.role === 'user' && String(draftRow.user_id || '') !== actorOwnerKey) {
    throw createRepositoryError(
      'Пользователь может сохранять только собственный документ.',
      403,
      'DOCUMENT_OWNERSHIP_REQUIRED'
    );
  }

  const userId = String(draftRow.user_id || actorOwnerKey);

  const normalizedName = typeof draft?.name === 'string' && draft.name.trim()
    ? draft.name.trim()
    : draftRow.name;
  const normalizedMeta = {
    ...createDefaultDocumentMeta(),
    ...normalizeLegacyDocumentMeta(draftRow.meta || {}),
    ...normalizeDraftMeta(draft?.meta || {}, actor),
  };
  const actorId = normalizeActorId(actor?.id);
  if (actorId && !String(normalizedMeta.creatorUserId || '').trim()) {
    normalizedMeta.creatorUserId = actorId;
  }
  if (!String(normalizedMeta.creatorName || '').trim()) {
    normalizedMeta.creatorName = getActorDisplayName(actor, '');
  }
  if (!String(normalizedMeta.creatorEmail || '').trim() && actor?.email) {
    normalizedMeta.creatorEmail = String(actor.email).trim();
  }
  if (!String(normalizedMeta.organization || '').trim() && actor?.organization) {
    normalizedMeta.organization = String(actor.organization).trim();
  }
  let synchronizedMeta = synchronizeCitationLinks(
    {
      ...normalizedMeta,
      doi: await resolveUniqueGeneratedDoi(
        resolveEditableDocumentDoi(nodeId, normalizedName, normalizedMeta),
        nodeId
      ),
    },
    normalizedName
  );
  let normalizedBlocks = normalizeDraftBlocks(draft?.blocks);
  const sourceUpdatedAt = normalizeOptionalTimestamp(draft?.sourceUpdatedAt);
  const createdAt = draftRow.created_at || new Date();

  assertMetaLanguageConstraints(synchronizedMeta);
  normalizedBlocks = await synchronizeFileBlocksForStorage({
    documentId: nodeId,
    blocks: normalizedBlocks,
    existingBlocks: draftRow.blocks || [],
    documentName: normalizedName,
    publicationDate: synchronizedMeta.publicationDate,
    createdAt,
  });

  const previousUploadUrls = collectManagedUploadUrlsFromBlocks(draftRow.blocks || []);
  const nextUploadUrls = collectManagedUploadUrlsFromBlocks(normalizedBlocks || []);
  const removedUploadUrls = previousUploadUrls.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри savePersonalDraft. */ (url) => !nextUploadUrls.includes(url));
  await deleteManagedUploads(removedUploadUrls);

  if (shouldRefreshEditableDocumentXml(synchronizedMeta)) {
    synchronizedMeta = {
      ...synchronizedMeta,
      xmlPath: await upsertGeneratedXml({
        nodeId,
        name: normalizedName,
        meta: synchronizedMeta,
        doi: synchronizedMeta.doi,
        existingXmlPath: synchronizedMeta.xmlPath,
        createdAt,
      }),
    };
  }

  const result = await authPool.query(
    `INSERT INTO repository_personal_drafts (
       user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
       source_updated_at, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::timestamp, $8::timestamp,
             $9::timestamp, COALESCE($10::timestamp, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
     ON CONFLICT (document_id)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       name = EXCLUDED.name,
       meta = EXCLUDED.meta,
       blocks = EXCLUDED.blocks,
       document_status = EXCLUDED.document_status,
       source_updated_at = EXCLUDED.source_updated_at,
       updated_at = CURRENT_TIMESTAMP
     RETURNING user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
               created_at, updated_at, source_updated_at`,
    [
      userId,
      nodeId,
      normalizedName,
      JSON.stringify(synchronizedMeta),
      JSON.stringify(normalizedBlocks),
      currentStatus,
      draftRow.review_requested_at || null,
      draftRow.verified_at || null,
      sourceUpdatedAt,
      createdAt,
    ]
  );

  return normalizePersonalDraftRow(result.rows[0]);
}

/* Делает: Удаляет черновик персонального. Применение: используется локально в файле backend/services/repositoryService.js. */
async function deletePersonalDraft(nodeId, actor = null) {
  await migrateJsonRepositoryIfNeeded();
  const userId = getRepositoryActorDraftOwnerKey(actor);

  await authPool.query(
    `DELETE FROM repository_personal_drafts
     WHERE user_id = $1 AND document_id = $2`,
    [userId, nodeId]
  );

  return { ok: true };
}

/* Делает: Создаёт каталог. Применение: используется локально в файле backend/services/repositoryService.js. */
async function createDirectory(parentId, name) {
  throw createRepositoryError(
    'Создание каталогов отключено: репозиторий использует плоскую структуру документов.',
    400,
    'DIRECTORIES_DISABLED'
  );
}

/* Делает: Создаёт документ. Применение: используется локально в файле backend/services/repositoryService.js. */
async function createDocument(parentId, name, documentType, creator = null) {
  await migrateJsonRepositoryIfNeeded();
  const userId = getRepositoryActorDraftOwnerKey(creator);
  const normalizedDocumentType = String(documentType || '').trim().toLowerCase() || DEFAULT_DOCUMENT_CLASSIFICATION;

  const id = randomUUID();
  const meta = {
    ...createDefaultDocumentMeta(),
    documentType: normalizedDocumentType,
    recordType: normalizedDocumentType,
    creatorUserId: creator?.id ? String(creator.id) : '',
    creatorName: creator?.fullName || creator?.name || '',
    creatorEmail: creator?.email || '',
    organization: creator?.organization || '',
  };
  const blocks = [];
  const result = await authPool.query(
    `INSERT INTO repository_personal_drafts (
       user_id, document_id, name, meta, blocks, document_status, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
               created_at, updated_at, source_updated_at`,
    [
      userId,
      id,
      name,
      JSON.stringify(meta),
      JSON.stringify(blocks),
      DOCUMENT_STATUS_DRAFT,
    ]
  );
  const createdNode = normalizeDraftDocumentRow(result.rows[0]);
  const { tree } = await getRepositorySummary(creator);

  return {
    tree,
    createdNode,
  };
}

/* Делает: Обновляет узел. Применение: используется локально в файле backend/services/repositoryService.js. */
async function updateNode(nodeId, updates) {
  await migrateJsonRepositoryIfNeeded();
  const client = await repositoryPool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, name, meta, info, document_type, doi, xml_path, blocks, updated_at, created_at,
              document_status, review_requested_at, verified_at
       FROM repository_nodes
       WHERE id = $1
       FOR UPDATE`,
      [nodeId]
    );
    const existing = rows[0];

    if (!existing || nodeId === 'root') {
      throw new Error('Node not found');
    }

    const actor = updates.actor && typeof updates.actor === 'object' ? updates.actor : null;
    ensureDocumentEditable(existing, actor, 'редактировать');

    const expectedUpdatedAt = typeof updates.expectedUpdatedAt === 'string' && updates.expectedUpdatedAt.trim()
      ? updates.expectedUpdatedAt.trim()
      : null;

    if (expectedUpdatedAt) {
      const currentUpdatedAt = existing.updated_at ? new Date(existing.updated_at).toISOString() : null;
      if (!currentUpdatedAt || currentUpdatedAt !== expectedUpdatedAt) {
        const conflictError = new Error('Документ изменен другим пользователем. Обновите страницу и повторите сохранение.');
        conflictError.code = 'EDIT_CONFLICT';
        conflictError.httpStatus = 409;
        throw conflictError;
      }
    }

    const nextName = typeof updates.name === 'string' && updates.name.trim() ? updates.name.trim() : existing.name;
    const metaPatch = normalizeLegacyDocumentMeta(sanitizeMetaPatchByActor(updates.meta, actor));
    let nextMeta = {
      ...createDefaultDocumentMeta(),
      ...buildDocumentMetaFromStorage(existing.meta || {}, existing.info || {}),
      documentType: existing.document_type || '',
      doi: existing.doi || '',
      xmlPath: existing.xml_path || '',
      ...metaPatch,
    };
    let nextBlocks = Array.isArray(updates.blocks) ? clone(updates.blocks) : clone(existing.blocks || []);
    const nextUpdatedAt = new Date().toISOString();

    const actorFullName = actor?.fullName?.trim();
    const actorName = actor?.name?.trim();
    const actorEmail = actor?.email?.trim();
    const actorOrganization = actor?.organization?.trim();
    const actorId = normalizeActorId(actor?.id);

    if (actorId && !String(nextMeta.creatorUserId || '').trim()) {
      nextMeta.creatorUserId = actorId;
    }

    if (actorFullName && (!nextMeta.creatorName || nextMeta.creatorName === actorName || nextMeta.creatorName === 'admin')) {
      nextMeta.creatorName = actorFullName;
    }

    if (actorEmail && !nextMeta.creatorEmail) {
      nextMeta.creatorEmail = actorEmail;
    }

    if (actorOrganization && !nextMeta.organization) {
      nextMeta.organization = actorOrganization;
    }

    assertMetaLanguageConstraints(nextMeta);

    if (Array.isArray(updates.blocks)) {
      nextBlocks = await synchronizeFileBlocksForStorage({
        documentId: nodeId,
        blocks: nextBlocks,
        existingBlocks: existing.blocks || [],
        documentName: nextName,
        publicationDate: nextMeta.publicationDate,
        createdAt: existing.created_at,
      });

      const previousUploadUrls = collectManagedUploadUrlsFromBlocks(existing.blocks || []);
      const nextUploadUrls = collectManagedUploadUrlsFromBlocks(nextBlocks || []);
      const removedUploadUrls = previousUploadUrls.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри updateNode. */ (url) => !nextUploadUrls.includes(url));
      await deleteManagedUploads(removedUploadUrls);
    }

    const generatedDoi = existing.doi || await resolveUniqueGeneratedDoi(
      buildApproximateDoi(nodeId, nextName, nextMeta),
      nodeId
    );
    const generatedXmlPath = await upsertGeneratedXml({
      nodeId,
      name: nextName,
      meta: nextMeta,
      doi: generatedDoi,
      existingXmlPath: existing.xml_path || nextMeta.xmlPath,
      createdAt: existing.created_at,
    });

    nextMeta = {
      ...nextMeta,
      doi: generatedDoi,
      xmlPath: generatedXmlPath,
    };
    nextMeta = synchronizeCitationLinks(nextMeta, nextName);

    const storedDocument = extractDocumentStorage(nextMeta);

    await client.query(
      `
        UPDATE repository_nodes
        SET name = $2,
            meta = $3::jsonb,
            info = $4::jsonb,
            document_type = $5,
            doi = $6,
            xml_path = $7,
            blocks = $8::jsonb,
            updated_at = COALESCE($9::timestamp, updated_at)
        WHERE id = $1
      `,
      [
        nodeId,
        nextName,
        JSON.stringify(storedDocument.meta),
        JSON.stringify(storedDocument.info),
        storedDocument.documentType,
        storedDocument.doi,
        storedDocument.xmlPath,
        JSON.stringify(nextBlocks || []),
        nextUpdatedAt,
      ]
    );

    await client.query('COMMIT');

    const updatedNode = {
      id: nodeId,
      name: nextName,
      type: 'document',
      meta: nextMeta,
      blocks: nextBlocks || [],
      updatedAt: nextUpdatedAt,
      documentStatus: normalizeDocumentStatus(existing.document_status),
      reviewRequestedAt: existing.review_requested_at ? new Date(existing.review_requested_at).toISOString() : undefined,
      verifiedAt: existing.verified_at ? new Date(existing.verified_at).toISOString() : undefined,
    };

    return { tree: await loadTreeFromDb(), updatedNode };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/* Делает: Удаляет узел. Применение: используется локально в файле backend/services/repositoryService.js. */
async function deleteNode(nodeId, actor = null) {
  await migrateJsonRepositoryIfNeeded();

  if (nodeId === 'root') {
    throw new Error('Node not found');
  }

  const existing = await getNodeRow(nodeId);
  if (!existing) {
    const actorOwnerKey = getRepositoryActorDraftOwnerKey(actor);
    const ownDraft = await getPersonalDraftRowByOwner(nodeId, actorOwnerKey);
    const draftRow = ownDraft || ((actor?.role === 'admin' || actor?.role === 'editor')
      ? await getLatestPersonalDraftRowByDocument(nodeId)
      : null);

    if (!draftRow) {
      throw new Error('Node not found');
    }

    const draftDocument = normalizeDraftDocumentRow(draftRow);
    if (!canActorViewDocument(draftDocument, actor)) {
      throw createRepositoryError('Нет доступа к документу.', 403, 'DOCUMENT_FORBIDDEN');
    }

    const currentStatus = normalizeDocumentStatus(draftRow.document_status);
    if (currentStatus === DOCUMENT_STATUS_UNDER_REVIEW && actor?.role !== 'admin') {
      throw createRepositoryError(
        'Документ находится на регистрации. Удаление недоступно до смены статуса.',
        403,
        'DOCUMENT_UNDER_REVIEW'
      );
    }

    await deleteManagedUploads(collectManagedUploadUrls(draftDocument));
    await authPool.query(`DELETE FROM repository_personal_drafts WHERE document_id = $1`, [nodeId]);
    return { tree: (await getRepositorySummary(actor)).tree, deletedNode: clone(draftDocument) };
  }

  ensureDocumentEditable(existing, actor, 'удалять');
  const deletedNode = normalizeRow(existing);
  await deleteManagedUploads(collectManagedUploadUrls(deletedNode));

  await authPool.query(`DELETE FROM repository_personal_drafts WHERE document_id = $1`, [nodeId]);
  await repositoryPool.query(`DELETE FROM repository_nodes WHERE id = $1`, [nodeId]);
  return { tree: await loadTreeFromDb(), deletedNode: clone(deletedNode) };
}

/* Делает: Получает проверку документов for. Применение: используется локально в файле backend/services/repositoryService.js. */
async function getDocumentsForReview() {
  const { documents } = await getVisibleDocumentsForActor({ role: 'admin' });
  return documents
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри getDocumentsForReview. */ (document) => normalizeDocumentStatus(document.documentStatus) === DOCUMENT_STATUS_UNDER_REVIEW)
    .sort(/* Делает: Сравнивает элементы при сортировке. Применение: передаётся как callback в sort внутри getDocumentsForReview. */ (left, right) => {
      const leftTime = Date.parse(left.reviewRequestedAt || left.updatedAt || '') || 0;
      const rightTime = Date.parse(right.reviewRequestedAt || right.updatedAt || '') || 0;
      return rightTime - leftTime;
    });
}

/* Делает: Отправляет проверку документа for. Применение: используется локально в файле backend/services/repositoryService.js. */
async function submitDocumentForReview(nodeId, actor = null) {
  await migrateJsonRepositoryIfNeeded();
  const client = await authPool.connect();
  let updatedRow = null;

  try {
    await client.query('BEGIN');

    const actorOwnerKey = getRepositoryActorDraftOwnerKey(actor);
    let { rows } = await client.query(
      `SELECT user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
              created_at, updated_at, source_updated_at
       FROM repository_personal_drafts
       WHERE user_id = $1 AND document_id = $2
       FOR UPDATE`,
      [actorOwnerKey, nodeId]
    );
    if (rows.length === 0 && (actor?.role === 'admin' || actor?.role === 'editor')) {
      ({ rows } = await client.query(
        `SELECT user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
                created_at, updated_at, source_updated_at
         FROM repository_personal_drafts
         WHERE document_id = $1
         ORDER BY updated_at DESC
         LIMIT 1
         FOR UPDATE`,
        [nodeId]
      ));
    }
    const draftRow = rows[0];

    if (!draftRow) {
      const publishedRow = await getNodeRow(nodeId);
      if (publishedRow) {
        throw createRepositoryError('Документ уже опубликован.', 409, 'DOCUMENT_ALREADY_VERIFIED');
      }
      throw createRepositoryError('Документ не найден', 404, 'DOCUMENT_NOT_FOUND');
    }

    const draftDocument = normalizeDraftDocumentRow(draftRow);
    if (!canActorViewDocument(draftDocument, actor)) {
      throw createRepositoryError('Нет доступа к документу.', 403, 'DOCUMENT_FORBIDDEN');
    }

    const currentStatus = normalizeDocumentStatus(draftRow.document_status);
    if (currentStatus === DOCUMENT_STATUS_UNDER_REVIEW) {
      throw createRepositoryError('Документ уже отправлен на регистрацию.', 409, 'DOCUMENT_ALREADY_UNDER_REVIEW');
    }

    if (currentStatus === DOCUMENT_STATUS_VERIFIED) {
      throw createRepositoryError('Документ уже опубликован.', 409, 'DOCUMENT_ALREADY_VERIFIED');
    }

    const reviewName = String(draftRow.name || '').trim() || 'Документ';
    const reviewMeta = {
      ...createDefaultDocumentMeta(),
      ...normalizeLegacyDocumentMeta(draftRow.meta || {}),
    };

    if (actor?.role === 'editor' || actor?.role === 'user') {
      const actorName = String(actor.fullName || actor.name || '').trim();
      const actorEmail = String(actor.email || '').trim();
      const actorOrganization = String(actor.organization || '').trim();
      const actorId = normalizeActorId(actor.id);

      if (actorId) {
        reviewMeta.creatorUserId = actorId;
      }

      if (actorName) {
        reviewMeta.creatorName = actorName;
        reviewMeta.reviewEditorName = actorName;
      }

      if (actorEmail) {
        reviewMeta.creatorEmail = actorEmail;
        reviewMeta.reviewEditorEmail = actorEmail;
      }

      if (!String(reviewMeta.organization || '').trim() && actorOrganization) {
        reviewMeta.organization = actorOrganization;
      }
    }

    assertMetaLanguageConstraints(reviewMeta);
    const reviewBlocks = await synchronizeFileBlocksForStorage({
      documentId: nodeId,
      blocks: draftRow.blocks || [],
      existingBlocks: draftRow.blocks || [],
      documentName: reviewName,
      publicationDate: reviewMeta.publicationDate,
      createdAt: draftRow.created_at,
    });
    assertCompleteDocumentMeta(reviewMeta, reviewBlocks || []);

    const generatedDoi = await resolveUniqueGeneratedDoi(
      buildApproximateDoi(nodeId, reviewName, reviewMeta),
      nodeId
    );
    const generatedXmlPath = await upsertGeneratedXml({
      nodeId,
      name: reviewName,
      meta: reviewMeta,
      doi: generatedDoi,
      existingXmlPath: reviewMeta.xmlPath,
      createdAt: draftRow.created_at,
    });
    const nextMeta = {
      ...reviewMeta,
      doi: generatedDoi,
      xmlPath: generatedXmlPath,
      revisionComment: '',
      revisionCommentAuthor: '',
      revisionCommentUpdatedAt: '',
    };
    const synchronizedMeta = synchronizeCitationLinks(nextMeta, reviewName);

    const updateResult = await client.query(
      `UPDATE repository_personal_drafts
       SET name = $3,
           meta = $4::jsonb,
           blocks = $5::jsonb,
           document_status = $6,
           review_requested_at = CURRENT_TIMESTAMP,
           verified_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND document_id = $2
       RETURNING user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
                 created_at, updated_at, source_updated_at`,
      [
        String(draftRow.user_id || actorOwnerKey),
        nodeId,
        reviewName,
        JSON.stringify(synchronizedMeta),
        JSON.stringify(reviewBlocks || []),
        DOCUMENT_STATUS_UNDER_REVIEW,
      ]
    );
    updatedRow = updateResult.rows[0];

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const { tree, documents: revisionDocuments } = await getRepositorySummary(actor);
  const reviewDocument = revisionDocuments.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри submitDocumentForReview. */ (document) => document.id === nodeId)
    || normalizeDraftDocumentRow(updatedRow);
  if (reviewDocument) {
    void notifyAdminsAboutDocumentReview(reviewDocument);
  }

  return {
    tree,
    updatedNode: normalizeDraftDocumentRow(updatedRow),
    message: 'Документ отправлен на регистрацию.',
  };
}

/* Делает: Собирает ключ crossref deposit lock. Применение: используется локально в файле backend/services/repositoryService.js. */
function buildCrossrefDepositLockKey(nodeId) {
  return `crossref-deposit-${nodeId}`;
}

/* Делает: Выполняет доработку send документа to. Применение: используется локально в файле backend/services/repositoryService.js. */
async function sendDocumentToRevision(nodeId, actor = null, revisionComment = '') {
  await migrateJsonRepositoryIfNeeded();
  assertAdminActor(actor, 'отправлять документ на доработку');
  const lockKey = buildCrossrefDepositLockKey(nodeId);
  const lockClient = await repositoryPool.connect();
  let lockAcquired = false;
  const client = await authPool.connect();
  let updatedRow = null;
  let transactionStarted = false;
  const normalizedRevisionComment = String(revisionComment || '').trim().slice(0, 2000);

  try {
    const lockResult = await lockClient.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [lockKey]
    );
    lockAcquired = Boolean(lockResult.rows[0]?.locked);

    if (!lockAcquired) {
      throw createRepositoryError('Документ сейчас отправляется в Crossref. Повторите позже.', 409, 'CROSSREF_DEPOSIT_BUSY');
    }

    await client.query('BEGIN');
    transactionStarted = true;

    const { rows } = await client.query(
      `SELECT user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
              created_at, updated_at, source_updated_at
       FROM repository_personal_drafts
       WHERE document_id = $1
       ORDER BY updated_at DESC
       LIMIT 1
       FOR UPDATE`,
      [nodeId]
    );
    const draftRow = rows[0];

    if (!draftRow) {
      throw createRepositoryError('Документ не найден', 404, 'DOCUMENT_NOT_FOUND');
    }

    const currentStatus = normalizeDocumentStatus(draftRow.document_status);
    if (currentStatus === DOCUMENT_STATUS_NEEDS_REVISION) {
      throw createRepositoryError('Документ уже находится на доработке.', 409, 'DOCUMENT_ALREADY_NEEDS_REVISION');
    }

    if (currentStatus === DOCUMENT_STATUS_VERIFIED) {
      throw createRepositoryError('Документ уже проверен и отправлен в Crossref.', 409, 'DOCUMENT_ALREADY_VERIFIED');
    }

    if (currentStatus !== DOCUMENT_STATUS_UNDER_REVIEW) {
      throw createRepositoryError('Документ можно отправить на доработку только из статуса "На регистрации".', 409, 'DOCUMENT_STATUS_CONFLICT');
    }

    const nextMeta = {
      ...createDefaultDocumentMeta(),
      ...normalizeLegacyDocumentMeta(draftRow.meta || {}),
      revisionComment: normalizedRevisionComment,
      revisionCommentAuthor: normalizedRevisionComment ? getActorDisplayName(actor, 'Администратор репозитория') : '',
      revisionCommentUpdatedAt: normalizedRevisionComment ? new Date().toISOString() : '',
    };

    const updateResult = await client.query(
      `UPDATE repository_personal_drafts
       SET meta = $4::jsonb,
           document_status = $2,
           review_requested_at = NULL,
           verified_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE document_id = $1 AND user_id = $5 AND document_status = $3
       RETURNING user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
                 created_at, updated_at, source_updated_at`,
      [
        nodeId,
        DOCUMENT_STATUS_NEEDS_REVISION,
        DOCUMENT_STATUS_UNDER_REVIEW,
        JSON.stringify(nextMeta),
        String(draftRow.user_id || ''),
      ]
    );
    updatedRow = updateResult.rows[0];

    if (!updatedRow) {
      throw createRepositoryError('Статус документа изменился. Обновите страницу и повторите действие.', 409, 'DOCUMENT_STATUS_CONFLICT');
    }

    await client.query('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
    }
    throw error;
  } finally {
    client.release();
    if (lockAcquired) {
      try {
        await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
      } catch {
        // ignore unlock errors
      }
    }
    lockClient.release();
  }

  const { tree, documents: reviewDocuments } = await getRepositorySummary(actor);
  const reviewDocument = reviewDocuments.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри sendDocumentToRevision. */ (document) => document.id === nodeId)
    || normalizeDraftDocumentRow(updatedRow);
  let notification = { sent: false, recipient: '', reason: 'RECIPIENT_NOT_FOUND' };
  if (reviewDocument) {
    notification = await notifyCreatorAboutRevision(reviewDocument, actor, normalizedRevisionComment);
  }

  const message = notification.sent
    ? 'Документ отправлен на доработку. Автор уведомлен по email.'
    : 'Документ отправлен на доработку. Уведомление автору не отправлено.';

  return {
    tree,
    updatedNode: normalizeDraftDocumentRow(updatedRow),
    message,
    notification,
  };
}

/* Делает: Собирает черновик опубликованного документа from. Применение: используется локально в файле backend/services/repositoryService.js. */
async function buildPublishedDocumentFromDraft(draftRow) {
  const draft = normalizePersonalDraftRow(draftRow);
  if (!draft) {
    throw createRepositoryError('У документа нет сохранённого черновика для публикации.', 400, 'DOCUMENT_DRAFT_REQUIRED');
  }

  const nodeId = String(draftRow.document_id || '');
  const publishedName = draft.name || 'Документ';
  let publishedMeta = {
    ...createDefaultDocumentMeta(),
    ...draft.meta,
  };
  const publishedBlocks = await synchronizeFileBlocksForStorage({
    documentId: nodeId,
    blocks: draft.blocks || [],
    existingBlocks: draftRow.blocks || [],
    documentName: publishedName,
    publicationDate: publishedMeta.publicationDate,
    createdAt: draftRow.created_at,
  });

  assertCompleteDocumentMeta(publishedMeta, publishedBlocks);

  const generatedDoi = normalizeDoiValue(publishedMeta.doi)
    || await resolveUniqueGeneratedDoi(
      buildApproximateDoi(nodeId, publishedName, publishedMeta),
      nodeId
    );
  const generatedXmlPath = String(publishedMeta.xmlPath || '').trim() || await upsertGeneratedXml({
    nodeId,
    name: publishedName,
    meta: publishedMeta,
    doi: generatedDoi,
    existingXmlPath: publishedMeta.xmlPath,
    createdAt: draftRow.created_at,
  });

  publishedMeta = {
    ...publishedMeta,
    doi: generatedDoi,
    xmlPath: generatedXmlPath,
  };
  publishedMeta = synchronizeCitationLinks(publishedMeta, publishedName);

  return {
    name: publishedName,
    meta: publishedMeta,
    blocks: publishedBlocks,
    storage: extractDocumentStorage(publishedMeta),
    xmlPath: generatedXmlPath,
    createdAt: draftRow.created_at,
  };
}

/* Делает: Извлекает значение XML tag. Применение: используется локально в файле backend/services/repositoryService.js. */
function extractXmlTagValue(source, tagName) {
  const normalizedSource = String(source || '');
  if (!normalizedSource || !tagName) {
    return '';
  }

  const matcher = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = normalizedSource.match(matcher);
  return match ? String(match[1] || '').trim() : '';
}

/* Делает: Извлекает значение XML attribute. Применение: используется локально в файле backend/services/repositoryService.js. */
function extractXmlAttributeValue(source, tagName, attributeName) {
  const normalizedSource = String(source || '');
  if (!normalizedSource || !tagName || !attributeName) {
    return '';
  }

  const matcher = new RegExp(`<${tagName}\\b[^>]*\\s${attributeName}="([^"]*)"`, 'i');
  const match = normalizedSource.match(matcher);
  return match ? String(match[1] || '').trim() : '';
}

/* Делает: Разбирает email crossref подтверждающего. Применение: используется локально в файле backend/services/repositoryService.js. */
function parseCrossrefConfirmationEmail(rawMessage = '') {
  const normalizedMessage = String(rawMessage || '').trim();
  if (!normalizedMessage) {
    throw createRepositoryError(
      'Вставьте текст письма или XML-ответа Crossref.',
      400,
      'CROSSREF_CONFIRMATION_REQUIRED'
    );
  }

  const doi = normalizeDoiValue(extractXmlTagValue(normalizedMessage, 'doi'));
  const submissionId = extractXmlTagValue(normalizedMessage, 'submission_id');
  const batchId = extractXmlTagValue(normalizedMessage, 'batch_id');
  const message = extractXmlTagValue(normalizedMessage, 'msg');
  const recordStatus = extractXmlAttributeValue(normalizedMessage, 'record_diagnostic', 'status');
  const batchStatus = extractXmlAttributeValue(normalizedMessage, 'doi_batch_diagnostic', 'status');

  if (!doi) {
    throw createRepositoryError(
      'В письме Crossref не найден DOI. Вставьте письмо целиком или XML-ответ.',
      400,
      'CROSSREF_CONFIRMATION_INVALID'
    );
  }

  const success = recordStatus.toLowerCase() === 'success' && /successfully added/i.test(message);
  if (!success) {
    const details = message ? ` Сообщение Crossref: ${message}` : '';
    throw createRepositoryError(
      `Crossref не подтвердил создание DOI для этого документа.${details}`,
      409,
      'CROSSREF_CONFIRMATION_NOT_SUCCESS'
    );
  }

  return {
    doi,
    submissionId,
    batchId,
    message,
    recordStatus,
    batchStatus,
  };
}

/* Делает: Выполняет узел publish черновика строки to проверенного. Применение: используется локально в файле backend/services/repositoryService.js. */
async function publishDraftRowToVerifiedNode(nodeId, publicationPayload, draftRow) {
  const { rows } = await repositoryPool.query(
    `INSERT INTO repository_nodes (
       id, name, meta, info, document_type, doi, xml_path, blocks,
       document_status, review_requested_at, verified_at, created_at, updated_at
     )
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8::jsonb, $9, NULL,
             CURRENT_TIMESTAMP, COALESCE($10::timestamp, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
     ON CONFLICT (id)
     DO UPDATE SET
       name = EXCLUDED.name,
       meta = EXCLUDED.meta,
       info = EXCLUDED.info,
       document_type = EXCLUDED.document_type,
       doi = EXCLUDED.doi,
       xml_path = EXCLUDED.xml_path,
       blocks = EXCLUDED.blocks,
       document_status = EXCLUDED.document_status,
       review_requested_at = NULL,
       verified_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, name, meta, info, document_type, doi, xml_path, blocks,
               updated_at, created_at, document_status, review_requested_at, verified_at`,
    [
      nodeId,
      publicationPayload.name,
      JSON.stringify(publicationPayload.storage.meta),
      JSON.stringify(publicationPayload.storage.info),
      publicationPayload.storage.documentType,
      publicationPayload.storage.doi,
      publicationPayload.storage.xmlPath,
      JSON.stringify(publicationPayload.blocks || []),
      DOCUMENT_STATUS_VERIFIED,
      publicationPayload.createdAt || draftRow?.created_at || null,
    ]
  );

  const updatedRow = rows[0];
  if (!updatedRow) {
    throw createRepositoryError(
      'Статус документа изменился во время публикации. Обновите страницу и повторите действие.',
      409,
      'DOCUMENT_STATUS_CONFLICT'
    );
  }

  return updatedRow;
}

/* Делает: Выполняет Crossref deposit XML to. Применение: используется локально в файле backend/services/repositoryService.js. */
async function depositXmlToCrossref(nodeId, actor = null) {
  await migrateJsonRepositoryIfNeeded();
  assertAdminActor(actor, 'отправлять XML в Crossref');

  if (!crossrefLoginId || !crossrefLoginPassword) {
    throw new Error('Не заданы учетные данные Crossref');
  }

  const lockKey = buildCrossrefDepositLockKey(nodeId);
  const lockClient = await repositoryPool.connect();
  let lockAcquired = false;

  try {
    const lockResult = await lockClient.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [lockKey]
    );
    lockAcquired = Boolean(lockResult.rows[0]?.locked);

    if (!lockAcquired) {
      const busyError = new Error('XML этого документа уже отправляется в Crossref.');
      busyError.code = 'CROSSREF_DEPOSIT_BUSY';
      busyError.httpStatus = 409;
      throw busyError;
    }

    const node = await getNodeRow(nodeId);
    let currentStatus = node ? normalizeDocumentStatus(node.document_status) : null;
    const isResubmission = currentStatus === DOCUMENT_STATUS_VERIFIED;
    let xmlPath = node?.xml_path || '';
    let draftRow = null;
    let draftDocument = null;

    if (!node) {
      const { rows } = await authPool.query(
        `SELECT user_id, document_id, name, meta, blocks, document_status, review_requested_at, verified_at,
                created_at, updated_at, source_updated_at
         FROM repository_personal_drafts
         WHERE document_id = $1
         ORDER BY updated_at DESC
         LIMIT 1`,
        [nodeId]
      );
      draftRow = rows[0] || null;

      if (!draftRow) {
        throw createRepositoryError('Документ не найден', 404, 'DOCUMENT_NOT_FOUND');
      }

      currentStatus = normalizeDocumentStatus(draftRow.document_status);
      if (currentStatus !== DOCUMENT_STATUS_UNDER_REVIEW) {
        throw createRepositoryError(
          'Документ можно отправить в Crossref только из статуса "На регистрации".',
          409,
          'DOCUMENT_STATUS_CONFLICT'
        );
      }

      draftDocument = normalizeDraftDocumentRow(draftRow);
      xmlPath = String(draftDocument?.meta?.xmlPath || '').trim();
    } else if (!isResubmission) {
      throw createRepositoryError(
        'Неопубликованный документ должен храниться в черновиках. Обновите страницу и повторите действие.',
        409,
        'DOCUMENT_STATUS_CONFLICT'
      );
    }

    if (!xmlPath) {
      throw new Error('У документа отсутствует XML для отправки');
    }

    const xmlFilePath = getManagedUploadFilePath(xmlPath);
    if (!xmlFilePath) {
      throw new Error('Не удалось определить путь к XML');
    }

    const xmlContent = await fs.readFile(xmlFilePath, 'utf-8');
    const fileName = path.basename(xmlFilePath);
    const form = new FormData();
    form.set('operation', 'doMDUpload');
    form.set('login_id', crossrefLoginId);
    form.set('login_passwd', crossrefLoginPassword);
    form.set('fname', new Blob([xmlContent], { type: 'application/xml' }), fileName);

    const response = await fetch(crossrefDepositUrl, {
      method: 'POST',
      body: form,
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Crossref вернул ${response.status}: ${responseText.slice(0, 500)}`);
    }

    const summary = await getRepositorySummary(actor);
    const updatedNode = summary.documents.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри depositXmlToCrossref. */ (document) => document.id === nodeId)
      || draftDocument
      || (node ? normalizeRow(node) : null);

    if (draftDocument) {
      void notifyCrossrefDepositAwaitingConfirmation(updatedNode || draftDocument, actor);
    }

    return {
      ok: true,
      fileName,
      responseText,
      resubmitted: isResubmission,
      tree: summary.tree,
      updatedNode,
    };
  } finally {
    if (lockAcquired) {
      try {
        await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
      } catch {
        // ignore unlock errors
      }
    }
    lockClient.release();
  }
}

/* Делает: Подтверждает email crossref публикации by. Применение: используется локально в файле backend/services/repositoryService.js. */
async function confirmCrossrefPublicationByEmail(nodeId, rawMessage, actor = null) {
  await migrateJsonRepositoryIfNeeded();
  assertAdminActor(actor, 'подтверждать публикацию по письму Crossref');

  const confirmation = parseCrossrefConfirmationEmail(rawMessage);
  const lockKey = buildCrossrefDepositLockKey(nodeId);
  const lockClient = await repositoryPool.connect();
  let lockAcquired = false;

  try {
    const lockResult = await lockClient.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [lockKey]
    );
    lockAcquired = Boolean(lockResult.rows[0]?.locked);

    if (!lockAcquired) {
      const busyError = new Error('Документ сейчас обрабатывается в Crossref. Повторите позже.');
      busyError.code = 'CROSSREF_DEPOSIT_BUSY';
      busyError.httpStatus = 409;
      throw busyError;
    }

    const node = await getNodeRow(nodeId);
    const nodeStatus = node ? normalizeDocumentStatus(node.document_status) : null;
    if (node && nodeStatus === DOCUMENT_STATUS_VERIFIED) {
      throw createRepositoryError('Документ уже опубликован.', 409, 'DOCUMENT_ALREADY_VERIFIED');
    }

    const draftRow = await getLatestPersonalDraftRowByDocument(nodeId);
    if (!draftRow) {
      throw createRepositoryError('Документ не найден', 404, 'DOCUMENT_NOT_FOUND');
    }

    const currentStatus = normalizeDocumentStatus(draftRow.document_status);
    if (currentStatus !== DOCUMENT_STATUS_UNDER_REVIEW) {
      throw createRepositoryError(
        'Подтверждение Crossref доступно только для документов в статусе "На регистрации".',
        409,
        'DOCUMENT_STATUS_CONFLICT'
      );
    }

    const publicationPayload = await buildPublishedDocumentFromDraft(draftRow);
    const currentDoi = normalizeDoiValue(publicationPayload.storage.doi);
    if (!currentDoi) {
      throw createRepositoryError(
        'У документа отсутствует DOI для подтверждения публикации.',
        409,
        'DOCUMENT_DOI_MISSING'
      );
    }

    if (normalizeDoiLookupValue(currentDoi) !== normalizeDoiLookupValue(confirmation.doi)) {
      throw createRepositoryError(
        `DOI в письме Crossref (${confirmation.doi}) не совпадает с текущим DOI документа (${currentDoi}). Сохраните изменения и повторно отправьте XML в Crossref.`,
        409,
        'CROSSREF_CONFIRMATION_DOI_MISMATCH'
      );
    }

    const updatedRow = await publishDraftRowToVerifiedNode(nodeId, publicationPayload, draftRow);
    await authPool.query(`DELETE FROM repository_personal_drafts WHERE document_id = $1`, [nodeId]);

    const tree = await loadTreeFromDb();
    const updatedNode = normalizeRow(updatedRow);
    const notification = await notifyCreatorAboutPublication(updatedNode, confirmation);

    return {
      ok: true,
      confirmedDoi: currentDoi,
      submissionId: confirmation.submissionId,
      batchId: confirmation.batchId,
      responseMessage: confirmation.message,
      tree,
      updatedNode,
      notification,
    };
  } finally {
    if (lockAcquired) {
      try {
        await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
      } catch {
        // ignore unlock errors
      }
    }
    lockClient.release();
  }
}

/* Делает: Подтверждает сообщение crossref публикации from почтового ящика. Применение: используется локально в файле backend/services/repositoryService.js. */
async function confirmCrossrefPublicationFromMailboxMessage(rawMessage, actor = null) {
  await migrateJsonRepositoryIfNeeded();
  assertAdminActor(actor, 'обрабатывать письма Crossref');

  const confirmation = parseCrossrefConfirmationEmail(rawMessage);
  const target = await findCrossrefConfirmationTargetByDoi(confirmation.doi);
  if (!target) {
    throw createRepositoryError(
      `Документ с DOI ${confirmation.doi} не найден среди документов репозитория.`,
      404,
      'DOCUMENT_NOT_FOUND'
    );
  }

  if (target.source === 'published' && target.status === DOCUMENT_STATUS_VERIFIED) {
    return {
      ok: true,
      alreadyVerified: true,
      confirmedDoi: confirmation.doi,
      matchedDocumentId: target.documentId,
      updatedNode: normalizeRow(target.nodeRow),
      submissionId: confirmation.submissionId,
      batchId: confirmation.batchId,
      responseMessage: confirmation.message,
    };
  }

  if (target.status !== DOCUMENT_STATUS_UNDER_REVIEW) {
    throw createRepositoryError(
      `Документ с DOI ${confirmation.doi} найден, но сейчас не находится в статусе "На регистрации".`,
      409,
      'DOCUMENT_STATUS_CONFLICT'
    );
  }

  const result = await confirmCrossrefPublicationByEmail(target.documentId, rawMessage, actor);
  return {
    ...result,
    alreadyVerified: false,
    matchedDocumentId: target.documentId,
    confirmedDoi: confirmation.doi,
  };
}

export const repositoryService = {
  getRepositorySummary,
  getRepositoryUserDocuments,
  getPersonalDraft,
  createDirectory,
  createDocument,
  saveUploadedAsset,
  deleteUploadedAsset,
  savePersonalDraft,
  updateNode,
  deletePersonalDraft,
  deleteNode,
  getDocumentsForReview,
  submitDocumentForReview,
  sendDocumentToRevision,
  depositXmlToCrossref,
  confirmCrossrefPublicationByEmail,
  confirmCrossrefPublicationFromMailboxMessage,
  migrateJsonRepositoryIfNeeded,
};

export const repositoryServiceTestUtils = {
  buildDocumentCitation,
  canActorViewDocument,
  ensureDocumentEditable,
  getManagedUploadDocumentDirectory,
  getManagedUploadRelativePath,
  getManagedUploadFilePath,
  findCrossrefConfirmationTargetByDoi,
  parseCrossrefConfirmationEmail,
  resolveEditableDocumentDoi,
  resolveXmlDocumentName,
  resolveUniqueDoiCandidate,
  shouldRefreshEditableDocumentXml,
  synchronizeCitationLinks,
};

