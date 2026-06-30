import { useEffect, useMemo, useState, type DragEvent as ReactDragEvent } from 'react';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Link, useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';
import SearchableSelect from '@/components/SearchableSelect/SearchableSelect';
import { repositoryService } from '@/services/repositoryService';
import { repositoryReferenceService } from '@/services/repositoryReferenceService';
import type {
  RepositoryBlock,
  RepositoryAuthorEntry,
  RepositoryBlockType,
  RepositoryDocument,
  RepositoryDocumentMeta,
  RepositoryDocumentStatus,
  RepositoryNode,
  RepositoryResponse,
} from '@/types/repository';
import type { RepositoryAuthorReference, RepositoryOrganizationReference } from '@/types/repositoryReference';
import ConfirmModal from '@/components/ConfirmModal/ConfirmModal';
import { FieldHelp } from '@/components/Tooltip/Tooltip';
import './RepositoryPage.scss';

interface PendingBlockUpload {
  file: File;
}

interface DocumentSaveNormalizationReport {
  collapsedSpaces: number;
  replacedEnglishAnnotationChars: number;
}

interface NormalizedDocumentDraftForSave {
  draftName: string;
  draftMeta: RepositoryDocumentMeta;
  authorEntries: RepositoryAuthorEntry[];
  draftBlocks: RepositoryBlock[];
  report: DocumentSaveNormalizationReport;
}

/* Делает: Создаёт document draft signature. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function createDocumentDraftSignature({
  draftName,
  draftMeta,
  authorEntries,
  draftBlocks,
  pendingBlockUploads,
}: {
  draftName: string;
  draftMeta: RepositoryDocumentMeta;
  authorEntries: RepositoryAuthorEntry[];
  draftBlocks: RepositoryBlock[];
  pendingBlockUploads: Record<string, PendingBlockUpload>;
}) {
  const pendingUploads = Object.entries(pendingBlockUploads)
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри createDocumentDraftSignature. */ ([blockId, upload]) => ({
      blockId,
      name: upload.file.name,
      size: upload.file.size,
      type: upload.file.type,
      lastModified: upload.file.lastModified,
    }))
    .sort(/* Делает: Сравнивает элементы при сортировке. Применение: передаётся как callback в sort внутри createDocumentDraftSignature. */ (left, right) => left.blockId.localeCompare(right.blockId));

  return JSON.stringify({
    draftName,
    draftMeta,
    authorEntries,
    draftBlocks,
    pendingUploads,
  });
}

const DEFAULT_DOCUMENT_CLASSIFICATION = 'dataset';
const DEFAULT_REPOSITORY_LICENSE = 'CC BY-NC 4.0';
const DEFAULT_JOURNAL_CODE = 'pub';
const REPOSITORY_LICENSE_LABEL = 'Лицензия: материалы опубликованы на условиях открытой лицензии для некоммерческого использования с указанием авторства';
const AUTHOR_PUBLICATION_CONSENT_DOCUMENT_PATH = '/documents/repository-author-publication-consent.pdf';

/* Делает: Создаёт блок пустого. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function createEmptyBlock(type: RepositoryBlockType, placement: 'content' | 'meta' = 'content'): RepositoryBlock {
  const id = `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return type === 'text'
    ? { id, type, placement, content: '' }
    : { id, type, placement, label: '', url: '', sourceUrl: '' };
}

/* Делает: Получает значение today даты input. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getTodayDateInputValue() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

/* Делает: Выполняет apply document classification. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function applyDocumentClassification(meta: RepositoryDocumentMeta, value: string): RepositoryDocumentMeta {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return {
    ...meta,
    documentType: normalizedValue,
    recordType: normalizedValue,
  };
}

/* Делает: Создаёт точку входа пустого автора. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function createEmptyAuthorEntry(): RepositoryAuthorEntry {
  return {
    id: `author-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    authorRu: '',
    authorEn: '',
    organizationRu: '',
    organizationEn: '',
    organizationFullRu: '',
    organizationFullEn: '',
    referenceAuthorId: null,
    referenceOrganizationId: null,
  };
}

/* Делает: Разделяет список метаданных. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function splitMetaList(value?: string) {
  return String(value || '')
    .split(/\r?\n|;/)
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри splitMetaList. */ (item) => item.trim())
    .filter(Boolean);
}

/* Делает: Извлекает год публикации. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function extractPublicationYear(publicationDate?: string) {
  const match = String(publicationDate || '')
    .trim()
    .match(/^(\d{4})/);
  return match?.[1] || '';
}

function extractPublicationDateParts(publicationDate?: string) {
  const match = String(publicationDate || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);

  return {
    year: match?.[1] || '',
    month: match?.[2] || '',
    day: match?.[3] || '',
  };
}

function applyPublicationDateDefaults(
  meta: RepositoryDocumentMeta,
  publicationDate = meta.publicationDate
): RepositoryDocumentMeta {
  const parts = extractPublicationDateParts(publicationDate);

  return {
    ...meta,
    publicationDate,
    publicationYear: String(meta.publicationYear || '').trim() || parts.year,
    volume: String(meta.volume || '').trim() || parts.month,
    articleNumber: String(meta.articleNumber || '').trim() || parts.day,
  };
}

function resolvePublicationYear(meta: Pick<RepositoryDocumentMeta, 'publicationDate' | 'publicationYear'>) {
  return String(meta.publicationYear || '').trim() || extractPublicationYear(meta.publicationDate);
}

function normalizeRepositoryLicense(value?: string) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return DEFAULT_REPOSITORY_LICENSE;
  }

  return normalized.replace(/^CC\s+BY\s+NC\s+4\.0$/i, DEFAULT_REPOSITORY_LICENSE);
}

/* Делает: Нормализует значение DOI. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function normalizeDoiValue(doi?: string) {
  const normalized = String(doi || '').trim();
  if (!normalized) {
    return '';
  }

  return normalized
    .replace(/^https?:\/\/doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
}

/* Делает: Собирает URL DOI. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function buildDoiUrl(doi?: string) {
  const normalized = normalizeDoiValue(doi);
  return normalized ? `https://doi.org/${normalized}` : '';
}

function normalizeDoiLookupValue(doi?: string) {
  return normalizeDoiValue(doi).toLowerCase();
}

function formatGeneratedDoiSuffix(index: number) {
  return String(Math.max(0, Number(index) || 0)).padStart(2, '0');
}

function resolveUniqueDoiCandidate(baseDoi: string, existingDois: string[] = []) {
  const normalizedBaseDoi = normalizeDoiValue(baseDoi);
  const baseLookupValue = normalizeDoiLookupValue(normalizedBaseDoi);
  if (!normalizedBaseDoi) {
    return '';
  }

  const existingLookupValues = new Set(
    existingDois
      .map((doi) => normalizeDoiLookupValue(doi))
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

const DEFAULT_REPOSITORY_DOI_PREFIX = '10.35540';

/* Делает: Собирает DOI приблизительного. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function buildApproximateDoi(meta: Pick<RepositoryDocumentMeta, 'publicationDate' | 'publicationYear' | 'journalCode' | 'volume' | 'articleNumber'>) {
  const publicationYear = resolvePublicationYear(meta);
  const journalCode = String(meta.journalCode || DEFAULT_JOURNAL_CODE)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '');
  const volume = String(meta.volume || '')
    .trim()
    .replace(/[^\dA-Za-z.-]+/g, '');
  const articleNumber = String(meta.articleNumber || '')
    .trim()
    .replace(/[^\dA-Za-z.-]+/g, '');

  if (!publicationYear || !journalCode || !volume || !articleNumber) {
    return '';
  }

  return `${DEFAULT_REPOSITORY_DOI_PREFIX}/repo.${journalCode}.${publicationYear}.${volume}.${articleNumber}`;
}

/* Делает: Определяет DOI редактируемого документа. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function resolveEditableDocumentDoi(
  meta: RepositoryDocumentMeta,
  documentId?: string | null,
  documentStatus: RepositoryDocumentStatus = 'draft'
) {
  if (documentStatus === 'verified') {
    return String(meta.doi || '').trim();
  }

  if (!String(documentId || '').trim()) {
    return '';
  }

  return buildApproximateDoi(meta);
}

/* Делает: Получает initials from name parts. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getInitialsFromNameParts(parts: string[]) {
  return parts
    .flatMap(/* Делает: Преобразует элемент и разворачивает результат. Применение: передаётся как callback в flatMap внутри getInitialsFromNameParts. */ (part) =>
      part
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

/* Делает: Форматирует автора ссылки для цитирования. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function formatCitationAuthor(author: string, language: 'ru' | 'en' = 'ru') {
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
  const nameParts = parts.slice(1);
  const initials = getInitialsFromNameParts(nameParts);

  return initials ? `${surname} ${initials}` : surname;
}

/* Делает: Гарантирует sentence period. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function ensureSentencePeriod(value: string) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  return /[.!?…]$/.test(normalized) ? normalized : `${normalized}.`;
}

/* Делает: Собирает ссылку для цитирования документа. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function buildDocumentCitation(
  meta: RepositoryDocumentMeta,
  documentName: string,
  language: 'ru' | 'en' = 'ru'
) {
  const authorsSource = Array.isArray(meta.authorEntries) && meta.authorEntries.length > 0
    ? meta.authorEntries
        .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри buildDocumentCitation. */ (entry) => (language === 'en' ? entry.authorEn : entry.authorRu))
        .filter(Boolean)
        .join('; ')
    : language === 'en'
      ? meta.authorsEn
      : meta.authors;
  const authors = splitMetaList(authorsSource)
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри buildDocumentCitation. */ (author) => formatCitationAuthor(author, language))
    .filter(Boolean)
    .join(', ');
  const publicationYear = resolvePublicationYear(meta);
  const title = String(
    language === 'en'
      ? (meta.titleEn || documentName || '')
      : (documentName || '')
  ).trim();
  const normalizedDoi = normalizeDoiValue(meta.doi);
  const doiUrl = buildDoiUrl(meta.doi);
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

  const resourceLabel = '[Электронный ресурс]';
  const repositoryLabel = 'Репозиторий геофизических данных';
  const publisherLabel = 'Обнинск: ФИЦ ЕГС РАН';
  const segments: string[] = [];

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

/* Делает: Нормализует document name for duplicate check. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function normalizeDocumentNameForDuplicateCheck(value: string) {
  return String(value || '').trim().replace(/[ \t\u00a0]+/g, ' ').toLowerCase();
}

/* Делает: Выполняет citation needs refresh. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function citationNeedsRefresh(citation: string | undefined, doi: string | undefined) {
  const normalizedCitation = String(citation || '').trim();
  const normalizedDoi = normalizeDoiValue(doi);

  if (!normalizedCitation) {
    return true;
  }

  if (!normalizedDoi) {
    return false;
  }

  return !normalizedCitation.toLowerCase().includes(normalizedDoi.toLowerCase());
}

/* Делает: Определяет текст документа ссылки для цитирования. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function resolveDocumentCitationText(
  meta: RepositoryDocumentMeta,
  documentName: string,
  language: 'ru' | 'en' = 'ru'
) {
  const storedCitation = language === 'en' ? meta.citationLinkEn : meta.citationLink;
  return citationNeedsRefresh(storedCitation, meta.doi)
    ? buildDocumentCitation(meta, documentName, language)
    : String(storedCitation || '').trim();
}

/* Делает: Собирает метаданные автора entries from. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function buildAuthorEntriesFromMeta(meta: RepositoryDocumentMeta): RepositoryAuthorEntry[] {
  const authorRuItems = splitMetaList(meta.authors);
  const authorEnItems = splitMetaList(meta.authorsEn);
  const organizationRuItems = splitMetaList(meta.organization);
  const organizationEnItems = splitMetaList(meta.organizationEn || meta.affiliations);
  const total = Math.max(authorRuItems.length, authorEnItems.length, organizationRuItems.length, organizationEnItems.length, 1);

  const useSharedOrganizationRu = organizationRuItems.length === 1;
  const useSharedOrganizationEn = organizationEnItems.length === 1;

  return Array.from({ length: total }, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в from внутри buildAuthorEntriesFromMeta. */ (_, index) => ({
    id: `author-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    authorRu: authorRuItems[index] || '',
    authorEn: authorEnItems[index] || '',
    organizationRu: useSharedOrganizationRu ? (organizationRuItems[0] || '') : (organizationRuItems[index] || ''),
    organizationEn: useSharedOrganizationEn ? (organizationEnItems[0] || '') : (organizationEnItems[index] || ''),
    referenceAuthorId: null,
    referenceOrganizationId: null,
  }));
}

/* Делает: Собирает meta authors from entries. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function composeMetaAuthorsFromEntries(entries: RepositoryAuthorEntry[]) {
  const normalized = entries.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри composeMetaAuthorsFromEntries. */ (entry) => ({
    authorRu: entry.authorRu.trim(),
    authorEn: entry.authorEn.trim(),
    organizationRu: entry.organizationRu.trim(),
    organizationEn: entry.organizationEn.trim(),
    organizationFullRu: String(entry.organizationFullRu || '').trim(),
    organizationFullEn: String(entry.organizationFullEn || '').trim(),
  }));

  return {
    authors: normalized.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри composeMetaAuthorsFromEntries. */ (entry) => entry.authorRu).filter(Boolean).join('; '),
    authorsEn: normalized.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри composeMetaAuthorsFromEntries. */ (entry) => entry.authorEn).filter(Boolean).join('; '),
    organization: normalized.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри composeMetaAuthorsFromEntries. */ (entry) => entry.organizationRu).filter(Boolean).join('; '),
    organizationEn: normalized.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри composeMetaAuthorsFromEntries. */ (entry) => entry.organizationEn).filter(Boolean).join('; '),
    affiliations: normalized.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри composeMetaAuthorsFromEntries. */ (entry) => entry.organizationEn).filter(Boolean).join('; '),
  };
}

/* Делает: Нормализует author entries. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function normalizeAuthorEntries(authorEntries: unknown) {
  if (!Array.isArray(authorEntries)) {
    return [] as RepositoryAuthorEntry[];
  }

  return authorEntries
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри normalizeAuthorEntries. */ (entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const rawReferenceAuthorId = record.referenceAuthorId;
      const rawReferenceOrganizationId = record.referenceOrganizationId;
      const normalizedReferenceAuthorId =
        typeof rawReferenceAuthorId === 'number'
          ? rawReferenceAuthorId
          : typeof rawReferenceAuthorId === 'string' && rawReferenceAuthorId.trim()
            ? Number(rawReferenceAuthorId)
            : null;
      const normalizedReferenceOrganizationId =
        typeof rawReferenceOrganizationId === 'number'
          ? rawReferenceOrganizationId
          : typeof rawReferenceOrganizationId === 'string' && rawReferenceOrganizationId.trim()
            ? Number(rawReferenceOrganizationId)
            : null;

      return {
        id: typeof record.id === 'string' && record.id.trim() ? record.id : `author-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
        authorRu: typeof record.authorRu === 'string' ? record.authorRu : '',
        authorEn: typeof record.authorEn === 'string' ? record.authorEn : '',
        organizationRu: typeof record.organizationRu === 'string' ? record.organizationRu : '',
        organizationEn: typeof record.organizationEn === 'string' ? record.organizationEn : '',
        organizationFullRu: typeof record.organizationFullRu === 'string' ? record.organizationFullRu : '',
        organizationFullEn: typeof record.organizationFullEn === 'string' ? record.organizationFullEn : '',
        referenceAuthorId: Number.isFinite(normalizedReferenceAuthorId) ? normalizedReferenceAuthorId : null,
        referenceOrganizationId: Number.isFinite(normalizedReferenceOrganizationId) ? normalizedReferenceOrganizationId : null,
      } satisfies RepositoryAuthorEntry;
    })
    .filter(Boolean) as RepositoryAuthorEntry[];
}

/* Делает: Определяет author entries. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function resolveAuthorEntries(meta: RepositoryDocumentMeta) {
  const normalized = normalizeAuthorEntries(meta.authorEntries);
  if (normalized.length > 0) {
    return normalized;
  }

  return buildAuthorEntriesFromMeta(meta);
}

const CYRILLIC_REGEX = /[А-Яа-яЁё]/;
const LATIN_REGEX = /[A-Za-z]/;

/* Делает: Проверяет корректность russian only. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function validateRussianOnly(value: string, label: string) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  if (!CYRILLIC_REGEX.test(normalized) || LATIN_REGEX.test(normalized)) {
    return `Поле "${label}" должно быть заполнено на русском языке.`;
  }

  return null;
}

/* Делает: Проверяет корректность english only. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function validateEnglishOnly(value: string, label: string) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  if (!LATIN_REGEX.test(normalized) || CYRILLIC_REGEX.test(normalized)) {
    return `Поле "${label}" должно быть заполнено на английском языке.`;
  }

  return null;
}

const CYRILLIC_TO_LATIN_HOMOGLYPHS: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  У: 'Y',
  Х: 'X',
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  І: 'I',
  і: 'i',
  Ј: 'J',
  ј: 'j',
};

const DOCUMENT_META_TEXT_FIELDS = [
  'annotation',
  'bibliography',
  'publicationDate',
  'publicationYear',
  'authors',
  'affiliations',
  'organization',
  'titleEn',
  'authorsEn',
  'organizationEn',
  'descriptionEn',
  'creatorUserId',
  'creatorName',
  'creatorEmail',
  'reviewEditorName',
  'reviewEditorEmail',
  'revisionComment',
  'revisionCommentAuthor',
  'revisionCommentUpdatedAt',
  'documentType',
  'recordType',
  'journalCode',
  'volume',
  'articleNumber',
  'doi',
  'citationLink',
  'citationLinkEn',
  'xmlPath',
  'license',
] as const satisfies readonly (keyof RepositoryDocumentMeta)[];

const BLOCK_TEXT_FIELDS = ['content', 'label', 'url', 'sourceUrl'] as const satisfies readonly (keyof RepositoryBlock)[];

/* Делает: Создаёт document save normalization report. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function createDocumentSaveNormalizationReport(): DocumentSaveNormalizationReport {
  return {
    collapsedSpaces: 0,
    replacedEnglishAnnotationChars: 0,
  };
}

/* Делает: Выполняет collapse multiple spaces for save. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function collapseMultipleSpacesForSave(value: string, report: DocumentSaveNormalizationReport) {
  return String(value || '').replace(/[ \t\u00a0]{2,}/g, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в replace внутри collapseMultipleSpacesForSave. */ (match) => {
    report.collapsedSpaces += match.length - 1;
    return ' ';
  });
}

/* Делает: Выполняет replace english annotation cyrillic homoglyphs. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function replaceEnglishAnnotationCyrillicHomoglyphs(value: string, report: DocumentSaveNormalizationReport) {
  return String(value || '').replace(/[А-Яа-яЁёІіЈј]/g, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в replace внутри replaceEnglishAnnotationCyrillicHomoglyphs. */ (char) => {
    const replacement = CYRILLIC_TO_LATIN_HOMOGLYPHS[char];
    if (!replacement) {
      return char;
    }

    report.replacedEnglishAnnotationChars += 1;
    return replacement;
  });
}

/* Делает: Нормализует author entries for save. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function normalizeAuthorEntriesForSave(
  entries: RepositoryAuthorEntry[],
  report: DocumentSaveNormalizationReport
) {
  return entries.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри normalizeAuthorEntriesForSave. */ (entry) => ({
    ...entry,
    authorRu: collapseMultipleSpacesForSave(entry.authorRu, report),
    authorEn: collapseMultipleSpacesForSave(entry.authorEn, report),
    organizationRu: collapseMultipleSpacesForSave(entry.organizationRu, report),
    organizationEn: collapseMultipleSpacesForSave(entry.organizationEn, report),
    organizationFullRu: collapseMultipleSpacesForSave(entry.organizationFullRu || '', report),
    organizationFullEn: collapseMultipleSpacesForSave(entry.organizationFullEn || '', report),
  }));
}

/* Делает: Нормализует document meta for save. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function normalizeDocumentMetaForSave(
  meta: RepositoryDocumentMeta,
  report: DocumentSaveNormalizationReport
): RepositoryDocumentMeta {
  const normalizedMeta: RepositoryDocumentMeta = { ...meta };

  DOCUMENT_META_TEXT_FIELDS.forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри normalizeDocumentMetaForSave. */ (field) => {
    const currentValue = normalizedMeta[field];
    if (typeof currentValue === 'string') {
      (normalizedMeta as unknown as Record<string, unknown>)[field] = collapseMultipleSpacesForSave(currentValue, report);
    }
  });

  normalizedMeta.license = normalizeRepositoryLicense(normalizedMeta.license);
  normalizedMeta.journalCode = String(normalizedMeta.journalCode || DEFAULT_JOURNAL_CODE).trim().toLowerCase();
  Object.assign(normalizedMeta, applyPublicationDateDefaults(normalizedMeta));
  normalizedMeta.descriptionEn = replaceEnglishAnnotationCyrillicHomoglyphs(normalizedMeta.descriptionEn, report);

  const normalizedAuthorEntries = normalizeAuthorEntriesForSave(resolveAuthorEntries(normalizedMeta), report);
  if (normalizedAuthorEntries.length > 0) {
    return {
      ...normalizedMeta,
      ...composeMetaAuthorsFromEntries(normalizedAuthorEntries),
      authorEntries: normalizedAuthorEntries,
    };
  }

  return normalizedMeta;
}

/* Делает: Нормализует repository blocks for save. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function normalizeRepositoryBlocksForSave(
  blocks: RepositoryBlock[],
  report: DocumentSaveNormalizationReport
) {
  return blocks.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри normalizeRepositoryBlocksForSave. */ (block) => {
    const normalizedBlock: RepositoryBlock = { ...block };
    BLOCK_TEXT_FIELDS.forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри mapCallback. */ (field) => {
      const currentValue = normalizedBlock[field];
      if (typeof currentValue === 'string') {
        (normalizedBlock as unknown as Record<string, unknown>)[field] = collapseMultipleSpacesForSave(currentValue, report);
      }
    });
    return normalizedBlock;
  });
}

/* Делает: Собирает document save normalization notice. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function buildDocumentSaveNormalizationNotice(report: DocumentSaveNormalizationReport) {
  const details: string[] = [];

  if (report.collapsedSpaces > 0) {
    details.push('множественные пробелы заменены на один');
  }

  if (report.replacedEnglishAnnotationChars > 0) {
    details.push(
      `русские символы в английской аннотации заменены на латинские: ${report.replacedEnglishAnnotationChars}`
    );
  }

  return details.length > 0 ? ` Автоматически исправлено: ${details.join('; ')}.` : '';
}

/* Делает: Выполняет append document save normalization notice. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function appendDocumentSaveNormalizationNotice(message: string, report: DocumentSaveNormalizationReport) {
  return `${message}${buildDocumentSaveNormalizationNotice(report)}`;
}

/* Делает: Нормализует identity. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function normalizeIdentity(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

/* Делает: Проверяет пользователя документа owned by. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function isDocumentOwnedByUser(
  meta: Partial<RepositoryDocumentMeta> | null | undefined,
  repositoryUser: { id?: number | string; email?: string | null } | null | undefined
) {
  if (!meta || !repositoryUser) {
    return false;
  }

  const actorId = normalizeIdentity(repositoryUser.id);
  const creatorUserId = normalizeIdentity(meta.creatorUserId);
  if (actorId && creatorUserId && actorId === creatorUserId) {
    return true;
  }

  const actorEmail = normalizeIdentity(repositoryUser.email);
  const creatorEmail = normalizeIdentity(meta.creatorEmail);
  return Boolean(actorEmail && creatorEmail && actorEmail === creatorEmail);
}

/* Делает: Находит идентификатор автора справочника by. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function findAuthorReferenceById(authors: RepositoryAuthorReference[], authorId: number | null | undefined) {
  if (!authorId) {
    return null;
  }

  return authors.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри findAuthorReferenceById. */ (author) => author.id === authorId) || null;
}

