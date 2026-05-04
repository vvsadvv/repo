import { useEffect, useState } from 'react';
import RepositoryDocumentsTable from '@/components/RepositoryDocumentsTable/RepositoryDocumentsTable';
import { repositoryService } from '@/services/repositoryService';
import type { RepositoryDocumentSummary } from '@/types/repository';
import { sortDocumentsByDateDesc } from '@/utils/repositoryDocuments';
import './RepositoryLatestUploads.scss';

const UPLOADS_BATCH_SIZE = 10;

export default function RepositoryLatestUploads() {
  const [documents, setDocuments] = useState<RepositoryDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(UPLOADS_BATCH_SIZE);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const data = await repositoryService.getRepository();
        const latest = sortDocumentsByDateDesc(data.documents);
        setDocuments(latest);
        setVisibleCount(UPLOADS_BATCH_SIZE);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить последние записи.');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const visibleDocuments = documents.slice(0, visibleCount);
  const hasMoreDocuments = visibleCount < documents.length;

  return (
    <section className='repository-latest-uploads'>
      <div className='repository-latest-uploads__container'>
        {!loading && !error && (
          <p className='repository-latest-uploads__lead'>
            Показано {Math.min(visibleCount, documents.length)} из {documents.length} записей репозитория.
          </p>
        )}

        {loading && <div className='repository-latest-uploads__state'>Загрузка...</div>}
        {error && <div className='repository-latest-uploads__state repository-latest-uploads__state--error'>{error}</div>}

        {!loading && !error && (
          <RepositoryDocumentsTable
            documents={visibleDocuments}
            emptyText='В репозитории пока нет загруженных материалов.'
          />
        )}

        {!loading && !error && documents.length > 0 && (
          <div className='repository-latest-uploads__actions'>
            <button
              type='button'
              className='repository-latest-uploads__more-button'
              disabled={!hasMoreDocuments}
              onClick={() => setVisibleCount((current) => Math.min(current + UPLOADS_BATCH_SIZE, documents.length))}
            >
              Ещё / More
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
