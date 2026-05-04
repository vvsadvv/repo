import { useEffect, useMemo, useState } from 'react';
import RepositoryDocumentsTable from '@/components/RepositoryDocumentsTable/RepositoryDocumentsTable';
import { repositoryService } from '@/services/repositoryService';
import type { RepositoryDocumentSummary } from '@/types/repository';
import { filterDocumentsByQuery, sortDocumentsByDateDesc } from '@/utils/repositoryDocuments';
import './RepositorySearch.scss';

export default function RepositorySearch() {
  const [documents, setDocuments] = useState<RepositoryDocumentSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  const filteredDocuments = useMemo(() => filterDocumentsByQuery(documents, query), [documents, query]);

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
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Поиск по Date, Name (Авторы), Title / Description, DOI'
        />

        {loading && <div className='repository-search__state'>Загрузка...</div>}
        {error && <div className='repository-search__state repository-search__state--error'>{error}</div>}

        {!loading && !error && (
          <RepositoryDocumentsTable
            documents={filteredDocuments}
            emptyText='По заданному поисковому запросу записи не найдены.'
          />
        )}
      </div>
    </section>
  );
}