/* Делает: Находит имена автора справочника by. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function findAuthorReferenceByNames(
  authors: RepositoryAuthorReference[],
  authorRu: string,
  authorEn: string
) {
  const normalizedRu = authorRu.trim().toLowerCase();
  const normalizedEn = authorEn.trim().toLowerCase();
  if (!normalizedRu && !normalizedEn) {
    return null;
  }

  return (
    authors.find(
      /* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри findAuthorReferenceByNames. */ (author) =>
        author.name_ru.trim().toLowerCase() === normalizedRu &&
        author.name_en.trim().toLowerCase() === normalizedEn
    ) || null
  );
}

/* Делает: Находит идентификатор организации справочника by. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function findOrganizationReferenceById(
  organizations: RepositoryOrganizationReference[],
  organizationId: number | null | undefined
) {
  if (!organizationId) {
    return null;
  }

  return organizations.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри findOrganizationReferenceById. */ (organization) => organization.id === organizationId) || null;
}

/* Делает: Находит имена организации справочника by. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function findOrganizationReferenceByNames(
  organizations: RepositoryOrganizationReference[],
  nameRu: string,
  nameEn: string
) {
  const normalizedRu = nameRu.trim().toLowerCase();
  const normalizedEn = nameEn.trim().toLowerCase();
  if (!normalizedRu && !normalizedEn) {
    return null;
  }

  return (
    organizations.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри findOrganizationReferenceByNames. */ (organization) => {
      const organizationRu = organization.name_ru.trim().toLowerCase();
      const organizationEn = String(organization.name_en || '').trim().toLowerCase();
      const organizationFullRu = String(organization.full_name_ru || '').trim().toLowerCase();
      const organizationFullEn = String(organization.full_name_en || '').trim().toLowerCase();
      return (
        organizationRu === normalizedRu ||
        organizationFullRu === normalizedRu ||
        (normalizedEn && (organizationEn === normalizedEn || organizationFullEn === normalizedEn))
      );
    }) || null
  );
}

/* Делает: Получает значения организации справочника поискового. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getOrganizationReferenceSearchValues(
  organization: RepositoryOrganizationReference | { name_ru: string; name_en?: string | null; full_name_ru?: string | null; full_name_en?: string | null }
) {
  return [
    organization.name_ru,
    organization.name_en,
    organization.full_name_ru,
    organization.full_name_en,
  ];
}

/* Делает: Получает значения автора справочника поискового. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getAuthorReferenceSearchValues(author: RepositoryAuthorReference) {
  return [
    author.name_ru,
    author.name_en,
    ...author.organizations.flatMap(/* Делает: Преобразует элемент и разворачивает результат. Применение: передаётся как callback в flatMap внутри getAuthorReferenceSearchValues. */ (organization) => getOrganizationReferenceSearchValues(organization)),
  ];
}

/* Делает: Форматирует подпись автора справочника. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function formatAuthorReferenceLabel(author: RepositoryAuthorReference) {
  return [author.name_ru, author.name_en].filter(Boolean).join(' / ');
}

/* Делает: Форматирует подпись организации справочника. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function formatOrganizationReferenceLabel(organization: RepositoryOrganizationReference) {
  return [organization.name_ru, organization.name_en].filter(Boolean).join(' / ');
}

/* Делает: Создаёт метаданные пустого. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function createEmptyMeta(): RepositoryDocumentMeta {
  const publicationDate = getTodayDateInputValue();
  const dateParts = extractPublicationDateParts(publicationDate);

  return {
    annotation: '',
    bibliography: '',
    publicationDate,
    publicationYear: dateParts.year,
    authors: '',
    affiliations: '',
    organization: '',
    titleEn: '',
    authorsEn: '',
    organizationEn: '',
    descriptionEn: '',
    authorEntries: [createEmptyAuthorEntry()],
    creatorUserId: '',
    revisionComment: '',
    revisionCommentAuthor: '',
    revisionCommentUpdatedAt: '',
    documentType: DEFAULT_DOCUMENT_CLASSIFICATION,
    recordType: DEFAULT_DOCUMENT_CLASSIFICATION,
    journalCode: DEFAULT_JOURNAL_CODE,
    volume: dateParts.month,
    articleNumber: dateParts.day,
    doi: '',
    citationLink: '',
    citationLinkEn: '',
    xmlPath: '',
    license: DEFAULT_REPOSITORY_LICENSE,
    position: 0,
  };
}

const REPOSITORY_FILE_BASE = '';
const DOCUMENT_CLASSIFICATION_OPTIONS = [
  { value: '', label: 'Выберите тип записи и документа' },
  { value: 'dataset', label: 'Набор данных (dataset)' },
  { value: 'database', label: 'База данных (database)' },
  { value: 'component', label: 'ЭВМ (component)' },
];

const JOURNAL_CODE_OPTIONS = [
  { value: DEFAULT_JOURNAL_CODE, label: 'Выберите издание из списка' },
  { value: 'rjs', label: 'Российский сейсмологический журнал (rjs)' },
  { value: 'zse', label: 'Землетрясения Северной Евразии (zse)' },
  { value: 'er', label: 'Землетрясения России (er)' },
];

const RECORD_TYPE_LABELS_RU: Record<string, string> = {
  database: 'База данных',
  dataset: 'Набор данных',
  journal_article: 'Журнальная статья',
  report: 'Отчет',
  component: 'ЭВМ',
};

const REQUIRED_META_FIELDS = [
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
] as const;

type RequiredMetaField = (typeof REQUIRED_META_FIELDS)[number];
type CreateDocumentMinimalField = 'publicationDate' | 'documentType' | 'titleRu' | 'titleEn';

const REQUIRED_META_FIELD_LABELS: Record<RequiredMetaField, string> = {
  annotation: 'Аннотация',
  descriptionEn: 'Аннотация на английском языке',
  publicationDate: 'Дата публикации',
  authors: 'Авторы на русском языке',
  authorsEn: 'Авторы на английском языке',
  organization: 'Организация на русском языке',
  organizationEn: 'Организация на английском языке',
  documentType: 'Тип документа',
  titleEn: 'Название материалов на английском языке',
  journalCode: 'Наименование издания',
  volume: 'Том',
  articleNumber: 'Номер статьи',
  license: 'Лицензия',
};

const CREATE_DOCUMENT_MINIMAL_FIELD_LABELS: Record<CreateDocumentMinimalField, string> = {
  publicationDate: 'Дата публикации',
  documentType: 'Тип документа',
  titleRu: 'Название материалов на русском языке',
  titleEn: 'Название материалов на английском языке',
};

const LICENSE_FIELD_HELP = (
  <>
    <a href='https://creativecommons.org/licenses/by-nc/4.0/' target='_blank' rel='noreferrer'>
      Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
    </a>
  </>
);

const DOCUMENT_FIELD_HELP = {
  publicationDate: 'Дата, к которой относится публикация материала. Используется в карточке документа, DOI и XML Crossref.',
  documentType: 'Категория материала в репозитории: набор данных, база данных, статья, отчёт или другой тип.',
  titleRu: 'Основное название материалов на русском языке. Оно отображается в списках и карточке материала.',
  titleEn: 'Английский вариант названия материалов, необходимый для регистрации DOI и международного описания материала.',
  authors: 'Авторы материала. Для каждого автора указываются ФИО на русском и английском языках, а также организация.',
  authorReference: 'Позволяет выбрать уже зарегистрированного автора и автоматически заполнить его данные.',
  organizationReference: 'Позволяет выбрать организацию из справочника и автоматически заполнить её названия.',
  authorRu: 'ФИО автора на русском языке.',
  authorEn: 'ФИО автора на английском языке.',
  organizationRu: 'Краткое русское название организации автора, например ФИЦ ЕГС РАН.',
  organizationEn: 'Краткое английское название организации автора, например GS RAS.',
  organizationFullRu: 'Официальное полное наименование организации на русском языке.',
  organizationFullEn: 'Официальное полное наименование организации на английском языке.',
  annotation: 'Краткое описание состава, содержания и назначения публикуемых материалов на русском языке.',
  descriptionEn: 'Английский перевод аннотации для международного описания и регистрации DOI.',
  bibliography: 'Библиографическая ссылка на публикации, которые содержат ссылку на рассматриваемые материалы.',
  files: 'Файлы, составляющие публикуемый материал. Можно загрузить файл с компьютера или указать ссылку.',
  fileUpload: 'Выберите файл на компьютере. Он будет загружен на сервер после сохранения документа.',
  fileTitle: 'Понятное название файла, которое увидит пользователь в карточке документа.',
  fileSource: 'Прямая ссылка на файл, если он хранится во внешнем источнике и не загружается с компьютера.',
  journal: 'Издание или серия, в которой регистрируется материал. Если издание не выбрано, для формирования DOI используется код pub.',
  publicationYear: 'Год выпуска издания. По умолчанию подставляется из даты публикации, но его можно изменить вручную.',
  volume: 'Номер тома издания. Используется при формировании DOI и XML Crossref.',
  articleNumber: 'Порядковый номер материала в томе. Используется при формировании DOI.',
  doi: 'Уникальный цифровой идентификатор материала. Формируется автоматически из параметров документа.',
  citationRu: 'Готовая русская ссылка для цитирования материала в публикациях и отчётах.',
  citationEn: 'Готовая английская ссылка для цитирования материала.',
  license: LICENSE_FIELD_HELP,
  crossrefXml: 'XML-файл с метаданными, который формируется для регистрации DOI в Crossref.',
  documentStatus: 'Текущий этап обработки документа: черновик, доработка, регистрация или публикация.',
  affiliations: 'Организации, к которым относятся указанные авторы материала.',
  revisionComment: 'Замечания администратора, которые необходимо учесть при доработке документа.',
  contentBlock: 'Дополнительный текст, изображение, ссылка или файл в содержании документа.',
} as const satisfies Record<string, ReactNode>;

type DocumentFieldHelpKey = keyof typeof DOCUMENT_FIELD_HELP;
const DOCUMENT_FIELD_HELP_HIDDEN_KEYS = new Set<DocumentFieldHelpKey>(['files', 'fileUpload', 'publicationYear', 'volume', 'articleNumber']);

/* Делает: Рендерит React-компонент DocumentFieldLabel и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function DocumentFieldLabel({ label, helpKey }: { label: string; helpKey: DocumentFieldHelpKey }) {
  return (
    <span className='repository-page__field-label'>
      <span>{label}</span>
      {!DOCUMENT_FIELD_HELP_HIDDEN_KEYS.has(helpKey) && (
        <FieldHelp
          text={DOCUMENT_FIELD_HELP[helpKey]}
          ariaLabel={helpKey === 'license' ? 'Пояснение по лицензии' : undefined}
        />
      )}
    </span>
  );
}

/* Делает: Получает поля отсутствующего обязательного метаданных. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getMissingRequiredMetaFields(meta: RepositoryDocumentMeta): RequiredMetaField[] {
  return REQUIRED_META_FIELDS.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри getMissingRequiredMetaFields. */ (field) => !String(meta[field] ?? '').trim());
}

/* Делает: Получает поля отсутствующего create документа. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getMissingCreateDocumentFields(
  meta: RepositoryDocumentMeta,
  documentName: string
): CreateDocumentMinimalField[] {
  const missingFields: CreateDocumentMinimalField[] = [];

  if (!String(meta.publicationDate ?? '').trim()) {
    missingFields.push('publicationDate');
  }

  if (!String(resolveDocumentClassification(meta) ?? '').trim()) {
    missingFields.push('documentType');
  }

  if (!String(documentName || '').trim()) {
    missingFields.push('titleRu');
  }

  if (!String(meta.titleEn ?? '').trim()) {
    missingFields.push('titleEn');
  }

  return missingFields;
}

const DOCUMENT_STATUS_LABELS: Record<RepositoryDocumentStatus, string> = {
  draft: 'Черновик',
  needs_revision: 'На доработке',
  under_review: 'На регистрации',
  verified: 'Опубликован',
};

const DOCUMENT_STATUS_VARIANTS: Record<RepositoryDocumentStatus, 'warning' | 'info' | 'success'> = {
  draft: 'info',
  needs_revision: 'warning',
  under_review: 'info',
  verified: 'success',
};

/* Делает: Получает подпись документа статуса. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getDocumentStatusLabel(status: RepositoryDocumentStatus) {
  return DOCUMENT_STATUS_LABELS[status] || DOCUMENT_STATUS_LABELS.draft;
}

/* Делает: Получает document status variant. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getDocumentStatusVariant(status: RepositoryDocumentStatus) {
  return DOCUMENT_STATUS_VARIANTS[status] || DOCUMENT_STATUS_VARIANTS.draft;
}

/* Делает: Получает record type label ru. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getRecordTypeLabelRu(recordType?: string) {
  const normalized = String(recordType || '').trim().toLowerCase();
  return RECORD_TYPE_LABELS_RU[normalized] || 'Не указан';
}

/* Делает: Определяет document classification. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function resolveDocumentClassification(meta: Pick<RepositoryDocumentMeta, 'documentType' | 'recordType'>) {
  return String(meta.documentType || meta.recordType || '').trim().toLowerCase();
}

/* Делает: Определяет текст аффилиаций. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function resolveAffiliationsText(meta: RepositoryDocumentMeta, language: 'ru' | 'en' = 'ru') {
  const entryValues = Array.isArray(meta.authorEntries) && meta.authorEntries.length > 0
    ? meta.authorEntries
        .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри resolveAffiliationsText. */ (entry) => (language === 'en' ? entry.organizationEn : entry.organizationRu))
        .filter(Boolean)
    : [];
  const fallbackValue = language === 'en'
    ? meta.affiliations || meta.organizationEn
    : meta.organization;
  const values = entryValues.length > 0 ? entryValues : splitMetaList(fallbackValue);

  return Array.from(new Set(values.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри resolveAffiliationsText. */ (value) => value.trim()).filter(Boolean))).join('; ');
}

/* Делает: Нормализует значение аффилиации. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function normalizeAffiliationValue(value?: string) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/* Делает: Определяет reference organization full title. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function resolveReferenceOrganizationFullTitle(
  entry: RepositoryAuthorEntry,
  organization: string,
  language: 'ru' | 'en',
  referenceOrganizations: RepositoryOrganizationReference[] = []
) {
  const matchedById = findOrganizationReferenceById(referenceOrganizations, entry.referenceOrganizationId);
  const matchedByName = findOrganizationReferenceByNames(
    referenceOrganizations,
    language === 'en' ? '' : organization,
    language === 'en' ? organization : ''
  );
  const matched = matchedById || matchedByName;

  if (!matched) {
    return '';
  }

  return language === 'en'
    ? String(matched.full_name_en || matched.name_en || '').trim()
    : String(matched.full_name_ru || matched.name_ru || '').trim();
}

/* Делает: Собирает аффилиации numbered автора. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function buildNumberedAuthorAffiliations(
  meta: RepositoryDocumentMeta,
  language: 'ru' | 'en' = 'ru',
  referenceOrganizations: RepositoryOrganizationReference[] = []
) {
  const entries = resolveAuthorEntries(meta);
  const affiliations = new Map<string, { index: number; value: string; fullTitle: string }>();

    /* Делает: Получает affiliation index. Применение: используется внутри функции buildNumberedAuthorAffiliations. */
  const getAffiliationIndex = (organization?: string, fullOrganization?: string) => {
    const value = normalizeAffiliationValue(organization);
    const fullTitle = normalizeAffiliationValue(fullOrganization);
    if (!value && !fullTitle) {
      return undefined;
    }

    const displayValue = value || fullTitle;
    const key = displayValue.toLowerCase();
    const existing = affiliations.get(key);
    if (existing) {
      if (!existing.fullTitle && fullTitle && fullTitle !== displayValue) {
        existing.fullTitle = fullTitle;
      }
      return existing.index;
    }

    const next = {
      index: affiliations.size + 1,
      value: displayValue,
      fullTitle: fullTitle && fullTitle !== displayValue ? fullTitle : '',
    };
    affiliations.set(key, next);
    return next.index;
  };

  const authors = entries
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри buildNumberedAuthorAffiliations. */ (entry) => {
      const name = normalizeAffiliationValue(language === 'en' ? entry.authorEn : entry.authorRu);
      const organization = normalizeAffiliationValue(language === 'en' ? entry.organizationEn : entry.organizationRu);
      const fullOrganization = normalizeAffiliationValue(
        (language === 'en' ? entry.organizationFullEn : entry.organizationFullRu) ||
        resolveReferenceOrganizationFullTitle(entry, organization, language, referenceOrganizations)
      );
      return {
        name,
        affiliationIndex: getAffiliationIndex(organization, fullOrganization),
      };
    })
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри buildNumberedAuthorAffiliations. */ (entry) => entry.name);

  return {
    authors,
    affiliations: [...affiliations.values()],
  };
}

/* Делает: Форматирует file size. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function formatFileSize(fileSize?: number, fallback = 'Размер не указан') {
  if (!Number.isFinite(fileSize) || Number(fileSize) <= 0) {
    return fallback;
  }

  const size = Number(fileSize);
  if (size < 1024) {
    return `${size} Б`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1).replace('.0', '')} КБ`;
  }

  return `${(size / (1024 * 1024)).toFixed(1).replace('.0', '')} МБ`;
}

/* Делает: Получает путь файлового имени from. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getFileNameFromPath(value?: string) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const cleanPath = raw.split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(cleanPath.split(/[\\/]/).pop() || '');
  } catch {
    return cleanPath.split(/[\\/]/).pop() || '';
  }
}

/* Делает: Получает file name stem. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getFileNameStem(value?: string) {
  const fileName = getFileNameFromPath(value);
  return fileName.replace(/\.[^.]+$/u, '').trim();
}

/* Делает: Получает расширение имени файла. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getFileNameExtension(value?: string) {
  const fileName = getFileNameFromPath(value);
  const match = fileName.match(/\.([^.]+)$/u);
  return match?.[1]?.trim().toLowerCase() || '';
}

/* Делает: Определяет имя прикреплённого файлового display. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function resolveAttachedFileDisplayName(block: RepositoryBlock) {
  return (
    String(block.fileName || '').trim() ||
    getFileNameFromPath(getEffectiveFileSourceUrl(block)) ||
    (hasManagedFile(block) ? getFileNameFromPath(block.url) : '')
  );
}

/* Делает: Собирает отображаемое имя файла с расширением. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function resolveDisplayFileName(block: RepositoryBlock, fallback = 'Файл') {
  const label = String(block.label || '').trim();
  const attachedFileName = resolveAttachedFileDisplayName(block);

  if (label) {
    if (getFileNameExtension(label)) {
      return label;
    }

    const extension =
      getFileNameExtension(attachedFileName) ||
      getFileNameExtension(getEffectiveFileSourceUrl(block)) ||
      (hasManagedFile(block) ? getFileNameExtension(block.url) : '');

    return extension ? `${label}.${extension}` : label;
  }

  return attachedFileName || fallback;
}

/* Делает: Проверяет наличие файл управляемого. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function hasManagedFile(block: RepositoryBlock) {
  return Boolean(block.url && isManagedRepositoryUploadUrl(block.url));
}

/* Делает: Проверяет блок локального загруженного файлового. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function isLocalUploadedFileBlock(block: RepositoryBlock) {
  return hasManagedFile(block) && !String(block.sourceUrl || '').trim();
}

/* Делает: Нормализует подпись редактируемого файлового. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function normalizeEditableFileLabel(value: string, block: RepositoryBlock) {
  const normalized = String(value || '').trimStart();
  if (block.type !== 'file' || !isLocalUploadedFileBlock(block)) {
    return normalized;
  }

  return normalized.replace(/\.[A-Za-z0-9]{1,10}$/u, '');
}

/* Делает: Получает блоки документа файлового. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getDocumentFileBlocks(blocks: RepositoryBlock[]) {
  return blocks.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри getDocumentFileBlocks. */ (block) => block.type === 'file' && block.url);
}

/* Делает: Получает блоки документа черновика файлового. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getDocumentDraftFileBlocks(blocks: RepositoryBlock[]) {
  return blocks.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри getDocumentDraftFileBlocks. */ (block) => block.type === 'file' && block.placement === 'meta');
}

/* Делает: Получает блоки редактируемого контентного. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getEditableContentBlocks(blocks: RepositoryBlock[]) {
  return blocks.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри getEditableContentBlocks. */ (block) => block.type !== 'file' || block.placement !== 'meta');
}

/* Делает: Проверяет URL управляемого репозиторного загрузки. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function isManagedRepositoryUploadUrl(url?: string) {
  return String(url || '').includes('/uploads/repository/');
}

/* Делает: Получает URL эффективного файлового исходного. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getEffectiveFileSourceUrl(block: RepositoryBlock) {
  const sourceUrl = String(block.sourceUrl || '').trim();
  if (sourceUrl) {
    return sourceUrl;
  }

  const url = String(block.url || '').trim();
  if (url && !isManagedRepositoryUploadUrl(url) && /^https?:\/\//i.test(url)) {
    return url;
  }

  return '';
}

/* Делает: Получает ошибки файлового блока validation. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getFileBlockValidationErrors(blocks: RepositoryBlock[], pendingUploadBlockIds: Set<string> = new Set()) {
  return blocks.flatMap(/* Делает: Преобразует элемент и разворачивает результат. Применение: передаётся как callback в flatMap внутри getFileBlockValidationErrors. */ (block, index) => {
    if (block.type !== 'file') {
      return [];
    }

    const label = String(block.label || '').trim();
    const sourceUrl = getEffectiveFileSourceUrl(block);
    const hasPendingUpload = pendingUploadBlockIds.has(block.id);
    const managedFileAttached = hasManagedFile(block) || hasPendingUpload;
    const localUploadedFile = isLocalUploadedFileBlock(block) || hasPendingUpload;
    const hasAnyFileData = Boolean(label || sourceUrl || managedFileAttached || block.fileName);

    if (!hasAnyFileData) {
      return [];
    }

    const errors: string[] = [];
    if (!label) {
      errors.push(`Для файла ${index + 1} укажите название файла.`);
    }

    if (sourceUrl && !/^https?:\/\/\S+/i.test(sourceUrl)) {
      errors.push(`Для файла ${index + 1} укажите корректную ссылку http(s).`);
    }

    if (label && !sourceUrl && !managedFileAttached) {
      errors.push(`Для файла ${index + 1} прикрепите файл с компьютера или укажите ссылку.`);
    }

    if (sourceUrl && localUploadedFile) {
      errors.push(`Для файла ${index + 1} выберите только один способ: ссылка или загрузка с компьютера.`);
    }

    return errors;
  });
}

/* Делает: Проверяет наличие данные meaningful файлового блока. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function hasMeaningfulFileBlockData(block: RepositoryBlock) {
  const label = String(block.label || '').trim();
  const sourceUrl = getEffectiveFileSourceUrl(block);
  const managedFileAttached = hasManagedFile(block);
  return Boolean(label || sourceUrl || managedFileAttached || block.fileName);
}

/* Делает: Очищает и нормализует blocks for save. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function sanitizeBlocksForSave(blocks: RepositoryBlock[]) {
  return blocks.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри sanitizeBlocksForSave. */ (block) => block.type !== 'file' || hasMeaningfulFileBlockData(block));
}

