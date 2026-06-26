import { Link } from 'react-router-dom';
import { startTransition, useDeferredValue, useState } from 'react';
import { useGsrasSiteData } from '@gsras-hooks/useGsrasSiteData';
import { buildPagePreview, filterSitePages, getPageRoute, getSectionRoute } from '@gsras-utils/siteContent';
import { getLegacyPageUrl, getLegacySectionUrl, getLegacySsdUrl, localizePath } from '@gsras-utils/siteLanguage';
import './SiteHome.scss';

/* Делает: Рендерит React-компонент SiteHomeState и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function SiteHomeState({ tone = 'default', children }) {
  return <div className={`site-home__state${tone === 'error' ? ' site-home__state--error' : ''}`}>{children}</div>;
}

const copy = {
  ru: {
    loading: 'Загрузка разделов сайта...',
    loadError: 'Не удалось загрузить карту сайта.',
    updateHint: 'Проверьте доступность GS RAS данных или загрузите обновленные файлы через админ-панель.',
    eyebrow: 'Официальный портал',
    headline: 'ФИЦ ЕГС РАН',
    lead:
      'Официальный сайт центра с новостями, публикациями, структурой, научными материалами и сервисами ССД на русском и английском языках.',
    openNews: 'Открыть новости',
    ssd: 'ССД',
    sectionsEyebrow: 'Разделы',
    sectionsTitle: 'Основные разделы сайта',
    openSection: 'Перейти в раздел',
    searchEyebrow: 'Поиск',
    searchTitle: 'Поиск по материалам сайта',
    queryLabel: 'Текст запроса',
    queryPlaceholder: 'Например: журнал, структура, конференция, вакансия...',
    sectionLabel: 'Раздел',
    allSections: 'Все разделы',
    open: 'Открыть материал',
    noResults: 'По текущему запросу ничего не найдено. Попробуйте другой термин или раздел.',
  },
  en: {
    loading: 'Loading site sections...',
    loadError: 'Failed to load the site map.',
    updateHint: 'Check GS RAS data availability or upload updated files through the admin panel.',
    eyebrow: 'Official portal',
    headline: 'GS RAS',
    lead:
      'The official website of the center with news, publications, institutional information, scientific materials and rapid reporting tools in Russian and English.',
    openNews: 'Open news',
    ssd: 'Alert Service',
    sectionsEyebrow: 'Sections',
    sectionsTitle: 'Main site sections',
    openSection: 'Open section',
    searchEyebrow: 'Search',
    searchTitle: 'Search across site materials',
    queryLabel: 'Search text',
    queryPlaceholder: 'For example: journal, structure, conference, vacancy...',
    sectionLabel: 'Section',
    allSections: 'All sections',
    open: 'Open page',
    noResults: 'No materials matched the current filter. Try a different term or section.',
  },
};

/* Делает: Рендерит React-компонент SiteHome и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function SiteHome({ locale = 'ru' }) {
  const currentCopy = copy[locale] ?? copy.ru;
  const { data, loading, error } = useGsrasSiteData(locale);
  const [query, setQuery] = useState('');
  const [sectionId, setSectionId] = useState('all');
  const deferredQuery = useDeferredValue(query);
  const filteredPages = data ? filterSitePages(data.pages, deferredQuery, sectionId).slice(0, 12) : [];
  const legacySsdUrl = getLegacySsdUrl(locale);

  if (loading) {
    return (
      <section className='site-home'>
        <div className='site-home__container'>
          <SiteHomeState>{currentCopy.loading}</SiteHomeState>
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className='site-home'>
        <div className='site-home__container'>
          <SiteHomeState tone='error'>
            {error ?? currentCopy.loadError} {currentCopy.updateHint}
          </SiteHomeState>
        </div>
      </section>
    );
  }

  return (
    <section className='site-home'>
      <div className='site-home__container'>
        <section className='site-home__hero'>
          <div className='site-home__hero-copy'>
            <span className='site-home__eyebrow'>{currentCopy.eyebrow}</span>
            <h1 className='site-home__headline'>{currentCopy.headline}</h1>
            <p className='site-home__lead'>{currentCopy.lead}</p>
            <div className='site-home__hero-actions'>
              <Link to={localizePath('/news', locale)} className='site-home__primary-action'>
                {currentCopy.openNews}
              </Link>
              <a href={legacySsdUrl} className='site-home__secondary-action'>
                {currentCopy.ssd}
              </a>
            </div>
          </div>
        </section>

        <section className='site-home__section'>
          <div className='site-home__section-head'>
            <div>
              <span className='site-home__section-eyebrow'>{currentCopy.sectionsEyebrow}</span>
              <h2 className='site-home__section-title'>{currentCopy.sectionsTitle}</h2>
            </div>
          </div>

          <div className='site-home__section-grid'>
            {data.sectionSummaries.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри SiteHome. */ (section) => (
              <article key={section.id} className='site-home__section-card'>
                <h3 className='site-home__section-card-title'>{section.label}</h3>
                <p className='site-home__section-card-description'>{section.description}</p>
                <div className='site-home__section-samples'>
                  {[...new Set(section.sampleTitles)].map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри mapCallback. */ (title) => (
                    <span key={title} className='site-home__section-sample'>
                      {title}
                    </span>
                  ))}
                </div>
                {getLegacySectionUrl(section.id, locale) ? (
                  <a href={getLegacySectionUrl(section.id, locale)} className='site-home__card-action'>
                    {currentCopy.openSection}
                  </a>
                ) : (
                  <Link to={getSectionRoute(section.id, locale)} className='site-home__card-action'>
                    {currentCopy.openSection}
                  </Link>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className='site-home__section'>
          <div className='site-home__section-head'>
            <div>
              <span className='site-home__section-eyebrow'>{currentCopy.searchEyebrow}</span>
              <h2 className='site-home__section-title'>{currentCopy.searchTitle}</h2>
            </div>
          </div>

          <div className='site-home__search-panel'>
            <label className='site-home__field'>
              <span className='site-home__field-label'>{currentCopy.queryLabel}</span>
              <input
                type='search'
                className='site-home__input'
                value={query}
                placeholder={currentCopy.queryPlaceholder}
                onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/gsras/pages/SiteHome/SiteHome.jsx. */ (event) => {
                  const nextValue = event.target.value;
                  startTransition(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/gsras/pages/SiteHome/SiteHome.jsx. */ () => {
                    setQuery(nextValue);
                  });
                }}
              />
            </label>

            <label className='site-home__field site-home__field--small'>
              <span className='site-home__field-label'>{currentCopy.sectionLabel}</span>
              <select
                className='site-home__select'
                value={sectionId}
                onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/gsras/pages/SiteHome/SiteHome.jsx. */ (event) => {
                  const nextValue = event.target.value;
                  startTransition(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/gsras/pages/SiteHome/SiteHome.jsx. */ () => {
                    setSectionId(nextValue);
                  });
                }}
              >
                <option value='all'>{currentCopy.allSections}</option>
                {data.sectionSummaries.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри SiteHome. */ (section) => (
                  <option key={section.id} value={section.id}>
                    {section.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className='site-home__results'>
            {filteredPages.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри SiteHome. */ (page) => {
              const preview = buildPagePreview(page, data.pages, locale);

              return (
                <article key={page.id} className='site-home__result-card'>
                  <span className='site-home__result-section'>{page.sectionLabel}</span>
                <h3 className='site-home__result-title'>{page.title}</h3>
                {preview && <p className='site-home__result-excerpt'>{preview}</p>}
                <div className='site-home__result-actions'>
                  {getLegacyPageUrl(page, locale) ? (
                    <a href={getLegacyPageUrl(page, locale)} className='site-home__card-action'>
                      {currentCopy.open}
                    </a>
                  ) : (
                    <Link to={getPageRoute(page, locale)} className='site-home__card-action'>
                      {currentCopy.open}
                    </Link>
                  )}
                </div>
              </article>
            );
            })}

            {filteredPages.length === 0 && (
              <SiteHomeState tone='error'>{currentCopy.noResults}</SiteHomeState>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

