import { Link } from 'react-router-dom';
import { useEffect, useEffectEvent, useState } from 'react';
import EarthquakeMapPreview from '@gsras-components/EarthquakeMapPreview/EarthquakeMapPreview';
import HtmlContent from '@gsras-components/HtmlContent/HtmlContent';
import { useGsrasNewsData } from '@gsras-hooks/useGsrasNewsData';
import { formatDateLabel, getCarouselItems, getEarthquakePreviewPoints, normalizeEarthquakeUpdates } from '@gsras-utils/news';
import { getLegacyMapUrl, getLegacySsdUrl, localizePath } from '@gsras-utils/siteLanguage';
import './NewsHome.scss';

const FEATURED_VISIBLE_COUNT = 3;
const FEATURED_ROTATION_INTERVAL = 15000;

/* Делает: Рендерит React-компонент HomeState и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function HomeState({ tone = 'default', children }) {
  return <div className={`news-home__state${tone === 'error' ? ' news-home__state--error' : ''}`}>{children}</div>;
}

const copy = {
  ru: {
    loading: 'Загрузка новостей...',
    loadError: 'Не удалось загрузить данные новости.',
    updateHint: 'Проверьте доступность GS RAS новостей или загрузите обновленные файлы через админ-панель.',
    eyebrow: 'Новости',
    headline: 'Новости ФИЦ ЕГС РАН',
    lead:
      'Актуальные публикации, архив новостей и оперативные сообщения ССД в официальном новостном разделе сайта.',
    openArchive: 'Открыть архив',
    wholeSite: 'На главную',
    latestQuake: 'Последнее землетрясение',
    feed: 'Лента',
    feedTitle: 'Актуальные карточки новостей',
    back: 'Назад',
    forward: 'Вперёд',
    headlineTag: 'Главная новость',
    openInArchive: 'Открыть в архиве',
    ssd: 'ССД',
    quakeTitle: 'Последние сообщения о землетрясениях',
    openWorkspace: 'Рабочее место ССД',
    openMap: 'Карта землетрясений',
    seismicReview: 'Сейсмический обзор',
    localReview: 'Локальный обзор по сообщениям ССД',
    openMessage: 'Открыть карту',
    created: 'Создано',
    updated: 'Обновлено',
    ssdUnavailable: 'Сообщения ССД временно недоступны.',
    archive: 'Архив',
    archiveTitle: 'Последние записи из полного архива',
    allYears: 'Смотреть все годы',
    details: 'Подробнее',
  },
  en: {
    loading: 'Loading news feed...',
    loadError: 'Failed to load news data.',
    updateHint: 'Check GS RAS news availability or upload updated files through the admin panel.',
    eyebrow: 'News',
    headline: 'GS RAS News',
    lead:
      'Current publications, the news archive and rapid-reporting updates in the official news section of the site.',
    openArchive: 'Open archive',
    wholeSite: 'Home',
    latestQuake: 'Latest earthquake',
    feed: 'Feed',
    feedTitle: 'Current news cards',
    back: 'Back',
    forward: 'Next',
    headlineTag: 'Featured news',
    openInArchive: 'Open in archive',
    ssd: 'Alert Service',
    quakeTitle: 'Latest earthquake reports',
    openWorkspace: 'Alert workspace',
    openMap: 'Earthquake map',
    seismicReview: 'Seismic overview',
    localReview: 'Local overview based on alert-service reports',
    openMessage: 'Open map',
    created: 'Created',
    updated: 'Updated',
    ssdUnavailable: 'Alert-service reports are temporarily unavailable.',
    archive: 'Archive',
    archiveTitle: 'Latest entries from the full archive',
    allYears: 'Browse all years',
    details: 'Details',
  },
};

/* Делает: Рендерит React-компонент NewsHome и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function NewsHome({ locale = 'ru' }) {
  const currentCopy = copy[locale] ?? copy.ru;
  const { data, loading, error } = useGsrasNewsData();
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const featuredNews = data?.featuredNews ?? [];
  const archivePreview = (data?.archiveEntries ?? []).slice(0, 6);
  const earthquakeUpdates = normalizeEarthquakeUpdates(data?.earthquake?.updates ?? []);
  const latestEarthquakeUpdate = earthquakeUpdates[0] ?? null;
  const quakePreviewPoints = getEarthquakePreviewPoints(earthquakeUpdates, 8);
  const visibleFeaturedNews = getCarouselItems(featuredNews, featuredIndex, FEATURED_VISIBLE_COUNT);
  const legacySsdUrl = getLegacySsdUrl(locale);
  const legacyMapUrl = getLegacyMapUrl(locale);

  const rotateFeatured = useEffectEvent(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в useEffectEvent внутри NewsHome. */ (direction) => {
    setFeaturedIndex(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setFeaturedIndex внутри useEffectEventCallback. */ (currentIndex) => {
      if (!featuredNews.length) {
        return 0;
      }

      const nextIndex = (currentIndex + direction + featuredNews.length) % featuredNews.length;
      return nextIndex;
    });
  });

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри NewsHome. */ () => {
    if (featuredNews.length <= FEATURED_VISIBLE_COUNT) {
      return undefined;
    }

    const intervalId = window.setInterval(/* Делает: Запускает периодическое действие по таймеру. Применение: передаётся как callback в setInterval внутри useEffectCallback. */ () => {
      rotateFeatured(1);
    }, FEATURED_ROTATION_INTERVAL);

    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => {
      window.clearInterval(intervalId);
    };
  }, [featuredNews.length, rotateFeatured]);

  if (loading) {
    return (
      <section className='news-home'>
        <div className='news-home__container'>
          <HomeState>{currentCopy.loading}</HomeState>
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className='news-home'>
        <div className='news-home__container'>
          <HomeState tone='error'>
            {error ?? currentCopy.loadError} {currentCopy.updateHint}
          </HomeState>
        </div>
      </section>
    );
  }

  return (
    <section className='news-home'>
      <div className='news-home__container'>
        <section className='news-home__hero'>
          <div className='news-home__hero-copy'>
            <span className='news-home__eyebrow'>{currentCopy.eyebrow}</span>
            <h1 className='news-home__headline'>{currentCopy.headline}</h1>
            <p className='news-home__lead'>{currentCopy.lead}</p>
            <div className='news-home__hero-actions'>
              <Link to={localizePath('/news/archive', locale)} className='news-home__primary-action'>
                {currentCopy.openArchive}
              </Link>
              <Link to={localizePath('/', locale)} className='news-home__secondary-action'>
                {currentCopy.wholeSite}
              </Link>
            </div>
          </div>
        </section>

        {data.earthquake.latest && (
          <section className='news-home__ticker' aria-label={currentCopy.latestQuake}>
            <div className='news-home__ticker-badge'>{currentCopy.latestQuake}</div>
            <p className='news-home__ticker-text'>{data.earthquake.latest.message}</p>
          </section>
        )}

        <section className='news-home__section'>
          <div className='news-home__section-head'>
            <div>
              <span className='news-home__section-eyebrow'>{currentCopy.feed}</span>
              <h2 className='news-home__section-title'>{currentCopy.feedTitle}</h2>
            </div>

            {featuredNews.length > FEATURED_VISIBLE_COUNT && (
              <div className='news-home__carousel-actions'>
                <button type='button' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/gsras/pages/NewsHome/NewsHome.jsx. */ () => rotateFeatured(-1)} className='news-home__carousel-button'>
                  {currentCopy.back}
                </button>
                <button type='button' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/gsras/pages/NewsHome/NewsHome.jsx. */ () => rotateFeatured(1)} className='news-home__carousel-button'>
                  {currentCopy.forward}
                </button>
              </div>
            )}
          </div>

          <div className='news-home__featured-grid'>
            {visibleFeaturedNews.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри NewsHome. */ (item) => (
              <article key={item.id} className='news-home__featured-card'>
                <div className='news-home__featured-meta'>
                  <span className='news-home__featured-date'>{formatDateLabel(item.date, locale)}</span>
                  <span className='news-home__featured-tag'>{currentCopy.headlineTag}</span>
                </div>
                <h3 className='news-home__featured-title'>{item.title}</h3>

                {item.imageUrl && <img src={item.imageUrl} alt='' className='news-home__featured-image' loading='lazy' />}

                <p className='news-home__featured-excerpt'>{item.excerpt}</p>

                <div className='news-home__featured-links'>
                  <Link to={localizePath(`/news/archive?entry=${item.id}`, locale)} className='news-home__card-action'>
                    {currentCopy.openInArchive}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className='news-home__section'>
          <div className='news-home__section-head'>
            <div>
              <span className='news-home__section-eyebrow'>{currentCopy.ssd}</span>
              <h2 className='news-home__section-title'>{currentCopy.quakeTitle}</h2>
            </div>
            <div className='news-home__section-links'>
              <a href={legacySsdUrl} className='news-home__section-link news-home__section-link--button'>
                {currentCopy.openWorkspace}
              </a>
              <a href={legacyMapUrl} className='news-home__section-link news-home__section-link--button'>
                {currentCopy.openMap}
              </a>
            </div>
          </div>

          <div className='news-home__quake-layout'>
            {latestEarthquakeUpdate && (
              <article className='news-home__quake-map-card'>
                <EarthquakeMapPreview
                  points={quakePreviewPoints}
                  label={currentCopy.seismicReview}
                  title={latestEarthquakeUpdate.title}
                  subtitle={latestEarthquakeUpdate.messageText}
                  footnote={latestEarthquakeUpdate.created ? `${currentCopy.created} ${latestEarthquakeUpdate.created}` : ''}
                  locale={locale}
                  className='news-home__quake-map'
                />
                <div className='news-home__quake-map-meta'>
                  <span>{latestEarthquakeUpdate.updated ? `${currentCopy.updated} ${latestEarthquakeUpdate.updated}` : currentCopy.localReview}</span>
                </div>
                <a href={legacyMapUrl} className='news-home__card-action'>
                  {currentCopy.openMessage}
                </a>
              </article>
            )}

            <div className='news-home__quake-list'>
              {earthquakeUpdates.length > 0 ? (
                earthquakeUpdates.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри NewsHome. */ (update) => (
                  <article key={update.id} className='news-home__quake-card'>
                    <h3 className='news-home__quake-title'>{update.title}</h3>
                    <HtmlContent html={update.messageHtml} className='news-home__quake-content' />
                    <div className='news-home__quake-footer'>
                      <div className='news-home__quake-meta'>
                        <span>{currentCopy.created}: {update.created}</span>
                        <span>{currentCopy.updated}: {update.updated}</span>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <HomeState>{currentCopy.ssdUnavailable}</HomeState>
              )}
            </div>
          </div>
        </section>

        <section className='news-home__section'>
          <div className='news-home__section-head'>
            <div>
              <span className='news-home__section-eyebrow'>{currentCopy.archive}</span>
              <h2 className='news-home__section-title'>{currentCopy.archiveTitle}</h2>
            </div>
            <Link to={localizePath('/news/archive', locale)} className='news-home__section-link news-home__section-link--button'>
              {currentCopy.allYears}
            </Link>
          </div>

          <div className='news-home__archive-preview'>
            {archivePreview.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри NewsHome. */ (entry) => (
              <article key={entry.id} className='news-home__archive-card'>
                <span className='news-home__archive-date'>{formatDateLabel(entry.date, locale)}</span>
                <h3 className='news-home__archive-title'>{entry.title}</h3>
                <p className='news-home__archive-excerpt'>{entry.excerpt}</p>
                <div className='news-home__featured-links'>
                  <Link to={localizePath(`/news/archive?entry=${entry.id}`, locale)} className='news-home__card-action'>
                    {currentCopy.details}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

