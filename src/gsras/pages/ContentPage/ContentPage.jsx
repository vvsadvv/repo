import { Link, Navigate, useParams } from 'react-router-dom';
import HtmlContent from '@gsras-components/HtmlContent/HtmlContent';
import { useGsrasSiteData } from '@gsras-hooks/useGsrasSiteData';
import { useGsrasSitePageData } from '@gsras-hooks/useGsrasSitePageData';
import { getHomeRoute, getLegacyPageUrl, getLegacySectionUrl } from '@gsras-utils/siteLanguage';
import {
  buildNativePageHtml,
  buildPageLead,
  getPageById,
  getPageRoute,
  getPagesBySection,
  getSectionRoute,
} from '@gsras-utils/siteContent';
import './ContentPage.scss';

/* Делает: Рендерит React-компонент ContentPageState и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function ContentPageState({ tone = 'default', children }) {
  return <div className={`content-page__state${tone === 'error' ? ' content-page__state--error' : ''}`}>{children}</div>;
}

/* Делает: Определяет, нужно ли изображение render cover. Применение: используется локально в файле src/gsras/pages/ContentPage/ContentPage.jsx. */
function shouldRenderCoverImage(imageUrl) {
  if (!imageUrl) {
    return false;
  }

  return !/\/(?:fon\d*|cor\d+|gor(?:_b)?|vert(?:_r)?|tri_[a-z]+|gs-logo|vk_icon|instagram_icon)\.(?:gif|png|jpe?g|svg)$/i.test(
    imageUrl
  );
}

const copy = {
  ru: {
    loading: 'Загрузка страницы...',
    loadError: 'Не удалось загрузить страницу.',
    home: 'Главная',
    section: 'К разделу',
    moreInSection: 'Еще в разделе',
  },
  en: {
    loading: 'Loading page...',
    loadError: 'Failed to load page.',
    home: 'Home',
    section: 'Back to section',
    moreInSection: 'More in this section',
  },
};

/* Делает: Рендерит React-компонент ContentPage и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function ContentPage({ locale = 'ru' }) {
  const currentCopy = copy[locale] ?? copy.ru;
  const { pageId } = useParams();
  const { data, loading, error } = useGsrasSiteData(locale);
  const pageSummary = pageId && data ? getPageById(data.pages, pageId) : null;
  const {
    data: page,
    loading: pageLoading,
    error: pageError,
  } = useGsrasSitePageData(pageSummary);

  if (!pageId) {
    return <Navigate to={getHomeRoute(locale)} replace />;
  }

  if (loading || (pageSummary && pageLoading)) {
    return (
      <section className='content-page'>
        <div className='content-page__container'>
          <ContentPageState>{currentCopy.loading}</ContentPageState>
        </div>
      </section>
    );
  }

  if (error || pageError || !data) {
    return (
      <section className='content-page'>
        <div className='content-page__container'>
          <ContentPageState tone='error'>{error ?? pageError ?? currentCopy.loadError}</ContentPageState>
        </div>
      </section>
    );
  }

  if (!page) {
    return <Navigate to={getHomeRoute(locale)} replace />;
  }

  const pagesForContent = data.pages.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри ContentPage. */ (candidate) => (candidate.id === page.id ? page : candidate));
  const relatedPages = getPagesBySection(data.pages, page.sectionId)
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри ContentPage. */ (candidate) => candidate.id !== page.id)
    .slice(0, 10);
  const nativeHtml = buildNativePageHtml(page, pagesForContent, locale);
  const lead = buildPageLead(page, nativeHtml);
  const legacySectionUrl = getLegacySectionUrl(page.sectionId, locale);

  return (
    <section className='content-page'>
      <div className='content-page__container'>
        <div className='content-page__hero'>
          <div className='content-page__breadcrumbs'>
            <Link to={getHomeRoute(locale)}>{currentCopy.home}</Link>
            <span>/</span>
            {legacySectionUrl ? (
              <a href={legacySectionUrl}>{page.sectionLabel}</a>
            ) : (
              <Link to={getSectionRoute(page.sectionId, locale)}>{page.sectionLabel}</Link>
            )}
          </div>

          <div className='content-page__hero-main'>
            <div>
              <span className='content-page__tag'>{page.sectionLabel}</span>
              <h1 className='content-page__headline'>{page.title}</h1>
              {lead && <p className='content-page__lead'>{lead}</p>}
            </div>

            <div className='content-page__hero-actions'>
              {legacySectionUrl ? (
                <a href={legacySectionUrl} className='content-page__primary-action'>
                  {currentCopy.section}
                </a>
              ) : (
                <Link to={getSectionRoute(page.sectionId, locale)} className='content-page__primary-action'>
                  {currentCopy.section}
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className='content-page__layout'>
          <article className='content-page__article'>
            {shouldRenderCoverImage(page.imageUrl) && (
              <img src={page.imageUrl} alt='' className='content-page__cover' loading='lazy' />
            )}
            <HtmlContent html={nativeHtml} className='content-page__html' />
          </article>

          <aside className='content-page__sidebar'>
            <div className='content-page__sidebar-panel'>
              <span className='content-page__sidebar-title'>{currentCopy.moreInSection}</span>
              <div className='content-page__sidebar-links'>
                {relatedPages.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри ContentPage. */ (relatedPage) => (
                  getLegacyPageUrl(relatedPage, locale) ? (
                    <a key={relatedPage.id} href={getLegacyPageUrl(relatedPage, locale)} className='content-page__sidebar-link'>
                      {relatedPage.title}
                    </a>
                  ) : (
                    <Link key={relatedPage.id} to={getPageRoute(relatedPage, locale)} className='content-page__sidebar-link'>
                      {relatedPage.title}
                    </Link>
                  )
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
