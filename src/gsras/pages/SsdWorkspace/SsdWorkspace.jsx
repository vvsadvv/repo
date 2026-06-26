import { Link } from 'react-router-dom';
import EarthquakeMapPreview from '@gsras-components/EarthquakeMapPreview/EarthquakeMapPreview';
import { useGsrasNewsData } from '@gsras-hooks/useGsrasNewsData';
import { getEarthquakePreviewPoints, normalizeEarthquakeUpdates } from '@gsras-utils/news';
import {
  getHomeRoute,
  getLegacyCcdQuakeUrl,
  getLegacyMapCustomUrl,
  getLegacyMapUrl,
  localizePath,
  normalizeLocale,
} from '@gsras-utils/siteLanguage';
import './SsdWorkspace.scss';

/* Делает: Рендерит React-компонент SsdState и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function SsdState({ tone = 'default', children }) {
  return <div className={`ssd-workspace__state${tone === 'error' ? ' ssd-workspace__state--error' : ''}`}>{children}</div>;
}

const copy = {
  ru: {
    loading: 'Загрузка сервисов ССД...',
    loadError: 'Не удалось загрузить данные ССД.',
    allSections: 'Все разделы',
    headline: 'Служба Срочных Донесений',
    lead:
      'Основные сервисы ССД: быстрый доступ к последним землетрясениям, выборкам по количеству, дате и координатам, а также переходам к картам и каталогам.',
    latestMessage: 'Последнее сообщение',
    noData: 'Данные временно недоступны.',
    report: 'Сообщить об ощущаемом землетрясении',
    map: 'Сейсмическая карта',
    mapCopy: 'Временно открыть раздел карты на старом сайте.',
    catalogs: 'Сейсм. данные',
    catalogsCopy: 'Перейти к разделу сейсмических данных и волновых форм.',
    news: 'Новости службы',
    newsCopy: 'Открыть новостной раздел сайта с архивом публикаций.',
    byCount: 'Выбор по количеству землетрясений',
    byDate: 'Выбор по дате землетрясения',
    byCoordinates: 'Выбор по координатам',
    countLabel: 'Количество событий',
    dateLabel: 'Дата',
    latLabel: 'Широта',
    lonLabel: 'Долгота',
    numLabel: 'Количество',
    radiusLabel: 'Радиус (км)',
    openList: 'Открыть список',
    openDate: 'Открыть дату',
    showOnMap: 'Показать на карте',
    mapReports: 'Последние сообщения на карте',
    mapLabel: 'ССД',
    mapTitle: 'Сейсмический обзор',
    mapSubtitle: 'Обзор обновляется автоматически при появлении новых сообщений ССД.',
    interactiveMap: 'Перейти к карте на старом сайте',
    latestReports: 'Последние сообщения',
    created: 'Создано',
  },
  en: {
    loading: 'Loading alert-service tools...',
    loadError: 'Failed to load alert-service data.',
    allSections: 'All sections',
    headline: 'Rapid Information Service',
    lead:
      'Core alert-service tools: quick access to recent earthquakes, selections by count, date and coordinates, plus direct links to maps and catalogs.',
    latestMessage: 'Latest report',
    noData: 'Data is temporarily unavailable.',
    report: 'Report a felt earthquake',
    map: 'Seismic map',
    mapCopy: 'Temporarily open the map section on the legacy site.',
    catalogs: 'Seismic data',
    catalogsCopy: 'Open the seismic-data and waveform section.',
    news: 'Service news',
    newsCopy: 'Open the site news section with archived publications.',
    byCount: 'Select by number of earthquakes',
    byDate: 'Select by earthquake date',
    byCoordinates: 'Select by coordinates',
    countLabel: 'Event count',
    dateLabel: 'Date',
    latLabel: 'Latitude',
    lonLabel: 'Longitude',
    numLabel: 'Count',
    radiusLabel: 'Radius (km)',
    openList: 'Open list',
    openDate: 'Open date',
    showOnMap: 'Show on map',
    mapReports: 'Latest reports on the map',
    mapLabel: 'RIS',
    mapTitle: 'Seismic overview',
    mapSubtitle: 'The overview refreshes automatically when new alert-service reports appear.',
    interactiveMap: 'Open the legacy map section',
    latestReports: 'Latest reports',
    created: 'Created',
  },
};

/* Делает: Рендерит React-компонент SsdWorkspace и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function SsdWorkspace({ locale = 'ru' }) {
  const currentCopy = copy[locale] ?? copy.ru;
  const { data, loading, error } = useGsrasNewsData();
  const normalizedLocale = normalizeLocale(locale);
  const legacyMapUrl = getLegacyMapUrl(locale);
  const legacyCcdQuakeUrl = getLegacyCcdQuakeUrl();
  const legacyMapCustomUrl = getLegacyMapCustomUrl();
  const seismicDataRoute = localizePath('/section/wf', locale);
  const legacyLanguageFlag = normalizedLocale === 'en' ? '1' : '0';

  if (loading) {
    return (
      <section className='ssd-workspace'>
        <div className='ssd-workspace__container'>
          <SsdState>{currentCopy.loading}</SsdState>
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className='ssd-workspace'>
        <div className='ssd-workspace__container'>
          <SsdState tone='error'>{error ?? currentCopy.loadError}</SsdState>
        </div>
      </section>
    );
  }

  const earthquakeUpdates = normalizeEarthquakeUpdates(data.earthquake.updates ?? []);
  const latestEarthquakeUpdate = earthquakeUpdates[0] ?? null;
  const quakePreviewPoints = getEarthquakePreviewPoints(earthquakeUpdates, 10);

    /* Делает: Открывает legacy selection. Применение: используется внутри функции SsdWorkspace. */
  const openLegacySelection = (baseUrl, params) => {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри openLegacySelection. */ ([key, value]) => {
      if (value !== '' && value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    });

    searchParams.set('l', legacyLanguageFlag);
    window.location.href = `${baseUrl}?${searchParams.toString()}`;
  };

  return (
    <section className='ssd-workspace'>
      <div className='ssd-workspace__container'>
        <div className='ssd-workspace__hero'>
          <div className='ssd-workspace__hero-copy'>
            <Link to={getHomeRoute(locale)} className='ssd-workspace__breadcrumb'>
              {currentCopy.allSections}
            </Link>
            <h1 className='ssd-workspace__headline'>{currentCopy.headline}</h1>
            <p className='ssd-workspace__lead'>{currentCopy.lead}</p>
          </div>

          <div className='ssd-workspace__hero-card'>
            <span className='ssd-workspace__hero-label'>{currentCopy.latestMessage}</span>
            <p className='ssd-workspace__hero-message'>{data.earthquake.latest?.message ?? currentCopy.noData}</p>
            <a
              href='http://mseism.gsras.ru/DyfitWeb'
              target='_blank'
              rel='noreferrer'
              className='ssd-workspace__hero-action'
            >
              {currentCopy.report}
            </a>
          </div>
        </div>

        <div className='ssd-workspace__quick-actions'>
          <a href={legacyMapUrl} className='ssd-workspace__quick-card'>
            <span className='ssd-workspace__quick-title'>{currentCopy.map}</span>
            <span className='ssd-workspace__quick-copy'>{currentCopy.mapCopy}</span>
          </a>
          <Link to={seismicDataRoute} className='ssd-workspace__quick-card'>
            <span className='ssd-workspace__quick-title'>{currentCopy.catalogs}</span>
            <span className='ssd-workspace__quick-copy'>{currentCopy.catalogsCopy}</span>
          </Link>
          <Link to={localizePath('/news', locale)} className='ssd-workspace__quick-card'>
            <span className='ssd-workspace__quick-title'>{currentCopy.news}</span>
            <span className='ssd-workspace__quick-copy'>{currentCopy.newsCopy}</span>
          </Link>
        </div>

        <div className='ssd-workspace__layout'>
          <div className='ssd-workspace__forms'>
            <article className='ssd-workspace__panel'>
              <h2 className='ssd-workspace__panel-title'>{currentCopy.byCount}</h2>
              <form
                className='ssd-workspace__form'
                onSubmit={/* Делает: Обрабатывает событие onSubmit в JSX-разметке. Применение: используется как inline-обработчик onSubmit внутри файла src/gsras/pages/SsdWorkspace/SsdWorkspace.jsx. */ (event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  openLegacySelection(legacyCcdQuakeUrl, {
                    num: formData.get('num') || '20',
                  });
                }}
              >
                <label className='ssd-workspace__field'>
                  <span className='ssd-workspace__field-label'>{currentCopy.countLabel}</span>
                  <input className='ssd-workspace__input' name='num' type='number' min='1' defaultValue='20' />
                </label>
                <button type='submit' className='ssd-workspace__submit'>
                  {currentCopy.openList}
                </button>
              </form>
            </article>

            <article className='ssd-workspace__panel'>
              <h2 className='ssd-workspace__panel-title'>{currentCopy.byDate}</h2>
              <form
                className='ssd-workspace__form'
                onSubmit={/* Делает: Обрабатывает событие onSubmit в JSX-разметке. Применение: используется как inline-обработчик onSubmit внутри файла src/gsras/pages/SsdWorkspace/SsdWorkspace.jsx. */ (event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  openLegacySelection(legacyCcdQuakeUrl, {
                    dat: formData.get('dat'),
                  });
                }}
              >
                <label className='ssd-workspace__field'>
                  <span className='ssd-workspace__field-label'>{currentCopy.dateLabel}</span>
                  <input className='ssd-workspace__input' name='dat' type='date' />
                </label>
                <button type='submit' className='ssd-workspace__submit'>
                  {currentCopy.openDate}
                </button>
              </form>
            </article>

            <article className='ssd-workspace__panel'>
              <h2 className='ssd-workspace__panel-title'>{currentCopy.byCoordinates}</h2>
              <form
                className='ssd-workspace__form ssd-workspace__form--grid'
                onSubmit={/* Делает: Обрабатывает событие onSubmit в JSX-разметке. Применение: используется как inline-обработчик onSubmit внутри файла src/gsras/pages/SsdWorkspace/SsdWorkspace.jsx. */ (event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  openLegacySelection(legacyMapCustomUrl, {
                    lat: formData.get('lat'),
                    lon: formData.get('lon'),
                    num: formData.get('num') || '7',
                    rad: formData.get('rad') || '500',
                  });
                }}
              >
                <label className='ssd-workspace__field'>
                  <span className='ssd-workspace__field-label'>{currentCopy.latLabel}</span>
                  <input
                    className='ssd-workspace__input'
                    name='lat'
                    type='number'
                    step='0.0001'
                    defaultValue={data.earthquake.latest?.latitude ?? '0.0'}
                  />
                </label>
                <label className='ssd-workspace__field'>
                  <span className='ssd-workspace__field-label'>{currentCopy.lonLabel}</span>
                  <input
                    className='ssd-workspace__input'
                    name='lon'
                    type='number'
                    step='0.0001'
                    defaultValue={data.earthquake.latest?.longitude ?? '0.0'}
                  />
                </label>
                <label className='ssd-workspace__field'>
                  <span className='ssd-workspace__field-label'>{currentCopy.numLabel}</span>
                  <input className='ssd-workspace__input' name='num' type='number' min='1' defaultValue='7' />
                </label>
                <label className='ssd-workspace__field'>
                  <span className='ssd-workspace__field-label'>{currentCopy.radiusLabel}</span>
                  <input className='ssd-workspace__input' name='rad' type='number' min='1' defaultValue='500' />
                </label>
                <button type='submit' className='ssd-workspace__submit'>
                  {currentCopy.showOnMap}
                </button>
              </form>
            </article>
          </div>

          <aside className='ssd-workspace__sidebar'>
            <article className='ssd-workspace__panel ssd-workspace__panel--visual'>
              <h2 className='ssd-workspace__panel-title'>{currentCopy.mapReports}</h2>
              <EarthquakeMapPreview
                points={quakePreviewPoints}
                label={currentCopy.mapLabel}
                title={latestEarthquakeUpdate?.title ?? currentCopy.mapTitle}
                subtitle={
                  latestEarthquakeUpdate?.messageText ??
                  currentCopy.mapSubtitle
                }
                locale={locale}
                className='ssd-workspace__map-preview'
              />
              <a href={legacyMapUrl} className='ssd-workspace__submit ssd-workspace__submit--link'>
                {currentCopy.interactiveMap}
              </a>
            </article>

            <article className='ssd-workspace__panel'>
              <h2 className='ssd-workspace__panel-title'>{currentCopy.latestReports}</h2>
              <div className='ssd-workspace__updates'>
                {earthquakeUpdates.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри SsdWorkspace. */ (update) => (
                  <article
                    key={update.id}
                    className='ssd-workspace__update-card'
                  >
                    <span className='ssd-workspace__update-title'>{update.title}</span>
                    <span className='ssd-workspace__update-meta'>{currentCopy.created}: {update.created}</span>
                  </article>
                ))}
              </div>
            </article>
          </aside>
        </div>
      </div>
    </section>
  );
}

