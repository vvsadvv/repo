import { useEffect, useMemo, useState, type DragEvent as ReactDragEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';
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
import './RepositoryPage.scss';

function createEmptyBlock(type: RepositoryBlockType): RepositoryBlock {
  const id = `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return type === 'text' ? { id, type, content: '' } : { id, type, label: '', url: '' };
}

function createEmptyAuthorEntry(): RepositoryAuthorEntry {
  return {
    id: `author-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    authorRu: '',
    authorEn: '',
    organizationRu: '',
    organizationEn: '',
    referenceAuthorId: null,
    referenceOrganizationId: null,
  };
}

function splitMetaList(value?: string) {
  return String(value || '')
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractPublicationYear(publicationDate?: string) {
  const match = String(publicationDate || '')
    .trim()
    .match(/^(\d{4})/);
  return match?.[1] || '';
}

function normalizeDoiValue(doi?: string) {
  const normalized = String(doi || '').trim();
  if (!normalized) {
    return '';
  }

  return normalized
    .replace(/^https?:\/\/doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
}

function buildDoiUrl(doi?: string) {
  const normalized = normalizeDoiValue(doi);
  return normalized ? `https://doi.org/${normalized}` : '';
}

function getInitialsFromNameParts(parts: string[]) {
  return parts
    .flatMap((part) =>
      part
        .split('-')
        .map((segment) => segment.trim())
        .filter(Boolean)
        .map((segment) => {
          const firstLetter = segment.match(/[A-Za-zА-Яа-яЁё]/)?.[0];
          return firstLetter ? `${firstLetter.toUpperCase()}.` : '';
        })
        .filter(Boolean)
    )
    .join('');
}

function formatCitationAuthor(author: string, language: 'ru' | 'en' = 'ru') {
  const normalized = String(author || '').trim();
  if (!normalized) {
    return '';
  }

  const commaParts = normalized.split(',').map((part) => part.trim()).filter(Boolean);
  if (language === 'en') {
    if (commaParts.length === 2) {
      return `${commaParts[1]} ${commaParts[0]}`.trim();
    }

    return normalized.replace(/\s+/g, ' ');
  }

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

function buildDocumentCitation(
  meta: RepositoryDocumentMeta,
  documentName: string,
  language: 'ru' | 'en' = 'ru'
) {
  const authorsSource = Array.isArray(meta.authorEntries) && meta.authorEntries.length > 0
    ? meta.authorEntries
        .map((entry) => (language === 'en' ? entry.authorEn : entry.authorRu))
        .filter(Boolean)
        .join('; ')
    : language === 'en'
      ? meta.authorsEn
      : meta.authors;
  const authors = splitMetaList(authorsSource)
    .map((author) => formatCitationAuthor(author, language))
    .filter(Boolean)
    .join(', ');
  const publicationYear = extractPublicationYear(meta.publicationDate);
  const title = String(
    language === 'en'
      ? (meta.titleEn || documentName || '')
      : (documentName || '')
  ).trim();
  const doiUrl = buildDoiUrl(meta.doi);
  const repositoryLabel = language === 'en'
    ? 'Geophysical Data Repository, Geophysical Survey of the Russian Academy of Sciences, Obninsk,'
    : 'Репозиторий геофизических данных, ФИЦ ЕГС РАН, Обнинск,';
  const segments = [
    authors,
    publicationYear ? `(${publicationYear}).` : '',
    title ? `${title}.` : '',
    repositoryLabel,
    doiUrl,
  ].filter(Boolean);

  return segments.join(' ').trim();
}

function buildAuthorEntriesFromMeta(meta: RepositoryDocumentMeta): RepositoryAuthorEntry[] {
  const authorRuItems = splitMetaList(meta.authors);
  const authorEnItems = splitMetaList(meta.authorsEn);
  const organizationRuItems = splitMetaList(meta.organization);
  const organizationEnItems = splitMetaList(meta.organizationEn || meta.affiliations);
  const total = Math.max(authorRuItems.length, authorEnItems.length, organizationRuItems.length, organizationEnItems.length, 1);

  const useSharedOrganizationRu = organizationRuItems.length === 1;
  const useSharedOrganizationEn = organizationEnItems.length === 1;

  return Array.from({ length: total }, (_, index) => ({
    id: `author-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    authorRu: authorRuItems[index] || '',
    authorEn: authorEnItems[index] || '',
    organizationRu: useSharedOrganizationRu ? (organizationRuItems[0] || '') : (organizationRuItems[index] || ''),
    organizationEn: useSharedOrganizationEn ? (organizationEnItems[0] || '') : (organizationEnItems[index] || ''),
    referenceAuthorId: null,
    referenceOrganizationId: null,
  }));
}

function composeMetaAuthorsFromEntries(entries: RepositoryAuthorEntry[]) {
  const normalized = entries.map((entry) => ({
    authorRu: entry.authorRu.trim(),
    authorEn: entry.authorEn.trim(),
    organizationRu: entry.organizationRu.trim(),
    organizationEn: entry.organizationEn.trim(),
  }));

  return {
    authors: normalized.map((entry) => entry.authorRu).filter(Boolean).join('; '),
    authorsEn: normalized.map((entry) => entry.authorEn).filter(Boolean).join('; '),
    organization: normalized.map((entry) => entry.organizationRu).filter(Boolean).join('; '),
    organizationEn: normalized.map((entry) => entry.organizationEn).filter(Boolean).join('; '),
    affiliations: normalized.map((entry) => entry.organizationEn).filter(Boolean).join('; '),
  };
}

function normalizeAuthorEntries(authorEntries: unknown) {
  if (!Array.isArray(authorEntries)) {
    return [] as RepositoryAuthorEntry[];
  }

  return authorEntries
    .map((entry, index) => {
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
        referenceAuthorId: Number.isFinite(normalizedReferenceAuthorId) ? normalizedReferenceAuthorId : null,
        referenceOrganizationId: Number.isFinite(normalizedReferenceOrganizationId) ? normalizedReferenceOrganizationId : null,
      } satisfies RepositoryAuthorEntry;
    })
    .filter(Boolean) as RepositoryAuthorEntry[];
}

function resolveAuthorEntries(meta: RepositoryDocumentMeta) {
  const normalized = normalizeAuthorEntries(meta.authorEntries);
  if (normalized.length > 0) {
    return normalized;
  }

  return buildAuthorEntriesFromMeta(meta);
}

const CYRILLIC_REGEX = /[А-Яа-яЁё]/;
const LATIN_REGEX = /[A-Za-z]/;

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

function normalizeIdentity(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

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

function findAuthorReferenceById(authors: RepositoryAuthorReference[], authorId: number | null | undefined) {
  if (!authorId) {
    return null;
  }

  return authors.find((author) => author.id === authorId) || null;
}

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
      (author) =>
        author.name_ru.trim().toLowerCase() === normalizedRu &&
        author.name_en.trim().toLowerCase() === normalizedEn
    ) || null
  );
}

function findOrganizationReferenceById(
  organizations: RepositoryOrganizationReference[],
  organizationId: number | null | undefined
) {
  if (!organizationId) {
    return null;
  }

  return organizations.find((organization) => organization.id === organizationId) || null;
}

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
    organizations.find((organization) => {
      const organizationRu = organization.name_ru.trim().toLowerCase();
      const organizationEn = String(organization.name_en || '').trim().toLowerCase();
      return organizationRu === normalizedRu || (normalizedEn && organizationEn === normalizedEn);
    }) || null
  );
}

function createEmptyMeta(): RepositoryDocumentMeta {
  return {
    annotation: '',
    publicationDate: '',
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

const REPOSITORY_FILE_BASE = '';
const RECORD_TYPE_OPTIONS = [
  { value: '', label: 'Выберите тип записи' },
  { value: 'database', label: 'Database' },
  { value: 'dataset', label: 'Dataset' },
  { value: 'journal_article', label: 'Journal article' },
  { value: 'report', label: 'Report' },
  { value: 'component', label: 'Component' },
];

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
  'recordType',
  'journalCode',
  'volume',
  'articleNumber',
  'license',
] as const;

type RequiredMetaField = (typeof REQUIRED_META_FIELDS)[number];

const REQUIRED_META_FIELD_LABELS: Record<RequiredMetaField, string> = {
  annotation: 'Аннотация / Annotation',
  descriptionEn: 'Аннотация (EN) / Annotation (EN)',
  publicationDate: 'Дата публикации / Publication Date',
  authors: 'Авторы (RU) / Authors (RU)',
  authorsEn: 'Авторы (EN) / Authors (EN)',
  organization: 'Организация (RU) / Organization (RU)',
  organizationEn: 'Организация (EN) / Organization (EN)',
  documentType: 'Тип документа / Document Type',
  titleEn: 'Название (EN) / Title (EN)',
  recordType: 'Тип записи / Record Type',
  journalCode: 'Код издания / Journal Code',
  volume: 'Том / Volume',
  articleNumber: 'Номер статьи / Article Number',
  license: 'Лицензия / License',
};

function getMissingRequiredMetaFields(meta: RepositoryDocumentMeta): RequiredMetaField[] {
  return REQUIRED_META_FIELDS.filter((field) => !String(meta[field] ?? '').trim());
}

const DOCUMENT_STATUS_LABELS: Record<RepositoryDocumentStatus, string> = {
  needs_revision: 'На доработке',
  under_review: 'На проверке',
  verified: 'Проверенный',
};

const DOCUMENT_STATUS_VARIANTS: Record<RepositoryDocumentStatus, 'warning' | 'info' | 'success'> = {
  needs_revision: 'warning',
  under_review: 'info',
  verified: 'success',
};

function getDocumentStatusLabel(status: RepositoryDocumentStatus) {
  return DOCUMENT_STATUS_LABELS[status] || DOCUMENT_STATUS_LABELS.needs_revision;
}

function getDocumentStatusVariant(status: RepositoryDocumentStatus) {
  return DOCUMENT_STATUS_VARIANTS[status] || DOCUMENT_STATUS_VARIANTS.needs_revision;
}

function isDocumentLockedForEditor(status: RepositoryDocumentStatus) {
  return status === 'under_review' || status === 'verified';
}

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

function buildVersionedFileUrl(url?: string, version?: string) {
  const normalized = normalizeExternalUrl(url);
  if (normalized === '#' || !version) {
    return normalized;
  }

  const separator = normalized.includes('?') ? '&' : '?';
  return `${normalized}${separator}v=${encodeURIComponent(version)}`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

function extractBase64Content(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(',');
  return separatorIndex === -1 ? dataUrl : dataUrl.slice(separatorIndex + 1);
}

function getNodeIdFromHash() {
  return window.location.hash.replace(/^#/, '').trim();
}

function buildWorkspaceDocumentPath(documentId: string) {
  return `/repository/workspace#${documentId}`;
}

function buildEditDocumentPath(documentId: string) {
  return `/repository/edit#${documentId}`;
}

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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightText(text: string, query: string) {
  if (!query.trim() || !text) {
    return text;
  }

  const pattern = new RegExp(`(${escapeRegExp(query.trim())})`, 'gi');
  const parts = text.split(pattern);

  return parts.map((part, index) =>
    part.toLowerCase() === query.trim().toLowerCase() ? (
      <mark key={`${part}-${index}`} className='repository-page__highlight'>
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function getDocumentSearchSource(document: RepositoryResponse['documents'][number]) {
  const blockText = document.blocks
    .map((block) => [block.content, block.label, block.url, block.fileName].filter(Boolean).join(' '))
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
    ...document.blocks.map((block) => block.content || block.label || block.url || block.fileName || ''),
  ].filter(Boolean);

  const matchedText = candidates.find((item) => item.toLowerCase().includes(normalizedQuery));
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

function formatDocumentParentPath(document: RepositoryResponse['documents'][number]) {
  return document.parentPath.length > 0 ? document.parentPath.join(' / ') : 'Корневой каталог';
}

function formatSearchResultId(documentId: string) {
  return `ID: ${documentId.slice(0, 8)}`;
}

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
        {highlightText(block.label || block.url || 'Файл', searchQuery)}
      </a>
    </p>
  );
}

function renderDocumentMeta({
  meta,
  documentName,
  documentStatus,
  searchQuery = '',
  canViewRevisionComment = false,
  canViewDocumentStatus = true,
  updatedAt,
}: {
  meta: RepositoryDocumentMeta;
  documentName: string;
  documentStatus: RepositoryDocumentStatus;
  searchQuery?: string;
  canViewRevisionComment?: boolean;
  canViewDocumentStatus?: boolean;
  updatedAt?: string;
}) {
  const citationText = meta.citationLink || buildDocumentCitation(meta, documentName, 'ru');
  const citationTextEn = meta.citationLinkEn || buildDocumentCitation(meta, documentName, 'en');

  return (
    <>
      <section className='repository-page__meta-view'>
        <div className='repository-page__meta-item'>
          <h3>Аннотация / Annotation</h3>
          <p>{highlightText(meta.annotation || 'Не указана', searchQuery)}</p>
        </div>
        <div className='repository-page__meta-grid'>
          {canViewDocumentStatus && (
            <div className='repository-page__meta-item'>
              <h3>Статус документа / Document status</h3>
              <p>{getDocumentStatusLabel(documentStatus)}</p>
            </div>
          )}
          <div className='repository-page__meta-item'>
            <h3>Тип документа / Document type</h3>
            <p>{highlightText(meta.documentType || 'Не указан', searchQuery)}</p>
          </div>
          <div className='repository-page__meta-item'>
            <h3>Авторы / Authors</h3>
            <p>{highlightText(meta.authors || 'Не указаны', searchQuery)}</p>
          </div>
          <div className='repository-page__meta-item'>
            <h3>Организация / Organization</h3>
            <p>{highlightText(meta.organization || 'Не указана', searchQuery)}</p>
          </div>
          {canViewRevisionComment && (
            <div className='repository-page__meta-item'>
              <h3>Комментарий администратора / Admin comment</h3>
              <p>{highlightText(meta.revisionComment || 'Не указан', searchQuery)}</p>
              {meta.revisionCommentAuthor && (
                <p className='repository-page__muted'>
                  Автор: {meta.revisionCommentAuthor}
                  {meta.revisionCommentUpdatedAt ? `, ${new Date(meta.revisionCommentUpdatedAt).toLocaleString('ru-RU')}` : ''}
                </p>
              )}
            </div>
          )}
          <div className='repository-page__meta-item'>
            <h3>DOI</h3>
            <p>{highlightText(meta.doi || 'Не указан', searchQuery)}</p>
          </div>
          <div className='repository-page__meta-item'>
            <h3>Crossref XML</h3>
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
            <h3>Ссылка для цитирования</h3>
            <p>{highlightText(citationText || 'Сформируется после генерации DOI.', searchQuery)}</p>
          </div>
          <div className='repository-page__meta-item'>
            <h3>Лицензия / License</h3>
            <p>{highlightText(meta.license || 'Не указана', searchQuery)}</p>
          </div>
        </div>
      </section>

      <section className='repository-page__meta-view'>
        <div className='repository-page__meta-item'>
          <h3>Англоязычные метаданные / English metadata</h3>
          <p>{highlightText(meta.descriptionEn || 'Not specified', searchQuery)}</p>
        </div>
        <div className='repository-page__meta-grid'>
          <div className='repository-page__meta-item'>
            <h3>Title (EN)</h3>
            <p>{highlightText(meta.titleEn || 'Not specified', searchQuery)}</p>
          </div>
          <div className='repository-page__meta-item'>
            <h3>Authors (EN)</h3>
            <p>{highlightText(meta.authorsEn || 'Not specified', searchQuery)}</p>
          </div>
          <div className='repository-page__meta-item'>
            <h3>Organization (EN)</h3>
            <p>{highlightText(meta.organizationEn || 'Not specified', searchQuery)}</p>
          </div>
          <div className='repository-page__meta-item'>
            <h3>Affiliations</h3>
            <p>{highlightText(meta.affiliations || 'Not specified', searchQuery)}</p>
          </div>
          <div className='repository-page__meta-item'>
            <h3>Citation</h3>
            <p>{highlightText(citationTextEn || 'Will be generated after DOI assignment.', searchQuery)}</p>
          </div>
        </div>
      </section>
    </>
  );
}

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
        onClick={() => onSelect(node)}
      >
        {node.name}
      </button>
    );
  }

  return (
    <details className='repository-page__group' open={expandedDirectoryIds.includes(node.id)}>
      <summary
        className={`repository-page__group-title ${selectedId === node.id ? 'is-active' : ''}`}
        onClick={(event) => {
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
          node.children.map((child) => (
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

function RepositoryPage({ workspaceMode = 'full' }: RepositoryPageProps) {
  const location = useLocation();
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
  const [newDocumentName, setNewDocumentName] = useState('');
  const [newDocumentType, setNewDocumentType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingBlockIds, setUploadingBlockIds] = useState<string[]>([]);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [actionModal, setActionModal] = useState<null | {
    title: string;
    message: string;
    variant: 'danger' | 'warning' | 'info' | 'success';
    confirmText?: string;
    onConfirm: () => void;
  }>(null);
  const [messageModal, setMessageModal] = useState<null | {
    title: string;
    message: string;
    variant: 'danger' | 'warning' | 'info' | 'success';
    confirmText?: string;
  }>(null);
  const [sendBackModalOpen, setSendBackModalOpen] = useState(false);
  const [revisionCommentDraft, setRevisionCommentDraft] = useState('');
  const [personalDraftSavedAt, setPersonalDraftSavedAt] = useState<string | null>(null);
  const [authorRequestModal, setAuthorRequestModal] = useState<null | {
    entryId: string;
    nameRu: string;
    nameEn: string;
    organizationId: string;
  }>(null);

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

  useEffect(() => {
    if (!loading) {
      void loadRepository(isAddWorkspace ? 'root' : undefined);
    }
  }, [loading, repositoryUser, isAddWorkspace]);

  useEffect(() => {
    if (!canEditRepository) {
      setReferenceAuthors([]);
      setReferenceOrganizations([]);
      setReferencesLoading(false);
      return;
    }

    let isActive = true;

    void (async () => {
      setReferencesLoading(true);
      try {
        const [authors, organizations] = await Promise.all([
          repositoryReferenceService.getAuthors(),
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

    return () => {
      isActive = false;
    };
  }, [canEditRepository]);

  useEffect(() => {
    if (isCompactWorkspace) {
      setEditorMode(true);
    }
  }, [isCompactWorkspace]);

  const selectedNode = useMemo(() => {
    if (!repository || !selectedId) {
      return null;
    }

    return findNodeById(repository.tree, selectedId);
  }, [repository, selectedId]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const searchResults = useMemo(() => {
    if (!repository || !normalizedSearchQuery) {
      return [];
    }

    return repository.documents
      .map((document) => ({
        document,
        searchSource: getDocumentSearchSource(document).toLowerCase(),
      }))
      .filter(({ searchSource }) => searchSource.includes(normalizedSearchQuery))
      .map(({ document }, index) => ({
        key: `${document.id}-${index}`,
        document,
        location: formatDocumentParentPath(document),
        identity: formatSearchResultId(document.id),
        snippet: createSearchSnippet(document, searchQuery),
      }))
      .sort((left, right) => {
        if (left.document.name !== right.document.name) {
          return left.document.name.localeCompare(right.document.name, 'ru');
        }

        if (left.location !== right.location) {
          return left.location.localeCompare(right.location, 'ru');
        }

        return left.document.id.localeCompare(right.document.id, 'ru');
      });
  }, [repository, normalizedSearchQuery, searchQuery]);

  const selectedDocument = selectedNode?.type === 'document' ? selectedNode : null;
  const isRepositoryUserLimitedToOwnDocuments = repositoryUser?.role === 'user';
  const isSelectedDocumentOwnedByRepositoryUser = Boolean(
    selectedDocument && isDocumentOwnedByUser(selectedDocument.meta, repositoryUser)
  );
  const selectedDocumentStatus: RepositoryDocumentStatus = selectedDocument?.documentStatus || 'needs_revision';
  const selectedDocumentStatusLabel = getDocumentStatusLabel(selectedDocumentStatus);
  const selectedDocumentStatusVariant = getDocumentStatusVariant(selectedDocumentStatus);
  const canViewSelectedDocumentStatus = Boolean(repositoryUser);
  const canViewRevisionComment = Boolean(
    repositoryUser?.role === 'admin' ||
      repositoryUser?.role === 'editor' ||
      (repositoryUser?.role === 'user' && isSelectedDocumentOwnedByRepositoryUser)
  );
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
      selectedDocument.documentStatus === 'needs_revision' &&
      !isSelectedDocumentLockedForEditor &&
      (repositoryUser?.role === 'editor' ||
        (repositoryUser?.role === 'user' && isSelectedDocumentOwnedByRepositoryUser))
  );
  const canOpenSelectedDocumentInEditMode = Boolean(
    selectedDocument &&
      canEditRepository &&
      (isRepositoryAdmin || repositoryUser?.role === 'editor' || isSelectedDocumentOwnedByRepositoryUser)
  );
  const showSelectedDocumentWorkflowActions = Boolean(
    selectedDocument &&
      (
        canViewSelectedDocumentStatus ||
        canOpenSelectedDocumentInEditMode ||
        (canViewSelectedDocumentStatus && selectedDocument.reviewRequestedAt && selectedDocument.documentStatus === 'under_review') ||
        canSubmitSelectedDocumentForReview ||
        (isRepositoryAdmin && selectedDocument.documentStatus !== 'needs_revision') ||
        (!isRepositoryAdmin && repositoryUser?.role === 'user' && !isSelectedDocumentOwnedByRepositoryUser) ||
        (!isRepositoryAdmin && isSelectedDocumentLockedForEditor)
      )
  );
  const missingRequiredMetaFields = useMemo(() => {
    if (!selectedNode || selectedNode.type !== 'document') {
      return [] as RequiredMetaField[];
    }

    return getMissingRequiredMetaFields(draftMeta);
  }, [selectedNode, draftMeta]);
  const canEditSelectedNode = Boolean(
    editorMode &&
      canEditRepository &&
      selectedNode &&
      selectedNode.id !== 'root' &&
      (selectedNode.type === 'directory'
        ? !isRepositoryUserLimitedToOwnDocuments
        : canEditSelectedDocument)
  );
  const draftCitationText = buildDocumentCitation(
    draftMeta,
    draftName.trim() || selectedDocument?.name || ''
  );
  const draftCitationTextEn = buildDocumentCitation(
    draftMeta,
    draftName.trim() || selectedDocument?.name || '',
    'en'
  );

  const getMetaLanguageValidationErrors = (meta: RepositoryDocumentMeta, entries: RepositoryAuthorEntry[]) => {
    const errors: string[] = [];

    entries.forEach((entry, index) => {
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

      const organizationEnError = validateEnglishOnly(entry.organizationEn, `Организация автора ${row} (EN)`);
      if (organizationEnError) {
        errors.push(organizationEnError);
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

    const documentTypeError = validateEnglishOnly(meta.documentType, 'Тип документа');
    if (documentTypeError) {
      errors.push(documentTypeError);
    }

    const licenseError = validateEnglishOnly(meta.license, 'Лицензия');
    if (licenseError) {
      errors.push(licenseError);
    }

    return errors;
  };

  useEffect(() => {
    if (!selectedNode) {
      return;
    }

    let isActive = true;

    if (selectedNode.type !== 'document') {
      setDraftName(selectedNode.name);
      setDraftMeta(createEmptyMeta());
      setAuthorEntries([createEmptyAuthorEntry()]);
      setDraftBlocks([]);
      setPersonalDraftSavedAt(null);
      setUploadingBlockIds([]);
      return;
    }

    const selectedDocumentMeta = {
      ...createEmptyMeta(),
      ...selectedNode.meta,
    };

    setDraftName(selectedNode.name);
    setDraftMeta(selectedDocumentMeta);
    setAuthorEntries(resolveAuthorEntries(selectedDocumentMeta));
    setDraftBlocks(selectedNode.blocks);
    setPersonalDraftSavedAt(null);
    setUploadingBlockIds([]);

    if (!repositoryUser?.id) {
      return () => {
        isActive = false;
      };
    }

    void (async () => {
      try {
        const personalDraft = await repositoryService.getPersonalDraft(selectedNode.id);
        if (!isActive || !personalDraft) {
          return;
        }

        const mergedMeta = {
          ...selectedDocumentMeta,
          ...personalDraft.meta,
        };

        setDraftName(personalDraft.name.trim() ? personalDraft.name : selectedNode.name);
        setDraftMeta(mergedMeta);
        setAuthorEntries(resolveAuthorEntries(mergedMeta));
        setDraftBlocks(personalDraft.blocks);
        setPersonalDraftSavedAt(personalDraft.savedAt);
      } catch (error) {
        console.error('Не удалось загрузить личный черновик:', error);
      }
    })();

    return () => {
      isActive = false;
    };
  }, [selectedNode, repositoryUser?.id]);

  useEffect(() => {
    if (!repository || !selectedId) {
      return;
    }

    const ancestorIds = findAncestorDirectoryIds(repository.tree, selectedId);
    if (ancestorIds.length === 0) {
      return;
    }

    setExpandedDirectoryIds((current) => [...new Set([...current, ...ancestorIds])]);
  }, [repository, selectedId]);

  useEffect(() => {
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

  useEffect(() => {
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
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [repository]);

  useEffect(() => {
    if (!draggedItem) {
      return;
    }

    const edgeSize = 140;
    const scrollStep = 28;

    const handleWindowDragOver = (event: globalThis.DragEvent) => {
      if (event.clientY < edgeSize) {
        window.scrollBy({ top: -scrollStep, behavior: 'auto' });
      } else if (event.clientY > window.innerHeight - edgeSize) {
        window.scrollBy({ top: scrollStep, behavior: 'auto' });
      }
    };

    window.addEventListener('dragover', handleWindowDragOver);
    return () => window.removeEventListener('dragover', handleWindowDragOver);
  }, [draggedItem]);

  if (loading) {
    return <section className='repository-page repository-page--state'>Загрузка доступа к репозиторию...</section>;
  }

  const handleSelect = (node: RepositoryNode) => {
    setSelectedId(node.id);
    setStatus(null);
    setMessageModal(null);
    setDeleteModalOpen(false);
  };

  const handleSearchSelect = (documentId: string) => {
    setSelectedId(documentId);
    setStatus(null);
    setMessageModal(null);
    setDeleteModalOpen(false);
  };

  const toggleDirectory = (directoryId: string) => {
    setExpandedDirectoryIds((current) =>
      current.includes(directoryId)
        ? current.filter((id) => id !== directoryId)
        : [...current, directoryId]
    );
  };

  const clearPersonalDraftForDocument = async (documentId: string) => {
    try {
      if (repositoryUser?.id) {
        await repositoryService.deletePersonalDraft(documentId);
      }
    } catch (error) {
      console.error('Не удалось очистить личный черновик:', error);
    }

    setPersonalDraftSavedAt(null);
  };

  const savePersonalDraft = async () => {
    if (!selectedNode || selectedNode.type !== 'document') {
      return;
    }

    if (!repositoryUser?.id) {
      setMessageModal({
        title: 'Недостаточно данных пользователя',
        message: 'Не удалось определить текущего пользователя для сохранения личного черновика.',
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    if (uploadingBlockIds.length > 0) {
      setMessageModal({
        title: 'Загрузка не завершена',
        message: 'Дождитесь завершения загрузки файла перед сохранением черновика.',
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    try {
      const metaToSave = {
        ...draftMeta,
        citationLink: buildDocumentCitation(draftMeta, draftName.trim() || selectedNode.name, 'ru'),
        citationLinkEn: buildDocumentCitation(draftMeta, draftName.trim() || selectedNode.name, 'en'),
      };
      const savedDraft = await repositoryService.savePersonalDraft(selectedNode.id, {
        name: draftName.trim() || selectedNode.name,
        meta: metaToSave,
        blocks: draftBlocks,
        sourceUpdatedAt: selectedNode.updatedAt,
      });
      setPersonalDraftSavedAt(savedDraft.savedAt);
      setMessageModal({
        title: 'Черновик сохранён',
        message: 'Черновик сохранён для вашей учётной записи и будет доступен после авторизации с любого устройства.',
        variant: 'success',
        confirmText: 'Понятно',
      });
    } catch (error) {
      setMessageModal({
        title: 'Не удалось сохранить черновик',
        message: error instanceof Error ? error.message : 'Не удалось сохранить личный черновик.',
        variant: 'danger',
        confirmText: 'Закрыть',
      });
    }
  };

  const createDocument = async () => {
    if (!selectedNode || selectedNode.type !== 'directory' || !newDocumentName.trim()) {
      return;
    }

    setSaving(true);
    try {
      const result = await repositoryService.createDocument(selectedNode.id, newDocumentName.trim(), newDocumentType.trim());
      setNewDocumentName('');
      setNewDocumentType('');
      setStatus('Документ создан.');
      await loadRepository(result.createdNode?.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не удалось создать документ.');
    } finally {
      setSaving(false);
    }
  };

  const saveSelectedNode = async () => {
    if (!selectedNode || selectedNode.id === 'root') {
      return;
    }

    const metaToSave = selectedNode.type === 'document'
      ? {
          ...draftMeta,
          citationLink: buildDocumentCitation(draftMeta, draftName.trim() || selectedNode.name, 'ru'),
          citationLinkEn: buildDocumentCitation(draftMeta, draftName.trim() || selectedNode.name, 'en'),
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

    if (selectedNode.type === 'document') {
      const languageValidationErrors = getMetaLanguageValidationErrors(draftMeta, authorEntries);
      if (languageValidationErrors.length > 0) {
        setMessageModal({
          title: 'Проверьте язык заполнения полей',
          message: languageValidationErrors.join(' '),
          variant: 'warning',
          confirmText: 'Понятно',
        });
        return;
      }

      const missingMeta = getMissingRequiredMetaFields(draftMeta);
      if (missingMeta.length > 0) {
        const missingMetaLabels = missingMeta.map((field) => REQUIRED_META_FIELD_LABELS[field]).join(', ');
        setMessageModal({
          title: 'Не заполнены обязательные поля',
          message: `Перед сохранением заполните все обязательные поля metadata: ${missingMetaLabels}.`,
          variant: 'warning',
          confirmText: 'Понятно',
        });
        return;
      }
    }

    setSaving(true);
    try {
      await repositoryService.updateNode(selectedNode.id, {
        name: draftName.trim(),
        meta: metaToSave,
        blocks: selectedNode.type === 'document' ? draftBlocks : undefined,
        expectedUpdatedAt: selectedNode.type === 'document' ? selectedNode.updatedAt : undefined,
      });
      setStatus('Изменения сохранены.');
      setMessageModal({
        title: 'Сохранение завершено',
        message: selectedNode.type === 'document'
          ? 'Документ успешно сохранён.'
          : 'Каталог успешно сохранён.',
        variant: 'success',
        confirmText: 'Отлично',
      });
      if (selectedNode.type === 'document') {
        await clearPersonalDraftForDocument(selectedNode.id);
      }
      await loadRepository(selectedNode.id);
    } catch (error) {
      setMessageModal({
        title: 'Не удалось сохранить',
        message: error instanceof Error ? error.message : 'Не удалось сохранить изменения.',
        variant: 'danger',
        confirmText: 'Закрыть',
      });
    } finally {
      setSaving(false);
    }
  };

  const openDeleteModal = () => {
    if (!selectedNode || selectedNode.id === 'root') {
      return;
    }

    setDeleteModalOpen(true);
  };

  const confirmDeleteSelectedNode = async () => {
    if (!selectedNode || selectedNode.id === 'root') {
      return;
    }

    setDeleteModalOpen(false);
    setSaving(true);
      try {
        await repositoryService.deleteNode(selectedNode.id);
        if (selectedNode.type === 'document') {
          await clearPersonalDraftForDocument(selectedNode.id);
        }
        setStatus('Узел удален.');
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

  const depositSelectedDocumentToCrossref = async () => {
    if (!selectedDocument) {
      return;
    }

    setSaving(true);
    try {
      const result = await repositoryService.depositXmlToCrossref(selectedDocument.id);
      setStatus('Документ принят, отправлен в Crossref, автор уведомлен по email.');
      setMessageModal({
        title: 'XML отправлен в Crossref',
        message: `Файл ${result.fileName} отправлен. Документ переведен в статус "${getDocumentStatusLabel('verified')}". Автору документа отправлено уведомление по email. Ответ Crossref: ${result.responseText.slice(0, 1000)}`,
        variant: 'success',
        confirmText: 'Закрыть',
      });
      await loadRepository(selectedDocument.id);
    } catch (error) {
      setMessageModal({
        title: 'Не удалось отправить XML',
        message: error instanceof Error ? error.message : 'Crossref deposit завершился ошибкой.',
        variant: 'danger',
        confirmText: 'Закрыть',
      });
    } finally {
      setSaving(false);
    }
  };

  const submitSelectedDocumentForReview = async () => {
    if (!selectedDocument) {
      return;
    }

    setSaving(true);
    try {
      await repositoryService.submitDocumentForReview(selectedDocument.id);
      setStatus('Документ отправлен на проверку.');
      setMessageModal({
        title: 'Документ отправлен на проверку',
        message: 'Редактирование документа заблокировано до смены статуса. Администратору отправлено уведомление по email.',
        variant: 'success',
        confirmText: 'Понятно',
      });
      await loadRepository(selectedDocument.id);
    } catch (error) {
      setMessageModal({
        title: 'Не удалось отправить документ',
        message: error instanceof Error ? error.message : 'Не удалось отправить документ на проверку.',
        variant: 'danger',
        confirmText: 'Закрыть',
      });
    } finally {
      setSaving(false);
    }
  };

  const sendSelectedDocumentToRevision = async (comment: string) => {
    if (!selectedDocument) {
      return;
    }

    setSaving(true);
    try {
      const result = await repositoryService.sendDocumentToRevisionAsAdmin(selectedDocument.id, comment);
      setStatus(result?.message || 'Документ отправлен на доработку.');
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

  const openSubmitForReviewAction = () => {
    if (!selectedDocument) {
      return;
    }

    if (uploadingBlockIds.length > 0) {
      setMessageModal({
        title: 'Загрузка не завершена',
        message: 'Дождитесь завершения загрузки файла перед отправкой документа на проверку.',
        variant: 'warning',
        confirmText: 'Понятно',
      });
      return;
    }

    if (selectedDocument.documentStatus === 'under_review') {
      setMessageModal({
        title: 'Документ уже на проверке',
        message: 'Документ уже и так находится на рассмотрении.',
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

    setActionModal({
      title: 'Отправить на проверку',
      message: `Отправить документ "${selectedDocument.name}" на проверку администратору? После этого редактирование документа будет заблокировано до смены статуса.`,
      variant: 'warning',
      confirmText: 'Отправить',
      onConfirm: () => {
        setActionModal(null);
        void submitSelectedDocumentForReview();
      },
    });
  };

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

  const confirmSendBackToRevision = () => {
    setSendBackModalOpen(false);
    void sendSelectedDocumentToRevision(revisionCommentDraft);
  };

  const openCrossrefDepositAction = () => {
    if (!selectedDocument) {
      return;
    }

    setActionModal({
      title: 'Отправить XML в Crossref',
      message: `Отправить XML документа "${selectedDocument.name}" в Crossref? После успешной отправки документ будет считаться принятым.`,
      variant: 'warning',
      confirmText: 'Отправить',
      onConfirm: () => {
        setActionModal(null);
        void depositSelectedDocumentToCrossref();
      },
    });
  };

  const addBlock = (type: RepositoryBlockType) => {
    setDraftBlocks((current) => [...current, createEmptyBlock(type)]);
  };

  const insertBlockAt = (index: number, type: RepositoryBlockType) => {
    setDraftBlocks((current) => {
      const next = [...current];
      next.splice(index, 0, createEmptyBlock(type));
      return next;
    });
    setDraftMeta((current) => ({
      ...current,
      position: index <= (current.position ?? 0) ? (current.position ?? 0) + 1 : current.position ?? 0,
    }));
  };

  const updateBlock = (blockId: string, updates: Partial<RepositoryBlock>) => {
    setDraftBlocks((current) => current.map((block) => (block.id === blockId ? { ...block, ...updates } : block)));
  };

  const deleteBlock = (blockId: string) => {
    const blockIndex = draftBlocks.findIndex((block) => block.id === blockId);
    setDraftBlocks((current) => current.filter((block) => block.id !== blockId));
    if (blockIndex !== -1) {
      setDraftMeta((current) => ({
        ...current,
        position:
          blockIndex < (current.position ?? 0)
            ? Math.max(0, (current.position ?? 0) - 1)
            : Math.min(current.position ?? 0, draftBlocks.length - 1),
      }));
    }
  };

  const moveBlock = (blockId: string, targetIndex: number) => {
    setDraftBlocks((current) => {
      const sourceIndex = current.findIndex((block) => block.id === blockId);
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

  const resolveAuthorReferenceForEntry = (entry: RepositoryAuthorEntry) =>
    findAuthorReferenceById(referenceAuthors, entry.referenceAuthorId) ||
    findAuthorReferenceByNames(referenceAuthors, entry.authorRu, entry.authorEn);

  const resolveOrganizationReferenceForEntry = (entry: RepositoryAuthorEntry) =>
    findOrganizationReferenceById(referenceOrganizations, entry.referenceOrganizationId) ||
    findOrganizationReferenceByNames(referenceOrganizations, entry.organizationRu, entry.organizationEn);

  const syncAuthorEntriesToMeta = (entries: RepositoryAuthorEntry[]) => {
    const normalizedEntries = entries.length > 0 ? entries : [createEmptyAuthorEntry()];
    const authorMeta = composeMetaAuthorsFromEntries(normalizedEntries);
    setAuthorEntries(normalizedEntries);
    setDraftMeta((current) => ({
      ...current,
      ...authorMeta,
      authorEntries: normalizedEntries,
    }));
  };

  const patchAuthorEntry = (entryId: string, patch: (entry: RepositoryAuthorEntry) => RepositoryAuthorEntry) => {
    syncAuthorEntriesToMeta(authorEntries.map((entry) => (entry.id === entryId ? patch(entry) : entry)));
  };

  const addAuthorEntry = () => {
    syncAuthorEntriesToMeta([...authorEntries, createEmptyAuthorEntry()]);
  };

  const applyAuthorReferenceSelection = (entryId: string, authorIdValue: string) => {
    const selectedAuthor = findAuthorReferenceById(referenceAuthors, Number(authorIdValue));
    if (!selectedAuthor) {
      patchAuthorEntry(entryId, (entry) => ({
        ...entry,
        authorRu: '',
        authorEn: '',
        referenceAuthorId: null,
      }));
      return;
    }

    patchAuthorEntry(entryId, (entry) => {
      const linkedOrganization =
        selectedAuthor.organizations.find((organization) => organization.id === entry.referenceOrganizationId) ||
        selectedAuthor.organizations.find(
          (organization) =>
            organization.name_ru.trim().toLowerCase() === entry.organizationRu.trim().toLowerCase() ||
            String(organization.name_en || '').trim().toLowerCase() === entry.organizationEn.trim().toLowerCase()
        ) ||
        selectedAuthor.organizations[0] ||
        null;

      return {
        ...entry,
        authorRu: selectedAuthor.name_ru,
        authorEn: selectedAuthor.name_en,
        organizationRu: linkedOrganization?.name_ru || entry.organizationRu,
        organizationEn: linkedOrganization?.name_en || entry.organizationEn,
        referenceAuthorId: selectedAuthor.id,
        referenceOrganizationId: linkedOrganization?.id ?? entry.referenceOrganizationId ?? null,
      };
    });
  };

  const applyOrganizationReferenceSelection = (entryId: string, organizationIdValue: string) => {
    const selectedOrganization = findOrganizationReferenceById(referenceOrganizations, Number(organizationIdValue));
    if (!selectedOrganization) {
      patchAuthorEntry(entryId, (entry) => ({
        ...entry,
        organizationRu: '',
        organizationEn: '',
        referenceOrganizationId: null,
      }));
      return;
    }

    patchAuthorEntry(entryId, (entry) => ({
      ...entry,
      organizationRu: selectedOrganization.name_ru,
      organizationEn: selectedOrganization.name_en || '',
      referenceOrganizationId: selectedOrganization.id,
    }));
  };

  const updateAuthorEntry = (
    entryId: string,
    field: 'authorRu' | 'authorEn' | 'organizationRu' | 'organizationEn',
    value: string
  ) => {
    patchAuthorEntry(entryId, (entry) => ({
      ...entry,
      [field]: value,
      referenceAuthorId: field === 'authorRu' || field === 'authorEn' ? null : entry.referenceAuthorId ?? null,
      referenceOrganizationId:
        field === 'organizationRu' || field === 'organizationEn' ? null : entry.referenceOrganizationId ?? null,
    }));
  };

  const removeAuthorEntry = (entryId: string) => {
    syncAuthorEntriesToMeta(authorEntries.filter((entry) => entry.id !== entryId));
  };

  const openAuthorRequestModal = (entry: RepositoryAuthorEntry) => {
    const organizationReference = resolveOrganizationReferenceForEntry(entry);
    setAuthorRequestModal({
      entryId: entry.id,
      nameRu: entry.authorRu,
      nameEn: entry.authorEn,
      organizationId: organizationReference ? String(organizationReference.id) : '',
    });
  };

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

      patchAuthorEntry(authorRequestModal.entryId, (entry) => ({
        ...(() => {
          const linkedOrganization =
            approvedAuthor?.organizations.find((organization) => organization.id === selectedOrganization?.id) ||
            approvedAuthor?.organizations[0] ||
            null;

          return {
            ...entry,
            authorRu: approvedAuthor?.name_ru || nameRu,
            authorEn: approvedAuthor?.name_en || nameEn,
            organizationRu: linkedOrganization?.name_ru || selectedOrganization?.name_ru || entry.organizationRu,
            organizationEn: linkedOrganization?.name_en || selectedOrganization?.name_en || entry.organizationEn,
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

  const updateMetaField = (field: keyof RepositoryDocumentMeta, value: string) => {
    setDraftMeta((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleDragStart = (event: ReactDragEvent<HTMLButtonElement>, item: { kind: 'block'; blockId: string } | { kind: 'meta' }) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.dropEffect = 'move';
    event.dataTransfer.setData('text/plain', item.kind === 'meta' ? 'meta' : item.blockId);
    setDraggedItem(item);
  };

  const handleDropAt = (targetIndex: number) => {
    if (!draggedItem) {
      return;
    }

    if (draggedItem.kind === 'meta') {
      setDraftMeta((current) => ({
        ...current,
        position: targetIndex,
      }));
    } else {
      moveBlock(draggedItem.blockId, targetIndex);
    }

    setDraggedItem(null);
    setDropIndex(null);
  };

  const uploadBlockFile = async (block: RepositoryBlock, file: File | null) => {
    if (!file) {
      return;
    }

    setUploadingBlockIds((current) => (current.includes(block.id) ? current : [...current, block.id]));

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const blockOrder = Math.max(1, draftBlocks.findIndex((draftBlock) => draftBlock.id === block.id) + 1);
      const upload = await repositoryService.uploadAsset(
        file.name,
        extractBase64Content(dataUrl),
        file.type || undefined,
        block.type === 'image' ? 'image' : 'file',
        {
          documentName: draftName.trim() || selectedDocument?.name || file.name,
          publicationDate: draftMeta.publicationDate || '',
          blockOrder,
        }
      );

      updateBlock(block.id, {
        url: upload.url,
        label: block.label?.trim() ? block.label : upload.fileName,
        fileName: upload.fileName,
      });
      setStatus(`Файл "${upload.fileName}" загружен на сервер.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не удалось загрузить файл.');
    } finally {
      setUploadingBlockIds((current) => current.filter((id) => id !== block.id));
    }
  };

  const metaPosition = Math.max(0, Math.min(draftMeta.position ?? 0, draftBlocks.length));

  const renderMetaEditor = () => (
    <div
      className={`repository-page__meta-editor repository-page__meta-editor--draggable ${draggedItem?.kind === 'meta' ? 'is-dragging' : ''}`}
    >
      <div className='repository-page__block-meta'>
        <div className='repository-page__block-heading'>
          <span className='repository-page__block-index'>M</span>
          <button
            type='button'
            className='repository-page__drag-handle'
            draggable
            onDragStart={(event) => handleDragStart(event, { kind: 'meta' })}
            onDragEnd={() => {
              setDraggedItem(null);
              setDropIndex(null);
            }}
          >
            Перетащить
          </button>
          <strong>Обязательные сведения / Required metadata</strong>
        </div>
      </div>
      <label>
        Аннотация / Annotation
        <textarea
          className='repository-page__textarea'
          rows={4}
          value={draftMeta.annotation}
          onChange={(event) => updateMetaField('annotation', event.target.value)}
        />
      </label>
      <label>
        Аннотация (EN) / Annotation (EN)
        <textarea
          className='repository-page__textarea'
          rows={4}
          value={draftMeta.descriptionEn}
          onChange={(event) => updateMetaField('descriptionEn', event.target.value)}
          placeholder='English annotation for XML'
        />
      </label>
      <div className='repository-page__meta-grid'>
        <label>
          Дата публикации / Publication Date
          <input
            type='date'
            className='repository-page__input'
            value={draftMeta.publicationDate}
            onChange={(event) => updateMetaField('publicationDate', event.target.value)}
          />
        </label>
        <div className='repository-page__authors'>
          <div className='repository-page__authors-head'>
            <h4>Авторы и организации / Authors and organizations</h4>
            <button type='button' onClick={addAuthorEntry}>
              Добавить автора
            </button>
          </div>
          <div className='repository-page__authors-list'>
            {authorEntries.map((entry, index) => {
              const authorReference = resolveAuthorReferenceForEntry(entry);
              const organizationReference = resolveOrganizationReferenceForEntry(entry);
              const linkedOrganizations = authorReference?.organizations || [];

              return (
                <div key={entry.id} className='repository-page__author-row'>
                  <div className='repository-page__author-row-header'>
                    <strong>Автор {index + 1}</strong>
                    {authorEntries.length > 1 && (
                      <button type='button' onClick={() => removeAuthorEntry(entry.id)} className='repository-page__author-remove'>
                        Удалить
                      </button>
                    )}
                  </div>
                  <div className='repository-page__meta-grid repository-page__meta-grid--author'>
                    <label>
                      Автор из справочника
                      <select
                        className='repository-page__input'
                        value={authorReference ? String(authorReference.id) : ''}
                        onChange={(event) => applyAuthorReferenceSelection(entry.id, event.target.value)}
                        disabled={referencesLoading}
                      >
                        <option value=''>Выберите автора</option>
                        {referenceAuthors.map((author) => (
                          <option key={author.id} value={author.id}>
                            {author.name_ru} / {author.name_en}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className='repository-page__reference-actions'>
                      <button type='button' onClick={() => openAuthorRequestModal(entry)}>
                        Нет автора в списке
                      </button>
                      {authorReference && linkedOrganizations.length > 0 && (
                        <span className='repository-page__muted'>
                          Связанные организации: {linkedOrganizations.map((organization) => organization.name_ru).join(', ')}
                        </span>
                      )}
                    </div>
                    <label>
                      Организация из справочника
                      <select
                        className='repository-page__input'
                        value={organizationReference ? String(organizationReference.id) : ''}
                        onChange={(event) => applyOrganizationReferenceSelection(entry.id, event.target.value)}
                        disabled={referencesLoading}
                      >
                        <option value=''>Выберите организацию</option>
                        {referenceOrganizations.map((organization) => (
                          <option key={organization.id} value={organization.id}>
                            {organization.name_ru}
                            {organization.name_en ? ` / ${organization.name_en}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className='repository-page__reference-hint'>
                      <span className='repository-page__muted'>
                        Если автора или организации нет в справочнике, заполните поля ниже и отправьте заявку админу.
                      </span>
                    </div>
                    <label>
                      Автор (RU)
                      <input
                        className='repository-page__input'
                        value={entry.authorRu}
                        onChange={(event) => updateAuthorEntry(entry.id, 'authorRu', event.target.value)}
                      />
                    </label>
                    <label>
                      Автор (EN)
                      <input
                        className='repository-page__input'
                        value={entry.authorEn}
                        onChange={(event) => updateAuthorEntry(entry.id, 'authorEn', event.target.value)}
                        placeholder='English full name'
                      />
                    </label>
                    <label>
                      Организация (RU)
                      <input
                        className='repository-page__input'
                        value={entry.organizationRu}
                        onChange={(event) => updateAuthorEntry(entry.id, 'organizationRu', event.target.value)}
                      />
                    </label>
                    <label>
                      Организация (EN)
                      <input
                        className='repository-page__input'
                        value={entry.organizationEn}
                        onChange={(event) => updateAuthorEntry(entry.id, 'organizationEn', event.target.value)}
                        placeholder='English organization'
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <label>
          Тип документа / Document Type
          <input
            className='repository-page__input'
            value={draftMeta.documentType}
            onChange={(event) => updateMetaField('documentType', event.target.value)}
          />
        </label>
        <label>
          Название (EN) / Title (EN)
          <input
            className='repository-page__input'
            value={draftMeta.titleEn}
            onChange={(event) => updateMetaField('titleEn', event.target.value)}
            placeholder='English title for XML'
          />
        </label>
        <label>
          Тип записи / Record Type
          <select
            className='repository-page__input'
            value={draftMeta.recordType}
            onChange={(event) => updateMetaField('recordType', event.target.value)}
          >
            {RECORD_TYPE_OPTIONS.map((option) => (
              <option key={option.value || 'empty'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Код издания / Journal Code
          <input
            className='repository-page__input'
            value={draftMeta.journalCode}
            onChange={(event) => updateMetaField('journalCode', event.target.value)}
            placeholder='rjs / zse / er'
          />
        </label>
        <label>
          Том / Volume
          <input
            className='repository-page__input'
            value={draftMeta.volume}
            onChange={(event) => updateMetaField('volume', event.target.value)}
            placeholder='2'
          />
        </label>
        <label>
          Номер статьи / Article Number
          <input
            className='repository-page__input'
            value={draftMeta.articleNumber}
            onChange={(event) => updateMetaField('articleNumber', event.target.value)}
            placeholder='02'
          />
        </label>
        <label>
          DOI
          <input
            className='repository-page__input'
            value={draftMeta.doi}
            readOnly
            disabled
          />
        </label>
        <label>
          Crossref XML
          {draftMeta.xmlPath && (
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
          )}
        </label>
        <label>
          Ссылка для цитирования
          <textarea
            className='repository-page__textarea'
            rows={4}
            value={draftCitationText}
            readOnly
            placeholder='Сформируется автоматически после генерации DOI.'
          />
        </label>
        <label>
          Citation (EN)
          <textarea
            className='repository-page__textarea'
            rows={4}
            value={draftCitationTextEn}
            readOnly
            placeholder='Will be generated automatically after DOI assignment.'
          />
        </label>
        <label>
          Лицензия / License
          <input
            className='repository-page__input'
            value={draftMeta.license}
            onChange={(event) => updateMetaField('license', event.target.value)}
          />
        </label>
      </div>
      <div className='repository-page__insert-toolbar repository-page__insert-toolbar--meta'>
        <span>Вставить первым блоком:</span>
        <button type='button' onClick={() => insertBlockAt(0, 'text')}>Текст</button>
        <button type='button' onClick={() => insertBlockAt(0, 'image')}>Изображение</button>
        <button type='button' onClick={() => insertBlockAt(0, 'link')}>Ссылка</button>
        <button type='button' onClick={() => insertBlockAt(0, 'file')}>Файл</button>
      </div>
    </div>
  );

  const renderDropZone = (targetIndex: number, label: string) => (
    <div
      className={`repository-page__drop-zone ${dropIndex === targetIndex ? 'is-active' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropIndex(targetIndex);
      }}
      onDragLeave={() => {
        if (dropIndex === targetIndex) {
          setDropIndex(null);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        handleDropAt(targetIndex);
      }}
    >
      <span>{label}</span>
    </div>
  );

  const renderBlockEditor = (block: RepositoryBlock, index: number) => (
    <div
      className={`repository-page__block-editor ${draggedItem?.kind === 'block' && draggedItem.blockId === block.id ? 'is-dragging' : ''}`}
    >
      <div className='repository-page__insert-toolbar'>
        <span>Вставить перед блоком:</span>
        <button type='button' onClick={() => insertBlockAt(index, 'text')}>Текст</button>
        <button type='button' onClick={() => insertBlockAt(index, 'image')}>Изображение</button>
        <button type='button' onClick={() => insertBlockAt(index, 'link')}>Ссылка</button>
        <button type='button' onClick={() => insertBlockAt(index, 'file')}>Файл</button>
      </div>
      <div className='repository-page__block-meta'>
        <div className='repository-page__block-heading'>
          <span className='repository-page__block-index'>{index + 1}</span>
          <button
            type='button'
            className='repository-page__drag-handle'
            draggable
            onDragStart={(event) => handleDragStart(event, { kind: 'block', blockId: block.id })}
            onDragEnd={() => {
              setDraggedItem(null);
              setDropIndex(null);
            }}
          >
            Перетащить
          </button>
          <strong>{block.type}</strong>
        </div>
        <button type='button' className='repository-page__ghost-danger' onClick={() => deleteBlock(block.id)}>
          Удалить
        </button>
      </div>

      {block.type === 'text' ? (
        <textarea
          className='repository-page__textarea'
          rows={6}
          value={block.content || ''}
          onChange={(event) => updateBlock(block.id, { content: event.target.value })}
          placeholder='Текстовый блок'
        />
      ) : (
        <>
          <input
            className='repository-page__input'
            value={block.label || ''}
            onChange={(event) => updateBlock(block.id, { label: event.target.value })}
            placeholder={block.type === 'image' ? 'Подпись к изображению' : 'Название блока'}
          />
          <input
            className='repository-page__input'
            value={block.url || ''}
            onChange={(event) => updateBlock(block.id, { url: event.target.value })}
            placeholder={block.type === 'image' ? 'URL изображения' : block.type === 'link' ? 'URL ссылки' : 'Ссылка или путь к файлу'}
          />
          {(block.type === 'image' || block.type === 'file') && (
            <label className='repository-page__upload'>
              <span>
                {block.type === 'image' ? 'Загрузить с компьютера' : 'Прикрепить файл с компьютера'}
              </span>
              <input
                type='file'
                accept={block.type === 'image' ? 'image/*' : undefined}
                onChange={(event) => {
                  void uploadBlockFile(block, event.target.files?.[0] || null);
                  event.target.value = '';
                }}
              />
            </label>
          )}
        </>
      )}
    </div>
  );

  const renderEditorSequence = () => {
    const items = [];

    for (let index = 0; index <= draftBlocks.length; index += 1) {
      items.push(
        <div key={`drop-${index}`} className='repository-page__block-wrapper'>
          {renderDropZone(index, index === draftBlocks.length ? 'Переместить блок в конец' : 'Переместить блок сюда')}
        </div>
      );

      if (metaPosition === index) {
        items.push(
          <div key='meta-editor' className='repository-page__block-wrapper'>
            {renderMetaEditor()}
          </div>
        );
      }

      if (index < draftBlocks.length) {
        items.push(
          <div key={draftBlocks[index].id} className='repository-page__block-wrapper'>
            {renderBlockEditor(draftBlocks[index], index)}
          </div>
        );
      }
    }

    return items;
  };

  const renderViewerSequence = (document: RepositoryDocument) => {
    const items = [];
    const position = Math.max(0, Math.min(document.meta.position ?? 0, document.blocks.length));

    for (let index = 0; index <= document.blocks.length; index += 1) {
      if (position === index) {
        items.push(
          <div key='meta-view'>
            {renderDocumentMeta({
              meta: document.meta,
              documentName: document.name,
              documentStatus: document.documentStatus || 'needs_revision',
              searchQuery,
              canViewRevisionComment,
              canViewDocumentStatus: canViewSelectedDocumentStatus,
              updatedAt: document.updatedAt,
            })}
          </div>
        );
      }

      if (index < document.blocks.length) {
        items.push(renderBlock(document.blocks[index], searchQuery));
      }
    }

    return items;
  };

  return (
    <section className='repository-page'>
      <div className='repository-page__container'>
        {showWorkspaceHero && (
          <div className='repository-page__hero'>
            <div>
              {(isAddWorkspace || isEditWorkspace) && (
                <h1>{isAddWorkspace ? 'Добавление материалов' : 'Редактирование материалов'}</h1>
              )}
              {showSearch && (
                <div className='repository-page__search'>
                  <input
                    type='search'
                    className='repository-page__search-input'
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder='Поиск по названию, DOI, типу документа и содержанию'
                  />
                  {normalizedSearchQuery && (
                    <div className='repository-page__search-results'>
                      {searchResults.length === 0 ? (
                        <div className='repository-page__search-empty'>Ничего не найдено.</div>
                      ) : (
                        searchResults.map(({ key, document, location, identity, snippet }) => (
                          <button
                            key={key}
                            type='button'
                            className='repository-page__search-result'
                            onClick={() => handleSearchSelect(document.id)}
                          >
                            <strong>{highlightText(document.name, searchQuery)}</strong>
                            <span>{highlightText(location, searchQuery)}</span>
                            <span>{identity}</span>
                            <span>Статус: {getDocumentStatusLabel(document.documentStatus || 'needs_revision')}</span>
                            <span>
                              Тип документа: {highlightText(document.meta.documentType || 'Не указан', searchQuery)}
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
            {isAddWorkspace && (
              <Link to='/repository/instruction' className='repository-page__instruction-button'>
                Инструкция
              </Link>
            )}
          </div>
        )}

        {status && <div className='repository-page__status'>{status}</div>}

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
                    onClick={() => handleSelect(repository.tree)}
                  >
                    {repository.tree.name}
                  </button>
                  {repository.tree.children.map((node) => (
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
                      onChange={(event) => setSelectedId(event.target.value || null)}
                    >
                      <option value=''>Выберите документ</option>
                      {repository.documents.map((document) => (
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
                  {!(isAddWorkspace && selectedNode.type === 'directory') && (
                    <div className='repository-page__card'>
                      <div className='repository-page__card-header'>
                        <span className='repository-page__badge'>
                          {selectedNode.type === 'directory' ? 'Каталог' : 'Документ'}
                        </span>
                        {selectedNode.type === 'document' && canViewSelectedDocumentStatus && (
                          <span className={`repository-page__document-status repository-page__document-status--${selectedDocumentStatusVariant}`}>
                            {selectedDocumentStatusLabel}
                          </span>
                        )}
                        {selectedNode.type === 'document' && (selectedNode.updatedAt || selectedDocument?.meta.publicationDate) && (
                          <div className='repository-page__document-dates'>
                            {selectedNode.updatedAt && (
                              <span className='repository-page__muted'>
                                Обновлено: {new Date(selectedNode.updatedAt).toLocaleString('ru-RU')}
                              </span>
                            )}
                            {selectedDocument?.meta.publicationDate && (
                              <span className='repository-page__muted'>
                                Дата публикации: {selectedDocument.meta.publicationDate}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {showSelectedDocumentWorkflowActions && selectedDocument && (
                        <div className='repository-page__workflow-actions'>
                          {canViewSelectedDocumentStatus && (
                            <span className='repository-page__workflow-hint'>
                              Текущий статус: {selectedDocumentStatusLabel}
                            </span>
                          )}
                          {!isEditWorkspace && canOpenSelectedDocumentInEditMode && (
                            <Link
                              to={buildEditDocumentPath(selectedDocument.id)}
                              className='repository-page__workflow-button'
                            >
                              Перейти к редактированию
                            </Link>
                          )}
                          {selectedDocument.reviewRequestedAt && selectedDocument.documentStatus === 'under_review' && (
                            <span className='repository-page__workflow-hint'>
                              На проверке с {new Date(selectedDocument.reviewRequestedAt).toLocaleString('ru-RU')}
                            </span>
                          )}
                          {canSubmitSelectedDocumentForReview && (
                            <button type='button' className='repository-page__workflow-button' onClick={openSubmitForReviewAction} disabled={saving}>
                              Отправить на проверку
                            </button>
                          )}
                          {isRepositoryAdmin && selectedDocument.documentStatus !== 'needs_revision' && (
                            <button type='button' className='repository-page__workflow-button' onClick={openSendBackToRevisionAction} disabled={saving}>
                              Отправить на доработку
                            </button>
                          )}
                          {!isRepositoryAdmin && repositoryUser?.role === 'user' && selectedDocument && !isSelectedDocumentOwnedByRepositoryUser && (
                            <span className='repository-page__workflow-hint'>
                              Пользователь может редактировать и отправлять на проверку только собственные документы.
                            </span>
                          )}
                          {!isRepositoryAdmin && isSelectedDocumentLockedForEditor && (
                            <span className='repository-page__workflow-hint'>
                              Редактирование документа заблокировано до смены статуса.
                            </span>
                          )}
                        </div>
                      )}

                      {canEditSelectedNode ? (
                        <div className='repository-page__editor'>
                          <label>
                            Название
                            <input
                              value={draftName}
                              onChange={(event) => setDraftName(event.target.value)}
                              className='repository-page__input'
                            />
                          </label>

                          {selectedNode.type === 'document' ? (
                            <>
                              <div className='repository-page__block-toolbar'>
                                <button type='button' onClick={() => addBlock('text')}>Добавить текст</button>
                                <button type='button' onClick={() => addBlock('image')}>Добавить изображение</button>
                                <button type='button' onClick={() => addBlock('link')}>Добавить гиперссылку</button>
                                <button type='button' onClick={() => addBlock('file')}>Добавить файл</button>
                              </div>

                              <div className='repository-page__blocks'>
                                {renderEditorSequence()}
                              </div>
                            </>
                          ) : (
                            <p className='repository-page__muted'>Используйте блок ниже для создания нового документа.</p>
                          )}

                          <div className='repository-page__actions'>
                            {selectedNode.type === 'document' && (
                                <button
                                  type='button'
                                  onClick={() => void savePersonalDraft()}
                                  disabled={saving || uploadingBlockIds.length > 0 || !draftName.trim()}
                                >
                                Сохранить черновик
                              </button>
                            )}
                            <button
                              type='button'
                              onClick={saveSelectedNode}
                              disabled={
                                saving ||
                                uploadingBlockIds.length > 0 ||
                                !draftName.trim() ||
                                (selectedNode.type === 'document' && missingRequiredMetaFields.length > 0)
                              }
                            >
                              Сохранить
                            </button>
                            {isRepositoryAdmin && selectedNode.type === 'document' && draftMeta.xmlPath && (
                              <button type='button' onClick={openCrossrefDepositAction} disabled={saving}>
                                Отправить XML в Crossref
                              </button>
                            )}
                            <button type='button' className='is-danger' onClick={openDeleteModal} disabled={saving}>
                              Удалить
                            </button>
                          </div>
                          {selectedNode.type === 'document' && missingRequiredMetaFields.length > 0 && (
                            <p className='repository-page__required-hint'>
                              Для сохранения в репозиторий заполните все обязательные поля metadata. Можно сохранить личный черновик.
                            </p>
                          )}
                          {selectedNode.type === 'document' && personalDraftSavedAt && (
                            <p className='repository-page__muted'>
                              Личный черновик сохранён: {new Date(personalDraftSavedAt).toLocaleString('ru-RU')}
                            </p>
                          )}
                        </div>
                      ) : selectedNode.type === 'document' ? (
                        <article className='repository-page__document'>
                          <h2>{highlightText(selectedNode.name, searchQuery)}</h2>
                          {editorMode && !isRepositoryAdmin && repositoryUser?.role === 'user' && !isSelectedDocumentOwnedByRepositoryUser && (
                            <div className='repository-page__status repository-page__status--inline'>
                              Пользователь может редактировать только собственные документы. Этот материал доступен только для просмотра.
                            </div>
                          )}
                          {editorMode && !isRepositoryAdmin && isSelectedDocumentLockedForEditor && (
                            <div className='repository-page__status repository-page__status--inline'>
                              Документ сейчас недоступен для редактирования. Дождитесь смены статуса администратором.
                            </div>
                          )}
                          <div className='repository-page__rendered-document'>
                            {selectedNode.blocks.length > 0 || selectedNode.meta ? renderViewerSequence(selectedNode) : <p>Контент не добавлен.</p>}
                          </div>
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
                  )}

                  {editorMode && canEditRepository && selectedNode.type === 'directory' && (
                    <div className='repository-page__card repository-page__creation'>
                      <div>
                        <h3>Добавить документ</h3>
                        <input
                          className='repository-page__input'
                          value={newDocumentName}
                          onChange={(event) => setNewDocumentName(event.target.value)}
                          placeholder='Название документа'
                        />
                        <input
                          className='repository-page__input'
                          value={newDocumentType}
                          onChange={(event) => setNewDocumentType(event.target.value)}
                          placeholder={'Тип документа'}
                        />
                        <button type='button' onClick={createDocument} disabled={saving || !newDocumentName.trim() || !newDocumentType.trim()}>
                          Создать документ
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </main>
          </div>
        )}
      </div>
      <ConfirmModal
        isOpen={Boolean(actionModal)}
        title={actionModal?.title || ''}
        message={actionModal?.message || ''}
        variant={actionModal?.variant || 'info'}
        confirmText={actionModal?.confirmText || 'Подтвердить'}
        onConfirm={actionModal?.onConfirm || (() => {})}
        onCancel={() => setActionModal(null)}
      />
      <ConfirmModal
        isOpen={sendBackModalOpen}
        title='Отправить на доработку'
        message={selectedDocument ? `Отправить документ "${selectedDocument.name}" на доработку автору?` : ''}
        variant='warning'
        confirmText='Отправить'
        cancelText='Отмена'
        onConfirm={confirmSendBackToRevision}
        onCancel={() => setSendBackModalOpen(false)}
      >
        <label className='repository-page__revision-comment-field'>
          Комментарий для доработки
          <textarea
            className='repository-page__textarea'
            value={revisionCommentDraft}
            onChange={(event) => setRevisionCommentDraft(event.target.value)}
            placeholder='Укажите замечания для автора документа'
            maxLength={2000}
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
        onConfirm={() => {
          void submitAuthorRequest();
        }}
        onCancel={() => setAuthorRequestModal(null)}
      >
        <div className='repository-page__author-request-fields'>
          <input
            type='text'
            className='repository-page__input'
            placeholder='Автор (RU)'
            value={authorRequestModal?.nameRu || ''}
            onChange={(event) =>
              setAuthorRequestModal((current) =>
                current
                  ? {
                      ...current,
                      nameRu: event.target.value,
                    }
                  : current
              )
            }
          />
          <input
            type='text'
            className='repository-page__input'
            placeholder='Author (EN)'
            value={authorRequestModal?.nameEn || ''}
            onChange={(event) =>
              setAuthorRequestModal((current) =>
                current
                  ? {
                      ...current,
                      nameEn: event.target.value,
                    }
                  : current
              )
            }
          />
          <select
            className='repository-page__input'
            value={authorRequestModal?.organizationId || ''}
            onChange={(event) =>
              setAuthorRequestModal((current) =>
                current
                  ? {
                      ...current,
                      organizationId: event.target.value,
                    }
                  : current
              )
            }
          >
            <option value=''>Организация не выбрана</option>
            {referenceOrganizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name_ru}
                {organization.name_en ? ` / ${organization.name_en}` : ''}
              </option>
            ))}
          </select>
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
        onCancel={() => setDeleteModalOpen(false)}
      />
      <ConfirmModal
        isOpen={Boolean(messageModal)}
        title={messageModal?.title || ''}
        message={messageModal?.message || ''}
        variant={messageModal?.variant || 'info'}
        confirmText={messageModal?.confirmText || 'Закрыть'}
        showCancel={false}
        onConfirm={() => setMessageModal(null)}
        onCancel={() => setMessageModal(null)}
      />
    </section>
  );
}

export default RepositoryPage;


