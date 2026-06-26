import { useEffect, useMemo, useState } from 'react';
import RepositoryDocumentsTable from '@/components/RepositoryDocumentsTable/RepositoryDocumentsTable';
import { repositoryService } from '@/services/repositoryService';
import type { RepositoryDocumentSummary } from '@/types/repository';
import { filterDocumentsByQuery, sortDocumentsByDateDesc } from '@/utils/repositoryDocuments';
import './RepositorySearch.scss';

/* Делает: Рендерит React-компонент RepositorySearch и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function RepositorySearch() {
  const [documents, setDocuments] = useState<RepositoryDocumentSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositorySearch. */ () => {
        /* Делает: Выполняет load. Применение: используется внутри функции useEffectCallback. */
    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const data = await repositoryService.getRepository();
        setDocuments(sortDocumentsByDateDesc(data.documents));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить список документов.');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const filteredDocuments = useMemo(/* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositorySearch. */ () => filterDocumentsByQuery(documents, query), [documents, query]);

  return (
    <section className='repository-search'>
      <div className='repository-search__container'>
        <h1>Поиск</h1>
        <p className='repository-search__lead'>
          Введите часть даты, названия, авторов, описания или DOI. Несоответствующие записи автоматически скрываются из таблицы.
        </p>

        <input
          type='search'
          className='repository-search__input'
          value={query}
          onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositorySearch/RepositorySearch.tsx. */ (event) => setQuery(event.target.value)}
          placeholder='Поиск по дате, авторам, названию, аннотации и DOI'
        />

        {loading && <div className='repository-search__state'>Загрузка...</div>}
        {error && <div className='repository-search__state repository-search__state--error'>{error}</div>}

        {!loading && !error && (
          <RepositoryDocumentsTable
            documents={filteredDocuments}
            emptyText='По заданному поисковому запросу записи не найдены.'
            compact
            visibleAuthorsCount={7}
          />
        )}
      </div>
    </section>
  );
}
