import { startTransition, useDeferredValue, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import HtmlContent from '@gsras-components/HtmlContent/HtmlContent';
import { useGsrasNewsData } from '@gsras-hooks/useGsrasNewsData';
import { filterArchiveEntries, formatDateLabel, groupEntriesByYear, sanitizeNewsHtml } from '@gsras-utils/news';
import './NewsArchive.scss';

/* Делает: Рендерит React-компонент ArchiveState и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function ArchiveState({ tone = 'default', children }) {
  return <div className={`news-archive__state${tone === 'error' ? ' news-archive__state--error' : ''}`}>{children}</div>;
}

const copy = {
  ru: {
    loading: 'Загрузка полного архива новостей...',
    loadError: 'Не удалось загрузить архив новостей.',
    eyebrow: 'Архив',
    headline: 'Полная история публикаций',
    lead: 'Архив новостей ФИЦ ЕГС РАН с поиском по годам и тексту.',
    searchLabel: 'Поиск по заголовку и тексту',
    searchPlaceholder: 'Например: Камчатка, конкурс, журнал...',
    yearLabel: 'Год',
    allYears: 'Все годы',
    yearsNav: 'Переход по годам',
    noResults: 'По текущему фильтру ничего не найдено. Попробуйте изменить запрос или выбрать другой год.',
    collapse: 'Свернуть',
    expand: 'Показать полностью',
  },
  en: {
    loading: 'Loading full news archive...',
    loadError: 'Failed to load the news archive.',
    eyebrow: 'Archive',
    headline: 'Full publication history',
    lead: 'GS RAS news archive with year-based navigation and full-text filtering.',
    searchLabel: 'Search in title and text',
    searchPlaceholder: 'For example: Kamchatka, competition, journal...',
    yearLabel: 'Year',
    allYears: 'All years',
    yearsNav: 'Jump by year',
    noResults: 'Nothing matched the current filter. Try changing the query or year.',
    collapse: 'Collapse',
    expand: 'Show full entry',
  },
};

/* Делает: Рендерит React-компонент NewsArchive и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function NewsArchive({ locale = 'ru' }) {
  const currentCopy = copy[locale] ?? copy.ru;
  const { data, loading, error } = useGsrasNewsData();
  const [searchParams] = useSearchParams();
  const initialEntryId = searchParams.get('entry');
  const [query, setQuery] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [expandedIds, setExpandedIds] = useState(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в useState внутри NewsArchive. */ () => new Set(initialEntryId ? [initialEntryId] : []));
  const deferredQuery = useDeferredValue(query);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри NewsArchive. */ () => {
    if (!initialEntryId) {
      return;
    }

    setExpandedIds(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setExpandedIds внутри useEffectCallback. */ (currentExpandedIds) => {
      const nextExpandedIds = new Set(currentExpandedIds);
      nextExpandedIds.add(initialEntryId);
      return nextExpandedIds;
    });

    const targetElement = document.getElementById(initialEntryId);

    if (!targetElement) {
      return;
    }

    window.requestAnimationFrame(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в requestAnimationFrame внутри useEffectCallback. */ () => {
      targetElement.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      });
    });
  }, [initialEntryId]);

  if (loading) {
    return (
      <section className='news-archive'>
        <div className='news-archive__container'>
          <ArchiveState>{currentCopy.loading}</ArchiveState>
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className='news-archive'>
        <div className='news-archive__container'>
          <ArchiveState tone='error'>{error ?? currentCopy.loadError}</ArchiveState>
        </div>
      </section>
    );
  }

  const filteredEntries = filterArchiveEntries(data.archiveEntries, deferredQuery, yearFilter);
  const groupedEntries = groupEntriesByYear(filteredEntries);

    /* Делает: Обрабатывает query change. Применение: используется внутри функции NewsArchive. */
  const handleQueryChange = (event) => {
    const nextValue = event.target.value;

    startTransition(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в startTransition внутри handleQueryChange. */ () => {
      setQuery(nextValue);
    });
  };

    /* Делает: Обрабатывает year change. Применение: используется внутри функции NewsArchive. */
  const handleYearChange = (event) => {
    const nextValue = event.target.value;

    startTransition(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в startTransition внутри handleYearChange. */ () => {
      setYearFilter(nextValue);
    });
  };

    /* Делает: Переключает expanded. Применение: используется внутри функции NewsArchive. */
  const toggleExpanded = (entryId) => {
    setExpandedIds(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setExpandedIds внутри toggleExpanded. */ (currentExpandedIds) => {
      const nextExpandedIds = new Set(currentExpandedIds);

      if (nextExpandedIds.has(entryId)) {
        nextExpandedIds.delete(entryId);
      } else {
        nextExpandedIds.add(entryId);
      }

      return nextExpandedIds;
    });
  };

  return (
    <section className='news-archive'>
      <div className='news-archive__container'>
        <section className='news-archive__hero'>
          <div>
            <span className='news-archive__eyebrow'>{currentCopy.eyebrow}</span>
            <h1 className='news-archive__headline'>{currentCopy.headline}</h1>
            <p className='news-archive__lead'>{currentCopy.lead}</p>
          </div>
        </section>

        <section className='news-archive__filters'>
          <label className='news-archive__field'>
            <span className='news-archive__field-label'>{currentCopy.searchLabel}</span>
            <input
              type='search'
              className='news-archive__input'
              placeholder={currentCopy.searchPlaceholder}
              value={query}
              onChange={handleQueryChange}
            />
          </label>

          <label className='news-archive__field news-archive__field--small'>
            <span className='news-archive__field-label'>{currentCopy.yearLabel}</span>
            <select className='news-archive__select' value={yearFilter} onChange={handleYearChange}>
              <option value='all'>{currentCopy.allYears}</option>
              {data.archiveYears.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри NewsArchive. */ (yearInfo) => (
                <option key={yearInfo.year} value={yearInfo.year}>
                  {yearInfo.year}
                </option>
              ))}
            </select>
          </label>
        </section>

        <div className='news-archive__layout'>
          <aside className='news-archive__sidebar'>
            <div className='news-archive__sidebar-panel'>
              <span className='news-archive__sidebar-title'>{currentCopy.yearsNav}</span>
              <div className='news-archive__year-links'>
                {groupedEntries.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри NewsArchive. */ (group) => (
                  <a key={group.year} href={`#year-${group.year}`} className='news-archive__year-link'>
                    {group.year}
                  </a>
                ))}
              </div>
            </div>
          </aside>

          <div className='news-archive__content'>
            {groupedEntries.length === 0 && (
              <ArchiveState tone='error'>{currentCopy.noResults}</ArchiveState>
            )}

            {groupedEntries.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри NewsArchive. */ (group) => (
              <section key={group.year} id={`year-${group.year}`} className='news-archive__year-section'>
                <div className='news-archive__year-head'>
                  <h2 className='news-archive__year-title'>{group.year}</h2>
                </div>

                <div className='news-archive__entries'>
                  {group.entries.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри mapCallback. */ (entry) => {
                    const expanded = expandedIds.has(entry.id);

                    return (
                      <article key={entry.id} id={entry.id} className='news-archive__entry-card'>
                        <div className='news-archive__entry-head'>
                          <div className='news-archive__entry-meta'>
                            <span className='news-archive__entry-date'>{formatDateLabel(entry.date, locale)}</span>
                            <span className='news-archive__entry-year'>{entry.year}</span>
                          </div>
                          <h3 className='news-archive__entry-title'>{entry.title}</h3>
                        </div>

                        {entry.imageUrl && <img src={entry.imageUrl} alt='' className='news-archive__entry-image' loading='lazy' />}

                        <p className='news-archive__entry-excerpt'>{entry.excerpt}</p>

                        <div className='news-archive__entry-actions'>
                          <button type='button' className='news-archive__toggle' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/gsras/pages/NewsArchive/NewsArchive.jsx. */ () => toggleExpanded(entry.id)}>
                            {expanded ? currentCopy.collapse : currentCopy.expand}
                          </button>
                        </div>

                        {expanded && (
                          <HtmlContent
                            html={sanitizeNewsHtml(entry.bodyHtml, data.archiveEntries, locale)}
                            className='news-archive__entry-content'
                          />
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