/* Делает: Гарантирует блок initial metadata файлового. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function ensureInitialMetadataFileBlock(blocks: RepositoryBlock[]) {
  return getDocumentDraftFileBlocks(blocks).length > 0 ? blocks : [...blocks, createEmptyBlock('file', 'meta')];
}

/* Делает: Определяет content insert index. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function resolveContentInsertIndex(blocks: RepositoryBlock[], visibleIndex: number) {
  let contentCount = 0;

  for (let index = 0; index < blocks.length; index += 1) {
    if (blocks[index].type === 'file' && blocks[index].placement === 'meta') {
      continue;
    }

    if (contentCount === visibleIndex) {
      return index;
    }

    contentCount += 1;
  }

  const firstFileIndex = blocks.findIndex(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в findIndex внутри resolveContentInsertIndex. */ (block) => block.type === 'file' && block.placement === 'meta');
  return firstFileIndex === -1 ? blocks.length : firstFileIndex;
}

/* Делает: Проверяет блок metadata файлового. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function isMetadataFileBlock(block: RepositoryBlock) {
  return block.type === 'file' && block.placement === 'meta';
}

/* Делает: Проверяет редактор документа locked for. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function isDocumentLockedForEditor(status: RepositoryDocumentStatus) {
  return status === 'under_review' || status === 'verified';
}

/* Делает: Нормализует URL внешнего. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function normalizeExternalUrl(url?: string) {
  if (!url) {
    return '#';
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return '#';
  }

  if (trimmed.startsWith('/')) {
    return `${REPOSITORY_FILE_BASE}${trimmed}`;
  }

  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

/* Делает: Собирает URL versioned файлового. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function buildVersionedFileUrl(url?: string, version?: string) {
  const normalized = normalizeExternalUrl(url);
  if (normalized === '#' || !version) {
    return normalized;
  }

  const separator = normalized.includes('?') ? '&' : '?';
  return `${normalized}${separator}v=${encodeURIComponent(version)}`;
}

/* Делает: Читает URL файлового as данных. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function readFileAsDataUrl(file: File) {
  return new Promise<string>(/* Делает: Выполняет локальный callback в текущем месте модуля. Применение: используется локально внутри readFileAsDataUrl. */ (resolve, reject) => {
    const reader = new FileReader();
    reader.onload = /* Делает: Выполняет локальный callback в текущем месте модуля. Применение: используется локально внутри callback. */ () => resolve(String(reader.result || ''));
    reader.onerror = /* Делает: Выполняет локальный callback в текущем месте модуля. Применение: используется локально внутри callback. */ () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

/* Делает: Извлекает контент base64. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function extractBase64Content(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(',');
  return separatorIndex === -1 ? dataUrl : dataUrl.slice(separatorIndex + 1);
}

/* Делает: Получает node id from hash. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getNodeIdFromHash() {
  return window.location.hash.replace(/^#/, '').trim();
}

/* Делает: Собирает путь рабочей области документа. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function buildWorkspaceDocumentPath(documentId: string) {
  return `/repository/workspace#${documentId}`;
}

/* Делает: Собирает путь edit документа. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function buildEditDocumentPath(documentId: string) {
  return `/repository/edit#${documentId}`;
}

/* Делает: Находит документ первого. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function findFirstDocument(node: RepositoryNode): RepositoryDocument | null {
  if (node.type === 'document') {
    return node;
  }

  for (const child of node.children) {
    const found = findFirstDocument(child);
    if (found) {
      return found;
    }
  }

  return null;
}

/* Делает: Находит идентификатор узла by. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function findNodeById(node: RepositoryNode, targetId: string): RepositoryNode | null {
  if (node.id === targetId) {
    return node;
  }

  if (node.type === 'document') {
    return null;
  }

  for (const child of node.children) {
    const found = findNodeById(child, targetId);
    if (found) {
      return found;
    }
  }

  return null;
}

/* Делает: Находит ancestor directory ids. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function findAncestorDirectoryIds(node: RepositoryNode, targetId: string, ancestors: string[] = []): string[] {
  if (node.id === targetId) {
    return node.type === 'directory' ? [...ancestors, node.id] : ancestors;
  }

  if (node.type === 'document') {
    return [];
  }

  for (const child of node.children) {
    const result = findAncestorDirectoryIds(child, targetId, node.id === 'root' ? ancestors : [...ancestors, node.id]);
    if (result.length > 0) {
      return result;
    }
  }

  return [];
}

/* Делает: Экранирует reg exp. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Делает: Выполняет текст highlight. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function highlightText(text: string, query: string) {
  if (!query.trim() || !text) {
    return text;
  }

  const pattern = new RegExp(`(${escapeRegExp(query.trim())})`, 'gi');
  const parts = text.split(pattern);

  return parts.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри highlightText. */ (part, index) =>
    part.toLowerCase() === query.trim().toLowerCase() ? (
      <mark key={`${part}-${index}`} className='repository-page__highlight'>
        {part}
      </mark>
    ) : (
      part
    )
  );
}

/* Делает: Получает document search source. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function getDocumentSearchSource(document: RepositoryResponse['documents'][number]) {
  const blockText = document.blocks
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getDocumentSearchSource. */ (block) => [block.content, block.label, block.url, block.fileName].filter(Boolean).join(' '))
    .join(' ');

  const metaText = [
    document.meta.annotation,
    document.meta.publicationDate,
    document.meta.authors,
    document.meta.affiliations,
    document.meta.organization,
    document.meta.titleEn,
    document.meta.authorsEn,
    document.meta.organizationEn,
    document.meta.descriptionEn,
    document.meta.documentType,
    document.meta.recordType,
    document.meta.journalCode,
    document.meta.volume,
    document.meta.articleNumber,
    document.meta.doi,
    document.meta.citationLink,
    document.meta.citationLinkEn,
    document.meta.license,
  ]
    .filter(Boolean)
    .join(' ');

  return [document.name, blockText, metaText].join(' ');
}

/* Делает: Создаёт search snippet. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function createSearchSnippet(document: RepositoryResponse['documents'][number], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return '';
  }

  const candidates = [
    document.name,
    document.meta.documentType,
    document.meta.doi,
    document.meta.annotation,
    ...document.blocks.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри createSearchSnippet. */ (block) => block.content || block.label || block.url || block.fileName || ''),
  ].filter(Boolean);

  const matchedText = candidates.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри createSearchSnippet. */ (item) => item.toLowerCase().includes(normalizedQuery));
  if (!matchedText) {
    return '';
  }

  const matchIndex = matchedText.toLowerCase().indexOf(normalizedQuery);
  const start = Math.max(0, matchIndex - 50);
  const end = Math.min(matchedText.length, matchIndex + normalizedQuery.length + 70);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < matchedText.length ? '...' : '';

  return `${prefix}${matchedText.slice(start, end)}${suffix}`;
}

/* Делает: Форматирует путь документа parent. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function formatDocumentParentPath(document: RepositoryResponse['documents'][number]) {
  return document.parentPath.length > 0 ? document.parentPath.join(' / ') : 'Корневой каталог';
}

/* Делает: Форматирует идентификатор поискового result. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function formatSearchResultId(documentId: string) {
  return `ID: ${documentId.slice(0, 8)}`;
}

/* Делает: Рендерит блок. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function renderBlock(block: RepositoryBlock, searchQuery = '') {
  if (block.type === 'text') {
    return <p key={block.id}>{highlightText(block.content || 'Текстовый блок пуст.', searchQuery)}</p>;
  }

  if (block.type === 'image') {
    return (
      <figure key={block.id} className='repository-page__media'>
        {block.url ? <img src={normalizeExternalUrl(block.url)} alt={block.label || 'Изображение'} /> : <div className='repository-page__missing'>Изображение не задано</div>}
        {block.label && <figcaption>{highlightText(block.label, searchQuery)}</figcaption>}
      </figure>
    );
  }

  if (block.type === 'link') {
    return (
      <p key={block.id}>
        <a href={normalizeExternalUrl(block.url)} target='_blank' rel='noreferrer'>
          {highlightText(block.label || block.url || 'Гиперссылка', searchQuery)}
        </a>
      </p>
    );
  }

  return (
    <p key={block.id}>
      <a
        href={normalizeExternalUrl(block.url)}
        target='_blank'
        rel='noreferrer'
        download={block.fileName || block.label || 'file'}
      >
        {highlightText(resolveDisplayFileName(block, block.url || 'Файл'), searchQuery)}
      </a>
    </p>
  );
}

/* Делает: Рендерит авторов numbered. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function renderNumberedAuthors(
  authors: Array<{ name: string; affiliationIndex?: number }>,
  searchQuery: string,
  emptyText: string,
  showAffiliationNumbers = true
) {
  if (authors.length === 0) {
    return <p>{emptyText}</p>;
  }

  return (
    <p className='repository-page__numbered-authors'>
      {authors.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри renderNumberedAuthors. */ (author, index) => (
        <span key={`${author.name}-${index}`} className='repository-page__numbered-author'>
          {highlightText(author.name, searchQuery)}
          {showAffiliationNumbers && author.affiliationIndex && <sup>{author.affiliationIndex}</sup>}
          {index < authors.length - 1 ? ', ' : ''}
        </span>
      ))}
    </p>
  );
}

/* Делает: Рендерит аффилиации numbered. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function renderNumberedAffiliations(
  affiliations: Array<{ index: number; value: string; fullTitle?: string }>,
  searchQuery: string,
  fallbackText: string,
  showAffiliationNumbers = true
) {
  if (!showAffiliationNumbers) {
    if (affiliations.length === 0) {
      return <p>{highlightText(fallbackText, searchQuery)}</p>;
    }

    return (
      <p className='repository-page__plain-affiliations'>
        {affiliations.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри renderNumberedAffiliations. */ (affiliation, index) => (
          <span
            key={`${affiliation.index}-${affiliation.value}`}
            className='repository-page__affiliation-name'
          >
            {highlightText(affiliation.value, searchQuery)}
            {index < affiliations.length - 1 ? '; ' : ''}
          </span>
        ))}
      </p>
    );
  }

  if (affiliations.length === 0) {
    return <p>{highlightText(fallbackText, searchQuery)}</p>;
  }

  return (
    <div className='repository-page__numbered-affiliations'>
      {affiliations.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри renderNumberedAffiliations. */ (affiliation) => (
        <p key={`${affiliation.index}-${affiliation.value}`}>
          <span>{affiliation.index}</span>
          {' - '}
          <span className='repository-page__affiliation-name'>
            {highlightText(affiliation.value, searchQuery)}
          </span>
        </p>
      ))}
    </div>
  );
}

/* Делает: Рендерит метаданные документа. Применение: используется локально в файле src/pages/RepositoryPage/RepositoryPage.tsx. */
function renderDocumentMeta({
  meta,
  blocks,
  documentName,
  documentStatus,
  searchQuery = '',
  canViewDocumentStatus = true,
  updatedAt,
  referenceOrganizations = [],
}: {
  meta: RepositoryDocumentMeta;
  blocks: RepositoryBlock[];
  documentName: string;
  documentStatus: RepositoryDocumentStatus;
  searchQuery?: string;
  canViewDocumentStatus?: boolean;
  updatedAt?: string;
  referenceOrganizations?: RepositoryOrganizationReference[];
}) {
  const citationText = resolveDocumentCitationText(meta, documentName, 'ru');
  const citationTextEn = resolveDocumentCitationText(meta, documentName, 'en');
  const fileBlocks = getDocumentFileBlocks(blocks);
  const affiliationsRu = resolveAffiliationsText(meta, 'ru');
  const affiliationsEn = resolveAffiliationsText(meta, 'en');
  const numberedRu = buildNumberedAuthorAffiliations(meta, 'ru', referenceOrganizations);
  const numberedEn = buildNumberedAuthorAffiliations(meta, 'en', referenceOrganizations);
  const showRuAffiliationNumbers = numberedRu.authors.length > 1 && numberedRu.affiliations.length > 0;
  const showEnAffiliationNumbers = numberedEn.authors.length > 1 && numberedEn.affiliations.length > 0;

  return (
    <>
      <section className='repository-page__meta-view'>
        <div className='repository-page__meta-item repository-page__meta-item--plain repository-page__meta-item--title'>
          <p>{highlightText(documentName || 'Не указано', searchQuery)}</p>
        </div>
        <div className='repository-page__meta-item repository-page__meta-item--plain'>
          {renderNumberedAuthors(numberedRu.authors, searchQuery, 'Не указаны', showRuAffiliationNumbers)}
        </div>
        <div className='repository-page__meta-item repository-page__meta-item--plain'>
          {renderNumberedAffiliations(numberedRu.affiliations, searchQuery, affiliationsRu || 'Не указаны', showRuAffiliationNumbers)}
        </div>
        <div className='repository-page__meta-item repository-page__meta-item--plain'>
          <span className='repository-page__field-label'>Аннотация</span>
          <p>{highlightText(meta.annotation || 'Не указана', searchQuery)}</p>
        </div>
        {meta.bibliography?.trim() && (
          <div className='repository-page__meta-item'>
            <h3>Связанные публикации</h3>
            <p>{highlightText(meta.bibliography, searchQuery)}</p>
          </div>
        )}
        <div className='repository-page__meta-item'>
          <h3>Файлы для загрузки</h3>
          {fileBlocks.length > 0 ? (
            <div className='repository-page__file-list'>
              {fileBlocks.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри renderDocumentMeta. */ (block) => (
                <a
                  key={block.id}
                  className='repository-page__file-item'
                  href={buildVersionedFileUrl(block.url, updatedAt)}
                  target='_blank'
                  rel='noreferrer'
                  download={block.fileName || block.label || 'file'}
                >
                  <strong>{highlightText(resolveDisplayFileName(block), searchQuery)}</strong>
                  <span className='repository-page__file-meta'>
                    {formatFileSize(block.fileSize)}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p>Файлы не добавлены.</p>
          )}
        </div>
        <div className='repository-page__meta-item'>
          <h3>Ссылка для цитирования</h3>
          <p>{highlightText(citationText || 'Сформируется после генерации DOI.', searchQuery)}</p>
        </div>
        <div className='repository-page__meta-item'>
          <h3>Файл Crossref XML</h3>
          <p>
            {meta.xmlPath ? (
              <a href={buildVersionedFileUrl(meta.xmlPath, updatedAt)} target='_blank' rel='noreferrer'>
                Открыть Crossref XML
              </a>
            ) : (
              'Не указан'
            )}
          </p>
        </div>
        <div className='repository-page__meta-item'>
          <h3><DocumentFieldLabel label={REPOSITORY_LICENSE_LABEL} helpKey='license' /></h3>
          <p>{highlightText(normalizeRepositoryLicense(meta.license), searchQuery)}</p>
        </div>
      </section>

      <section className='repository-page__meta-view'>
        <div className='repository-page__meta-item repository-page__meta-item--section-title'>
          <h3>Описание на английском языке:</h3>
        </div>
        <div className='repository-page__meta-stack'>
          <div className='repository-page__meta-item repository-page__meta-item--plain repository-page__meta-item--title'>
            <p>{highlightText(meta.titleEn || 'Not specified', searchQuery)}</p>
          </div>
          <div className='repository-page__meta-item repository-page__meta-item--plain'>
            {renderNumberedAuthors(numberedEn.authors, searchQuery, 'Not specified', showEnAffiliationNumbers)}
          </div>
          <div className='repository-page__meta-item repository-page__meta-item--plain'>
            {renderNumberedAffiliations(numberedEn.affiliations, searchQuery, affiliationsEn || 'Not specified', showEnAffiliationNumbers)}
          </div>
          <div className='repository-page__meta-item repository-page__meta-item--plain'>
            <span className='repository-page__field-label'>Annotation</span>
            <p>{highlightText(meta.descriptionEn || 'Not specified', searchQuery)}</p>
          </div>
          <div className='repository-page__meta-item'>
            <h3>Ссылка для цитирования на английском языке</h3>
            <p>{highlightText(citationTextEn || 'Will be generated after DOI assignment.', searchQuery)}</p>
          </div>
        </div>
      </section>
    </>
  );
}

/* Делает: Рендерит React-компонент TreeItem и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function TreeItem({
  node,
  selectedId,
  expandedDirectoryIds,
  onSelect,
  onToggleDirectory,
}: {
  node: RepositoryNode;
  selectedId: string | null;
  expandedDirectoryIds: string[];
  onSelect: (node: RepositoryNode) => void;
  onToggleDirectory: (directoryId: string) => void;
}) {
  if (node.type === 'document') {
    return (
      <button
        type='button'
        className={`repository-page__tree-link ${selectedId === node.id ? 'is-active' : ''}`}
        onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => onSelect(node)}
      >
        {node.name}
      </button>
    );
  }

  return (
    <details className='repository-page__group' open={expandedDirectoryIds.includes(node.id)}>
      <summary
        className={`repository-page__group-title ${selectedId === node.id ? 'is-active' : ''}`}
        onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => {
          event.preventDefault();
          onToggleDirectory(node.id);
          onSelect(node);
        }}
      >
        {node.name}
      </summary>
      <div className='repository-page__group-children'>
        {node.children.length === 0 ? (
          <span className='repository-page__empty-hint'>Пустой каталог</span>
        ) : (
          node.children.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри TreeItem. */ (child) => (
            <TreeItem
              key={child.id}
              node={child}
              selectedId={selectedId}
              expandedDirectoryIds={expandedDirectoryIds}
              onSelect={onSelect}
              onToggleDirectory={onToggleDirectory}
            />
          ))
        )}
      </div>
    </details>
  );
}

type RepositoryWorkspaceMode = 'full' | 'add' | 'edit';

interface RepositoryPageProps {
  workspaceMode?: RepositoryWorkspaceMode;
}

