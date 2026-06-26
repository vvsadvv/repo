import { Link, useSearchParams } from 'react-router-dom';
import EarthquakeMapPreview from '@gsras-components/EarthquakeMapPreview/EarthquakeMapPreview';
import { useGsrasNewsData } from '@gsras-hooks/useGsrasNewsData';
import { useGsrasSiteData } from '@gsras-hooks/useGsrasSiteData';
import {
  filterRecentEarthquakeEvents,
  formatEarthquakeDateTime,
  getRecentEarthquakePreviewPoints,
  normalizeRecentEarthquakeEvents,
} from '@gsras-utils/news';
import { getPageRoute, getPageByRoute } from '@gsras-utils/siteContent';
import { getHomeRoute, getLegacySsdUrl, localizePath } from '@gsras-utils/siteLanguage';
import './EarthquakePage.scss';

const DEFAULT_COUNT = 10;
const DEFAULT_RADIUS = 500;

/* Делает: Рендерит React-компонент EarthquakeState и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function EarthquakeState({ tone = 'default', children }) {
  return <div className={`earthquake-page__state${tone === 'error' ? ' earthquake-page__state--error' : ''}`}>{children}</div>;
}

const copy = {
  ru: {
    loading: 'Загрузка карты и последних событий...',
    loadError: 'Не удалось загрузить данные о землетрясениях.',
    home: 'Главная',
    ssd: 'ССД',
    eyebrow: 'Карта и выборки',
    headline: 'Последние землетрясения',
    lead:
      'Внутренний экран с логикой старых страниц equakes.pl, ccd_quake.pl и mapCustom.pl: карта, таблица и выборки по числу событий, дате и региону.',
    byCount: 'По числу событий',
    byDate: 'По дате',
    byRegion: 'По региону',
    countLabel: 'Количество',
    dateLabel: 'Дата',
    latLabel: 'Широта',
    lonLabel: 'Долгота',
    radiusLabel: 'Радиус (км)',
    showList: 'Показать выборку',
    showDate: 'Показать дату',
    showRegion: 'Показать регион',
    reset: 'Сбросить',
    mapLabel: 'Карта',
    mapTitle: 'Сейсмический обзор по локальному набору данных',
    mapSubtitle: 'Карта и таблица обновляются на основе локально сохраненных последних событий.',
    noResults: 'По текущему фильтру событий не найдено.',
    tableTitle: 'Таблица событий',
    columns: {
      id: 'N',
      date: 'Дата и время',
      lat: 'Широта',
      lon: 'Долгота',
      depth: 'Глубина',
      stations: 'Станции',
      ms: 'Ms',
      mb: 'mb',
      i0: 'I0',
      region: 'Регион',
    },
    collections: 'Связанные материалы',
    collectionTitle: 'Данные и публикации по теме',
    openWaveforms: 'Волновые формы',
    openWaveformsLive: '24-часовые формы',
    openSsd: 'Рабочее место ССД',
  },
  en: {
    loading: 'Loading the map and recent events...',
    loadError: 'Failed to load earthquake data.',
    home: 'Home',
    ssd: 'Alert Service',
    eyebrow: 'Map and filters',
    headline: 'Recent earthquakes',
    lead:
      'An internal screen that adapts the logic of equakes.pl, ccd_quake.pl and mapCustom.pl into one native page with a map, a table and local filters by event count, date and region.',
    byCount: 'By event count',
    byDate: 'By date',
    byRegion: 'By region',
    countLabel: 'Count',
    dateLabel: 'Date',
    latLabel: 'Latitude',
    lonLabel: 'Longitude',
    radiusLabel: 'Radius (km)',
    showList: 'Show list',
    showDate: 'Show date',
    showRegion: 'Show region',
    reset: 'Reset',
    mapLabel: 'Map',
    mapTitle: 'Seismic overview from the local dataset',
    mapSubtitle: 'The map and table update using the locally stored recent-event dataset.',
    noResults: 'No events matched the current filter.',
    tableTitle: 'Event table',
    columns: {
      id: 'N',
      date: 'Date and time',
      lat: 'Latitude',
      lon: 'Longitude',
      depth: 'Depth',
      stations: 'Stations',
      ms: 'Ms',
      mb: 'mb',
      i0: 'I0',
      region: 'Region',
    },
    collections: 'Related materials',
    collectionTitle: 'Data and publications in this area',
    openWaveforms: 'Wave forms',
    openWaveformsLive: '24-hour waveforms',
    openSsd: 'Alert workspace',
  },
};

/* Делает: Выполняет to integer. Применение: используется локально в файле src/gsras/pages/EarthquakePage/EarthquakePage.jsx. */
function toInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/* Делает: Выполняет to number or null. Применение: используется локально в файле src/gsras/pages/EarthquakePage/EarthquakePage.jsx. */
function toNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const parsed = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/* Делает: Собирает query string. Применение: используется локально в файле src/gsras/pages/EarthquakePage/EarthquakePage.jsx. */
function buildQueryString(params) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри buildQueryString. */ ([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      searchParams.set(key, String(value));
    }
  });

  return searchParams;
}

