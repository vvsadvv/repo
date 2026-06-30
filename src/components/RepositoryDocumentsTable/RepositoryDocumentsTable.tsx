import { useNavigate } from 'react-router-dom';
import type { RepositoryDocumentSummary } from '@/types/repository';
import './RepositoryDocumentsTable.scss';

interface RepositoryDocumentsTableProps {
  documents: RepositoryDocumentSummary[];
  emptyText?: string;
  showStatus?: boolean;
  compact?: boolean;
  visibleAuthorsCount?: number;
}

const statusLabels = {
  draft: 'Черновик',
  needs_revision: 'На доработке',
  under_review: 'На регистрации',
  verified: 'Опубликован',
} as const;

const statusVariants = {
  draft: 'info',
  needs_revision: 'warning',
  under_review: 'info',
  verified: 'success',
} as const;

/* Делает: Форматирует дату. Применение: используется локально в файле src/components/RepositoryDocumentsTable/RepositoryDocumentsTable.tsx. */
function formatDate(document: RepositoryDocumentSummary) {
  const rawDate = document.meta?.publicationDate?.trim();
  if (rawDate) {
    return rawDate;
  }

  if (!document.updatedAt) {
    return '\u2014';
  }

  const parsed = new Date(document.updatedAt);
  return Number.isNaN(parsed.getTime()) ? '\u2014' : parsed.toLocaleDateString('ru-RU');
}

/* Делает: Разделяет список метаданных. Применение: используется локально в файле src/components/RepositoryDocumentsTable/RepositoryDocumentsTable.tsx. */
function splitMetaList(value?: string) {
  return String(value || '')
    .split(/\r?\n|;/)
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри splitMetaList. */ (item) => item.trim())
    .filter(Boolean);
}

/* Делает: Получает initials. Применение: используется локально в файле src/components/RepositoryDocumentsTable/RepositoryDocumentsTable.tsx. */
function getInitials(parts: string[]) {
  return parts
    .flatMap(/* Делает: Преобразует элемент и разворачивает результат. Применение: передаётся как callback в flatMap внутри getInitials. */ (part) =>
      part
        .split('-')
        .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри flatMapCallback. */ (segment) => segment.trim())
        .filter(Boolean)
        .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри flatMapCallback. */ (segment) => {
          const firstLetter = segment.match(/[A-Za-zА-Яа-яЁё]/)?.[0];
          return firstLetter ? `${firstLetter.toUpperCase()}.` : '';
        })
    )
    .join('');
}

/* Делает: Форматирует author short. Применение: используется локально в файле src/components/RepositoryDocumentsTable/RepositoryDocumentsTable.tsx. */
function formatAuthorShort(author: string) {
  const normalized = String(author || '').trim();
  if (!normalized) {
    return '';
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return normalized;
  }

  if (parts.slice(1).every(/* Делает: Проверяет условие для всех элементов коллекции. Применение: передаётся как callback в every внутри formatAuthorShort. */ (part) => part.includes('.'))) {
    return normalized;
  }

  const surname = parts[0];
  const initials = getInitials(parts.slice(1));
  return initials ? `${surname} ${initials}` : surname;
}

/* Делает: Форматирует авторов. Применение: используется локально в файле src/components/RepositoryDocumentsTable/RepositoryDocumentsTable.tsx. */
function formatAuthors(document: RepositoryDocumentSummary) {
  const source = Array.isArray(document.meta?.authorEntries) && document.meta.authorEntries.length > 0
    ? document.meta.authorEntries.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри formatAuthors. */ (entry) => entry.authorRu).filter(Boolean).join('; ')
    : document.meta?.authors;
  return splitMetaList(source).map(formatAuthorShort).filter(Boolean);
}

