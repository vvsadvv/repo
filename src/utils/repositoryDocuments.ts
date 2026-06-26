import type { RepositoryDocumentSummary } from '@/types/repository';

/* Делает: Получает document sort timestamp. Применение: используется локально в файле src/utils/repositoryDocuments.ts. */
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

/* Делает: Сортирует documents by date desc. Применение: используется локально в файле src/utils/repositoryDocuments.ts. */
export function sortDocumentsByDateDesc(documents: RepositoryDocumentSummary[]) {
  return [...documents].sort(/* Делает: Сравнивает элементы при сортировке. Применение: передаётся как callback в sort внутри sortDocumentsByDateDesc. */ (left, right) => getDocumentSortTimestamp(right) - getDocumentSortTimestamp(left));
}

/* Делает: Фильтрует documents by query. Применение: используется локально в файле src/utils/repositoryDocuments.ts. */
export function filterDocumentsByQuery(documents: RepositoryDocumentSummary[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return documents;
  }

  return documents.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри filterDocumentsByQuery. */ (document) => {
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
