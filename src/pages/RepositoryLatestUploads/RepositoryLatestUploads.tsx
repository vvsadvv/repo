import { useEffect, useState } from 'react';
import RepositoryDocumentsTable from '@/components/RepositoryDocumentsTable/RepositoryDocumentsTable';
import { repositoryService } from '@/services/repositoryService';
import type { RepositoryDocumentSummary } from '@/types/repository';
import { sortDocumentsByDateDesc } from '@/utils/repositoryDocuments';
import './RepositoryLatestUploads.scss';

const UPLOADS_BATCH_SIZE = 10;

/* Делает: Рендерит React-компонент RepositoryLatestUploads и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function RepositoryLatestUploads() {
  const [documents, setDocuments] = useState<RepositoryDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(UPLOADS_BATCH_SIZE);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryLatestUploads. */ () => {
        /* Делает: Выполняет load. Применение: используется внутри функции useEffectCallback. */
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
        {loading && <div className='repository-latest-uploads__state'>Загрузка...</div>}
        {error && <div className='repository-latest-uploads__state repository-latest-uploads__state--error'>{error}</div>}

        {!loading && !error && (
          <RepositoryDocumentsTable
            documents={visibleDocuments}
            emptyText='В репозитории пока нет загруженных материалов.'
            compact
            visibleAuthorsCount={7}
          />
        )}

        {!loading && !error && documents.length > 0 && (
          <div className='repository-latest-uploads__footer'>
            <p className='repository-latest-uploads__lead'>
              Показано {Math.min(visibleCount, documents.length)} из {documents.length} записей репозитория.
            </p>
            <div className='repository-latest-uploads__actions'>
              <button
                type='button'
                className='repository-latest-uploads__more-button'
                disabled={!hasMoreDocuments}
                onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryLatestUploads/RepositoryLatestUploads.tsx. */ () => setVisibleCount(/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryLatestUploads/RepositoryLatestUploads.tsx. */ (current) => Math.min(current + UPLOADS_BATCH_SIZE, documents.length))}
              >
                Ещё
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