/* Делает: Подготавливает список отображаемого авторов. Применение: используется локально в файле src/components/RepositoryDocumentsTable/RepositoryDocumentsTable.tsx. */
function formatVisibleAuthors(authors: string[], visibleAuthorsCount: number) {
  if (authors.length <= visibleAuthorsCount) {
    return authors.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри formatVisibleAuthors. */ (author, index) => `${author}${index < authors.length - 1 ? ',' : ''}`);
  }

  return authors
    .slice(0, visibleAuthorsCount)
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри formatVisibleAuthors. */ (author, index, visibleAuthors) => {
      const isLastVisibleAuthor = index === visibleAuthors.length - 1;
      return isLastVisibleAuthor ? `${author}, ...` : `${author},`;
    });
}

/* Делает: Форматирует annotation. Применение: используется локально в файле src/components/RepositoryDocumentsTable/RepositoryDocumentsTable.tsx. */
function formatAnnotation(document: RepositoryDocumentSummary) {
  return document.meta?.annotation?.trim() || document.meta?.descriptionEn?.trim() || '';
}

/* Делает: Форматирует DOI. Применение: используется локально в файле src/components/RepositoryDocumentsTable/RepositoryDocumentsTable.tsx. */
function formatDoi(document: RepositoryDocumentSummary) {
  const doi = document.meta?.doi?.trim();
  return doi || '\u2014';
}

/* Делает: Рендерит React-компонент RepositoryDocumentsTable и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function RepositoryDocumentsTable({
  documents,
  emptyText = 'Записей пока нет.',
  showStatus = false,
  compact = false,
  visibleAuthorsCount = 8,
}: RepositoryDocumentsTableProps) {
  const navigate = useNavigate();

    /* Делает: Открывает документ. Применение: используется внутри функции RepositoryDocumentsTable. */
  const openDocument = (documentId: string) => {
    navigate(`/repository/workspace#${documentId}`);
  };

  if (documents.length === 0) {
    return <div className='repository-documents-table__empty'>{emptyText}</div>;
  }

  return (
    <div className={`repository-documents-table${compact ? ' repository-documents-table--compact' : ''}`}>
      <table>
        <thead>
          <tr>
            <th className='repository-documents-table__col-date'>Дата размещения</th>
            <th className='repository-documents-table__col-authors'>Авторы</th>
            <th className='repository-documents-table__col-title'>Название / Аннотация</th>
            <th className='repository-documents-table__col-doi'>DOI</th>
            {showStatus && <th>Статус</th>}
          </tr>
        </thead>
        <tbody>
          {documents.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryDocumentsTable. */ (document) => (
            (/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в внешний вызов внутри mapCallback. */ () => {
              const authors = formatAuthors(document);
              const visibleAuthors = formatVisibleAuthors(authors, visibleAuthorsCount);
              const annotation = formatAnnotation(document);
              const documentStatus = document.documentStatus || 'draft';

              return (
                <tr
                  key={document.id}
                  className='repository-documents-table__row'
                  role='link'
                  tabIndex={0}
                  onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/components/RepositoryDocumentsTable/RepositoryDocumentsTable.tsx. */ () => openDocument(document.id)}
                  onKeyDown={/* Делает: Обрабатывает событие onKeyDown в JSX-разметке. Применение: используется как inline-обработчик onKeyDown внутри файла src/components/RepositoryDocumentsTable/RepositoryDocumentsTable.tsx. */ (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openDocument(document.id);
                    }
                  }}
                  aria-label={`Открыть документ ${document.name}`}
                >
                  <td>{formatDate(document)}</td>
                  <td className='repository-documents-table__col-authors'>
                    {authors.length > 0 ? (
                        <span className='repository-documents-table__authors'>
                          {visibleAuthors.join('\n')}
                        </span>
                    ) : (
                      '\u2014'
                    )}
                  </td>
                  <td>
                    <div className='repository-documents-table__title-cell'>
                      <strong>{document.name}</strong>
                      {annotation && (
                        <span>{annotation}</span>
                      )}
                    </div>
                  </td>
                  <td className='repository-documents-table__col-doi'>{formatDoi(document)}</td>
                  {showStatus && (
                    <td>
                      <span className={`repository-documents-table__status repository-documents-table__status--${statusVariants[documentStatus]}`}>
                        {statusLabels[documentStatus]}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })()
          ))}
        </tbody>
      </table>
    </div>
  );
}
