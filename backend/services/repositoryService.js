import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
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
const repositoryDepositorName = process.env.REPOSITORY_DOI_DEPOSITOR_NAME || 'Ernest Kedrov';
const repositoryDepositorEmail = process.env.REPOSITORY_DOI_DEPOSITOR_EMAIL || 'crossref@gcras.ru';
const repositoryPublisherName = process.env.REPOSITORY_XML_PUBLISHER_NAME || 'Geophysical Survey of the Russian Academy of Sciences';
const repositoryPublisherPlace = process.env.REPOSITORY_XML_PUBLISHER_PLACE || 'Obninsk, Russia';
const repositoryInstitutionName = process.env.REPOSITORY_XML_INSTITUTION_NAME || 'Geophysical Survey of the Russian Academy of Sciences';
const repositoryInstitutionPlace = process.env.REPOSITORY_XML_INSTITUTION_PLACE || 'Obninsk, Russia';
const repositoryContributorOrganization = process.env.REPOSITORY_XML_CONTRIBUTOR_ORGANIZATION || 'Geophysical Center RAS, Moscow, Russia ';
const crossrefSchemaVersion = process.env.CROSSREF_SCHEMA_VERSION || '4.3.7';

const DOCUMENT_STATUS_NEEDS_REVISION = 'needs_revision';
const DOCUMENT_STATUS_UNDER_REVIEW = 'under_review';
const DOCUMENT_STATUS_VERIFIED = 'verified';
const DOCUMENT_STATUS_VALUES = new Set([
  DOCUMENT_STATUS_NEEDS_REVISION,
  DOCUMENT_STATUS_UNDER_REVIEW,
  DOCUMENT_STATUS_VERIFIED,
]);
let flatStructureNormalized = false;
let legacyXmlResourceUrlsFixed = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEmptyRoot() {
  return {
    id: 'root',
    name: 'Репозиторий ФИЦ ЕГС РАС',
    type: 'directory',
    children: [],
  };
}

function createDefaultDocumentMeta() {
  return {
    annotation: '',
    publicationDate: new Date().toISOString().slice(0, 10),
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
    journalCode: '',
    volume: '',
    articleNumber: '',
    doi: '',
    citationLink: '',
    citationLinkEn: '',
    xmlPath: '',
    license: 'CC BY 4.0',
    position: 0,
  };
}

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

  delete normalized.descriptionInfo;
  return normalized;
}

function extractDocumentStorage(meta = {}) {
  const defaults = createDefaultDocumentMeta();
  const mergedMeta = { ...defaults, ...normalizeLegacyDocumentMeta(meta || {}) };
  const documentType = typeof mergedMeta.documentType === 'string' ? mergedMeta.documentType : '';
  const doi = typeof mergedMeta.doi === 'string' ? mergedMeta.doi : '';
  const xmlPath = typeof mergedMeta.xmlPath === 'string' ? mergedMeta.xmlPath : '';

  return {
    documentType,
    doi,
    xmlPath,
    meta: {
      ...mergedMeta,
      documentType: '',
      doi: '',
      xmlPath: '',
    },
  };
}

function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'file';
}

function buildDocumentSlug(value) {
  return slugifySegment(value || 'document', 'document').toLowerCase();
}

function resolveStorageYear(publicationDate, fallbackDate = new Date()) {
  const yearMatch = String(publicationDate || '').trim().match(/^(\d{4})/);
  if (yearMatch) {
    return yearMatch[1];
  }

  const parsedFallback = new Date(fallbackDate);
  if (!Number.isNaN(parsedFallback.getTime())) {
    return String(parsedFallback.getUTCFullYear());
  }

  return String(new Date().getUTCFullYear());
}

function resolveDocumentStorageInfo({
  documentName,
  publicationDate,
  createdAt,
}) {
  const year = resolveStorageYear(publicationDate, createdAt);
  const documentSlug = buildDocumentSlug(documentName);
  const relativeDir = path.posix.join(year, documentSlug);
  const absoluteDir = path.join(repositoryUploadsDir, year, documentSlug);

  return { year, documentSlug, relativeDir, absoluteDir };
}

function buildManagedUploadUrl(relativeDir, fileName) {
  return `${managedUploadPrefix}${path.posix.join(relativeDir, fileName)}`;
}

function normalizeBlockOrder(blockOrder) {
  const numeric = Number(blockOrder);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalized = Math.floor(numeric);
  return normalized >= 1 ? normalized : null;
}

function buildStoredAssetFileName({ documentSlug, blockOrder, extension }) {
  const normalizedExtension = extension || '';
  const normalizedOrder = normalizeBlockOrder(blockOrder);
  const orderSegment = normalizedOrder
    ? String(normalizedOrder).padStart(2, '0')
    : `${Date.now()}-${randomUUID().slice(0, 8)}`;

  return `${documentSlug}-${orderSegment}${normalizedExtension}`;
}

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

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function splitMetaList(value) {
  return String(value || '')
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitPersonName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { givenName: parts[0] || 'test', surname: parts[0] || 'test' };
  }

  return {
    givenName: parts.slice(0, -1).join(' ') || 'test',
    surname: parts[parts.length - 1] || 'test',
  };
}

function xmlField(value, fallback = 'test') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}


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
    .map((char) => map[char] ?? char)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function xmlPersonName(value, fallback = 'test') {
  return xmlField(transliterateRuToLatin(value), fallback);
}

function createCrossrefTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}00`;
}

function createDoiBatchId(nodeId) {
  const source = String(nodeId || 'repository');
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) % 100000;
  }

  return `ESDB${String(hash).padStart(5, '0')}`;
}

function resolvePublicationDate(meta) {
  const parsed = meta?.publicationDate ? new Date(meta.publicationDate) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function resolveCreationDate(createdAt, publicationDate) {
  if (createdAt) {
    const parsed = new Date(createdAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return publicationDate;
}

function buildApproximateDoi(nodeId, name, meta) {
  const publicationYear =
    String(meta?.publicationDate || '')
      .trim()
      .match(/^(\d{4})-/)?.[1] || '';
  const journalCode = String(meta?.journalCode || '')
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

function buildDocumentWorkspaceUrl(nodeId) {
  return `${repositoryPublicBaseUrl}/repository/workspace#${nodeId}`;
}

function buildDocumentEditUrl(nodeId) {
  return `${repositoryPublicBaseUrl}/repository/edit#${nodeId}`;
}

function buildDocumentResourceUrl(nodeId, mode = 'workspace') {
  return mode === 'edit' ? buildDocumentEditUrl(nodeId) : buildDocumentWorkspaceUrl(nodeId);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function repairLegacyXmlResourceUrls() {
  const { rows } = await repositoryPool.query(`
    SELECT id, xml_path
    FROM repository_nodes
    WHERE COALESCE(xml_path, '') <> ''
  `);

  await Promise.all(
    rows.map(async (row) => {
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

function buildXmlFileName(directoryNames = [], documentName = 'document') {
  const segments = [...directoryNames, documentName]
    .map((segment) => slugifySegment(segment, 'DOCUMENT').toLowerCase())
    .filter(Boolean);

  return `${segments.join('--') || 'document'}.xml`;
}

function buildDatabaseCollectionDoi({ meta, directoryNames = [] }) {
  const publicationYear =
    String(meta?.publicationDate || '')
      .trim()
      .match(/^(\d{4})-/)?.[1] || new Date().getUTCFullYear();
  const journalCode = String(meta?.journalCode || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '') || 'repo';
  const volume = String(meta?.volume || '')
    .trim()
    .replace(/[^\dA-Za-z.-]+/g, '') || slugifySegment(directoryNames.join('-') || 'collection', 'collection').toLowerCase();

  return `${repositoryDoiPrefix}/gsras.${journalCode}.${publicationYear}.${volume}.collection`;
}

function buildDatabaseCollectionResourceUrl(directoryNames = []) {
  if (!directoryNames.length) {
    return `${repositoryPublicBaseUrl}/repository`;
  }

  return `${repositoryPublicBaseUrl}/repository?collection=${encodeURIComponent(directoryNames.join('/'))}`;
}

function resolveDatasetType(meta) {
  const source = `${meta?.documentType || ''} ${meta?.recordType || ''}`.toLowerCase();
  return source.includes('collection') ? 'collection' : 'record';
}

function resolveAffiliations(meta) {
  const rawAffiliations = splitMetaList(meta?.affiliations);
  const fallbackAffiliation = xmlField(meta?.organizationEn || meta?.organization, repositoryContributorOrganization || 'test');

  return {
    items: rawAffiliations,
    fallback: fallbackAffiliation,
  };
}

function buildContributorsXml(meta, indent = '          ') {
  const authors = splitMetaList(meta?.authorsEn || meta?.authors);
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

  authors.forEach((author, index) => {
    const { givenName, surname } = splitPersonName(author);
    const sequence = index === 0 ? 'first' : 'additional';
    const affiliation = xmlField(affiliations[index] || affiliations[0] || fallbackAffiliation);

    lines.push(`${indent}<person_name sequence="${sequence}" contributor_role="author">`);
    lines.push(`${indent}  <given_name>${escapeXml(xmlField(givenName))}</given_name>`);
    lines.push(`${indent}  <surname>${escapeXml(xmlField(surname))}</surname>`);
    lines.push(`${indent}  <affiliation>${escapeXml(affiliation)}</affiliation>`);
    lines.push(`${indent}</person_name>`);
  });

  return lines.join('\n');
}

function normalizeRecordType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['database', 'dataset', 'journal_article', 'report', 'component'].includes(normalized)) {
    return normalized;
  }

  return 'database';
}

function extractDoiFromText(value) {
  const match = String(value || '').match(/10\.\d{4,9}\/[A-Z0-9._;()/:+-]+/i);
  return match ? match[0].replace(/[.,;]+$/, '') : '';
}

function resolveJournalTitle(meta) {
  const journalCode = String(meta?.journalCode || '').trim().toLowerCase();
  const knownTitles = {
    rjs: 'The Russian Journal of Seismology',
    zse: 'Earthquakes of Northern Eurasia',
    er: 'Earthquakes of Russia',
  };

  return knownTitles[journalCode] || xmlField(meta?.organizationEn || meta?.organization || repositoryInstitutionName);
}

function resolveComponentParentDoi(meta, doi) {
  return (
    extractDoiFromText(meta?.parentDoi) ||
    extractDoiFromText(meta?.citationLink) ||
    extractDoiFromText(meta?.xmlPath) ||
    `${xmlField(meta?.doi || doi, `${repositoryDoiPrefix}/gsras.parent.test`)}.parent`
  );
}

function buildTitlesXml(title, indent = '') {
  return `${indent}<titles>\n${indent}  <title>${escapeXml(xmlField(title))}</title>\n${indent}</titles>`;
}

function buildPublicationDateXml(publicationDate, indent = '', attributes = '') {
  const attr = attributes ? ` ${attributes}` : '';
  return `${indent}<publication_date${attr}>\n${indent}  <month>${publicationDate.getUTCMonth() + 1}</month>\n${indent}  <day>${publicationDate.getUTCDate()}</day>\n${indent}  <year>${publicationDate.getUTCFullYear()}</year>\n${indent}</publication_date>`;
}

function buildDatabaseDateXml(creationDate, publicationDate, indent = '') {
  return `${indent}<database_date>\n${indent}  <creation_date>\n${indent}    <year>${creationDate.getUTCFullYear()}</year>\n${indent}  </creation_date>\n${buildPublicationDateXml(publicationDate, `${indent}  `)}\n${indent}</database_date>`;
}

function buildPublisherXml(indent = '') {
  return `${indent}<publisher>\n${indent}  <publisher_name>${escapeXml(xmlField(repositoryPublisherName))}</publisher_name>\n${indent}  <publisher_place>${escapeXml(xmlField(repositoryPublisherPlace))}</publisher_place>\n${indent}</publisher>`;
}

function buildInstitutionXml(indent = '') {
  return `${indent}<institution>\n${indent}  <institution_name>${escapeXml(xmlField(repositoryInstitutionName))}</institution_name>\n${indent}  <institution_place>${escapeXml(xmlField(repositoryInstitutionPlace))}</institution_place>\n${indent}</institution>`;
}

function buildDoiDataXml({ doi, timestamp, resource }, indent = '') {
  return `${indent}<doi_data>\n${indent}  <doi>${escapeXml(xmlField(doi))}</doi>\n${indent}  <timestamp>${timestamp}</timestamp>\n${indent}  <resource>${escapeXml(xmlField(resource))}</resource>\n${indent}</doi_data>`;
}

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

function buildJournalIssueXml(meta, publicationDate, indent = '') {
  const volume = String(meta?.volume || '').trim();
  if (!volume) {
    return '';
  }

  return `${indent}<journal_issue>\n${buildPublicationDateXml(publicationDate, `${indent}  `, 'media_type="online"')}\n${indent}  <journal_volume>\n${indent}    <volume>${escapeXml(xmlField(volume))}</volume>\n${indent}  </journal_volume>\n${indent}</journal_issue>`;
}

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
      const databaseDoi = buildDatabaseCollectionDoi({ meta, directoryNames });
      const databaseResource = buildDatabaseCollectionResourceUrl(directoryNames);
      const datasetType = resolveDatasetType(meta);

      return `<database>\n<database_metadata language="en">\n${buildTitlesXml(databaseTitle)}\n${buildInstitutionXml()}\n${buildDoiDataXml({ doi: databaseDoi, timestamp, resource: databaseResource })}\n</database_metadata>\n<dataset dataset_type="${datasetType}">\n<contributors>\n${contributorsXml}\n</contributors>\n${buildTitlesXml(title)}\n<description>${escapeXml(description)}</description>\n${buildDatabaseDateXml(creationDate, publicationDate)}\n${buildPublisherXml()}\n${buildInstitutionXml()}\n${buildDoiDataXml({ doi, timestamp, resource })}\n</dataset>\n</database>`;
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

      return `<report-paper>\n<report-paper_metadata language="en">\n<contributors>\n${contributorsXml}\n</contributors>\n${buildTitlesXml(title)}\n<description>${escapeXml(description)}</description>\n${buildPublicationDateXml(publicationDate, '', 'media_type="online"')}${reportNumberXml}\n${buildPublisherXml()}\n${buildInstitutionXml()}\n${buildDoiDataXml({ doi, timestamp, resource })}\n</report-paper_metadata>\n</report-paper>`;
    }
    case 'component': {
      const parentDoi = resolveComponentParentDoi(meta, doi);
      return `<sa_component parent_doi="${escapeXml(parentDoi)}">\n<component_list>\n<component parent_relation="isPartOf">\n${buildTitlesXml(title)}\n<description>${escapeXml(description)}</description>\n<format mime_type="text/html"/>\n${buildDoiDataXml({ doi, timestamp, resource })}\n</component>\n</component_list>\n</sa_component>`;
    }
    case 'database':
    default:
      return `<database>\n<database_metadata language="en">\n<contributors>\n${contributorsXml}\n</contributors>\n${buildTitlesXml(title)}\n<description>${escapeXml(description)}</description>\n${buildDatabaseDateXml(creationDate, publicationDate)}\n${buildPublisherXml()}\n${buildInstitutionXml()}\n${buildDoiDataXml({ doi, timestamp, resource })}\n</database_metadata>\n</database>`;
  }
}

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
  const depositorName = xmlPersonName(normalizedMeta?.creatorName, repositoryDepositorName);
  const depositorEmail = xmlField(normalizedMeta?.creatorEmail, repositoryDepositorEmail);
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

