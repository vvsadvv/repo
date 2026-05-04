import { useNavigate } from 'react-router-dom';
import type { RepositoryDocumentSummary } from '@/types/repository';
import './RepositoryDocumentsTable.scss';

interface RepositoryDocumentsTableProps {
  documents: RepositoryDocumentSummary[];
  emptyText?: string;
}

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

function formatNameWithAuthors(document: RepositoryDocumentSummary) {
  const authors = document.meta?.authors?.trim();
  return authors ? `${document.name} (${authors})` : document.name;
}

function formatTitleDescription(document: RepositoryDocumentSummary) {
  const title = document.meta?.titleEn?.trim();
  const description = document.meta?.annotation?.trim() || document.meta?.descriptionEn?.trim();

  if (title && description) {
    return `${title} \u2014 ${description}`;
  }

  return title || description || '\u2014';
}

function formatDoi(document: RepositoryDocumentSummary) {
  const doi = document.meta?.doi?.trim();
  return doi || '\u2014';
}

export default function RepositoryDocumentsTable({
  documents,
  emptyText = 'Записей пока нет.',
}: RepositoryDocumentsTableProps) {
  const navigate = useNavigate();

  const openDocument = (documentId: string) => {
    navigate(`/repository/workspace#${documentId}`);
  };

  if (documents.length === 0) {
    return <div className='repository-documents-table__empty'>{emptyText}</div>;
  }

  return (
    <div className='repository-documents-table'>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Name (Авторы)</th>
            <th>Title / Annotation</th>
            <th>DOI</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <tr
              key={document.id}
              className='repository-documents-table__row'
              role='link'
              tabIndex={0}
              onClick={() => openDocument(document.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openDocument(document.id);
                }
              }}
              aria-label={`Открыть документ ${document.name}`}
            >
              <td>{formatDate(document)}</td>
              <td>{formatNameWithAuthors(document)}</td>
              <td>{formatTitleDescription(document)}</td>
              <td>{formatDoi(document)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
