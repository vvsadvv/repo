import type { RepositoryDocumentSummary } from '@/types/repository';

export function getDocumentSortTimestamp(document: RepositoryDocumentSummary) {
  const publicationDate = document.meta?.publicationDate?.trim();
  if (publicationDate) {
    const parsedPublicationDate = Date.parse(publicationDate);
    if (!Number.isNaN(parsedPublicationDate)) {
      return parsedPublicationDate;
    }
  }

  if (document.updatedAt) {
    const parsedUpdatedAt = Date.parse(document.updatedAt);
    if (!Number.isNaN(parsedUpdatedAt)) {
      return parsedUpdatedAt;
    }
  }

  return 0;
}

export function sortDocumentsByDateDesc(documents: RepositoryDocumentSummary[]) {
  return [...documents].sort((left, right) => getDocumentSortTimestamp(right) - getDocumentSortTimestamp(left));
}

export function filterDocumentsByQuery(documents: RepositoryDocumentSummary[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return documents;
  }

  return documents.filter((document) => {
    const searchable = [
      document.meta?.publicationDate,
      document.name,
      document.meta?.authors,
      document.meta?.titleEn,
      document.meta?.annotation,
      document.meta?.descriptionEn,
      document.meta?.doi,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return searchable.includes(normalizedQuery);
  });
}
