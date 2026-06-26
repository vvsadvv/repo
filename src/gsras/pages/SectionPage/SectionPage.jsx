import { Link, Navigate, useParams } from 'react-router-dom';
import { startTransition, useDeferredValue, useState } from 'react';
import { useGsrasSiteData } from '@gsras-hooks/useGsrasSiteData';
import { getHomeRoute, getLegacyPageUrl, getSectionShortcutDefinitions, localizePath } from '@gsras-utils/siteLanguage';
import {
  buildPagePreview,
  filterSitePages,
  getPageRoute,
  getPagesBySection,
  getSectionRoute,
} from '@gsras-utils/siteContent';
import SsdWorkspace from '@gsras-pages/SsdWorkspace/SsdWorkspace';
import './SectionPage.scss';

/* Делает: Рендерит React-компонент SectionPageState и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function SectionPageState({ tone = 'default', children }) {
  return <div className={`section-page__state${tone === 'error' ? ' section-page__state--error' : ''}`}>{children}</div>;
}

const copy = {
  ru: {
    loading: 'Загрузка раздела...',
    loadError: 'Не удалось загрузить раздел.',
    allSections: 'Все разделы',
    subsections: 'Подразделы',
    quickAccess: 'Быстрый доступ по разделу',
    externalResource: 'Внешний ресурс',
    searchLabel: 'Поиск по разделу',
    searchPlaceholder: 'Введите ключевое слово...',
    openPage: 'Открыть страницу',
    noResults: 'В этом разделе ничего не найдено. Попробуйте изменить поисковый запрос или вернуться к общей карте.',
    homeMap: 'На главную карту',
  },
  en: {
    loading: 'Loading section...',
    loadError: 'Failed to load section.',
    allSections: 'All sections',
    subsections: 'Subsections',
    quickAccess: 'Quick access in this section',
    externalResource: 'External resource',
    searchLabel: 'Search inside section',
    searchPlaceholder: 'Enter a keyword...',
    openPage: 'Open page',
    noResults: 'Nothing matched inside this section. Try another search term or return to the site map.',
    homeMap: 'Back to site map',
  },
};

/* Делает: Рендерит React-компонент SectionPage и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function SectionPage({ locale = 'ru' }) {
  const currentCopy = copy[locale] ?? copy.ru;
  const { sectionId } = useParams();
  const { data, loading, error } = useGsrasSiteData(locale);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  if (!sectionId) {
    return <Navigate to={getHomeRoute(locale)} replace />;
  }

  if (sectionId === 'news') {
    return <Navigate to={localizePath('/news', locale)} replace />;
  }

  if (sectionId === 'ssd') {
    return <SsdWorkspace locale={locale} />;
  }

  if (loading) {
    return (
      <section className='section-page'>
        <div className='section-page__container'>
          <SectionPageState>{currentCopy.loading}</SectionPageState>
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className='section-page'>
        <div className='section-page__container'>
          <SectionPageState tone='error'>{error ?? currentCopy.loadError}</SectionPageState>
        </div>
      </section>
    );
  }

  const summary = data.sectionSummaries.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри SectionPage. */ (item) => item.id === sectionId);

  if (!summary) {
    return <Navigate to={getHomeRoute(locale)} replace />;
  }

  const pages = getPagesBySection(data.pages, sectionId);
  const filteredPages = filterSitePages(pages, deferredQuery, sectionId);
  const shortcutDefinitions = getSectionShortcutDefinitions(locale, sectionId);
  const sampleTitles = [...new Set(summary.sampleTitles)];
  const shortcuts = shortcutDefinitions
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри SectionPage. */ (shortcut) => {
      if (shortcut.externalUrl) {
        return {
          ...shortcut,
          kind: 'external',
        };
      }

      const page = data.pages.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри mapCallback. */ (candidate) => candidate.sourcePath === shortcut.sourcePath);

      if (!page) {
        return null;
      }

      return {
        ...shortcut,
        kind: 'internal',
        routePath: getPageRoute(page, locale),
        sectionLabel: page.sectionLabel,
      };
    })
    .filter(Boolean);

  return (
    <section className='section-page'>
      <div className='section-page__container'>
        <div className='section-page__hero'>
          <div className='section-page__hero-copy'>
            <Link to={getHomeRoute(locale)} className='section-page__breadcrumb'>
              {currentCopy.allSections}
            </Link>
            <h1 className='section-page__headline'>{summary.label}</h1>
            <p className='section-page__lead'>{summary.description}</p>
          </div>
        </div>

        {shortcuts.length > 0 && (
          <section className='section-page__shortcuts'>
            <div className='section-page__shortcuts-head'>
              <span className='section-page__field-label'>{currentCopy.subsections}</span>
              <h2 className='section-page__shortcuts-title'>{currentCopy.quickAccess}</h2>
            </div>

            <div className='section-page__shortcuts-grid'>
              {shortcuts.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри SectionPage. */ (shortcut) =>
                shortcut.kind === 'internal' ? (
                  <Link key={shortcut.label} to={shortcut.routePath} className='section-page__shortcut-card'>
                    <span className='section-page__shortcut-label'>{shortcut.label}</span>
                    <span className='section-page__shortcut-meta'>{shortcut.sectionLabel}</span>
                  </Link>
                ) : (
                  <a
                    key={shortcut.label}
                    href={shortcut.externalUrl}
                    target='_blank'
                    rel='noreferrer'
                    className='section-page__shortcut-card'
                  >
                    <span className='section-page__shortcut-label'>{shortcut.label}</span>
                    <span className='section-page__shortcut-meta'>{currentCopy.externalResource}</span>
                  </a>
                )
              )}
            </div>
          </section>
        )}

        <div className='section-page__toolbar'>
          <label className='section-page__field'>
            <span className='section-page__field-label'>{currentCopy.searchLabel}</span>
            <input
              type='search'
              className='section-page__input'
              value={query}
              placeholder={currentCopy.searchPlaceholder}
              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/gsras/pages/SectionPage/SectionPage.jsx. */ (event) => {
                const nextValue = event.target.value;
                startTransition(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/gsras/pages/SectionPage/SectionPage.jsx. */ () => {
                  setQuery(nextValue);
                });
              }}
            />
          </label>

          <div className='section-page__quick-links'>
            {sampleTitles.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри SectionPage. */ (title) => (
              <span key={title} className='section-page__sample'>
                {title}
              </span>
            ))}
          </div>
        </div>

        <div className='section-page__grid'>
          {filteredPages.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри SectionPage. */ (page) => {
            const preview = buildPagePreview(page, data.pages, locale);

            return (
              <article key={page.id} className='section-page__card'>
                <div className='section-page__card-meta'>
                  <span className='section-page__card-tag'>{summary.label}</span>
                </div>
                <h2 className='section-page__card-title'>{page.title}</h2>
                {preview && <p className='section-page__card-excerpt'>{preview}</p>}
                <div className='section-page__card-actions'>
                  {getLegacyPageUrl(page, locale) ? (
                    <a href={getLegacyPageUrl(page, locale)} className='section-page__card-action'>
                      {currentCopy.openPage}
                    </a>
                  ) : (
                    <Link to={getPageRoute(page, locale)} className='section-page__card-action'>
                      {currentCopy.openPage}
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {filteredPages.length === 0 && (
          <SectionPageState tone='error'>{currentCopy.noResults}</SectionPageState>
        )}

        <div className='section-page__footer-actions'>
          <Link to={getSectionRoute('home', locale)} className='section-page__secondary-action'>
            {currentCopy.homeMap}
          </Link>
        </div>
      </div>
    </section>
  );
}