async function upsertGeneratedXml({ nodeId, name, meta, doi, existingXmlPath, createdAt }) {
  await ensureUploadsInitialized();

  const existingFilePath = existingXmlPath ? getManagedUploadFilePath(existingXmlPath) : null;
  const storage = resolveDocumentStorageInfo({
    documentName: name,
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
  const normalizedPathname = cleanPathname.startsWith('/') ? cleanPathname : `/${cleanPathname}`;
  if (!normalizedPathname.startsWith(managedUploadPrefix)) {
    return null;
  }

  const relativePath = normalizedPathname.slice(1).replace(/^\/+/, '');
  return relativePath || null;
}

function isManagedUploadUrl(url) {
  return Boolean(getManagedUploadRelativePath(url));
}

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
  const normalizedPathname = cleanPathname.startsWith('/') ? cleanPathname : `/${cleanPathname}`;

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

function collectManagedUploadUrlsFromBlocks(blocks = []) {
  return blocks
    .filter((block) => (block.type === 'image' || block.type === 'file') && isManagedUploadUrl(block.url))
    .map((block) => block.url);
}

function collectManagedUploadUrls(node) {
  if (!node) {
    return [];
  }

  if (node.type === 'document') {
    const xmlUrl = node.meta?.xmlPath && isManagedUploadUrl(node.meta.xmlPath) ? [node.meta.xmlPath] : [];
    return [...collectManagedUploadUrlsFromBlocks(node.blocks || []), ...xmlUrl];
  }

  return (node.children || []).flatMap((child) => collectManagedUploadUrls(child));
}

async function deleteManagedUploads(urls) {
  const uniqueUrls = [...new Set((urls || []).filter(Boolean))];
  for (const url of uniqueUrls) {
    await deleteManagedUpload(url);
  }
}

async function ensureUploadsInitialized() {
  await fs.mkdir(repositoryUploadsDir, { recursive: true });
  await fs.mkdir(repositoryXmlDir, { recursive: true });
}

async function saveUploadedAsset({
  fileName,
  content,
  mimeType,
  kind,
  documentName = '',
  publicationDate = '',
  blockOrder = null,
}) {
  await ensureUploadsInitialized();

  const safeName = sanitizeFileName(fileName);
  const extension = path.extname(safeName);
  const storage = resolveDocumentStorageInfo({
    documentName: documentName || safeName || kind,
    publicationDate,
    createdAt: new Date(),
  });
  const storedFileName = buildStoredAssetFileName({
    documentSlug: storage.documentSlug,
    blockOrder,
    extension,
  });
  const filePath = path.join(storage.absoluteDir, storedFileName);
  const buffer = Buffer.from(content, 'base64');

  await fs.mkdir(storage.absoluteDir, { recursive: true });
  await fs.writeFile(filePath, buffer);

  return {
    fileName: storedFileName,
    mimeType: mimeType || null,
    url: buildManagedUploadUrl(storage.relativeDir, storedFileName),
  };
}

function normalizeDraftMeta(meta = {}, actor = null) {
  if (!meta || typeof meta !== 'object') {
    return {};
  }

  return normalizeLegacyDocumentMeta(sanitizeMetaPatchByActor(meta, actor));
}

function normalizeDraftBlocks(blocks) {
  return Array.isArray(blocks) ? clone(blocks) : [];
}

function normalizeOptionalTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizePersonalDraftRow(row) {
  if (!row) {
    return null;
  }

  return {
    name: typeof row.name === 'string' ? row.name : '',
    meta: normalizeDraftMeta(row.meta || {}),
    blocks: normalizeDraftBlocks(row.blocks),
    savedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    sourceUpdatedAt: row.source_updated_at ? new Date(row.source_updated_at).toISOString() : undefined,
  };
}

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

async function readJsonFile(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function readDirectoryNodeFromJson(directoryId) {
  return readJsonFile(path.join(storageDir, `${directoryId}.json`));
}

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

async function ensureRepositorySchema() {
  await repositoryPool.query(`
    CREATE TABLE IF NOT EXISTS repository_nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      meta JSONB,
      document_type TEXT,
      doi TEXT,
      xml_path TEXT,
      document_status VARCHAR(32) NOT NULL DEFAULT 'needs_revision',
      review_requested_at TIMESTAMP,
      verified_at TIMESTAMP,
      blocks JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

  await repositoryPool.query(`
    CREATE TABLE IF NOT EXISTS repository_personal_drafts (
      user_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
      source_updated_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, document_id)
    );
  `);

  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS document_type TEXT`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS doi TEXT`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS xml_path TEXT`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS document_status VARCHAR(32) NOT NULL DEFAULT 'needs_revision'`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMP`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP`);
  await repositoryPool.query(`ALTER TABLE repository_personal_drafts ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMP`);
  await repositoryPool.query(`ALTER TABLE repository_personal_drafts ALTER COLUMN user_id TYPE TEXT USING user_id::text`);

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

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'repository_nodes_document_status_check'
        ) THEN
          ALTER TABLE repository_nodes
          ADD CONSTRAINT repository_nodes_document_status_check
          CHECK (document_status IN ('needs_revision', 'under_review', 'verified'));
        END IF;
      END $$;
    `);

    await client.query(`
      UPDATE repository_nodes
      SET document_status = CASE
        WHEN document_status IN ('needs_revision', 'under_review', 'verified') THEN document_status
        ELSE 'needs_revision'
      END
    `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS repository_nodes_document_status_idx
        ON repository_nodes(document_status, updated_at DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS repository_personal_drafts_document_idx
        ON repository_personal_drafts(document_id, updated_at DESC)
      `);

      await client.query('COMMIT');
    } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function insertTreeIntoDb(client, node) {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (node.type === 'document') {
    const stored = extractDocumentStorage(node.meta || {});
    await client.query(
      `
        INSERT INTO repository_nodes (id, name, meta, document_type, doi, xml_path, blocks, updated_at)
        VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb, COALESCE($8::timestamp, CURRENT_TIMESTAMP))
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          meta = EXCLUDED.meta,
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

  await normalizeRepositoryStructureIfNeeded();
}

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

function normalizeDocumentStatus(status) {
  return DOCUMENT_STATUS_VALUES.has(status) ? status : DOCUMENT_STATUS_NEEDS_REVISION;
}

function createRepositoryError(message, httpStatus = 400, code = '') {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  if (code) {
    error.code = code;
  }
  return error;
}

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

function collectMetaLanguageValidationErrors(meta) {
  const errors = [];
  const authorEntries = Array.isArray(meta?.authorEntries) ? meta.authorEntries : [];

  if (authorEntries.length > 0) {
    authorEntries.forEach((entry, index) => {
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

function assertMetaLanguageConstraints(meta) {
  const errors = collectMetaLanguageValidationErrors(meta);
  if (!errors.length) {
    return;
  }

  throw createRepositoryError(errors.join(' '), 400, 'META_LANGUAGE_VALIDATION_FAILED');
}

function getDocumentStatusLabel(status) {
  switch (normalizeDocumentStatus(status)) {
    case DOCUMENT_STATUS_UNDER_REVIEW:
      return 'На проверке';
    case DOCUMENT_STATUS_VERIFIED:
      return 'Проверенный';
    default:
      return 'На доработке';
  }
}

function normalizeActorId(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function isDocumentOwnedByActor(row, actor) {
  if (!row || !actor) {
    return false;
  }

  const meta = normalizeLegacyDocumentMeta(row.meta || {});
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
      'Документ находится на проверке. Изменения недоступны до смены статуса.',
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
      adminRecipients.map((admin) =>
        emailService.sendRepositoryAdminNotification({
          to: admin.email,
          subject: 'Новый документ на проверке',
          title: 'Документ отправлен на проверку',
          message: `Документ "${documentSummary.name}" ожидает проверки администратора.`,
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

    const failedCount = results.reduce((count, result, index) => {
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

async function resolveEditorRecipientEmail(documentSummary) {
  const candidates = [
    String(documentSummary?.meta?.reviewEditorEmail || '').trim().toLowerCase(),
    String(documentSummary?.meta?.creatorEmail || '').trim().toLowerCase(),
    String(documentSummary?.creatorEmail || '').trim().toLowerCase(),
  ].filter(Boolean);

  const uniqueCandidates = [...new Set(candidates)].filter((email) => email.includes('@'));
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

async function notifyCreatorAboutAcceptance(documentSummary, actor) {
  try {
    const recipient = await resolveEditorRecipientEmail(documentSummary);
    if (!recipient) {
      console.warn(`Repository acceptance notification skipped: editor email is empty for document ${documentSummary?.id || 'unknown'}`);
      return;
    }

    const emailService = await getEmailService();
    await emailService.sendRepositoryUserNotification({
      to: recipient,
      subject: 'Документ принят администратором',
      title: 'Документ принят и отправлен дальше',
      message: `Документ "${documentSummary.name}" принят администратором и подготовлен к отправке в Crossref.`,
      details: [
        `Статус: ${getDocumentStatusLabel(DOCUMENT_STATUS_VERIFIED)}`,
        `Администратор: ${getActorDisplayName(actor, 'Администратор репозитория')}`,
      ],
      actionLabel: 'Открыть документ',
      actionUrl: buildDocumentResourceUrl(documentSummary.id, 'edit'),
    });
    console.log(`Repository acceptance notification sent to ${recipient} for document ${documentSummary.id}`);
  } catch (error) {
    console.error('Repository acceptance notification error:', error);
  }
}

function normalizeRow(row) {
  return {
    id: row.id,
    name: row.name,
    type: 'document',
    meta: {
      ...createDefaultDocumentMeta(),
      ...normalizeLegacyDocumentMeta(row.meta || {}),
      documentType: row.document_type || '',
      doi: row.doi || '',
      xmlPath: row.xml_path || '',
    },
    blocks: row.blocks || [],
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
    documentStatus: normalizeDocumentStatus(row.document_status),
    reviewRequestedAt: row.review_requested_at ? new Date(row.review_requested_at).toISOString() : undefined,
    verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : undefined,
  };
}

function buildTreeFromRows(rows) {
  return {
    id: 'root',
    name: 'Репозиторий ФИЦ ЕГС РАС',
    type: 'directory',
    children: rows.map((row) => normalizeRow(row)),
  };
}

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

  return (node.children || []).flatMap((child) =>
    listDocuments(child, node.id === 'root' ? parents : [...parents, node.name])
  );
}

function buildFlatTree(rootName, documents) {
  return {
    id: 'root',
    name: rootName || 'Репозиторий ФИЦ ЕГС РАН',
    type: 'directory',
    children: documents.map((document) => ({
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

async function getAllRows() {
  await migrateJsonRepositoryIfNeeded();
  const { rows } = await repositoryPool.query(`
    SELECT id, name, meta, document_type, doi, xml_path, blocks,
           updated_at, created_at, document_status, review_requested_at, verified_at
    FROM repository_nodes
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id ASC
  `);
  return rows;
}

async function loadTreeFromDb() {
  const rows = await getAllRows();
  const tree = buildTreeFromRows(rows);
  if (!tree) {
    throw new Error('Repository root not found');
  }
  return tree;
}

async function getNodeRow(nodeId) {
  await migrateJsonRepositoryIfNeeded();
  const { rows } = await repositoryPool.query(
    `SELECT id, name, meta, document_type, doi, xml_path, blocks,
            updated_at, created_at, document_status, review_requested_at, verified_at
     FROM repository_nodes
     WHERE id = $1`,
    [nodeId]
  );
  return rows[0] || null;
}

async function getDirectoryNamesByParentId(client, parentId) {
  return [];
}

const RESTRICTED_META_FIELDS_FOR_GUESTS = ['revisionComment', 'revisionCommentAuthor', 'revisionCommentUpdatedAt'];

function canViewRevisionComment(actor, meta = null) {
  if (actor?.role === 'admin' || actor?.role === 'editor') {
    return true;
  }

  if (actor?.role !== 'user' || !meta) {
    return false;
  }

  return isDocumentOwnedByActor({ meta }, actor);
}

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
    children: (node.children || []).map((child) => sanitizeTreeForPublic(child, actor)),
  };
}

function sanitizeDocumentsForPublic(documents, actor = null) {
  return documents.map((document) => ({
    ...document,
    meta: sanitizeMetaForPublic(document.meta, actor),
  }));
}

async function getRepositorySummary(actor = null) {
  const tree = await loadTreeFromDb();
  const documents = listDocuments(tree);
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

async function getPersonalDraft(nodeId, actor = null) {
  await migrateJsonRepositoryIfNeeded();
  const userId = getRepositoryActorDraftOwnerKey(actor);
  const existing = await getNodeRow(nodeId);

  if (!existing || nodeId === 'root') {
    throw createRepositoryError('Документ не найден', 404, 'DOCUMENT_NOT_FOUND');
  }

  const { rows } = await repositoryPool.query(
    `SELECT name, meta, blocks, updated_at, source_updated_at
     FROM repository_personal_drafts
     WHERE user_id = $1 AND document_id = $2`,
    [userId, nodeId]
  );

  return normalizePersonalDraftRow(rows[0] || null);
}

async function savePersonalDraft(nodeId, draft, actor = null) {
  await migrateJsonRepositoryIfNeeded();
  const userId = getRepositoryActorDraftOwnerKey(actor);
  const client = await repositoryPool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, name, meta, document_type, doi, xml_path, blocks, updated_at, created_at,
              document_status, review_requested_at, verified_at
       FROM repository_nodes
       WHERE id = $1
       FOR UPDATE`,
      [nodeId]
    );
    const existing = rows[0];

    if (!existing || nodeId === 'root') {
      throw createRepositoryError('Документ не найден', 404, 'DOCUMENT_NOT_FOUND');
    }

    ensureDocumentEditable(existing, actor, 'сохранять черновик для');

    const normalizedName = typeof draft?.name === 'string' && draft.name.trim()
      ? draft.name.trim()
      : existing.name;
    const normalizedMeta = normalizeDraftMeta(draft?.meta || {}, actor);
    const normalizedBlocks = normalizeDraftBlocks(draft?.blocks);
    const sourceUpdatedAt = normalizeOptionalTimestamp(draft?.sourceUpdatedAt);

    const result = await client.query(
      `INSERT INTO repository_personal_drafts (
         user_id, document_id, name, meta, blocks, source_updated_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::timestamp, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, document_id)
       DO UPDATE SET
         name = EXCLUDED.name,
         meta = EXCLUDED.meta,
         blocks = EXCLUDED.blocks,
         source_updated_at = EXCLUDED.source_updated_at,
         updated_at = CURRENT_TIMESTAMP
       RETURNING name, meta, blocks, updated_at, source_updated_at`,
      [
        userId,
        nodeId,
        normalizedName,
        JSON.stringify(normalizedMeta),
        JSON.stringify(normalizedBlocks),
        sourceUpdatedAt,
      ]
    );

    await client.query('COMMIT');
    return normalizePersonalDraftRow(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deletePersonalDraft(nodeId, actor = null) {
  await migrateJsonRepositoryIfNeeded();
  const userId = getRepositoryActorDraftOwnerKey(actor);

  await repositoryPool.query(
    `DELETE FROM repository_personal_drafts
     WHERE user_id = $1 AND document_id = $2`,
    [userId, nodeId]
  );

  return { ok: true };
}

async function createDirectory(parentId, name) {
  throw createRepositoryError(
    'Создание каталогов отключено: репозиторий использует плоскую структуру документов.',
    400,
    'DIRECTORIES_DISABLED'
  );
}

async function createDocument(parentId, name, documentType, creator = null) {
  await migrateJsonRepositoryIfNeeded();
  const client = await repositoryPool.connect();
  try {
    await client.query('BEGIN');

    const id = randomUUID();
    const meta = {
      ...createDefaultDocumentMeta(),
      documentType: (documentType || '').trim(),
      creatorUserId: creator?.id ? String(creator.id) : '',
      creatorName: creator?.fullName || creator?.name || '',
      creatorEmail: creator?.email || '',
      organization: creator?.organization || '',
    };
    const blocks = [];
    const updatedAt = new Date().toISOString();
    const stored = extractDocumentStorage(meta);

    await client.query(
      `
        INSERT INTO repository_nodes (
          id, name, meta, document_type, doi, xml_path, blocks, updated_at, document_status
        )
        VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb, $8::timestamp, $9)
      `,
      [
        id,
        name,
        JSON.stringify(stored.meta),
        stored.documentType,
        stored.doi,
        stored.xmlPath,
        JSON.stringify(blocks),
        updatedAt,
        DOCUMENT_STATUS_NEEDS_REVISION,
      ]
    );

    await client.query('COMMIT');
    return {
      tree: await loadTreeFromDb(),
      createdNode: {
        id,
        name,
        type: 'document',
        meta,
        blocks,
        updatedAt,
        documentStatus: DOCUMENT_STATUS_NEEDS_REVISION,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateNode(nodeId, updates) {
  await migrateJsonRepositoryIfNeeded();
  const client = await repositoryPool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, name, meta, document_type, doi, xml_path, blocks, updated_at, created_at,
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
      ...normalizeLegacyDocumentMeta(existing.meta || {}),
      documentType: existing.document_type || '',
      doi: existing.doi || '',
      xmlPath: existing.xml_path || '',
      ...metaPatch,
    };
    const nextBlocks = Array.isArray(updates.blocks) ? updates.blocks : (existing.blocks || []);
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
      const previousUploadUrls = collectManagedUploadUrlsFromBlocks(existing.blocks || []);
      const nextUploadUrls = collectManagedUploadUrlsFromBlocks(nextBlocks || []);
      const removedUploadUrls = previousUploadUrls.filter((url) => !nextUploadUrls.includes(url));
      await deleteManagedUploads(removedUploadUrls);
    }

    const generatedDoi = existing.doi || buildApproximateDoi(nodeId, nextName, nextMeta);
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

    const storedDocument = extractDocumentStorage(nextMeta);

    await client.query(
      `
        UPDATE repository_nodes
        SET name = $2,
            meta = $3::jsonb,
            document_type = $4,
            doi = $5,
            xml_path = $6,
            blocks = $7::jsonb,
            updated_at = COALESCE($8::timestamp, updated_at)
        WHERE id = $1
      `,
      [
        nodeId,
        nextName,
        JSON.stringify(storedDocument.meta),
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

async function deleteNode(nodeId, actor = null) {
  await migrateJsonRepositoryIfNeeded();

  if (nodeId === 'root') {
    throw new Error('Node not found');
  }

  const existing = await getNodeRow(nodeId);
  if (!existing) {
    throw new Error('Node not found');
  }

  ensureDocumentEditable(existing, actor, 'удалять');
  const deletedNode = normalizeRow(existing);
  await deleteManagedUploads(collectManagedUploadUrls(deletedNode));

  await repositoryPool.query(`DELETE FROM repository_personal_drafts WHERE document_id = $1`, [nodeId]);
  await repositoryPool.query(`DELETE FROM repository_nodes WHERE id = $1`, [nodeId]);
  return { tree: await loadTreeFromDb(), deletedNode: clone(deletedNode) };
}

async function getDocumentsForReview() {
  const tree = await loadTreeFromDb();
  return listDocuments(tree)
    .filter((document) => normalizeDocumentStatus(document.documentStatus) === DOCUMENT_STATUS_UNDER_REVIEW)
    .sort((left, right) => {
      const leftTime = Date.parse(left.reviewRequestedAt || left.updatedAt || '') || 0;
      const rightTime = Date.parse(right.reviewRequestedAt || right.updatedAt || '') || 0;
      return rightTime - leftTime;
    });
}

async function submitDocumentForReview(nodeId, actor = null) {
  await migrateJsonRepositoryIfNeeded();
  const client = await repositoryPool.connect();
  let updatedRow = null;

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, name, meta, document_type, doi, xml_path, blocks,
              updated_at, created_at, document_status, review_requested_at, verified_at
       FROM repository_nodes
       WHERE id = $1
       FOR UPDATE`,
      [nodeId]
    );
    const existing = rows[0];

    if (!existing) {
      throw createRepositoryError('Документ не найден', 404, 'DOCUMENT_NOT_FOUND');
    }

    ensureDocumentEditable(existing, actor, 'отправлять на проверку');

    const currentStatus = normalizeDocumentStatus(existing.document_status);
    if (currentStatus == DOCUMENT_STATUS_UNDER_REVIEW) {
      throw createRepositoryError('Документ уже и так находится на рассмотрении.', 409, 'DOCUMENT_ALREADY_UNDER_REVIEW');
    }

    if (currentStatus == DOCUMENT_STATUS_VERIFIED) {
      throw createRepositoryError('Документ уже проверен администратором.', 409, 'DOCUMENT_ALREADY_VERIFIED');
    }

    const reviewMeta = {
      ...createDefaultDocumentMeta(),
      ...(existing.meta || {}),
      documentType: existing.document_type || '',
      doi: existing.doi || '',
      xmlPath: existing.xml_path || '',
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

    const storedReviewMeta = extractDocumentStorage(reviewMeta);

    const updateResult = await client.query(
      `UPDATE repository_nodes
       SET meta = $3::jsonb,
           document_status = $2,
           review_requested_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, name, meta, document_type, doi, xml_path, blocks,
                 updated_at, created_at, document_status, review_requested_at, verified_at`,
      [nodeId, DOCUMENT_STATUS_UNDER_REVIEW, JSON.stringify(storedReviewMeta.meta)]
    );
    updatedRow = updateResult.rows[0];

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const tree = await loadTreeFromDb();
  const reviewDocument = listDocuments(tree).find((document) => document.id === nodeId);
  if (reviewDocument) {
    void notifyAdminsAboutDocumentReview(reviewDocument);
  }

  return {
    tree,
    updatedNode: normalizeRow(updatedRow),
    message: 'Документ отправлен на проверку.',
  };
}

function buildCrossrefDepositLockKey(nodeId) {
  return `crossref-deposit-${nodeId}`;
}

async function sendDocumentToRevision(nodeId, actor = null, revisionComment = '') {
  await migrateJsonRepositoryIfNeeded();
  assertAdminActor(actor, 'отправлять документ на доработку');
  const lockKey = buildCrossrefDepositLockKey(nodeId);
  const lockClient = await repositoryPool.connect();
  let lockAcquired = false;
  const client = await repositoryPool.connect();
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
      `SELECT id, name, meta, document_type, doi, xml_path, blocks,
              updated_at, created_at, document_status, review_requested_at, verified_at
       FROM repository_nodes
       WHERE id = $1
       FOR UPDATE`,
      [nodeId]
    );
    const existing = rows[0];

    if (!existing) {
      throw createRepositoryError('Документ не найден', 404, 'DOCUMENT_NOT_FOUND');
    }

    const currentStatus = normalizeDocumentStatus(existing.document_status);
    if (currentStatus === DOCUMENT_STATUS_NEEDS_REVISION) {
      throw createRepositoryError('Документ уже находится на доработке.', 409, 'DOCUMENT_ALREADY_NEEDS_REVISION');
    }

    if (currentStatus === DOCUMENT_STATUS_VERIFIED) {
      throw createRepositoryError('Документ уже проверен и отправлен в Crossref.', 409, 'DOCUMENT_ALREADY_VERIFIED');
    }

    if (currentStatus !== DOCUMENT_STATUS_UNDER_REVIEW) {
      throw createRepositoryError('Документ можно отправить на доработку только из статуса "На проверке".', 409, 'DOCUMENT_STATUS_CONFLICT');
    }

    const nextMeta = {
      ...createDefaultDocumentMeta(),
      ...(existing.meta || {}),
      documentType: existing.document_type || '',
      doi: existing.doi || '',
      xmlPath: existing.xml_path || '',
      revisionComment: normalizedRevisionComment,
      revisionCommentAuthor: normalizedRevisionComment ? getActorDisplayName(actor, 'Администратор репозитория') : '',
      revisionCommentUpdatedAt: normalizedRevisionComment ? new Date().toISOString() : '',
    };
    const storedRevisionMeta = extractDocumentStorage(nextMeta);

    const updateResult = await client.query(
      `UPDATE repository_nodes
       SET meta = $4::jsonb,
           document_status = $2,
           review_requested_at = NULL,
           verified_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND document_status = $3
       RETURNING id, name, meta, document_type, doi, xml_path, blocks,
                 updated_at, created_at, document_status, review_requested_at, verified_at`,
      [nodeId, DOCUMENT_STATUS_NEEDS_REVISION, DOCUMENT_STATUS_UNDER_REVIEW, JSON.stringify(storedRevisionMeta.meta)]
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

  const tree = await loadTreeFromDb();
  const reviewDocument = listDocuments(tree).find((document) => document.id === nodeId);
  let notification = { sent: false, recipient: '', reason: 'RECIPIENT_NOT_FOUND' };
  if (reviewDocument) {
    notification = await notifyCreatorAboutRevision(reviewDocument, actor, normalizedRevisionComment);
  }

  const message = notification.sent
    ? 'Документ отправлен на доработку. Автор уведомлен по email.'
    : 'Документ отправлен на доработку. Уведомление автору не отправлено.';

  return {
    tree,
    updatedNode: normalizeRow(updatedRow),
    message,
    notification,
  };
}

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
    if (!node) {
      throw new Error('Документ не найден');
    }

    const currentStatus = normalizeDocumentStatus(node.document_status);
    if (currentStatus === DOCUMENT_STATUS_VERIFIED) {
      throw createRepositoryError('Документ уже проверен и отправлен в Crossref.', 409, 'DOCUMENT_ALREADY_VERIFIED');
    }

    if (currentStatus !== DOCUMENT_STATUS_UNDER_REVIEW) {
      throw createRepositoryError(
        'Документ можно отправить в Crossref только из статуса "На проверке".',
        409,
        'DOCUMENT_STATUS_CONFLICT'
      );
    }

    if (!node.xml_path) {
      throw new Error('У документа отсутствует XML для отправки');
    }

    const xmlFilePath = getManagedUploadFilePath(node.xml_path);
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

    const { rows } = await repositoryPool.query(
      `UPDATE repository_nodes
       SET document_status = $2,
           verified_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND document_status = $3
       RETURNING id, name, meta, document_type, doi, xml_path, blocks,
                 updated_at, created_at, document_status, review_requested_at, verified_at`,
      [nodeId, DOCUMENT_STATUS_VERIFIED, DOCUMENT_STATUS_UNDER_REVIEW]
    );

    const updatedRow = rows[0];
    if (!updatedRow) {
      throw createRepositoryError(
        'Статус документа изменился во время отправки в Crossref. Обновите страницу и повторите действие.',
        409,
        'DOCUMENT_STATUS_CONFLICT'
      );
    }
    const tree = await loadTreeFromDb();
    const reviewDocument = listDocuments(tree).find((document) => document.id === nodeId);
    if (reviewDocument) {
      void notifyCreatorAboutAcceptance(reviewDocument, actor);
    }

    return {
      ok: true,
      fileName,
      responseText,
      tree,
      updatedNode: normalizeRow(updatedRow),
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

export const repositoryService = {
  getRepositorySummary,
  getPersonalDraft,
  createDirectory,
  createDocument,
  saveUploadedAsset,
  savePersonalDraft,
  updateNode,
  deletePersonalDraft,
  deleteNode,
  getDocumentsForReview,
  submitDocumentForReview,
  sendDocumentToRevision,
  depositXmlToCrossref,
  migrateJsonRepositoryIfNeeded,
};