/* Делает: Рендерит React-компонент RepositoryPage и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function RepositoryPage({ workspaceMode = 'full' }: RepositoryPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { repositoryUser, loading, canEditRepository, isRepositoryAdmin } = useRepositoryAuth();
  const isAddWorkspace = workspaceMode === 'add' || location.pathname === '/repository/add';
  const isEditWorkspace = workspaceMode === 'edit' || location.pathname === '/repository/edit';
  const isCompactWorkspace = isAddWorkspace || isEditWorkspace;
  const showSidebar = false;
  const showSearch = false;
  const currentHashNodeId = location.hash.replace(/^#/, '').trim();
  const showDocumentPicker = !showSidebar && !isAddWorkspace && !currentHashNodeId;
  const showWorkspaceHero = isAddWorkspace || isEditWorkspace || showSearch;
  const [repository, setRepository] = useState<RepositoryResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState(isCompactWorkspace);
  const [draftName, setDraftName] = useState('');
  const [draftMeta, setDraftMeta] = useState<RepositoryDocumentMeta>(createEmptyMeta());
  const [authorEntries, setAuthorEntries] = useState<RepositoryAuthorEntry[]>([createEmptyAuthorEntry()]);
  const [draftBlocks, setDraftBlocks] = useState<RepositoryBlock[]>([]);
  const [referenceAuthors, setReferenceAuthors] = useState<RepositoryAuthorReference[]>([]);
  const [referenceOrganizations, setReferenceOrganizations] = useState<RepositoryOrganizationReference[]>([]);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [draggedItem, setDraggedItem] = useState<{ kind: 'block'; blockId: string } | { kind: 'meta' } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [expandedDirectoryIds, setExpandedDirectoryIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingBlockIds, setUploadingBlockIds] = useState<string[]>([]);
  const [uploadDropTargetId, setUploadDropTargetId] = useState<string | null>(null);
  const [pendingBlockUploads, setPendingBlockUploads] = useState<Record<string, PendingBlockUpload>>({});
  const [savedDocumentDraftSignature, setSavedDocumentDraftSignature] = useState('');
  const [documentDraftTrackingReady, setDocumentDraftTrackingReady] = useState(false);
  const navigationGuardBypassRef = useRef(false);
  const [shownUiNoticeKey, setShownUiNoticeKey] = useState('');
  const [publicationConsentConfirmed, setPublicationConsentConfirmed] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [actionModal, setActionModal] = useState<null | {
    title: string;
    message: string;
    variant: 'danger' | 'warning' | 'info' | 'success';
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel?: () => void;
  }>(null);
  const [messageModal, setMessageModal] = useState<null | {
    title: string;
    message: string;
    variant: 'danger' | 'warning' | 'info' | 'success';
    confirmText?: string;
  }>(null);
  const [sendBackModalOpen, setSendBackModalOpen] = useState(false);
  const [revisionCommentDraft, setRevisionCommentDraft] = useState('');
  const [crossrefConfirmationModalOpen, setCrossrefConfirmationModalOpen] = useState(false);
  const [crossrefConfirmationDraft, setCrossrefConfirmationDraft] = useState('');
  const [authorRequestModal, setAuthorRequestModal] = useState<null | {
    entryId: string;
    nameRu: string;
    nameEn: string;
    organizationId: string;
  }>(null);
  const [organizationRequestModal, setOrganizationRequestModal] = useState<null | {
    entryId: string;
    nameRu: string;
    nameEn: string;
    fullNameRu: string;
    fullNameEn: string;
  }>(null);

    /* Делает: Загружает репозиторий. Применение: используется внутри функции RepositoryPage. */
  const loadRepository = async (preferredNodeId?: string) => {
    const data = await repositoryService.getRepository();
    setRepository(data);
    const fallbackDocument = findFirstDocument(data.tree);
    const hashNodeId = getNodeIdFromHash();
    const nextId =
      (preferredNodeId && findNodeById(data.tree, preferredNodeId)?.id) ||
      (hashNodeId && findNodeById(data.tree, hashNodeId)?.id) ||
      (isAddWorkspace ? data.tree.id : null) ||
      selectedId ||
      fallbackDocument?.id ||
      data.tree.id;
    setSelectedId(nextId);
  };

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryPage. */ () => {
    if (!loading) {
      void loadRepository(isAddWorkspace ? 'root' : undefined);
    }
  }, [loading, repositoryUser, isAddWorkspace]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryPage. */ () => {
    let isActive = true;

    void (/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в внешний вызов внутри useEffectCallback. */ async () => {
      setReferencesLoading(true);
      try {
        const [authors, organizations] = await Promise.all([
          canEditRepository ? repositoryReferenceService.getAuthors() : Promise.resolve([]),
          repositoryReferenceService.getOrganizations(),
        ]);

        if (!isActive) {
          return;
        }

        setReferenceAuthors(authors);
        setReferenceOrganizations(organizations);
      } catch (error) {
        if (isActive) {
          console.error('Не удалось загрузить справочники репозитория:', error);
        }
      } finally {
        if (isActive) {
          setReferencesLoading(false);
        }
      }
    })();

    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => {
      isActive = false;
    };
  }, [canEditRepository]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryPage. */ () => {
    if (isCompactWorkspace) {
      setEditorMode(true);
    }
  }, [isCompactWorkspace]);

  const selectedNode = useMemo(/* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryPage. */ () => {
    if (!repository || !selectedId) {
      return null;
    }

    return findNodeById(repository.tree, selectedId);
  }, [repository, selectedId]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const searchResults = useMemo(/* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryPage. */ () => {
    if (!repository || !normalizedSearchQuery) {
      return [];
    }

    return repository.documents
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри useMemoCallback. */ (document) => ({
        document,
        searchSource: getDocumentSearchSource(document).toLowerCase(),
      }))
      .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри useMemoCallback. */ ({ searchSource }) => searchSource.includes(normalizedSearchQuery))
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри useMemoCallback. */ ({ document }, index) => ({
        key: `${document.id}-${index}`,
        document,
        location: formatDocumentParentPath(document),
        identity: formatSearchResultId(document.id),
        snippet: createSearchSnippet(document, searchQuery),
      }))
      .sort(/* Делает: Сравнивает элементы при сортировке. Применение: передаётся как callback в sort внутри useMemoCallback. */ (left, right) => {
        if (left.document.name !== right.document.name) {
          return left.document.name.localeCompare(right.document.name, 'ru');
        }

        if (left.location !== right.location) {
          return left.location.localeCompare(right.location, 'ru');
        }

        return left.document.id.localeCompare(right.document.id, 'ru');
      });
  }, [repository, normalizedSearchQuery, searchQuery]);

  const authorReferenceOptions = useMemo(
    /* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryPage. */ () =>
      referenceAuthors.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри useMemoCallback. */ (author) => ({
        id: String(author.id),
        label: formatAuthorReferenceLabel(author),
        description: author.organizations.length > 0 ? author.organizations.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри mapCallback. */ (organization) => organization.name_ru).join(', ') : undefined,
        searchValues: getAuthorReferenceSearchValues(author),
      })),
    [referenceAuthors]
  );

  const organizationReferenceOptions = useMemo(
    /* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryPage. */ () =>
      referenceOrganizations.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри useMemoCallback. */ (organization) => ({
        id: String(organization.id),
        label: formatOrganizationReferenceLabel(organization),
        description:
          [organization.full_name_ru, organization.full_name_en].filter(Boolean).join(' / ') || undefined,
        searchValues: getOrganizationReferenceSearchValues(organization),
      })),
    [referenceOrganizations]
  );

  const selectedDocument = selectedNode?.type === 'document' ? selectedNode : null;
  const isCreateDocumentWorkspace = Boolean(isAddWorkspace && selectedNode && selectedNode.type === 'directory');
  const isDocumentEditorSurface = Boolean(selectedNode && (selectedNode.type === 'document' || isCreateDocumentWorkspace));
  const isRepositoryUserLimitedToOwnDocuments = repositoryUser?.role === 'user';
  const isSelectedDocumentOwnedByRepositoryUser = Boolean(
    selectedDocument && isDocumentOwnedByUser(selectedDocument.meta, repositoryUser)
  );
  const selectedDocumentStatus: RepositoryDocumentStatus = selectedDocument?.documentStatus || 'draft';
  const selectedDocumentStatusLabel = getDocumentStatusLabel(selectedDocumentStatus);
  const selectedDocumentStatusVariant = getDocumentStatusVariant(selectedDocumentStatus);
  const selectedDocumentTypeLabel = selectedDocument
    ? getRecordTypeLabelRu(resolveDocumentClassification(selectedDocument.meta))
    : '';
  const selectedDocumentStoredDoiLabel = selectedDocument?.meta.doi || 'Не указан';
  const selectedDocumentPublicationDateLabel = selectedDocument?.meta.publicationDate || 'Дата не указана';
  const canViewSelectedDocumentStatus = Boolean(repositoryUser);
  const isSelectedDocumentLockedForEditor = Boolean(
    selectedDocument && canEditRepository && !isRepositoryAdmin && isDocumentLockedForEditor(selectedDocument.documentStatus)
  );
  const canEditSelectedDocument = Boolean(
    selectedDocument &&
      (isRepositoryAdmin || repositoryUser?.role === 'editor' || isSelectedDocumentOwnedByRepositoryUser) &&
      !isSelectedDocumentLockedForEditor
  );
  const canSubmitSelectedDocumentForReview = Boolean(
    selectedDocument &&
      (selectedDocument.documentStatus === 'draft' || selectedDocument.documentStatus === 'needs_revision') &&
      !isSelectedDocumentLockedForEditor &&
      (repositoryUser?.role === 'editor' ||
        (repositoryUser?.role === 'user' && isSelectedDocumentOwnedByRepositoryUser))
  );
  const canDeleteSelectedDocument = Boolean(
    selectedDocument &&
      !(isRepositoryAdmin && selectedDocument.documentStatus === 'verified')
  );
  const canOpenSelectedDocumentInEditMode = Boolean(
    selectedDocument &&
      canEditRepository &&
      canEditSelectedDocument
  );
  const showSelectedDocumentWorkflowActions = Boolean(
    selectedDocument &&
      isRepositoryAdmin &&
      selectedDocument.documentStatus === 'under_review'
  );
  const canEditSelectedNode = Boolean(
    editorMode &&
      canEditRepository &&
      selectedNode &&
      (isCreateDocumentWorkspace ||
        (selectedNode.id !== 'root' &&
          (selectedNode.type === 'directory'
            ? !isRepositoryUserLimitedToOwnDocuments
            : canEditSelectedDocument)))
  );
  const currentDocumentDraftSignature = useMemo(
    /* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryPage. */ () =>
      createDocumentDraftSignature({
        draftName,
        draftMeta,
        authorEntries,
        draftBlocks,
        pendingBlockUploads,
      }),
    [authorEntries, draftBlocks, draftMeta, draftName, pendingBlockUploads]
  );
  const hasUnsavedDocumentChanges = Boolean(
    documentDraftTrackingReady &&
      selectedNode?.type === 'document' &&
      canEditSelectedNode &&
      savedDocumentDraftSignature &&
      currentDocumentDraftSignature !== savedDocumentDraftSignature
  );
  const navigationBlocker = useBlocker(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в useBlocker внутри RepositoryPage. */ ({ currentLocation, nextLocation }) => {
    if (navigationGuardBypassRef.current) {
      navigationGuardBypassRef.current = false;
      return false;
    }

    const destinationChanged =
      currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search ||
      currentLocation.hash !== nextLocation.hash;
    return hasUnsavedDocumentChanges && destinationChanged;
  });

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryPage. */ () => {
    if (!hasUnsavedDocumentChanges) {
      return undefined;
    }

        /* Делает: Обрабатывает before unload. Применение: используется внутри функции useEffectCallback. */
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedDocumentChanges]);

  const getExistingDocumentDoiValues = (excludeDocumentId?: string | null) => {
    const excludedId = String(excludeDocumentId || '').trim();
    return (repository?.documents || [])
      .filter((document) => String(document.id || '').trim() !== excludedId)
      .flatMap((document) => [
        document.meta.doi,
        buildApproximateDoi(document.meta),
      ])
      .map((doi) => normalizeDoiValue(doi))
      .filter(Boolean);
  };

  const resolveUniqueEditableDocumentDoi = (
    meta: RepositoryDocumentMeta,
    documentId?: string | null,
    documentStatus: RepositoryDocumentStatus = 'draft'
  ) => {
    const baseDoi = resolveEditableDocumentDoi(meta, documentId, documentStatus);
    if (documentStatus === 'verified') {
      return baseDoi;
    }

    return resolveUniqueDoiCandidate(baseDoi, getExistingDocumentDoiValues(documentId));
  };

  const draftResolvedDoi = resolveUniqueEditableDocumentDoi(
    draftMeta,
    selectedNode?.type === 'document' ? selectedNode.id : null,
    selectedDocumentStatus
  );
  const draftMetaWithResolvedDoi = {
    ...draftMeta,
    doi: draftResolvedDoi,
  };
  const selectedDocumentDoiLabel = selectedDocument
    ? (editorMode && canEditSelectedDocument
        ? draftResolvedDoi || 'Не указан'
        : selectedDocumentStoredDoiLabel)
    : 'Не указан';
  const draftCitationText = buildDocumentCitation(
    draftMetaWithResolvedDoi,
    draftName.trim() || selectedDocument?.name || ''
  );
  const draftCitationTextEn = buildDocumentCitation(
    draftMetaWithResolvedDoi,
    draftName.trim() || selectedDocument?.name || '',
    'en'
  );
  const draftPublicationYear = resolvePublicationYear(draftMeta);

    /* Делает: Получает ошибки метаданных языка validation. Применение: используется внутри функции RepositoryPage. */
  const getMetaLanguageValidationErrors = (meta: RepositoryDocumentMeta, entries: RepositoryAuthorEntry[]) => {
    const errors: string[] = [];

    entries.forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри getMetaLanguageValidationErrors. */ (entry, index) => {
      const row = index + 1;
      const authorRuError = validateRussianOnly(entry.authorRu, `Автор ${row} (RU)`);
      if (authorRuError) {
        errors.push(authorRuError);
      }

      const authorEnError = validateEnglishOnly(entry.authorEn, `Автор ${row} (EN)`);
      if (authorEnError) {
        errors.push(authorEnError);
      }

      const organizationRuError = validateRussianOnly(entry.organizationRu, `Организация автора ${row} (RU)`);
      if (organizationRuError) {
        errors.push(organizationRuError);
      }

      const organizationFullRuError = validateRussianOnly(entry.organizationFullRu || '', `Полное наименование организации автора ${row} (RU)`);
      if (organizationFullRuError) {
        errors.push(organizationFullRuError);
      }

      const organizationEnError = validateEnglishOnly(entry.organizationEn, `Организация автора ${row} (EN)`);
      if (organizationEnError) {
        errors.push(organizationEnError);
      }

      const organizationFullEnError = validateEnglishOnly(entry.organizationFullEn || '', `Полное наименование организации автора ${row} (EN)`);
      if (organizationFullEnError) {
        errors.push(organizationFullEnError);
      }
    });

    const titleEnError = validateEnglishOnly(meta.titleEn, 'Название (EN)');
    if (titleEnError) {
      errors.push(titleEnError);
    }

    const annotationEnError = validateEnglishOnly(meta.descriptionEn, 'Аннотация (EN)');
    if (annotationEnError) {
      errors.push(annotationEnError);
    }

    const documentTypeError = validateEnglishOnly(meta.documentType, 'Тип записи и документа');
    if (documentTypeError) {
      errors.push(documentTypeError);
    }

    const licenseError = validateEnglishOnly(meta.license, 'Лицензия');
    if (licenseError) {
      errors.push(licenseError);
    }

    return errors;
  };

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryPage. */ () => {
    if (!selectedNode) {
      setSavedDocumentDraftSignature('');
      setDocumentDraftTrackingReady(false);
      return;
    }

    let isActive = true;
    setDocumentDraftTrackingReady(false);

    if (selectedNode.type !== 'document') {
      setDraftName(isAddWorkspace ? '' : selectedNode.name);
      setDraftMeta(createEmptyMeta());
      setAuthorEntries([createEmptyAuthorEntry()]);
      setDraftBlocks(ensureInitialMetadataFileBlock([]));
      setUploadingBlockIds([]);
      setPendingBlockUploads({});
      setSavedDocumentDraftSignature('');
      return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => {
        isActive = false;
      };
    }

    const selectedDocumentMeta = applyPublicationDateDefaults({
      ...createEmptyMeta(),
      ...selectedNode.meta,
      publicationYear: selectedNode.meta.publicationYear || '',
      volume: selectedNode.meta.volume || '',
      articleNumber: selectedNode.meta.articleNumber || '',
    });
    const selectedDocumentAuthorEntries = resolveAuthorEntries(selectedDocumentMeta);
    const selectedDocumentBlocks = ensureInitialMetadataFileBlock(selectedNode.blocks);

    setDraftName(selectedNode.name);
    setDraftMeta(selectedDocumentMeta);
    setAuthorEntries(selectedDocumentAuthorEntries);
    setDraftBlocks(selectedDocumentBlocks);
    setUploadingBlockIds([]);
    setPendingBlockUploads({});
    setSavedDocumentDraftSignature(
      createDocumentDraftSignature({
        draftName: selectedNode.name,
        draftMeta: selectedDocumentMeta,
        authorEntries: selectedDocumentAuthorEntries,
        draftBlocks: selectedDocumentBlocks,
        pendingBlockUploads: {},
      })
    );
    setDocumentDraftTrackingReady(true);

    if (selectedNode.documentStatus === 'draft' && canEditSelectedDocument) {
      void (/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в внешний вызов внутри useEffectCallback. */ async () => {
        try {
          const personalDraft = await repositoryService.getPersonalDraft(selectedNode.id);
          if (!isActive || !personalDraft) {
            return;
          }

          const personalDraftMeta = {
            ...selectedDocumentMeta,
            ...personalDraft.meta,
          };
          const personalDraftName = personalDraft.name || selectedNode.name;
          const personalDraftAuthorEntries = resolveAuthorEntries(personalDraftMeta);
          const personalDraftBlocks = ensureInitialMetadataFileBlock(personalDraft.blocks || []);

          setDraftName(personalDraftName);
          setDraftMeta(personalDraftMeta);
          setAuthorEntries(personalDraftAuthorEntries);
          setDraftBlocks(personalDraftBlocks);
          setPendingBlockUploads({});
          setSavedDocumentDraftSignature(
            createDocumentDraftSignature({
              draftName: personalDraftName,
              draftMeta: personalDraftMeta,
              authorEntries: personalDraftAuthorEntries,
              draftBlocks: personalDraftBlocks,
              pendingBlockUploads: {},
            })
          );
          setDocumentDraftTrackingReady(true);
        } catch (error) {
          if (isActive) {
            console.error('Не удалось загрузить личный черновик документа:', error);
          }
        }
      })();
    }

    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => {
      isActive = false;
    };
  }, [selectedNode, isAddWorkspace, canEditSelectedDocument]);

  useEffect(/* Делает: Сбрасывает подтверждение публикации при смене выбранного документа. Применение: используется внутри функции RepositoryPage. */ () => {
    setPublicationConsentConfirmed(false);
  }, [selectedNode?.id]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryPage. */ () => {
    if (!repository || !selectedId) {
      return;
    }

    const ancestorIds = findAncestorDirectoryIds(repository.tree, selectedId);
    if (ancestorIds.length === 0) {
      return;
    }

    setExpandedDirectoryIds(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setExpandedDirectoryIds внутри useEffectCallback. */ (current) => [...new Set([...current, ...ancestorIds])]);
  }, [repository, selectedId]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryPage. */ () => {
    if (!selectedNode) {
      return;
    }

    if (selectedNode.type === 'document') {
      if (window.location.hash !== `#${selectedNode.id}`) {
        window.history.replaceState(null, '', `#${selectedNode.id}`);
      }
      return;
    }

    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [selectedNode]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryPage. */ () => {
        /* Делает: Обрабатывает hash change. Применение: используется внутри функции useEffectCallback. */
    const handleHashChange = () => {
      const hashNodeId = getNodeIdFromHash();
      if (!repository || !hashNodeId) {
        return;
      }

      const targetNode = findNodeById(repository.tree, hashNodeId);
      if (targetNode) {
        setSelectedId(targetNode.id);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => window.removeEventListener('hashchange', handleHashChange);
  }, [repository]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryPage. */ () => {
    if (!draggedItem) {
      return;
    }

    const edgeSize = 140;
    const scrollStep = 28;

        /* Делает: Обрабатывает window drag over. Применение: используется внутри функции useEffectCallback. */
    const handleWindowDragOver = (event: globalThis.DragEvent) => {
      if (event.clientY < edgeSize) {
        window.scrollBy({ top: -scrollStep, behavior: 'auto' });
      } else if (event.clientY > window.innerHeight - edgeSize) {
        window.scrollBy({ top: scrollStep, behavior: 'auto' });
      }
    };

    window.addEventListener('dragover', handleWindowDragOver);
    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => window.removeEventListener('dragover', handleWindowDragOver);
  }, [draggedItem]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryPage. */ () => {
    let nextNotice:
      | {
          key: string;
          title: string;
          message: string;
          variant: 'danger' | 'warning' | 'info' | 'success';
        }
      | null = null;

    if (
      selectedNode?.type === 'document' &&
      editorMode &&
      !isRepositoryAdmin &&
      repositoryUser?.role === 'user' &&
      !isSelectedDocumentOwnedByRepositoryUser
    ) {
      nextNotice = {
        key: `ownership-${selectedNode.id}`,
        title: 'Редактирование недоступно',
        message: 'Пользователь может редактировать только собственные документы. Этот материал доступен только для просмотра.',
        variant: 'warning',
      };
    } else if (
      selectedNode?.type === 'document' &&
      editorMode &&
      !isRepositoryAdmin &&
      isSelectedDocumentLockedForEditor
    ) {
      nextNotice = {
        key: `locked-${selectedNode.id}-${selectedDocumentStatus}`,
        title: 'Редактирование временно недоступно',
        message: 'Документ сейчас недоступен для редактирования. Дождитесь смены статуса администратором.',
        variant: 'warning',
      };
    }

    if (!nextNotice) {
      if (shownUiNoticeKey) {
        setShownUiNoticeKey('');
      }
      return;
    }

    if (messageModal || shownUiNoticeKey === nextNotice.key) {
      return;
    }

    setShownUiNoticeKey(nextNotice.key);
    setMessageModal({
      ...nextNotice,
      confirmText: 'Понятно',
    });
  }, [
    editorMode,
    isCreateDocumentWorkspace,
    isDocumentEditorSurface,
    isRepositoryAdmin,
    isSelectedDocumentLockedForEditor,
    isSelectedDocumentOwnedByRepositoryUser,
    messageModal,
    repositoryUser?.role,
    selectedDocumentStatus,
    selectedNode,
    shownUiNoticeKey,
  ]);

  const metadataFileBlocks = getDocumentDraftFileBlocks(draftBlocks);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryPage. */ () => {
    if (!isDocumentEditorSurface || metadataFileBlocks.length > 0) {
      return;
    }

    setDraftBlocks(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setDraftBlocks внутри useEffectCallback. */ (current) => ensureInitialMetadataFileBlock(current));
  }, [isDocumentEditorSurface, metadataFileBlocks.length]);

    /* Делает: Получает загрузку ожидающего блока. Применение: используется внутри функции RepositoryPage. */
  const getPendingBlockUpload = (blockId: string) => pendingBlockUploads[blockId] || null;
    /* Делает: Проверяет наличие загрузку ожидающего блока. Применение: используется внутри функции RepositoryPage. */
  const hasPendingBlockUpload = (block: RepositoryBlock) => Boolean(getPendingBlockUpload(block.id));
    /* Делает: Очищает загрузку ожидающего блока. Применение: используется внутри функции RepositoryPage. */
  const clearPendingBlockUpload = (blockId: string) => {
    setPendingBlockUploads(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setPendingBlockUploads внутри clearPendingBlockUpload. */ (current) => {
      if (!current[blockId]) {
        return current;
      }

      const next = { ...current };
      delete next[blockId];
      return next;
    });
  };
    /* Делает: Получает идентификатор persisted блока by. Применение: используется внутри функции RepositoryPage. */
  const getPersistedBlockById = (blockId: string) =>
    selectedNode?.type === 'document'
      ? selectedNode.blocks.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри getPersistedBlockById. */ (block) => block.id === blockId) || null
      : null;
    /* Делает: Получает URL disposable управляемого загрузки. Применение: используется внутри функции RepositoryPage. */
  const getDisposableManagedUploadUrl = (block: RepositoryBlock) => {
    const currentUrl = String(block.url || '').trim();
    if (!currentUrl || !isManagedRepositoryUploadUrl(currentUrl)) {
      return '';
    }

    const persistedUrl = String(getPersistedBlockById(block.id)?.url || '').trim();
    return currentUrl && currentUrl !== persistedUrl ? currentUrl : '';
  };
    /* Делает: Очищает загрузку obsolete управляемого. Применение: используется внутри функции RepositoryPage. */
  const cleanupObsoleteManagedUpload = async (url: string) => {
    if (!url || selectedNode?.type !== 'document') {
      return;
    }

    try {
      await repositoryService.deleteUploadAsset(url, selectedNode.id);
    } catch (error) {
      console.error('Failed to delete obsolete repository upload:', error);
    }
  };
    /* Делает: Определяет имя блока прикреплённого файлового display. Применение: используется внутри функции RepositoryPage. */
  const resolveBlockAttachedFileDisplayName = (block: RepositoryBlock) =>
    getPendingBlockUpload(block.id)?.file.name || resolveAttachedFileDisplayName(block);
    /* Делает: Определяет block file size. Применение: используется внутри функции RepositoryPage. */
  const resolveBlockFileSize = (block: RepositoryBlock) => getPendingBlockUpload(block.id)?.file.size ?? block.fileSize;
    /* Делает: Проверяет file source input disabled. Применение: используется внутри функции RepositoryPage. */
  const isFileSourceInputDisabled = (block: RepositoryBlock) =>
    block.type === 'file' && (hasPendingBlockUpload(block) || isLocalUploadedFileBlock(block));
    /* Делает: Определяет file source placeholder. Применение: используется внутри функции RepositoryPage. */
  const resolveFileSourcePlaceholder = (block: RepositoryBlock) => {
    if (hasPendingBlockUpload(block)) {
      return 'Файл будет загружен при сохранении';
    }

    return isLocalUploadedFileBlock(block) ? 'Файл загружен с компьютера' : 'Ссылка на файл';
  };

  if (loading) {
    return <section className='repository-page repository-page--state'>Загрузка доступа к репозиторию...</section>;
  }

    /* Делает: Обрабатывает выбор. Применение: используется внутри функции RepositoryPage. */
  const handleSelect = (node: RepositoryNode) => {
    setSelectedId(node.id);
    setMessageModal(null);
    setDeleteModalOpen(false);
  };

    /* Делает: Обрабатывает выбор поискового. Применение: используется внутри функции RepositoryPage. */
  const handleSearchSelect = (documentId: string) => {
    setSelectedId(documentId);
    setMessageModal(null);
    setDeleteModalOpen(false);
  };

    /* Делает: Переключает каталог. Применение: используется внутри функции RepositoryPage. */
  const toggleDirectory = (directoryId: string) => {
    setExpandedDirectoryIds(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setExpandedDirectoryIds внутри toggleDirectory. */ (current) =>
      current.includes(directoryId)
        ? current.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри setExpandedDirectoryIdsCallback. */ (id) => id !== directoryId)
        : [...current, directoryId]
    );
  };

    /* Делает: Создаёт ошибку workflow. Применение: используется внутри функции RepositoryPage. */
  const createWorkflowError = (
    title: string,
    message: string,
    variant: 'warning' | 'danger' = 'warning'
  ) => {
    const error = new Error(message) as Error & { modalTitle?: string; modalVariant?: 'warning' | 'danger' };
    error.modalTitle = title;
    error.modalVariant = variant;
    return error;
  };

    /* Делает: Определяет workflow error title. Применение: используется внутри функции RepositoryPage. */
  const resolveWorkflowErrorTitle = (error: unknown, fallback: string) =>
    typeof (error as { modalTitle?: unknown })?.modalTitle === 'string' && String((error as { modalTitle?: string }).modalTitle).trim()
      ? String((error as { modalTitle?: string }).modalTitle).trim()
      : fallback;

    /* Делает: Определяет workflow error variant. Применение: используется внутри функции RepositoryPage. */
  const resolveWorkflowErrorVariant = (error: unknown, fallback: 'warning' | 'danger') => {
    const variant = (error as { modalVariant?: unknown })?.modalVariant;
    return variant === 'warning' || variant === 'danger' ? variant : fallback;
  };

    /* Делает: Выполняет prepare draft document fields for save. Применение: используется внутри функции RepositoryPage. */
  const prepareDraftDocumentFieldsForSave = (): NormalizedDocumentDraftForSave => {
    const report = createDocumentSaveNormalizationReport();
    const normalizedDraftName = collapseMultipleSpacesForSave(draftName, report);
    const sourceAuthorEntries = authorEntries.length > 0 ? authorEntries : [createEmptyAuthorEntry()];
    const normalizedAuthorEntries = normalizeAuthorEntriesForSave(sourceAuthorEntries, report);
    const normalizedMeta = normalizeDocumentMetaForSave(
      {
        ...draftMeta,
        ...composeMetaAuthorsFromEntries(normalizedAuthorEntries),
        authorEntries: normalizedAuthorEntries,
      },
      report
    );

    return {
      draftName: normalizedDraftName,
      draftMeta: normalizedMeta,
      authorEntries: resolveAuthorEntries(normalizedMeta),
      draftBlocks: normalizeRepositoryBlocksForSave(draftBlocks, report),
      report,
    };
  };

    /* Делает: Выполняет поля apply prepared черновика документа. Применение: используется внутри функции RepositoryPage. */
  const applyPreparedDraftDocumentFields = (preparedDraft: NormalizedDocumentDraftForSave) => {
    setDraftName(preparedDraft.draftName);
    setDraftMeta(preparedDraft.draftMeta);
    setAuthorEntries(preparedDraft.authorEntries);
    setDraftBlocks(preparedDraft.draftBlocks);
  };

    /* Делает: Нормализует draft document fields for save. Применение: используется внутри функции RepositoryPage. */
  const normalizeDraftDocumentFieldsForSave = () => {
    const preparedDraft = prepareDraftDocumentFieldsForSave();
    applyPreparedDraftDocumentFields(preparedDraft);
    return preparedDraft;
  };

    /* Делает: Получает existing document name set. Применение: используется внутри функции RepositoryPage. */
  const getExistingDocumentNameSet = () =>
    new Set(
      (repository?.documents || [])
        .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getExistingDocumentNameSet. */ (document) => normalizeDocumentNameForDuplicateCheck(document.name))
        .filter(Boolean)
    );

    /* Делает: Проверяет document name already used. Применение: используется внутри функции RepositoryPage. */
  const isDocumentNameAlreadyUsed = (name: string) => {
    const normalizedName = normalizeDocumentNameForDuplicateCheck(name);
    return Boolean(normalizedName && getExistingDocumentNameSet().has(normalizedName));
  };

    /* Делает: Определяет имя appendix документа. Применение: используется внутри функции RepositoryPage. */
  const resolveAppendixDocumentName = (baseName: string) => {
    const normalizedBaseName = String(baseName || '').trim().replace(/[ \t\u00a0]+/g, ' ');
    const existingNames = getExistingDocumentNameSet();

    for (let index = 1; index < 10_000; index += 1) {
      const candidate = `${normalizedBaseName} приложение ${index}`;
      if (!existingNames.has(normalizeDocumentNameForDuplicateCheck(candidate))) {
        return candidate;
      }
    }

    return `${normalizedBaseName} приложение ${Date.now()}`;
  };

    /* Делает: Сохраняет selected document edits. Применение: используется внутри функции RepositoryPage. */
  const persistSelectedDocumentEdits = async ({
    reloadAfterSave = false,
    showSuccessModal = false,
    normalizedDraft,
  }: {
    reloadAfterSave?: boolean;
    showSuccessModal?: boolean;
    normalizedDraft?: NormalizedDocumentDraftForSave;
  } = {}) => {
    if (!selectedNode || selectedNode.type !== 'document') {
      throw createWorkflowError('Не удалось сохранить', 'Документ не выбран.', 'danger');
    }

    const preparedDraft = normalizedDraft || normalizeDraftDocumentFieldsForSave();
    const documentNameForSave = preparedDraft.draftName.trim() || selectedNode.name;
    const synchronizedMetaBase = applyDocumentClassification(
      preparedDraft.draftMeta,
      resolveDocumentClassification(preparedDraft.draftMeta)
    );
    const synchronizedMeta = {
      ...synchronizedMetaBase,
      doi: resolveUniqueEditableDocumentDoi(synchronizedMetaBase, selectedNode.id, selectedNode.documentStatus),
    };
    const metaToSave = {
      ...synchronizedMeta,
      citationLink: buildDocumentCitation(synchronizedMeta, documentNameForSave, 'ru'),
      citationLinkEn: buildDocumentCitation(synchronizedMeta, documentNameForSave, 'en'),
    };

    if (uploadingBlockIds.length > 0) {
      throw createWorkflowError(
        'Загрузка не завершена',
        'Дождитесь завершения загрузки файла перед сохранением.',
        'warning'
      );
    }

    const languageValidationErrors = getMetaLanguageValidationErrors(synchronizedMeta, preparedDraft.authorEntries);
    if (languageValidationErrors.length > 0) {
      throw createWorkflowError(
        'Проверьте язык заполнения полей',
        languageValidationErrors.join(' '),
        'warning'
      );
    }

    const fileValidationErrors = getFileBlockValidationErrors(preparedDraft.draftBlocks, new Set(Object.keys(pendingBlockUploads)));
    if (fileValidationErrors.length > 0) {
      throw createWorkflowError(
        'Проверьте файлы документа',
        fileValidationErrors.join(' '),
        'warning'
      );
    }

    let blocksToSave = sanitizeBlocksForSave(preparedDraft.draftBlocks);
    blocksToSave = await uploadPendingBlockFiles(blocksToSave, {
      documentId: selectedNode.id,
      documentName: documentNameForSave,
      publicationDate: metaToSave.publicationDate || '',
    });

    if (selectedNode.documentStatus !== 'verified') {
      await repositoryService.savePersonalDraft(selectedNode.id, {
        name: documentNameForSave,
        meta: metaToSave,
        blocks: blocksToSave,
        sourceUpdatedAt: selectedNode.updatedAt,
      });

      if (showSuccessModal) {
        const isDraftDocument = selectedNode.documentStatus === 'draft';
        setMessageModal({
          title: isDraftDocument ? 'Черновик сохранён' : 'Сохранение завершено',
          message: appendDocumentSaveNormalizationNotice(
            isDraftDocument
              ? 'Данные сохранены в черновик. Основной документ будет заполнен после успешной отправки XML в Crossref.'
              : `Документ сохранён. Текущий статус: ${getDocumentStatusLabel(selectedNode.documentStatus)}.`,
            preparedDraft.report
          ),
          variant: 'success',
          confirmText: 'Отлично',
        });
      }
    } else {
      await repositoryService.updateNode(selectedNode.id, {
        name: documentNameForSave,
        meta: metaToSave,
        blocks: blocksToSave,
        expectedUpdatedAt: selectedNode.updatedAt,
      });

      if (showSuccessModal) {
        setMessageModal({
          title: 'Сохранение завершено',
          message: appendDocumentSaveNormalizationNotice(
            'Документ сохранён в текущем статусе.',
            preparedDraft.report
          ),
          variant: 'success',
          confirmText: 'Отлично',
        });
      }
    }

    const savedDraftBlocks = ensureInitialMetadataFileBlock(blocksToSave);
    setDraftName(documentNameForSave);
    setDraftMeta(metaToSave);
    setAuthorEntries(preparedDraft.authorEntries);
    setDraftBlocks(savedDraftBlocks);
    setPendingBlockUploads({});
    setSavedDocumentDraftSignature(
      createDocumentDraftSignature({
        draftName: documentNameForSave,
        draftMeta: metaToSave,
        authorEntries: preparedDraft.authorEntries,
        draftBlocks: savedDraftBlocks,
        pendingBlockUploads: {},
      })
    );
    setDocumentDraftTrackingReady(true);

    if (reloadAfterSave) {
      await loadRepository(selectedNode.id);
    }

    return preparedDraft.report;
  };

    /* Делает: Сохраняет узел выбранного. Применение: используется внутри функции RepositoryPage. */
  const saveSelectedNode = async ({
    createDocumentNameOverride = '',
    skipDuplicateNamePrompt = false,
  }: {
    createDocumentNameOverride?: string;
    skipDuplicateNamePrompt?: boolean;
  } = {}) => {
    if (!selectedNode || (!isCreateDocumentWorkspace && selectedNode.id === 'root')) {
      return;
    }

    const preparedDraftForSave = isDocumentEditorSurface ? normalizeDraftDocumentFieldsForSave() : null;
    const createDocumentNameForSave = createDocumentNameOverride.trim();
    if (createDocumentNameForSave) {
      setDraftName(createDocumentNameForSave);
    }
    const draftNameForSave = createDocumentNameForSave || (preparedDraftForSave?.draftName ?? draftName);
    const draftMetaForSave = preparedDraftForSave?.draftMeta ?? draftMeta;
    const draftBlocksForSave = preparedDraftForSave?.draftBlocks ?? draftBlocks;
    const authorEntriesForSave = preparedDraftForSave?.authorEntries ?? authorEntries;
    const synchronizedMetaBase = applyDocumentClassification(draftMetaForSave, resolveDocumentClassification(draftMetaForSave));
    const synchronizedMeta = {
      ...synchronizedMetaBase,
      doi: resolveUniqueEditableDocumentDoi(
        synchronizedMetaBase,
        selectedNode.type === 'document' ? selectedNode.id : null,
        selectedNode.type === 'document' ? selectedNode.documentStatus : 'draft'
      ),
    };
    const metaToSave = isDocumentEditorSurface
      ? {
          ...synchronizedMeta,
          citationLink: buildDocumentCitation(synchronizedMeta, draftNameForSave.trim() || selectedNode.name, 'ru'),
          citationLinkEn: buildDocumentCitation(synchronizedMeta, draftNameForSave.trim() || selectedNode.name, 'en'),
        }
      : undefined;

    if (uploadingBlockIds.length > 0) {
      setMessageModal({
        title: 'Загрузка не завершена',
        message: 'Дождитесь завершения загрузки файла перед сохранением.',
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    if (isDocumentEditorSurface) {
      const languageValidationErrors = getMetaLanguageValidationErrors(synchronizedMeta, authorEntriesForSave);
      if (languageValidationErrors.length > 0) {
        setMessageModal({
          title: 'Проверьте язык заполнения полей',
          message: languageValidationErrors.join(' '),
          variant: 'warning',
          confirmText: 'Понятно',
        });
        return;
      }

      const fileValidationErrors = getFileBlockValidationErrors(draftBlocksForSave, new Set(Object.keys(pendingBlockUploads)));
      if (fileValidationErrors.length > 0) {
        setMessageModal({
          title: 'Проверьте файлы документа',
          message: fileValidationErrors.join(' '),
          variant: 'warning',
          confirmText: 'Понятно',
        });
        return;
      }

      if (isCreateDocumentWorkspace) {
        const missingCreateFields = getMissingCreateDocumentFields(synchronizedMeta, draftNameForSave);
        if (missingCreateFields.length > 0) {
          const missingCreateFieldLabels = missingCreateFields
            .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри saveSelectedNode. */ (field) => CREATE_DOCUMENT_MINIMAL_FIELD_LABELS[field])
            .join(', ');
          setMessageModal({
            title: 'Заполните обязательные поля',
            message: `Для создания документа заполните обязательные поля: ${missingCreateFieldLabels}.`,
            variant: 'warning',
            confirmText: 'Понятно',
          });
          return;
        }

        if (!skipDuplicateNamePrompt && isDocumentNameAlreadyUsed(draftNameForSave)) {
          const appendixDocumentName = resolveAppendixDocumentName(draftNameForSave);
          setActionModal({
            title: 'Документ с таким названием уже существует',
            message: 'Документ с таким названием уже существует, вы хотите создать приложение?',
            variant: 'warning',
            confirmText: 'Создать приложение',
            cancelText: 'Отказаться',
                        /* Делает: Выполняет on confirm. Применение: используется внутри функции saveSelectedNode. */
            onConfirm: () => {
              setActionModal(null);
              setDraftName(appendixDocumentName);
              void saveSelectedNode({
                createDocumentNameOverride: appendixDocumentName,
                skipDuplicateNamePrompt: true,
              });
            },
                        /* Делает: Выполняет on cancel. Применение: используется внутри функции saveSelectedNode. */
            onCancel: () => {
              setMessageModal({
                title: 'Измените название документа',
                message: 'Чтобы создать документ, необходимо изменить название документа.',
                variant: 'warning',
                confirmText: 'Понятно',
              });
            },
          });
          return;
        }
      }
    }

    setSaving(true);
    let createdDocumentId: string | null = null;
    try {
      let blocksToSave = sanitizeBlocksForSave(draftBlocksForSave);
      if (isCreateDocumentWorkspace && metaToSave) {
        const result = await repositoryService.createDocument(
          selectedNode.id,
          draftNameForSave.trim(),
          metaToSave.documentType
        );
        createdDocumentId = result.createdNode.id;
        blocksToSave = await uploadPendingBlockFiles(blocksToSave, {
          documentId: result.createdNode.id,
          documentName: draftNameForSave.trim() || result.createdNode.name,
          publicationDate: metaToSave.publicationDate || '',
        });
        await repositoryService.savePersonalDraft(result.createdNode.id, {
          name: draftNameForSave.trim(),
          meta: metaToSave,
          blocks: blocksToSave,
          sourceUpdatedAt: result.createdNode.updatedAt,
        });
        setMessageModal({
          title: 'Создание завершено',
          message: appendDocumentSaveNormalizationNotice(
            'Новый документ создан, данные сохранены в личный черновик. Основной документ заполнится после успешной отправки XML в Crossref.',
            preparedDraftForSave?.report ?? createDocumentSaveNormalizationReport()
          ),
          variant: 'success',
          confirmText: 'Отлично',
        });
        await loadRepository(result.createdNode.id);
        return;
      }

      if (selectedNode.type === 'document') {
        await persistSelectedDocumentEdits({
          reloadAfterSave: true,
          showSuccessModal: true,
          normalizedDraft: preparedDraftForSave ?? undefined,
        });
        return;
      }

      await repositoryService.updateNode(selectedNode.id, {
        name: draftName.trim(),
        meta: metaToSave,
      });
      setMessageModal({
        title: 'Сохранение завершено',
        message: 'Каталог успешно сохранён.',
        variant: 'success',
        confirmText: 'Отлично',
      });
      await loadRepository(selectedNode.id);
    } catch (error) {
      if (createdDocumentId) {
        try {
          await loadRepository(createdDocumentId);
        } catch {
          // ignore recovery navigation errors and still show the original save message
        }
      }

      const errorMessage =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Не удалось сохранить изменения.';
      setMessageModal({
        title: createdDocumentId
          ? 'Документ создан, но сохранение не завершено'
          : resolveWorkflowErrorTitle(error, 'Не удалось сохранить'),
        message:
          createdDocumentId
            ? `Документ уже создан. ${errorMessage}`
            : errorMessage,
        variant: createdDocumentId ? 'warning' : resolveWorkflowErrorVariant(error, 'danger'),
        confirmText: 'Закрыть',
      });
    } finally {
      setSaving(false);
    }
  };

    /* Делает: Сохраняет unsaved document changes and continue. Применение: используется внутри функции RepositoryPage. */
  const saveUnsavedDocumentChangesAndContinue = async () => {
    if (saving || navigationBlocker.state !== 'blocked' || selectedNode?.type !== 'document') {
      return;
    }

    setSaving(true);
    try {
      await persistSelectedDocumentEdits();
      navigationBlocker.proceed();
    } catch (error) {
      navigationBlocker.reset();
      setMessageModal({
        title: resolveWorkflowErrorTitle(error, 'Не удалось сохранить'),
        message: error instanceof Error ? error.message : 'Не удалось сохранить изменения перед переходом.',
        variant: resolveWorkflowErrorVariant(error, 'danger'),
        confirmText: 'Закрыть',
      });
    } finally {
      setSaving(false);
    }
  };

    /* Делает: Выполняет discard unsaved document changes and continue. Применение: используется внутри функции RepositoryPage. */
  const discardUnsavedDocumentChangesAndContinue = () => {
    if (navigationBlocker.state === 'blocked') {
      navigationBlocker.proceed();
    }
  };

    /* Делает: Выполняет редактор stay on документа. Применение: используется внутри функции RepositoryPage. */
  const stayOnDocumentEditor = () => {
    if (navigationBlocker.state === 'blocked') {
      navigationBlocker.reset();
    }
  };

    /* Делает: Открывает модальное окно delete. Применение: используется внутри функции RepositoryPage. */
  const openDeleteModal = () => {
    if (!selectedNode || selectedNode.id === 'root') {
      return;
    }

    setDeleteModalOpen(true);
  };

    /* Делает: Подтверждает узел delete выбранного. Применение: используется внутри функции RepositoryPage. */
  const confirmDeleteSelectedNode = async () => {
    if (!selectedNode || selectedNode.id === 'root') {
      return;
    }

    setDeleteModalOpen(false);
    setSaving(true);
    try {
      await repositoryService.deleteNode(selectedNode.id);
      setMessageModal({
        title: 'Удаление завершено',
        message: `"${selectedNode.name}" успешно удалён.`,
        variant: 'success',
        confirmText: 'Понятно',
      });
      await loadRepository('root');
    } catch (error) {
      setMessageModal({
        title: 'Не удалось удалить',
        message: error instanceof Error ? error.message : 'Не удалось удалить узел.',
        variant: 'danger',
        confirmText: 'Закрыть',
      });
    } finally {
      setSaving(false);
    }
  };

    /* Делает: Выполняет Crossref deposit выбранного документа to. Применение: используется внутри функции RepositoryPage. */
  const depositSelectedDocumentToCrossref = async () => {
    if (!selectedDocument) {
      return;
    }

    setSaving(true);
    try {
      await persistSelectedDocumentEdits();
      await repositoryService.depositXmlToCrossref(selectedDocument.id);
      navigationGuardBypassRef.current = true;
      navigate('/repository/cabinet', { replace: true });
    } catch (error) {
      setMessageModal({
        title: resolveWorkflowErrorTitle(error, 'Не удалось отправить XML'),
        message: error instanceof Error ? error.message : 'Crossref deposit завершился ошибкой.',
        variant: resolveWorkflowErrorVariant(error, 'danger'),
        confirmText: 'Закрыть',
      });
    } finally {
      setSaving(false);
    }
  };

    /* Делает: Подтверждает публикацию выбранного документа crossref. Применение: используется внутри функции RepositoryPage. */
  const confirmSelectedDocumentCrossrefPublication = async (message: string) => {
    if (!selectedDocument) {
      return;
    }

    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      setMessageModal({
        title: 'Нет письма Crossref',
        message: 'Вставьте текст письма или XML-ответа Crossref перед подтверждением публикации.',
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    setSaving(true);
    try {
      const result = await repositoryService.confirmCrossrefPublicationByEmail(selectedDocument.id, normalizedMessage);
      setCrossrefConfirmationModalOpen(false);
      setCrossrefConfirmationDraft('');
      setMessageModal({
        title: 'Публикация подтверждена',
        message: [
          `Документ переведён в статус "${getDocumentStatusLabel('verified')}".`,
          result.confirmedDoi ? `DOI: ${result.confirmedDoi}.` : '',
          result.submissionId ? `Submission ID: ${result.submissionId}.` : '',
        ].filter(Boolean).join(' '),
        variant: 'success',
        confirmText: 'Закрыть',
      });
      await loadRepository(selectedDocument.id);
    } catch (error) {
      setMessageModal({
        title: resolveWorkflowErrorTitle(error, 'Не удалось подтвердить публикацию'),
        message: error instanceof Error ? error.message : 'Не удалось подтвердить публикацию по письму Crossref.',
        variant: resolveWorkflowErrorVariant(error, 'danger'),
        confirmText: 'Закрыть',
      });
    } finally {
      setSaving(false);
    }
  };

    /* Делает: Отправляет проверку выбранного документа for. Применение: используется внутри функции RepositoryPage. */
  const submitSelectedDocumentForReview = async () => {
    if (!selectedDocument) {
      return;
    }

    setSaving(true);
    try {
      const preparedDraft = normalizeDraftDocumentFieldsForSave();
      const documentNameForSave = preparedDraft.draftName.trim() || selectedDocument.name;
      const blocksToSave = sanitizeBlocksForSave(preparedDraft.draftBlocks);
      const synchronizedMetaBase = applyDocumentClassification(
        preparedDraft.draftMeta,
        resolveDocumentClassification(preparedDraft.draftMeta)
      );
      const synchronizedMeta = {
        ...synchronizedMetaBase,
        doi: resolveUniqueEditableDocumentDoi(synchronizedMetaBase, selectedDocument.id, selectedDocument.documentStatus),
      };
      const metaToSave = {
        ...synchronizedMeta,
        citationLink: buildDocumentCitation(synchronizedMeta, documentNameForSave, 'ru'),
        citationLinkEn: buildDocumentCitation(synchronizedMeta, documentNameForSave, 'en'),
      };

      await repositoryService.savePersonalDraft(selectedDocument.id, {
        name: documentNameForSave,
        meta: metaToSave,
        blocks: blocksToSave,
        sourceUpdatedAt: selectedDocument.updatedAt,
      });
      await repositoryService.submitDocumentForReview(selectedDocument.id);
      setMessageModal({
        title: 'Документ отправлен на регистрацию',
        message: appendDocumentSaveNormalizationNotice(
          'Редактирование документа заблокировано до смены статуса. Администратору отправлено уведомление по email.',
          preparedDraft.report
        ),
        variant: 'success',
        confirmText: 'Понятно',
      });
      navigationGuardBypassRef.current = true;
      navigate('/repository/cabinet', { replace: true });
    } catch (error) {
      setMessageModal({
        title: 'Не удалось отправить документ',
        message: error instanceof Error ? error.message : 'Не удалось отправить документ на регистрацию.',
        variant: 'danger',
        confirmText: 'Закрыть',
      });
    } finally {
      setSaving(false);
    }
  };

    /* Делает: Выполняет доработку send выбранного документа to. Применение: используется внутри функции RepositoryPage. */
  const sendSelectedDocumentToRevision = async (comment: string) => {
    if (!selectedDocument) {
      return;
    }

    setSaving(true);
    try {
      const result = await repositoryService.sendDocumentToRevisionAsAdmin(selectedDocument.id, comment);
      setMessageModal({
        title: 'Документ отправлен на доработку',
        message:
          result?.message ||
          'Статус документа изменен на "На доработке". Автору документа отправлено уведомление по email.',
        variant: 'success',
        confirmText: 'Понятно',
      });
      await loadRepository(selectedDocument.id);
    } catch (error) {
      setMessageModal({
        title: 'Не удалось отправить на доработку',
        message: error instanceof Error ? error.message : 'Не удалось отправить документ на доработку.',
        variant: 'danger',
        confirmText: 'Закрыть',
      });
    } finally {
      setSaving(false);
    }
  };

    /* Делает: Открывает submit for review action. Применение: используется внутри функции RepositoryPage. */
  const openSubmitForReviewAction = () => {
    if (!selectedDocument) {
      return;
    }

    if (uploadingBlockIds.length > 0) {
      setMessageModal({
        title: 'Загрузка не завершена',
        message: 'Дождитесь завершения загрузки файла перед отправкой документа на регистрацию.',
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    if (Object.keys(pendingBlockUploads).length > 0) {
      setMessageModal({
        title: 'Сначала сохраните документ',
        message: 'Вы выбрали новые файлы. Сначала нажмите "Сохранить", чтобы загрузить их на сервер, и только потом отправляйте документ на регистрацию.',
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    const preparedDraft = prepareDraftDocumentFieldsForSave();
    const synchronizedMeta = applyDocumentClassification(
      preparedDraft.draftMeta,
      resolveDocumentClassification(preparedDraft.draftMeta)
    );
    const languageValidationErrors = getMetaLanguageValidationErrors(synchronizedMeta, preparedDraft.authorEntries);
    if (languageValidationErrors.length > 0) {
      setMessageModal({
        title: 'Проверьте язык заполнения полей',
        message: languageValidationErrors.join(' '),
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    const fileValidationErrors = getFileBlockValidationErrors(preparedDraft.draftBlocks, new Set(Object.keys(pendingBlockUploads)));
    if (fileValidationErrors.length > 0) {
      setMessageModal({
        title: 'Проверьте файлы документа',
        message: fileValidationErrors.join(' '),
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    const missingMeta = getMissingRequiredMetaFields(synchronizedMeta);
    if (missingMeta.length > 0) {
      const missingMetaLabels = missingMeta.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри openSubmitForReviewAction. */ (field) => REQUIRED_META_FIELD_LABELS[field]).join(', ');
      setMessageModal({
        title: 'Не заполнены обязательные поля',
        message: `Перед отправкой на регистрацию заполните все обязательные поля metadata: ${missingMetaLabels}.`,
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    if (selectedDocument.documentStatus === 'under_review') {
      setMessageModal({
        title: 'Документ уже на регистрации',
        message: 'Документ уже ожидает регистрации администратором.',
        variant: 'info',
        confirmText: 'Понятно',
      });
      return;
    }

    if (selectedDocument.documentStatus === 'verified') {
      setMessageModal({
        title: 'Документ уже принят',
        message: 'Документ уже проверен администратором и повторная отправка не требуется.',
        variant: 'info',
        confirmText: 'Понятно',
      });
      return;
    }

    if (!publicationConsentConfirmed) {
      setMessageModal({
        title: 'Требуется подтверждение',
        message: 'Перед отправкой на регистрацию подтвердите, что получены согласия от всех авторов на публикацию размещаемых материалов.',
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    setActionModal({
      title: 'Отправить на регистрацию',
      message: `Отправить документ "${selectedDocument.name}" на регистрацию администратору? После этого редактирование документа будет заблокировано до смены статуса.`,
      variant: 'warning',
      confirmText: 'Отправить',
            /* Делает: Выполняет on confirm. Применение: используется внутри функции openSubmitForReviewAction. */
      onConfirm: () => {
        setActionModal(null);
        void submitSelectedDocumentForReview();
      },
    });
  };

    /* Делает: Открывает send back to revision action. Применение: используется внутри функции RepositoryPage. */
  const openSendBackToRevisionAction = () => {
    if (!selectedDocument) {
      return;
    }

    if (selectedDocument.documentStatus === 'needs_revision') {
      setMessageModal({
        title: 'Документ уже на доработке',
        message: 'Документ уже находится в статусе "На доработке".',
        variant: 'info',
        confirmText: 'Понятно',
      });
      return;
    }

    setRevisionCommentDraft(selectedDocument.meta.revisionComment || '');
    setSendBackModalOpen(true);
  };

    /* Делает: Подтверждает доработку send back to. Применение: используется внутри функции RepositoryPage. */
  const confirmSendBackToRevision = () => {
    setSendBackModalOpen(false);
    void sendSelectedDocumentToRevision(revisionCommentDraft);
  };

    /* Делает: Открывает crossref confirmation action. Применение: используется внутри функции RepositoryPage. */
  const openCrossrefConfirmationAction = () => {
    if (!selectedDocument) {
      return;
    }

    if (selectedDocument.documentStatus === 'verified') {
      setMessageModal({
        title: 'Документ уже опубликован',
        message: 'Для этого документа подтверждение Crossref уже выполнено.',
        variant: 'info',
        confirmText: 'Понятно',
      });
      return;
    }

    setCrossrefConfirmationDraft('');
    setCrossrefConfirmationModalOpen(true);
  };

    /* Делает: Подтверждает crossref publication action. Применение: используется внутри функции RepositoryPage. */
  const confirmCrossrefPublicationAction = () => {
    void confirmSelectedDocumentCrossrefPublication(crossrefConfirmationDraft);
  };

    /* Делает: Открывает crossref deposit action. Применение: используется внутри функции RepositoryPage. */
  const openCrossrefDepositAction = () => {
    if (!selectedDocument) {
      return;
    }

    setActionModal({
      title: selectedDocument.documentStatus === 'verified' ? 'Повторно отправить XML в Crossref' : 'Отправить XML в Crossref',
      message:
        selectedDocument.documentStatus === 'verified'
          ? `Повторно отправить XML документа "${selectedDocument.name}" в Crossref? Статус документа останется "${getDocumentStatusLabel('verified')}".`
          : `Отправить XML документа "${selectedDocument.name}" в Crossref? После успешной отправки документ останется в статусе "${getDocumentStatusLabel('under_review')}" до подтверждения письмом от Crossref.`,
      variant: 'warning',
      confirmText: selectedDocument.documentStatus === 'verified' ? 'Отправить повторно' : 'Отправить',
            /* Делает: Выполняет on confirm. Применение: используется внутри функции openCrossrefDepositAction. */
      onConfirm: () => {
        setActionModal(null);
        void depositSelectedDocumentToCrossref();
      },
    });
  };

    /* Делает: Выполняет блок add. Применение: используется внутри функции RepositoryPage. */
  const addBlock = (type: RepositoryBlockType) => {
    setDraftBlocks(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setDraftBlocks внутри addBlock. */ (current) => [...current, createEmptyBlock(type)]);
  };

    /* Делает: Выполняет insert block at. Применение: используется внутри функции RepositoryPage. */
  const insertBlockAt = (index: number, type: RepositoryBlockType) => {
    setDraftBlocks(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setDraftBlocks внутри insertBlockAt. */ (current) => {
      const next = [...current];
      next.splice(index, 0, createEmptyBlock(type));
      return next;
    });
    setDraftMeta(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setDraftMeta внутри insertBlockAt. */ (current) => ({
      ...current,
      position: index <= (current.position ?? 0) ? (current.position ?? 0) + 1 : current.position ?? 0,
    }));
  };

    /* Делает: Обновляет блок. Применение: используется внутри функции RepositoryPage. */
  const updateBlock = (blockId: string, updates: Partial<RepositoryBlock>) => {
    setDraftBlocks(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setDraftBlocks внутри updateBlock. */ (current) => current.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри setDraftBlocksCallback. */ (block) => (block.id === blockId ? { ...block, ...updates } : block)));
  };

    /* Делает: Обновляет подпись файлового блока. Применение: используется внутри функции RepositoryPage. */
  const updateFileBlockLabel = (block: RepositoryBlock, value: string) => {
    updateBlock(block.id, { label: normalizeEditableFileLabel(value, block) });
  };

    /* Делает: Обновляет URL файлового блока исходного. Применение: используется внутри функции RepositoryPage. */
  const updateFileBlockSourceUrl = (block: RepositoryBlock, value: string) => {
    if (isFileSourceInputDisabled(block)) {
      return;
    }

    const sourceUrl = value.trim();
    const staleUploadUrl = sourceUrl ? getDisposableManagedUploadUrl(block) : '';
    const updates: Partial<RepositoryBlock> = { sourceUrl };
    if (sourceUrl) {
      updates.url = '';
      if (!String(block.label || '').trim()) {
        updates.label = getFileNameStem(sourceUrl) || block.label || '';
      }
    }

    updateBlock(block.id, updates);
    if (staleUploadUrl) {
      void cleanupObsoleteManagedUpload(staleUploadUrl);
    }
  };

    /* Делает: Удаляет блок. Применение: используется внутри функции RepositoryPage. */
  const deleteBlock = (blockId: string) => {
    const blockIndex = draftBlocks.findIndex(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в findIndex внутри deleteBlock. */ (block) => block.id === blockId);
    const blockToDelete = draftBlocks.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри deleteBlock. */ (block) => block.id === blockId) || null;
    const staleUploadUrl = blockToDelete ? getDisposableManagedUploadUrl(blockToDelete) : '';
    clearPendingBlockUpload(blockId);
    setDraftBlocks(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setDraftBlocks внутри deleteBlock. */ (current) => current.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри setDraftBlocksCallback. */ (block) => block.id !== blockId));
    if (staleUploadUrl) {
      void cleanupObsoleteManagedUpload(staleUploadUrl);
    }
    if (blockIndex !== -1) {
      setDraftMeta(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setDraftMeta внутри deleteBlock. */ (current) => ({
        ...current,
        position:
          blockIndex < (current.position ?? 0)
            ? Math.max(0, (current.position ?? 0) - 1)
            : Math.min(current.position ?? 0, draftBlocks.length - 1),
      }));
    }
  };

    /* Делает: Выполняет блок move. Применение: используется внутри функции RepositoryPage. */
  const moveBlock = (blockId: string, targetIndex: number) => {
    setDraftBlocks(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setDraftBlocks внутри moveBlock. */ (current) => {
      const sourceIndex = current.findIndex(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в findIndex внутри setDraftBlocksCallback. */ (block) => block.id === blockId);
      if (sourceIndex === -1) {
        return current;
      }

      const next = [...current];
      const [movedBlock] = next.splice(sourceIndex, 1);
      const normalizedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      next.splice(normalizedTargetIndex, 0, movedBlock);
      return next;
    });
  };

    /* Делает: Определяет точку входа автора справочника for. Применение: используется внутри функции RepositoryPage. */
  const resolveAuthorReferenceForEntry = (entry: RepositoryAuthorEntry) =>
    findAuthorReferenceById(referenceAuthors, entry.referenceAuthorId) ||
    findAuthorReferenceByNames(referenceAuthors, entry.authorRu, entry.authorEn);

    /* Делает: Определяет точку входа организации справочника for. Применение: используется внутри функции RepositoryPage. */
  const resolveOrganizationReferenceForEntry = (entry: RepositoryAuthorEntry) =>
    findOrganizationReferenceById(referenceOrganizations, entry.referenceOrganizationId) ||
    findOrganizationReferenceByNames(referenceOrganizations, entry.organizationRu, entry.organizationEn);

    /* Делает: Синхронизирует метаданные автора entries to. Применение: используется внутри функции RepositoryPage. */
  const syncAuthorEntriesToMeta = (entries: RepositoryAuthorEntry[]) => {
    const normalizedEntries = entries.length > 0 ? entries : [createEmptyAuthorEntry()];
    const authorMeta = composeMetaAuthorsFromEntries(normalizedEntries);
    setAuthorEntries(normalizedEntries);
    setDraftMeta(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setDraftMeta внутри syncAuthorEntriesToMeta. */ (current) => ({
      ...current,
      ...authorMeta,
      authorEntries: normalizedEntries,
    }));
  };

    /* Делает: Выполняет точку входа patch автора. Применение: используется внутри функции RepositoryPage. */
  const patchAuthorEntry = (entryId: string, patch: (entry: RepositoryAuthorEntry) => RepositoryAuthorEntry) => {
    syncAuthorEntriesToMeta(authorEntries.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри patchAuthorEntry. */ (entry) => (entry.id === entryId ? patch(entry) : entry)));
  };

    /* Делает: Выполняет точку входа add автора. Применение: используется внутри функции RepositoryPage. */
  const addAuthorEntry = () => {
    syncAuthorEntriesToMeta([...authorEntries, createEmptyAuthorEntry()]);
  };

    /* Делает: Выполняет apply author reference selection. Применение: используется внутри функции RepositoryPage. */
  const applyAuthorReferenceSelection = (entryId: string, authorIdValue: string) => {
    const selectedAuthor = findAuthorReferenceById(referenceAuthors, Number(authorIdValue));
    if (!selectedAuthor) {
      patchAuthorEntry(entryId, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в patchAuthorEntry внутри applyAuthorReferenceSelection. */ (entry) => ({
        ...entry,
        authorRu: '',
        authorEn: '',
        referenceAuthorId: null,
      }));
      return;
    }

    patchAuthorEntry(entryId, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в patchAuthorEntry внутри applyAuthorReferenceSelection. */ (entry) => {
      const linkedOrganization =
        selectedAuthor.organizations.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри patchAuthorEntryCallback. */ (organization) => organization.id === entry.referenceOrganizationId) ||
        selectedAuthor.organizations.find(
          /* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри patchAuthorEntryCallback. */ (organization) =>
            organization.name_ru.trim().toLowerCase() === entry.organizationRu.trim().toLowerCase() ||
            String(organization.name_en || '').trim().toLowerCase() === entry.organizationEn.trim().toLowerCase() ||
            String(organization.full_name_ru || '').trim().toLowerCase() === String(entry.organizationFullRu || '').trim().toLowerCase() ||
            String(organization.full_name_en || '').trim().toLowerCase() === String(entry.organizationFullEn || '').trim().toLowerCase()
        ) ||
        selectedAuthor.organizations[0] ||
        null;

      return {
        ...entry,
        authorRu: selectedAuthor.name_ru,
        authorEn: selectedAuthor.name_en,
        organizationRu: linkedOrganization?.name_ru || entry.organizationRu,
        organizationEn: linkedOrganization?.name_en || entry.organizationEn,
        organizationFullRu: linkedOrganization?.full_name_ru || linkedOrganization?.name_ru || entry.organizationFullRu || entry.organizationRu,
        organizationFullEn: linkedOrganization?.full_name_en || linkedOrganization?.name_en || entry.organizationFullEn || entry.organizationEn,
        referenceAuthorId: selectedAuthor.id,
        referenceOrganizationId: linkedOrganization?.id ?? entry.referenceOrganizationId ?? null,
      };
    });
  };

    /* Делает: Выполняет apply organization reference selection. Применение: используется внутри функции RepositoryPage. */
  const applyOrganizationReferenceSelection = (entryId: string, organizationIdValue: string) => {
    const selectedOrganization = findOrganizationReferenceById(referenceOrganizations, Number(organizationIdValue));
    if (!selectedOrganization) {
      patchAuthorEntry(entryId, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в patchAuthorEntry внутри applyOrganizationReferenceSelection. */ (entry) => ({
        ...entry,
        organizationRu: '',
        organizationEn: '',
        organizationFullRu: '',
        organizationFullEn: '',
        referenceOrganizationId: null,
      }));
      return;
    }

    patchAuthorEntry(entryId, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в patchAuthorEntry внутри applyOrganizationReferenceSelection. */ (entry) => ({
      ...entry,
      organizationRu: selectedOrganization.name_ru,
      organizationEn: selectedOrganization.name_en || '',
      organizationFullRu: selectedOrganization.full_name_ru || selectedOrganization.name_ru,
      organizationFullEn: selectedOrganization.full_name_en || selectedOrganization.name_en || '',
      referenceOrganizationId: selectedOrganization.id,
    }));
  };

    /* Делает: Обновляет точку входа автора. Применение: используется внутри функции RepositoryPage. */
  const updateAuthorEntry = (
    entryId: string,
    field: 'authorRu' | 'authorEn' | 'organizationRu' | 'organizationEn' | 'organizationFullRu' | 'organizationFullEn',
    value: string
  ) => {
    patchAuthorEntry(entryId, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в patchAuthorEntry внутри updateAuthorEntry. */ (entry) => ({
      ...entry,
      [field]: value,
      referenceAuthorId: field === 'authorRu' || field === 'authorEn' ? null : entry.referenceAuthorId ?? null,
      referenceOrganizationId:
        field === 'organizationRu' || field === 'organizationEn' || field === 'organizationFullRu' || field === 'organizationFullEn'
          ? null
          : entry.referenceOrganizationId ?? null,
    }));
  };

    /* Делает: Удаляет точку входа автора. Применение: используется внутри функции RepositoryPage. */
  const removeAuthorEntry = (entryId: string) => {
    syncAuthorEntriesToMeta(authorEntries.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри removeAuthorEntry. */ (entry) => entry.id !== entryId));
  };

    /* Делает: Открывает модальное окно автора запроса. Применение: используется внутри функции RepositoryPage. */
  const openAuthorRequestModal = (entry: RepositoryAuthorEntry) => {
    const organizationReference = resolveOrganizationReferenceForEntry(entry);
    setAuthorRequestModal({
      entryId: entry.id,
      nameRu: entry.authorRu,
      nameEn: entry.authorEn,
      organizationId: organizationReference ? String(organizationReference.id) : '',
    });
  };

    /* Делает: Открывает модальное окно организации запроса. Применение: используется внутри функции RepositoryPage. */
  const openOrganizationRequestModal = (entry: RepositoryAuthorEntry) => {
    setOrganizationRequestModal({
      entryId: entry.id,
      nameRu: entry.organizationRu,
      nameEn: entry.organizationEn,
      fullNameRu: entry.organizationFullRu || '',
      fullNameEn: entry.organizationFullEn || '',
    });
  };

    /* Делает: Открывает модальное окно информации. Применение: используется внутри функции RepositoryPage. */
  const openInfoModal = (
    title: string,
    message: string,
    variant: 'danger' | 'warning' | 'info' | 'success' = 'info'
  ) => {
    setMessageModal({
      title,
      message,
      variant,
      confirmText: 'Понятно',
    });
  };

    /* Делает: Отправляет запрос автора. Применение: используется внутри функции RepositoryPage. */
  const submitAuthorRequest = async () => {
    if (!authorRequestModal) {
      return;
    }

    const nameRu = authorRequestModal.nameRu.trim();
    const nameEn = authorRequestModal.nameEn.trim();
    const organizationId = authorRequestModal.organizationId ? Number(authorRequestModal.organizationId) : null;

    if (!nameRu || !nameEn) {
      setMessageModal({
        title: 'Недостаточно данных',
        message: 'Укажите автора на русском и английском языках перед отправкой заявки.',
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    try {
      const result = await repositoryReferenceService.requestAuthor({
        nameRu,
        nameEn,
        organizationId,
      });

      const refreshedAuthors = await repositoryReferenceService.getAuthors();
      setReferenceAuthors(refreshedAuthors);

      const selectedOrganization = organizationId
        ? findOrganizationReferenceById(referenceOrganizations, organizationId)
        : null;
      const approvedAuthor = result.author?.status === 'approved' ? result.author : null;

      patchAuthorEntry(authorRequestModal.entryId, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в patchAuthorEntry внутри submitAuthorRequest. */ (entry) => ({
        ...(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в внешний вызов внутри patchAuthorEntryCallback. */ () => {
          const linkedOrganization =
            approvedAuthor?.organizations.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри callback. */ (organization) => organization.id === selectedOrganization?.id) ||
            approvedAuthor?.organizations[0] ||
            null;

          return {
            ...entry,
            authorRu: approvedAuthor?.name_ru || nameRu,
            authorEn: approvedAuthor?.name_en || nameEn,
            organizationRu: linkedOrganization?.name_ru || selectedOrganization?.name_ru || entry.organizationRu,
            organizationEn: linkedOrganization?.name_en || selectedOrganization?.name_en || entry.organizationEn,
            organizationFullRu:
              linkedOrganization?.full_name_ru ||
              selectedOrganization?.full_name_ru ||
              linkedOrganization?.name_ru ||
              selectedOrganization?.name_ru ||
              entry.organizationFullRu ||
              entry.organizationRu,
            organizationFullEn:
              linkedOrganization?.full_name_en ||
              selectedOrganization?.full_name_en ||
              linkedOrganization?.name_en ||
              selectedOrganization?.name_en ||
              entry.organizationFullEn ||
              entry.organizationEn,
            referenceAuthorId: approvedAuthor?.id ?? null,
            referenceOrganizationId: linkedOrganization?.id ?? selectedOrganization?.id ?? entry.referenceOrganizationId ?? null,
          };
        })(),
      }));

      setAuthorRequestModal(null);
      setMessageModal({
        title: result.author?.status === 'approved' ? 'Автор найден' : 'Заявка отправлена',
        message: result.message,
        variant: 'success',
        confirmText: 'Понятно',
      });
    } catch (error) {
      setMessageModal({
        title: 'Не удалось отправить заявку',
        message: error instanceof Error ? error.message : 'Не удалось отправить заявку на автора.',
        variant: 'danger',
        confirmText: 'Закрыть',
      });
    }
  };

    /* Делает: Отправляет запрос организации. Применение: используется внутри функции RepositoryPage. */
  const submitOrganizationRequest = async () => {
    if (!organizationRequestModal) {
      return;
    }

    const nameRu = organizationRequestModal.nameRu.trim();
    const nameEn = organizationRequestModal.nameEn.trim();
    const fullNameRu = organizationRequestModal.fullNameRu.trim();
    const fullNameEn = organizationRequestModal.fullNameEn.trim();

    if (!nameRu) {
      setMessageModal({
        title: 'Недостаточно данных',
        message: 'Укажите организацию на русском языке перед отправкой заявки.',
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    try {
      const result = await repositoryReferenceService.requestOrganization({
        nameRu,
        nameEn,
        fullNameRu,
        fullNameEn,
        requesterName: repositoryUser?.full_name || repositoryUser?.name || '',
        requesterEmail: repositoryUser?.email || '',
      });

      const refreshedOrganizations = await repositoryReferenceService.getOrganizations();
      setReferenceOrganizations(refreshedOrganizations);

      patchAuthorEntry(organizationRequestModal.entryId, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в patchAuthorEntry внутри submitOrganizationRequest. */ (entry) => ({
        ...entry,
        organizationRu: result.organization?.name_ru || nameRu,
        organizationEn: result.organization?.name_en || nameEn,
        organizationFullRu: result.organization?.full_name_ru || fullNameRu || result.organization?.name_ru || nameRu,
        organizationFullEn: result.organization?.full_name_en || fullNameEn || result.organization?.name_en || nameEn,
        referenceOrganizationId: result.organization?.status === 'approved' ? result.organization.id : null,
      }));

      setOrganizationRequestModal(null);
      setMessageModal({
        title: result.organization?.status === 'approved' ? 'Организация найдена' : 'Заявка отправлена',
        message: result.message,
        variant: 'success',
        confirmText: 'Понятно',
      });
    } catch (error) {
      setMessageModal({
        title: 'Не удалось отправить заявку',
        message: error instanceof Error ? error.message : 'Не удалось отправить заявку на организацию.',
        variant: 'danger',
        confirmText: 'Закрыть',
      });
    }
  };

    /* Делает: Обновляет поле метаданных. Применение: используется внутри функции RepositoryPage. */
  const updateMetaField = (field: keyof RepositoryDocumentMeta, value: string) => {
    setDraftMeta(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setDraftMeta внутри updateMetaField. */ (current) => {
      if (field !== 'publicationDate') {
        return {
          ...current,
          [field]: value,
        };
      }

      const previousParts = extractPublicationDateParts(current.publicationDate);
      const nextParts = extractPublicationDateParts(value);

      return {
        ...current,
        publicationDate: value,
        publicationYear:
          !String(current.publicationYear || '').trim() || current.publicationYear === previousParts.year
            ? nextParts.year
            : current.publicationYear,
        volume:
          !String(current.volume || '').trim() || current.volume === previousParts.month
            ? nextParts.month
            : current.volume,
        articleNumber:
          !String(current.articleNumber || '').trim() || current.articleNumber === previousParts.day
            ? nextParts.day
            : current.articleNumber,
      };
    });
  };

    /* Делает: Обрабатывает drag start. Применение: используется внутри функции RepositoryPage. */
  const handleDragStart = (event: ReactDragEvent<HTMLButtonElement>, item: { kind: 'block'; blockId: string } | { kind: 'meta' }) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.dropEffect = 'move';
    event.dataTransfer.setData('text/plain', item.kind === 'meta' ? 'meta' : item.blockId);
    setDraggedItem(item);
  };

    /* Делает: Обрабатывает drop at. Применение: используется внутри функции RepositoryPage. */
  const handleDropAt = (targetIndex: number) => {
    if (!draggedItem) {
      return;
    }

    if (draggedItem.kind === 'meta') {
      setDraftMeta(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setDraftMeta внутри handleDropAt. */ (current) => ({
        ...current,
        position: targetIndex,
      }));
    } else {
      moveBlock(draggedItem.blockId, targetIndex);
    }

    setDraggedItem(null);
    setDropIndex(null);
  };

    /* Делает: Ставит в очередь block file selection. Применение: используется внутри функции RepositoryPage. */
  const queueBlockFileSelection = (block: RepositoryBlock, file: File | null) => {
    if (!file) {
      return;
    }

    const sourceUrl = getEffectiveFileSourceUrl(block);
    if (block.type === 'file' && sourceUrl) {
      setMessageModal({
        title: 'Выберите один способ загрузки',
        message: 'Для этого файла уже указана ссылка. Чтобы загрузить файл с компьютера, сначала очистите поле ссылки.',
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    if (block.type === 'image' && file.type && !file.type.startsWith('image/')) {
      setMessageModal({
        title: 'Неверный тип файла',
        message: 'Для блока изображения можно выбрать только изображение.',
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    const normalizedLabel = String(block.label || '').trim() || getFileNameStem(file.name) || file.name;
    if (block.type === 'file' && !String(block.label || '').trim()) {
      updateBlock(block.id, { label: normalizedLabel });
    }

    setPendingBlockUploads(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setPendingBlockUploads внутри queueBlockFileSelection. */ (current) => ({
      ...current,
      [block.id]: { file },
    }));
    setMessageModal({
      title:
        block.type === 'file' && block.url && isManagedRepositoryUploadUrl(block.url)
          ? 'Файл будет заменён'
          : block.type === 'image'
            ? 'Изображение прикреплено'
            : 'Файл прикреплён',
      message:
        block.type === 'file' && block.url && isManagedRepositoryUploadUrl(block.url)
          ? `Вы выбрали новый файл "${file.name}". Он заменит текущий файл после сохранения документа.`
          : `Файл "${file.name}" будет загружен на сервер при сохранении документа.`,
      variant: 'info',
      confirmText: 'Понятно',
    });
  };

    /* Делает: Выполняет файлы загрузки ожидающего блока. Применение: используется внутри функции RepositoryPage. */
  const uploadPendingBlockFiles = async (
    blocks: RepositoryBlock[],
    options: {
      documentId: string;
      documentName: string;
      publicationDate: string;
    }
  ) => {
    const pendingEntries = blocks
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри uploadPendingBlockFiles. */ (block) => {
        const pendingUpload = getPendingBlockUpload(block.id);
        return pendingUpload ? { block, pendingUpload } : null;
      })
      .filter(Boolean) as Array<{ block: RepositoryBlock; pendingUpload: PendingBlockUpload }>;

    if (pendingEntries.length === 0) {
      return blocks;
    }

    const pendingIds = pendingEntries.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри uploadPendingBlockFiles. */ ({ block }) => block.id);
    setUploadingBlockIds(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setUploadingBlockIds внутри uploadPendingBlockFiles. */ (current) => [...new Set([...current, ...pendingIds])]);

    let nextBlocks = [...blocks];

    try {
      for (const { block, pendingUpload } of pendingEntries) {
        const { file } = pendingUpload;
        const staleUploadUrl = getDisposableManagedUploadUrl(block);
        const normalizedLabel = String(block.label || '').trim() || getFileNameStem(file.name) || file.name;
        const dataUrl = await readFileAsDataUrl(file);
        const blockOrder = Math.max(1, nextBlocks.findIndex(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в findIndex внутри uploadPendingBlockFiles. */ (draftBlock) => draftBlock.id === block.id) + 1);
        const upload = await repositoryService.uploadAsset(
          file.name,
          extractBase64Content(dataUrl),
          file.type || undefined,
          block.type === 'image' ? 'image' : 'file',
          {
            documentId: options.documentId,
            documentName: options.documentName || file.name,
            publicationDate: options.publicationDate || '',
            blockOrder,
            desiredName: block.type === 'file' ? normalizedLabel : undefined,
          }
        );

        const blockPatch: Partial<RepositoryBlock> = {
          url: upload.url,
          label:
            block.type === 'file'
              ? String(block.label || '').trim() || getFileNameStem(file.name) || getFileNameStem(upload.fileName) || upload.fileName
              : block.label,
          fileName: upload.fileName,
          fileSize: upload.fileSize ?? file.size,
          mimeType: upload.mimeType || file.type || undefined,
        };

        if (block.type === 'file') {
          blockPatch.sourceUrl = '';
        }

        nextBlocks = nextBlocks.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри uploadPendingBlockFiles. */ (draftBlock) =>
          draftBlock.id === block.id ? { ...draftBlock, ...blockPatch } : draftBlock
        );
        setDraftBlocks(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setDraftBlocks внутри uploadPendingBlockFiles. */ (current) =>
          current.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри setDraftBlocksCallback. */ (draftBlock) => (draftBlock.id === block.id ? { ...draftBlock, ...blockPatch } : draftBlock))
        );
        clearPendingBlockUpload(block.id);
        if (staleUploadUrl && staleUploadUrl !== upload.url) {
          void cleanupObsoleteManagedUpload(staleUploadUrl);
        }
      }

      return nextBlocks;
    } finally {
      setUploadingBlockIds(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setUploadingBlockIds внутри uploadPendingBlockFiles. */ (current) => current.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри setUploadingBlockIdsCallback. */ (id) => !pendingIds.includes(id)));
    }
  };

    /* Делает: Определяет файл single загрузки. Применение: используется внутри функции RepositoryPage. */
  const resolveSingleUploadFile = (files: FileList | null | undefined) => {
    if (!files || files.length === 0) {
      return null;
    }

    if (files.length > 1) {
      setMessageModal({
        title: 'Слишком много файлов',
        message:
          'Одно поле загрузки принимает только один файл за раз. Если нужно добавить несколько файлов, загрузите их по очереди или создайте отдельные файловые блоки.',
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return null;
    }

    return files[0];
  };

    /* Делает: Обрабатывает upload zone drag over. Применение: используется внутри функции RepositoryPage. */
  const handleUploadZoneDragOver = (
    event: ReactDragEvent<HTMLElement>,
    zoneId: string
  ) => {
    if (!Array.from(event.dataTransfer.types || []).includes('Files')) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (uploadDropTargetId !== zoneId) {
      setUploadDropTargetId(zoneId);
    }
  };

    /* Делает: Обрабатывает upload zone drag leave. Применение: используется внутри функции RepositoryPage. */
  const handleUploadZoneDragLeave = (
    event: ReactDragEvent<HTMLElement>,
    zoneId: string
  ) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    if (uploadDropTargetId === zoneId) {
      setUploadDropTargetId(null);
    }
  };

    /* Делает: Обрабатывает upload zone drop. Применение: используется внутри функции RepositoryPage. */
  const handleUploadZoneDrop = (
    event: ReactDragEvent<HTMLElement>,
    block: RepositoryBlock,
    zoneId: string
  ) => {
    event.preventDefault();
    if (uploadDropTargetId === zoneId) {
      setUploadDropTargetId(null);
    }

    const file = resolveSingleUploadFile(event.dataTransfer.files);
    if (!file) {
      return;
    }

    if (block.type === 'image' && file.type && !file.type.startsWith('image/')) {
      setMessageModal({
        title: 'Неверный тип файла',
        message: 'Для блока изображения можно перетаскивать только изображения.',
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    queueBlockFileSelection(block, file);
  };

    /* Делает: Рендерит upload control. Применение: используется внутри функции RepositoryPage. */
  const renderUploadControl = (
    block: RepositoryBlock,
    label: string,
    zoneId: string,
    disabled = false
  ) => {
    const pendingUpload = getPendingBlockUpload(block.id);
    const attachedFileName = resolveBlockAttachedFileDisplayName(block);
    const uploadActionLabel = pendingUpload || attachedFileName ? 'Изменить файл' : 'Загрузить файл';

    return (
      <label
        className={`repository-page__upload ${uploadDropTargetId === zoneId ? 'is-dragover' : ''}${disabled ? ' is-disabled' : ''}`}
        onDragOver={/* Делает: Обрабатывает событие onDragOver в JSX-разметке. Применение: используется как inline-обработчик onDragOver внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => {
          if (!disabled) {
            handleUploadZoneDragOver(event, zoneId);
          }
        }}
        onDragLeave={/* Делает: Обрабатывает событие onDragLeave в JSX-разметке. Применение: используется как inline-обработчик onDragLeave внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => handleUploadZoneDragLeave(event, zoneId)}
        onDrop={/* Делает: Обрабатывает событие onDrop в JSX-разметке. Применение: используется как inline-обработчик onDrop внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => {
          if (!disabled) {
            handleUploadZoneDrop(event, block, zoneId);
          }
        }}
      >
        <span className='repository-page__upload-title'>
          <DocumentFieldLabel label={label} helpKey='fileUpload' />
        </span>
        <div className='repository-page__upload-row'>
          <span className='repository-page__upload-action'>{uploadActionLabel}</span>
          <span className='repository-page__upload-file'>
            {disabled ? 'Недоступно: указана ссылка' : attachedFileName || 'Файл не выбран'}
          </span>
        </div>
        <input
          type='file'
          accept={block.type === 'image' ? 'image/*' : undefined}
          disabled={disabled}
          onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => {
            queueBlockFileSelection(block, resolveSingleUploadFile(event.target.files));
            event.target.value = '';
          }}
        />
      </label>
    );
  };

  const metaPosition = Math.max(0, Math.min(draftMeta.position ?? 0, draftBlocks.length));
  const editorBlocks = getEditableContentBlocks(draftBlocks).map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryPage. */ (block) => ({
    block,
    actualIndex: draftBlocks.findIndex(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в findIndex внутри mapCallback. */ (draftBlock) => draftBlock.id === block.id),
  }));
  const visibleMetaPosition = draftBlocks
    .slice(0, metaPosition)
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри RepositoryPage. */ (block) => !isMetadataFileBlock(block)).length;

    /* Делает: Выполняет блок add метаданных файлового. Применение: используется внутри функции RepositoryPage. */
  const addMetaFileBlock = () => {
    setDraftBlocks(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setDraftBlocks внутри addMetaFileBlock. */ (current) => [...current, createEmptyBlock('file', 'meta')]);
  };

    /* Делает: Рендерит редактор метаданных. Применение: используется внутри функции RepositoryPage. */
  const renderMetaEditor = () => (
    <div
      className={`repository-page__meta-editor repository-page__meta-editor--draggable ${draggedItem?.kind === 'meta' ? 'is-dragging' : ''}`}
    >
      <label className='repository-page__publication-date-field'>
        <DocumentFieldLabel label='Дата публикации *' helpKey='publicationDate' />
        <input
          type='date'
          className='repository-page__input'
          value={draftMeta.publicationDate}
          onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateMetaField('publicationDate', event.target.value)}
        />
      </label>
      <div className='repository-page__meta-grid'>
        <label className='repository-page__field--wide'>
          <DocumentFieldLabel label='Тип документа *' helpKey='documentType' />
          <select
            className='repository-page__input'
            value={resolveDocumentClassification(draftMeta)}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => setDraftMeta(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (current) => applyDocumentClassification(current, event.target.value))}
          >
            {DOCUMENT_CLASSIFICATION_OPTIONS.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри renderMetaEditor. */ (option) => (
              <option key={option.value || 'empty'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className='repository-page__field--wide'>
          <DocumentFieldLabel label='Название материалов на русском языке *' helpKey='titleRu' />
          <input
            className='repository-page__input'
            value={draftName}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => setDraftName(event.target.value)}
          />
        </label>
        <label className='repository-page__field--wide'>
          <DocumentFieldLabel label='Название материалов на английском языке *' helpKey='titleEn' />
          <input
            className='repository-page__input'
            value={draftMeta.titleEn}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateMetaField('titleEn', event.target.value)}
          />
        </label>
        <div className='repository-page__authors'>
          <div className='repository-page__authors-head'>
            <h4><DocumentFieldLabel label='Сведения об авторах *' helpKey='authors' /></h4>
          </div>
          <div className='repository-page__authors-list'>
            {authorEntries.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри renderMetaEditor. */ (entry, index) => {
              const authorReference = resolveAuthorReferenceForEntry(entry);
              const organizationReference = resolveOrganizationReferenceForEntry(entry);

              return (
                <div key={entry.id} className='repository-page__author-row'>
                  <div className='repository-page__author-row-header'>
                    <strong>Автор {index + 1}</strong>
                    {authorEntries.length > 1 && (
                      <button type='button' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => removeAuthorEntry(entry.id)} className='repository-page__author-remove'>
                        Удалить
                      </button>
                    )}
                  </div>
                  <div className='repository-page__author-columns'>
                    <div className='repository-page__author-column'>
                      <label>
                        <DocumentFieldLabel label='Автор из справочника' helpKey='authorReference' />
                        <SearchableSelect
                          inputClassName='repository-page__input'
                          options={authorReferenceOptions}
                          value={authorReference ? String(authorReference.id) : ''}
                          onSelect={/* Делает: Обрабатывает событие onSelect в JSX-разметке. Применение: используется как inline-обработчик onSelect внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (value) => applyAuthorReferenceSelection(entry.id, value)}
                          placeholder='Поиск автора по имени или организации'
                          emptyText='Авторы по этому запросу не найдены'
                          disabled={referencesLoading}
                        />
                      </label>
                      <label>
                        <DocumentFieldLabel label='ФИО автора на русском языке *' helpKey='authorRu' />
                        <input
                          className='repository-page__input'
                          value={entry.authorRu}
                          onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateAuthorEntry(entry.id, 'authorRu', event.target.value)}
                          placeholder='Фамилия Имя Отчество'
                        />
                      </label>
                      <label>
                        <DocumentFieldLabel label='ФИО автора на английском языке *' helpKey='authorEn' />
                        <input
                          className='repository-page__input'
                          value={entry.authorEn}
                          onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateAuthorEntry(entry.id, 'authorEn', event.target.value)}
                          placeholder='Surname Name Patronymic'
                        />
                      </label>
                      <div className='repository-page__reference-actions'>
                        <button type='button' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => openAuthorRequestModal(entry)}>
                          Добавить автора в справочник
                        </button>
                      </div>
                    </div>
                    <div className='repository-page__author-column'>
                      <label>
                        <DocumentFieldLabel label='Организация из справочника' helpKey='organizationReference' />
                        <SearchableSelect
                          inputClassName='repository-page__input'
                          options={organizationReferenceOptions}
                          value={organizationReference ? String(organizationReference.id) : ''}
                          onSelect={/* Делает: Обрабатывает событие onSelect в JSX-разметке. Применение: используется как inline-обработчик onSelect внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (value) => applyOrganizationReferenceSelection(entry.id, value)}
                          placeholder='Поиск организации по названию'
                          emptyText='Организации по этому запросу не найдены'
                          disabled={referencesLoading}
                        />
                      </label>
                      <label>
                        <DocumentFieldLabel label='Сокращенное название организации на русском языке *' helpKey='organizationRu' />
                        <input
                          className='repository-page__input'
                          value={entry.organizationRu}
                          onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateAuthorEntry(entry.id, 'organizationRu', event.target.value)}
                          placeholder='Например: ФИЦ ЕГС РАН'
                        />
                      </label>
                      <label>
                        <DocumentFieldLabel label='Сокращенное название организации на английском языке *' helpKey='organizationEn' />
                        <input
                          className='repository-page__input'
                          value={entry.organizationEn}
                          onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateAuthorEntry(entry.id, 'organizationEn', event.target.value)}
                          placeholder='Например: GS RAS'
                        />
                      </label>
                      <label>
                        <DocumentFieldLabel label='Полное наименование организации на русском языке' helpKey='organizationFullRu' />
                        <input
                          className='repository-page__input'
                          value={entry.organizationFullRu || ''}
                          onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateAuthorEntry(entry.id, 'organizationFullRu', event.target.value)}
                          placeholder='Например: Федеральный исследовательский центр...'
                        />
                      </label>
                      <label>
                        <DocumentFieldLabel label='Полное наименование организации на английском языке' helpKey='organizationFullEn' />
                        <input
                          className='repository-page__input'
                          value={entry.organizationFullEn || ''}
                          onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateAuthorEntry(entry.id, 'organizationFullEn', event.target.value)}
                          placeholder='Например: Geophysical Survey of the Russian Academy of Sciences'
                        />
                      </label>
                      <div className='repository-page__reference-actions'>
                        <button type='button' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => openOrganizationRequestModal(entry)}>
                          Добавить организацию в справочник
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <button type='button' className='repository-page__author-add' onClick={addAuthorEntry}>
            Добавить автора
          </button>
        </div>
        <label>
          <DocumentFieldLabel label='Аннотация (краткое описание материалов) *' helpKey='annotation' />
          <textarea
            className='repository-page__textarea'
            rows={4}
            value={draftMeta.annotation}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateMetaField('annotation', event.target.value)}
          />
        </label>
        <label>
          <DocumentFieldLabel label='Аннотация на английском языке' helpKey='descriptionEn' />
          <textarea
            className='repository-page__textarea'
            rows={4}
            value={draftMeta.descriptionEn}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateMetaField('descriptionEn', event.target.value)}
          />
        </label>
        <label className='repository-page__field--wide'>
          <DocumentFieldLabel label='Связанные публикации' helpKey='bibliography' />
          <textarea
            className='repository-page__textarea'
            rows={4}
            value={draftMeta.bibliography || ''}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateMetaField('bibliography', event.target.value)}
          />
        </label>
        <div className='repository-page__meta-files'>
          <div className='repository-page__meta-files-head'>
            <h3><DocumentFieldLabel label='Файлы для загрузки' helpKey='files' /></h3>
            <button type='button' onClick={addMetaFileBlock}>
              Добавить файлы
            </button>
          </div>
          {metadataFileBlocks.length > 0 ? (
            <div className='repository-page__meta-files-list'>
              {metadataFileBlocks.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри renderMetaEditor. */ (block, fileIndex) => (
                <div key={block.id} className='repository-page__meta-file-card'>
                  <div className='repository-page__meta-file-card-head'>
                    <strong>Файл {fileIndex + 1}</strong>
                    <button type='button' className='repository-page__ghost-danger' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => deleteBlock(block.id)}>
                      Удалить
                    </button>
                  </div>
                  {renderUploadControl(
                    block,
                    'Прикрепить файл с компьютера',
                    `${block.id}-meta`,
                    Boolean(getEffectiveFileSourceUrl(block))
                  )}
                  <label>
                    <DocumentFieldLabel label='Название файла' helpKey='fileTitle' />
                    <input
                      className='repository-page__input'
                      value={block.label || ''}
                      onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateFileBlockLabel(block, event.target.value)}
                      placeholder='Название файла'
                    />
                  </label>
                  <label>
                    <DocumentFieldLabel label='Ссылка на файл' helpKey='fileSource' />
                    <input
                      className='repository-page__input'
                      value={getEffectiveFileSourceUrl(block)}
                      onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateFileBlockSourceUrl(block, event.target.value)}
                      placeholder={resolveFileSourcePlaceholder(block)}
                      disabled={isFileSourceInputDisabled(block)}
                    />
                  </label>
                  <div className='repository-page__meta-file-card-meta'>
                    <span>Имя: {resolveBlockAttachedFileDisplayName(block) || 'Не прикреплен'}</span>
                    <span>Размер: {formatFileSize(resolveBlockFileSize(block), 'Не указан')}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <label>
          <DocumentFieldLabel label='Наименование издания' helpKey='journal' />
          <select
            className='repository-page__input'
            value={draftMeta.journalCode}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateMetaField('journalCode', event.target.value)}
          >
            {JOURNAL_CODE_OPTIONS.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри renderMetaEditor. */ (option) => (
              <option key={option.value || 'empty'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className='repository-page__journal-row'>
          <label>
            <DocumentFieldLabel label='Год выпуска журнала' helpKey='publicationYear' />
            <input
              className='repository-page__input'
              value={draftPublicationYear}
              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateMetaField('publicationYear', event.target.value)}
              placeholder='2026'
            />
          </label>
          <label>
            <DocumentFieldLabel label='Том' helpKey='volume' />
            <input
              className='repository-page__input'
              value={draftMeta.volume}
              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateMetaField('volume', event.target.value)}
              placeholder='2'
            />
          </label>
          <label>
            <DocumentFieldLabel label='Номер статьи' helpKey='articleNumber' />
            <input
              className='repository-page__input'
              value={draftMeta.articleNumber}
              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateMetaField('articleNumber', event.target.value)}
              placeholder='02'
            />
          </label>
        </div>
        <label className='repository-page__field--wide'>
          <DocumentFieldLabel label='DOI' helpKey='doi' />
          <div className='repository-page__static-value'>
            {draftResolvedDoi || 'Сформируется автоматически'}
          </div>
        </label>
        <label className='repository-page__field--wide'>
          <DocumentFieldLabel label='Ссылка для цитирования' helpKey='citationRu' />
          <textarea
            className='repository-page__textarea'
            rows={4}
            value={draftCitationText}
            readOnly
            placeholder='Сформируется автоматически после генерации DOI.'
          />
        </label>
        <label className='repository-page__field--wide'>
          <DocumentFieldLabel label='Ссылка для цитирования на английском языке' helpKey='citationEn' />
          <textarea
            className='repository-page__textarea'
            rows={4}
            value={draftCitationTextEn}
            readOnly
            placeholder='Will be generated automatically after DOI assignment.'
          />
        </label>
        <label className='repository-page__field--wide'>
          <DocumentFieldLabel label='Crossref XML' helpKey='crossrefXml' />
          {draftMeta.xmlPath ? (
            <a
              className='repository-page__meta-link'
              href={buildVersionedFileUrl(
                draftMeta.xmlPath,
                selectedNode?.type === 'document' ? selectedNode.updatedAt : undefined
              )}
              target='_blank'
              rel='noreferrer'
            >
              Открыть Crossref XML
            </a>
          ) : (
            <div className='repository-page__static-value'>Сформируется после отправки на регистрацию</div>
          )}
        </label>
        <label className='repository-page__field--wide repository-page__license-field'>
          <DocumentFieldLabel label={`${REPOSITORY_LICENSE_LABEL} *`} helpKey='license' />
          <div className='repository-page__static-value'>
            {normalizeRepositoryLicense(draftMeta.license)}
          </div>
        </label>
      </div>
    </div>
  );

    /* Делает: Рендерит drop zone. Применение: используется внутри функции RepositoryPage. */
  const renderDropZone = (targetIndex: number, label: string) => {
    if (!draggedItem) {
      return null;
    }

    return (
    <div
      className={`repository-page__drop-zone ${dropIndex === targetIndex ? 'is-active' : ''}`}
      onDragOver={/* Делает: Обрабатывает событие onDragOver в JSX-разметке. Применение: используется как inline-обработчик onDragOver внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropIndex(targetIndex);
      }}
      onDragLeave={/* Делает: Обрабатывает событие onDragLeave в JSX-разметке. Применение: используется как inline-обработчик onDragLeave внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => {
        if (dropIndex === targetIndex) {
          setDropIndex(null);
        }
      }}
      onDrop={/* Делает: Обрабатывает событие onDrop в JSX-разметке. Применение: используется как inline-обработчик onDrop внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => {
        event.preventDefault();
        handleDropAt(targetIndex);
      }}
    >
      <span>{label}</span>
    </div>
    );
  };

    /* Делает: Рендерит редактор блока. Применение: используется внутри функции RepositoryPage. */
  const renderBlockEditor = (block: RepositoryBlock, actualIndex: number, visibleIndex: number) => (
    <div
      className={`repository-page__block-editor ${draggedItem?.kind === 'block' && draggedItem.blockId === block.id ? 'is-dragging' : ''}`}
    >
      <div className='repository-page__block-meta'>
        <div className='repository-page__block-heading'>
          <span className='repository-page__block-index'>{visibleIndex + 1}</span>
          <strong>{block.type}</strong>
        </div>
        <button type='button' className='repository-page__ghost-danger' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => deleteBlock(block.id)}>
          Удалить
        </button>
      </div>

      {block.type === 'text' ? (
        <label>
          <DocumentFieldLabel label='Текстовый блок' helpKey='contentBlock' />
          <textarea
            className='repository-page__textarea'
            rows={6}
            value={block.content || ''}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => updateBlock(block.id, { content: event.target.value })}
            placeholder='Текстовый блок'
          />
        </label>
      ) : (
        <>
          {(block.type === 'image' || block.type === 'file') &&
            renderUploadControl(
              block,
              block.type === 'image' ? 'Загрузить с компьютера' : 'Прикрепить файл с компьютера',
              `${block.id}-block`,
              block.type === 'file' && Boolean(getEffectiveFileSourceUrl(block))
            )}
          <label>
            <DocumentFieldLabel
              label={block.type === 'image' ? 'Подпись к изображению' : 'Название блока'}
              helpKey={block.type === 'file' ? 'fileTitle' : 'contentBlock'}
            />
            <input
              className='repository-page__input'
              value={block.label || ''}
              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => {
                if (block.type === 'file') {
                  updateFileBlockLabel(block, event.target.value);
                } else {
                  updateBlock(block.id, { label: event.target.value });
                }
              }}
              placeholder={block.type === 'image' ? 'Подпись к изображению' : 'Название блока'}
            />
          </label>
          <label>
            <DocumentFieldLabel
              label={block.type === 'image' ? 'URL изображения' : block.type === 'link' ? 'URL ссылки' : 'Ссылка на файл'}
              helpKey={block.type === 'file' ? 'fileSource' : 'contentBlock'}
            />
            <input
              className='repository-page__input'
              value={block.type === 'file' ? getEffectiveFileSourceUrl(block) : block.url || ''}
              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => {
                if (block.type === 'file') {
                  updateFileBlockSourceUrl(block, event.target.value);
                } else {
                  updateBlock(block.id, { url: event.target.value });
                }
              }}
              placeholder={block.type === 'image' ? 'URL изображения' : block.type === 'link' ? 'URL ссылки' : resolveFileSourcePlaceholder(block)}
              disabled={block.type === 'file' && isFileSourceInputDisabled(block)}
            />
          </label>
        </>
      )}
    </div>
  );

    /* Делает: Рендерит editor sequence. Применение: используется внутри функции RepositoryPage. */
  const renderEditorSequence = () => {
    const items = [];

    for (let visibleIndex = 0; visibleIndex <= editorBlocks.length; visibleIndex += 1) {
      const targetIndex =
        visibleIndex === editorBlocks.length ? draftBlocks.length : editorBlocks[visibleIndex].actualIndex;

      items.push(
        <div key={`drop-${targetIndex}-${visibleIndex}`} className='repository-page__block-wrapper'>
          {renderDropZone(
            targetIndex,
            visibleIndex === editorBlocks.length ? 'Переместить блок в конец' : 'Переместить блок сюда'
          )}
        </div>
      );

      if (visibleMetaPosition === visibleIndex) {
        items.push(
          <div key='meta-editor' className='repository-page__block-wrapper'>
            {renderMetaEditor()}
          </div>
        );
      }

      if (visibleIndex < editorBlocks.length) {
        items.push(
          <div key={editorBlocks[visibleIndex].block.id} className='repository-page__block-wrapper'>
            {renderBlockEditor(
              editorBlocks[visibleIndex].block,
              editorBlocks[visibleIndex].actualIndex,
              visibleIndex
            )}
          </div>
        );
      }
    }

    return items;
  };

    /* Делает: Рендерит viewer sequence. Применение: используется внутри функции RepositoryPage. */
  const renderViewerSequence = (document: RepositoryDocument) => {
    const visibleBlocks = document.blocks.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри renderViewerSequence. */ (block) => block.type !== 'file');

    return [
      <div key='meta-view'>
        {renderDocumentMeta({
          meta: document.meta,
          blocks: document.blocks,
          documentName: document.name,
          documentStatus: document.documentStatus || 'draft',
          searchQuery,
          canViewDocumentStatus: canViewSelectedDocumentStatus,
          updatedAt: document.updatedAt,
          referenceOrganizations,
        })}
      </div>,
      ...visibleBlocks.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри renderViewerSequence. */ (block) => renderBlock(block, searchQuery)),
    ];
  };

  return (
    <section className='repository-page'>
      <div className='repository-page__container'>
        {showWorkspaceHero && (
          isAddWorkspace || isEditWorkspace ? (
            <div className='repository-page__workspace-heading'>
              <h1>{isAddWorkspace ? 'Добавление материалов' : 'Редактирование материалов'}</h1>
              {isAddWorkspace && (
                <Link to='/repository/instruction' className='repository-page__instruction-button'>
                  Инструкция
                </Link>
              )}
            </div>
          ) : (
            <div className='repository-page__hero'>
              <div>
                {showSearch && (
                  <div className='repository-page__search'>
                    <input
                      type='search'
                      className='repository-page__search-input'
                      value={searchQuery}
                      onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => setSearchQuery(event.target.value)}
                      placeholder='Поиск по названию, DOI, типу документа и содержанию'
                    />
                    {normalizedSearchQuery && (
                      <div className='repository-page__search-results'>
                        {searchResults.length === 0 ? (
                          <div className='repository-page__search-empty'>Ничего не найдено.</div>
                        ) : (
                          searchResults.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryPage. */ ({ key, document, location, identity, snippet }) => (
                            <button
                              key={key}
                              type='button'
                              className='repository-page__search-result'
                              onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => handleSearchSelect(document.id)}
                            >
                              <strong>{highlightText(document.name, searchQuery)}</strong>
                              <span>{highlightText(location, searchQuery)}</span>
                              <span>{identity}</span>
                              <span>Статус: {getDocumentStatusLabel(document.documentStatus || 'draft')}</span>
                              <span>
                                Тип документа: {highlightText(getRecordTypeLabelRu(resolveDocumentClassification(document.meta)), searchQuery)}
                              </span>
                              {document.meta.doi && <span>DOI: {highlightText(document.meta.doi, searchQuery)}</span>}
                              {snippet && <em>{highlightText(snippet, searchQuery)}</em>}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        )}

        {!repository ? (
          <div className='repository-page__loading'>Загрузка структуры репозитория...</div>
        ) : (
          <div className={`repository-page__layout${showSidebar ? '' : ' repository-page__layout--single'}`}>
            {showSidebar && (
              <aside className='repository-page__sidebar'>
                <h2>Каталоги</h2>
                <div className='repository-page__tree'>
                  <button
                    type='button'
                    className={`repository-page__tree-link ${selectedId === repository.tree.id ? 'is-active' : ''}`}
                    onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => handleSelect(repository.tree)}
                  >
                    {repository.tree.name}
                  </button>
                  {repository.tree.children.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryPage. */ (node) => (
                    <TreeItem
                      key={node.id}
                      node={node}
                      selectedId={selectedId}
                      expandedDirectoryIds={expandedDirectoryIds}
                      onSelect={handleSelect}
                      onToggleDirectory={toggleDirectory}
                    />
                  ))}
                </div>
              </aside>
            )}

            <main className='repository-page__content'>
              {showDocumentPicker && (
                <div className='repository-page__compact-toolbar'>
                  <label>
                    Документ
                    <select
                      className='repository-page__select'
                      value={selectedId || ''}
                      onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => setSelectedId(event.target.value || null)}
                    >
                      <option value=''>Выберите документ</option>
                      {repository.documents.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryPage. */ (document) => (
                        <option key={document.id} value={document.id}>
                          {document.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {!selectedNode ? (
                <div className='repository-page__placeholder'>
                  {showSidebar ? 'Выберите каталог или документ слева.' : 'Выберите документ для просмотра и редактирования.'}
                </div>
              ) : (
                <>
                  <div className='repository-page__card'>
                    {selectedDocument && (
                      <div className='repository-page__card-header'>
                        <div className='repository-page__document-summary'>
                          <div className='repository-page__document-summary-main'>
                            <div className='repository-page__document-summary-type'>
                              <DocumentFieldLabel label='Тип документа' helpKey='documentType' />
                              <span className='repository-page__document-summary-type-value'>
                                {highlightText(selectedDocumentTypeLabel, searchQuery)}
                              </span>
                            </div>
                            <span className='repository-page__document-summary-doi'>
                              DOI: {highlightText(selectedDocumentDoiLabel, searchQuery)}
                            </span>
                          </div>
                          {canViewSelectedDocumentStatus && (
                            <div className='repository-page__document-status-block'>
                              <span className={`repository-page__document-status repository-page__document-status--${selectedDocumentStatusVariant}`}>
                                {selectedDocumentStatusLabel}
                              </span>
                              <span className='repository-page__document-status-publication-date'>
                                Дата публикации: {highlightText(selectedDocumentPublicationDateLabel, searchQuery)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {showSelectedDocumentWorkflowActions && selectedDocument && (
                        <div className='repository-page__workflow-actions'>
                          {isRepositoryAdmin && selectedDocument.documentStatus === 'under_review' && (
                            <button type='button' className='repository-page__workflow-button' onClick={openSendBackToRevisionAction} disabled={saving}>
                              Отправить на доработку
                            </button>
                          )}
                        </div>
                      )}

                      {canEditSelectedNode ? (
                        <div className='repository-page__editor'>
                          {isDocumentEditorSurface ? (
                            <div className='repository-page__blocks'>
                              {renderEditorSequence()}
                            </div>
                          ) : (
                            <button
                              type='button'
                              className='repository-page__workflow-button'
                              onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => openInfoModal(
                                'Создание документа',
                                'Используйте блок ниже для создания нового документа.'
                              )}
                            >
                              Как создать документ
                            </button>
                          )}

                          {selectedNode.type === 'document' && canSubmitSelectedDocumentForReview && (
                            <div className='repository-page__submit-consent'>
                              <label className='repository-page__submit-consent-label' htmlFor='repository-publication-consent'>
                                <input
                                  id='repository-publication-consent'
                                  type='checkbox'
                                  className='repository-page__submit-consent-checkbox'
                                  checked={publicationConsentConfirmed}
                                  onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => setPublicationConsentConfirmed(event.target.checked)}
                                  disabled={saving}
                                />
                                <span>
                                  <a
                                    href={AUTHOR_PUBLICATION_CONSENT_DOCUMENT_PATH}
                                    target='_blank'
                                    rel='noreferrer'
                                    className='repository-page__submit-consent-link'
                                    onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => {
                                      event.stopPropagation();
                                    }}
                                  >
                                    Я подтверждаю, что мною получены согласия от всех авторов на публикацию размещаемых материалов.
                                  </a>
                                </span>
                              </label>
                            </div>
                          )}

                          <div className='repository-page__actions'>
                            <button
                              type='button'
                              onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => void saveSelectedNode()}
                              disabled={
                                saving ||
                                uploadingBlockIds.length > 0
                              }
                            >
                              Сохранить
                            </button>
                            {selectedNode.type === 'document' && canSubmitSelectedDocumentForReview && (
                              <button type='button' onClick={openSubmitForReviewAction} disabled={saving}>
                                Отправить на регистрацию
                              </button>
                            )}
                            {isRepositoryAdmin &&
                              selectedNode.type === 'document' &&
                              (selectedDocument?.documentStatus === 'under_review' || draftMeta.xmlPath) && (
                              <button type='button' onClick={openCrossrefDepositAction} disabled={saving}>
                                Отправить XML в Crossref
                              </button>
                            )}
                            {isRepositoryAdmin &&
                              selectedNode.type === 'document' &&
                              selectedDocument?.documentStatus === 'under_review' && (
                              <button type='button' onClick={openCrossrefConfirmationAction} disabled={saving}>
                                Подтвердить письмо Crossref
                              </button>
                            )}
                            {selectedNode.type === 'document' && canDeleteSelectedDocument && (
                              <button type='button' className='is-danger' onClick={openDeleteModal} disabled={saving}>
                                Удалить
                              </button>
                            )}
                          </div>
                        </div>
                      ) : selectedNode.type === 'document' ? (
                        <article className='repository-page__document'>
                          <div className='repository-page__rendered-document'>
                            {renderViewerSequence(selectedNode)}
                          </div>
                          {!isEditWorkspace && canOpenSelectedDocumentInEditMode && (
                            <div className='repository-page__document-bottom-actions'>
                              <Link
                                to={buildEditDocumentPath(selectedNode.id)}
                                className='repository-page__workflow-button'
                              >
                                Перейти к редактированию
                              </Link>
                            </div>
                          )}
                        </article>
                      ) : (
                        <div className='repository-page__document'>
                          <h2>{highlightText(selectedNode.name, searchQuery)}</h2>
                          <p>
                            {canEditRepository
                              ? 'Откройте вложенный документ или добавьте в каталог новые материалы.'
                              : 'Откройте вложенный документ для просмотра содержимого.'}
                          </p>
                        </div>
                      )}
                    </div>
                </>
              )}
            </main>
          </div>
        )}
      </div>
      <ConfirmModal
        isOpen={navigationBlocker.state === 'blocked'}
        title='Есть несохранённые изменения'
        message='Вы изменили поля документа, но ещё не нажали «Сохранить». Сохранить изменения перед переходом?'
        variant='warning'
        confirmText={saving ? 'Сохранение...' : 'Сохранить и перейти'}
        secondaryText='Перейти без сохранения'
        cancelText='Остаться'
        onConfirm={/* Делает: Обрабатывает событие onConfirm в JSX-разметке. Применение: используется как inline-обработчик onConfirm внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => {
          void saveUnsavedDocumentChangesAndContinue();
        }}
        onSecondary={discardUnsavedDocumentChangesAndContinue}
        onCancel={stayOnDocumentEditor}
      />
      <ConfirmModal
        isOpen={Boolean(actionModal)}
        title={actionModal?.title || ''}
        message={actionModal?.message || ''}
        variant={actionModal?.variant || 'info'}
        confirmText={actionModal?.confirmText || 'Подтвердить'}
        cancelText={actionModal?.cancelText || 'Отмена'}
        onConfirm={actionModal?.onConfirm || (/* Делает: Обрабатывает событие onConfirm в JSX-разметке. Применение: используется как inline-обработчик onConfirm внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => {})}
        onCancel={/* Делает: Обрабатывает событие onCancel в JSX-разметке. Применение: используется как inline-обработчик onCancel внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => {
          const onCancel = actionModal?.onCancel;
          setActionModal(null);
          onCancel?.();
        }}
      />
      <ConfirmModal
        isOpen={sendBackModalOpen}
        title='Отправить на доработку'
        message={selectedDocument ? `Отправить документ "${selectedDocument.name}" на доработку автору?` : ''}
        variant='warning'
        confirmText='Отправить'
        cancelText='Отмена'
        onConfirm={confirmSendBackToRevision}
        onCancel={/* Делает: Обрабатывает событие onCancel в JSX-разметке. Применение: используется как inline-обработчик onCancel внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => setSendBackModalOpen(false)}
      >
        <label className='repository-page__revision-comment-field'>
          <DocumentFieldLabel label='Комментарий для доработки' helpKey='revisionComment' />
          <textarea
            className='repository-page__textarea'
            value={revisionCommentDraft}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => setRevisionCommentDraft(event.target.value)}
            placeholder='Укажите замечания для автора документа'
            maxLength={2000}
          />
        </label>
      </ConfirmModal>
      <ConfirmModal
        isOpen={crossrefConfirmationModalOpen}
        title='Подтвердить письмо Crossref'
        message='Вставьте текст письма или XML-ответа от Crossref. Статус "Опубликован" будет выставлен только после подтверждения успешного создания DOI.'
        variant='info'
        confirmText='Подтвердить'
        cancelText='Отмена'
        onConfirm={confirmCrossrefPublicationAction}
        onCancel={/* Делает: Обрабатывает событие onCancel в JSX-разметке. Применение: используется как inline-обработчик onCancel внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => {
          setCrossrefConfirmationModalOpen(false);
          setCrossrefConfirmationDraft('');
        }}
      >
        <label className='repository-page__revision-comment-field'>
          <DocumentFieldLabel label='Письмо Crossref или XML' helpKey='crossrefXml' />
          <textarea
            className='repository-page__textarea'
            value={crossrefConfirmationDraft}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) => setCrossrefConfirmationDraft(event.target.value)}
            placeholder='Вставьте сюда письмо Crossref целиком или XML-ответ с тегами doi_batch_diagnostic / record_diagnostic'
            maxLength={20000}
          />
        </label>
      </ConfirmModal>
      <ConfirmModal
        isOpen={authorRequestModal !== null}
        title='Запрос на нового автора'
        message='Если автора нет в справочнике, отправьте заявку администратору. После одобрения он появится в выпадающем списке.'
        variant='info'
        confirmText='Отправить заявку'
        cancelText='Отмена'
        onConfirm={/* Делает: Обрабатывает событие onConfirm в JSX-разметке. Применение: используется как inline-обработчик onConfirm внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => {
          void submitAuthorRequest();
        }}
        onCancel={/* Делает: Обрабатывает событие onCancel в JSX-разметке. Применение: используется как inline-обработчик onCancel внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => setAuthorRequestModal(null)}
      >
        <div className='repository-page__author-request-fields'>
          <label>
            <DocumentFieldLabel label='Автор (RU)' helpKey='authorRu' />
            <input
              type='text'
              className='repository-page__input'
              placeholder='Автор (RU)'
              value={authorRequestModal?.nameRu || ''}
              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) =>
                setAuthorRequestModal(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (current) =>
                  current ? { ...current, nameRu: event.target.value } : current
                )
              }
            />
          </label>
          <label>
            <DocumentFieldLabel label='Автор (EN)' helpKey='authorEn' />
            <input
              type='text'
              className='repository-page__input'
              placeholder='Author (EN)'
              value={authorRequestModal?.nameEn || ''}
              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) =>
                setAuthorRequestModal(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (current) =>
                  current ? { ...current, nameEn: event.target.value } : current
                )
              }
            />
          </label>
          <label>
            <DocumentFieldLabel label='Организация' helpKey='organizationReference' />
            <SearchableSelect
              inputClassName='repository-page__input'
              options={organizationReferenceOptions}
              value={authorRequestModal?.organizationId || ''}
              onSelect={/* Делает: Обрабатывает событие onSelect в JSX-разметке. Применение: используется как inline-обработчик onSelect внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (value) =>
                setAuthorRequestModal(/* Делает: Обрабатывает событие onSelect в JSX-разметке. Применение: используется как inline-обработчик onSelect внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (current) =>
                  current ? { ...current, organizationId: value } : current
                )
              }
              placeholder='Организация не выбрана'
              emptyText='Организации по этому запросу не найдены'
            />
          </label>
        </div>
      </ConfirmModal>
      <ConfirmModal
        isOpen={organizationRequestModal !== null}
        title='Запрос на новую организацию'
        message='Если организации нет в справочнике, отправьте заявку администратору. После одобрения она появится в выпадающем списке.'
        variant='info'
        confirmText='Отправить заявку'
        cancelText='Отмена'
        onConfirm={/* Делает: Обрабатывает событие onConfirm в JSX-разметке. Применение: используется как inline-обработчик onConfirm внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => {
          void submitOrganizationRequest();
        }}
        onCancel={/* Делает: Обрабатывает событие onCancel в JSX-разметке. Применение: используется как inline-обработчик onCancel внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => setOrganizationRequestModal(null)}
      >
        <div className='repository-page__author-request-fields'>
          <label>
            <DocumentFieldLabel label='Сокращенное название (RU)' helpKey='organizationRu' />
            <input
            type='text'
            className='repository-page__input'
            placeholder='Сокращенное название (RU)'
            value={organizationRequestModal?.nameRu || ''}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) =>
              setOrganizationRequestModal(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (current) =>
                current
                  ? {
                      ...current,
                      nameRu: event.target.value,
                    }
                  : current
              )
            }
            />
          </label>
          <label>
            <DocumentFieldLabel label='Сокращенное название (EN)' helpKey='organizationEn' />
            <input
            type='text'
            className='repository-page__input'
            placeholder='Short name (EN)'
            value={organizationRequestModal?.nameEn || ''}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) =>
              setOrganizationRequestModal(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (current) =>
                current
                  ? {
                      ...current,
                      nameEn: event.target.value,
                    }
                  : current
              )
            }
            />
          </label>
          <label>
            <DocumentFieldLabel label='Полное наименование (RU)' helpKey='organizationFullRu' />
            <input
            type='text'
            className='repository-page__input'
            placeholder='Полное наименование (RU)'
            value={organizationRequestModal?.fullNameRu || ''}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) =>
              setOrganizationRequestModal(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (current) =>
                current
                  ? {
                      ...current,
                      fullNameRu: event.target.value,
                    }
                  : current
              )
            }
            />
          </label>
          <label>
            <DocumentFieldLabel label='Полное наименование (EN)' helpKey='organizationFullEn' />
            <input
            type='text'
            className='repository-page__input'
            placeholder='Full name (EN)'
            value={organizationRequestModal?.fullNameEn || ''}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (event) =>
              setOrganizationRequestModal(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ (current) =>
                current
                  ? {
                      ...current,
                      fullNameEn: event.target.value,
                    }
                  : current
              )
            }
            />
          </label>
        </div>
      </ConfirmModal>
      <ConfirmModal
        isOpen={deleteModalOpen}
        title='Подтвердите удаление'
        message={selectedNode ? `Вы действительно хотите удалить "${selectedNode.name}"? Это действие нельзя отменить.` : ''}
        variant='danger'
        confirmText='Удалить'
        cancelText='Отмена'
        onConfirm={confirmDeleteSelectedNode}
        onCancel={/* Делает: Обрабатывает событие onCancel в JSX-разметке. Применение: используется как inline-обработчик onCancel внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => setDeleteModalOpen(false)}
      />
      <ConfirmModal
        isOpen={Boolean(messageModal)}
        title={messageModal?.title || ''}
        message={messageModal?.message || ''}
        variant={messageModal?.variant || 'info'}
        confirmText={messageModal?.confirmText || 'Закрыть'}
        showCancel={false}
        onConfirm={/* Делает: Обрабатывает событие onConfirm в JSX-разметке. Применение: используется как inline-обработчик onConfirm внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => setMessageModal(null)}
        onCancel={/* Делает: Обрабатывает событие onCancel в JSX-разметке. Применение: используется как inline-обработчик onCancel внутри файла src/pages/RepositoryPage/RepositoryPage.tsx. */ () => setMessageModal(null)}
      />
    </section>
  );
}

export default RepositoryPage;