/* Делает: Рендерит React-компонент EarthquakePage и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function EarthquakePage({ locale = 'ru' }) {
  const currentCopy = copy[locale] ?? copy.ru;
  const { data, loading, error } = useGsrasNewsData();
  const { data: siteData } = useGsrasSiteData(locale);
  const [searchParams, setSearchParams] = useSearchParams();

  if (loading) {
    return (
      <section className='earthquake-page'>
        <div className='earthquake-page__container'>
          <EarthquakeState>{currentCopy.loading}</EarthquakeState>
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className='earthquake-page'>
        <div className='earthquake-page__container'>
          <EarthquakeState tone='error'>{error ?? currentCopy.loadError}</EarthquakeState>
        </div>
      </section>
    );
  }

  const eventCount = toInteger(searchParams.get('num') ?? DEFAULT_COUNT, DEFAULT_COUNT);
  const dateValue = searchParams.get('date') ?? '';
  const latitudeValue = searchParams.get('lat') ?? '';
  const longitudeValue = searchParams.get('lon') ?? '';
  const radiusValue = searchParams.get('rad') ?? String(DEFAULT_RADIUS);
  const events = normalizeRecentEarthquakeEvents(data.earthquake, locale);
  const filteredEvents = filterRecentEarthquakeEvents(events, {
    count: eventCount,
    dayKey: dateValue,
    latitude: toNumberOrNull(latitudeValue),
    longitude: toNumberOrNull(longitudeValue),
    radiusKm: toInteger(radiusValue, DEFAULT_RADIUS),
  });
  const previewPoints = getRecentEarthquakePreviewPoints(filteredEvents, Math.max(filteredEvents.length, 12));
  const waveformsPage = siteData ? getPageByRoute(siteData.pages, '/wf') : null;
  const waveformsLivePage = siteData ? getPageByRoute(siteData.pages, '/wf/last24/wf.htm') : null;
  const legacySsdUrl = getLegacySsdUrl(locale);

    /* Делает: Отправляет count filter. Применение: используется внутри функции EarthquakePage. */
  const submitCountFilter = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setSearchParams(buildQueryString({
      num: toInteger(formData.get('num'), DEFAULT_COUNT),
    }));
  };

    /* Делает: Отправляет date filter. Применение: используется внутри функции EarthquakePage. */
  const submitDateFilter = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setSearchParams(buildQueryString({
      date: formData.get('date'),
    }));
  };

    /* Делает: Отправляет region filter. Применение: используется внутри функции EarthquakePage. */
  const submitRegionFilter = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setSearchParams(buildQueryString({
      lat: formData.get('lat'),
      lon: formData.get('lon'),
      rad: toInteger(formData.get('rad'), DEFAULT_RADIUS),
      num: toInteger(formData.get('num'), DEFAULT_COUNT),
    }));
  };

  return (
    <section className='earthquake-page'>
      <div className='earthquake-page__container'>
        <section className='earthquake-page__hero'>
          <div className='earthquake-page__hero-copy'>
            <div className='earthquake-page__breadcrumbs'>
              <Link to={getHomeRoute(locale)}>{currentCopy.home}</Link>
              <span>/</span>
              <a href={legacySsdUrl}>{currentCopy.ssd}</a>
            </div>
            <span className='earthquake-page__eyebrow'>{currentCopy.eyebrow}</span>
            <h1 className='earthquake-page__headline'>{currentCopy.headline}</h1>
            <p className='earthquake-page__lead'>{currentCopy.lead}</p>
          </div>
        </section>

        <div className='earthquake-page__layout'>
          <div className='earthquake-page__main'>
            <section className='earthquake-page__filters'>
              <article className='earthquake-page__filter-card'>
                <h2 className='earthquake-page__filter-title'>{currentCopy.byCount}</h2>
                <form className='earthquake-page__form' onSubmit={submitCountFilter}>
                  <label className='earthquake-page__field'>
                    <span className='earthquake-page__field-label'>{currentCopy.countLabel}</span>
                    <input
                      className='earthquake-page__input'
                      type='number'
                      name='num'
                      min='1'
                      max='50'
                      defaultValue={eventCount}
                    />
                  </label>
                  <button type='submit' className='earthquake-page__primary-action'>
                    {currentCopy.showList}
                  </button>
                </form>
              </article>

              <article className='earthquake-page__filter-card'>
                <h2 className='earthquake-page__filter-title'>{currentCopy.byDate}</h2>
                <form className='earthquake-page__form' onSubmit={submitDateFilter}>
                  <label className='earthquake-page__field'>
                    <span className='earthquake-page__field-label'>{currentCopy.dateLabel}</span>
                    <input className='earthquake-page__input' type='date' name='date' defaultValue={dateValue} />
                  </label>
                  <button type='submit' className='earthquake-page__primary-action'>
                    {currentCopy.showDate}
                  </button>
                </form>
              </article>

              <article className='earthquake-page__filter-card'>
                <h2 className='earthquake-page__filter-title'>{currentCopy.byRegion}</h2>
                <form className='earthquake-page__form earthquake-page__form--grid' onSubmit={submitRegionFilter}>
                  <label className='earthquake-page__field'>
                    <span className='earthquake-page__field-label'>{currentCopy.latLabel}</span>
                    <input className='earthquake-page__input' type='number' step='0.01' name='lat' defaultValue={latitudeValue} />
                  </label>
                  <label className='earthquake-page__field'>
                    <span className='earthquake-page__field-label'>{currentCopy.lonLabel}</span>
                    <input className='earthquake-page__input' type='number' step='0.01' name='lon' defaultValue={longitudeValue} />
                  </label>
                  <label className='earthquake-page__field'>
                    <span className='earthquake-page__field-label'>{currentCopy.radiusLabel}</span>
                    <input className='earthquake-page__input' type='number' min='1' name='rad' defaultValue={radiusValue} />
                  </label>
                  <label className='earthquake-page__field'>
                    <span className='earthquake-page__field-label'>{currentCopy.countLabel}</span>
                    <input className='earthquake-page__input' type='number' min='1' max='50' name='num' defaultValue={eventCount} />
                  </label>
                  <button type='submit' className='earthquake-page__primary-action'>
                    {currentCopy.showRegion}
                  </button>
                </form>
              </article>
            </section>

            <section className='earthquake-page__map-card'>
              <EarthquakeMapPreview
                points={previewPoints}
                label={currentCopy.mapLabel}
                title={currentCopy.mapTitle}
                subtitle={currentCopy.mapSubtitle}
                locale={locale}
                interactive
                className='earthquake-page__map'
              />
            </section>

            <section className='earthquake-page__table-card'>
              <div className='earthquake-page__table-head'>
                <h2 className='earthquake-page__table-title'>{currentCopy.tableTitle}</h2>
                <button
                  type='button'
                  className='earthquake-page__secondary-action'
                  onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/gsras/pages/EarthquakePage/EarthquakePage.jsx. */ () => setSearchParams(buildQueryString({ num: DEFAULT_COUNT }))}
                >
                  {currentCopy.reset}
                </button>
              </div>

              {filteredEvents.length === 0 ? (
                <EarthquakeState tone='error'>{currentCopy.noResults}</EarthquakeState>
              ) : (
                <div className='earthquake-page__table-wrap'>
                  <table className='earthquake-page__table'>
                    <thead>
                      <tr>
                        <th>{currentCopy.columns.id}</th>
                        <th>{currentCopy.columns.date}</th>
                        <th>{currentCopy.columns.lat}</th>
                        <th>{currentCopy.columns.lon}</th>
                        <th>{currentCopy.columns.depth}</th>
                        <th>{currentCopy.columns.stations}</th>
                        <th>{currentCopy.columns.ms}</th>
                        <th>{currentCopy.columns.mb}</th>
                        <th>{currentCopy.columns.i0}</th>
                        <th>{currentCopy.columns.region}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри EarthquakePage. */ (event) => (
                        <tr key={event.id}>
                          <td>{event.eventId || event.id}</td>
                          <td>{formatEarthquakeDateTime(event.date, locale)}</td>
                          <td>{event.latitude.toFixed(2)}</td>
                          <td>{event.longitude.toFixed(2)}</td>
                          <td>{event.depth > 0 ? event.depth : '-'}</td>
                          <td>{event.nsta > 0 ? event.nsta : '-'}</td>
                          <td>{event.ms}</td>
                          <td>{event.mpv}</td>
                          <td>{event.i0}</td>
                          <td>{event.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <aside className='earthquake-page__sidebar'>
            <section className='earthquake-page__sidebar-card'>
              <span className='earthquake-page__sidebar-eyebrow'>{currentCopy.collections}</span>
              <h2 className='earthquake-page__sidebar-title'>{currentCopy.collectionTitle}</h2>
              <div className='earthquake-page__sidebar-links'>
                {waveformsPage ? (
                  <Link to={getPageRoute(waveformsPage, locale)} className='earthquake-page__sidebar-link'>
                    {currentCopy.openWaveforms}
                  </Link>
                ) : (
                  <Link to={localizePath('/section/wf', locale)} className='earthquake-page__sidebar-link'>
                    {currentCopy.openWaveforms}
                  </Link>
                )}

                {waveformsLivePage ? (
                  <Link to={getPageRoute(waveformsLivePage, locale)} className='earthquake-page__sidebar-link'>
                    {currentCopy.openWaveformsLive}
                  </Link>
                ) : null}

                <a href={legacySsdUrl} className='earthquake-page__sidebar-link'>
                  {currentCopy.openSsd}
                </a>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}

