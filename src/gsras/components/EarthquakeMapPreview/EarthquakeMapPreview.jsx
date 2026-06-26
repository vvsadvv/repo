import { useEffect, useId, useRef, useState } from 'react';
import { getEarthquakeMapViewport, loadYandexMaps } from '@gsras-utils/yandexMaps';
import './EarthquakeMapPreview.scss';

/* Делает: Выполняет текст truncate. Применение: используется локально в файле src/gsras/components/EarthquakeMapPreview/EarthquakeMapPreview.jsx. */
function truncateText(value, maxLength = 180) {
  if (!value) {
    return '';
  }

  return value.length > maxLength ? `${value.slice(0, maxLength).trim()}...` : value;
}

const copy = {
  ru: {
    markers: 'метки',
    noCoordinates: 'Без координат',
    latitude: 'Широта',
    longitude: 'Долгота',
    unavailable: 'Координаты события временно недоступны.',
    loading: 'Загружаем Яндекс.Карты...',
    loadError: 'Не удалось загрузить Яндекс.Карты.',
    loadHint: 'При необходимости добавьте VITE_YANDEX_MAPS_API_KEY в локальные переменные окружения.',
  },
  en: {
    markers: 'markers',
    noCoordinates: 'No coordinates',
    latitude: 'Latitude',
    longitude: 'Longitude',
    unavailable: 'Event coordinates are temporarily unavailable.',
    loading: 'Loading Yandex Maps...',
    loadError: 'Failed to load Yandex Maps.',
    loadHint: 'If needed, add VITE_YANDEX_MAPS_API_KEY to your local environment variables.',
  },
};

/* Делает: Собирает подпись marker. Применение: используется локально в файле src/gsras/components/EarthquakeMapPreview/EarthquakeMapPreview.jsx. */
function buildMarkerLabel(point, title) {
  const parts = [point.title, point.created, title].filter(Boolean);
  return parts.join(' • ');
}

/* Делает: Рендерит React-компонент EarthquakeMapPreview и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function EarthquakeMapPreview({
  points = [],
  label = 'Сейсмический обзор',
  title = 'Координаты землетрясения',
  subtitle = '',
  footnote = '',
  locale = 'ru',
  className = '',
  interactive = false,
}) {
  const currentCopy = copy[locale] ?? copy.ru;
  const normalizedPoints = points.filter(
    /* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри EarthquakeMapPreview. */ (point) => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)
  );
  const pointsSignature = normalizedPoints
    .map(
      /* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри EarthquakeMapPreview. */ (point) =>
        `${point.id ?? ''}:${point.latitude}:${point.longitude}:${point.isPrimary ? 1 : 0}:${point.title ?? ''}:${point.created ?? ''}`
    )
    .join('|');
  const primaryPoint = normalizedPoints.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри EarthquakeMapPreview. */ (point) => point.isPrimary) ?? normalizedPoints[0] ?? null;
  const summary = truncateText(subtitle);
  const pointCountLabel =
    normalizedPoints.length > 0 ? `${normalizedPoints.length} ${currentCopy.markers}` : currentCopy.noCoordinates;
  const containerId = useId().replace(/:/g, '-');
  const mapRef = useRef(null);
  const [mapState, setMapState] = useState('idle');

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри EarthquakeMapPreview. */ () => {
    let isCancelled = false;
    let mapInstance = null;
    let geoObjects = null;

        /* Делает: Выполняет карту init. Применение: используется внутри функции useEffectCallback. */
    const initMap = async () => {
      if (!mapRef.current) {
        return;
      }

      setMapState('loading');

      try {
        const ymaps = await loadYandexMaps(locale);

        if (isCancelled || !mapRef.current) {
          return;
        }

        const viewport = getEarthquakeMapViewport(normalizedPoints);
        mapInstance = new ymaps.Map(
          mapRef.current,
          {
            center: [viewport.center[1], viewport.center[0]],
            zoom: viewport.zoom,
            controls: interactive ? ['zoomControl'] : [],
          },
          {
            suppressMapOpenBlock: true,
          }
        );

        if (!interactive) {
          mapInstance.behaviors.disable(['drag', 'scrollZoom', 'dblClickZoom', 'multiTouch']);
        }

        geoObjects = new ymaps.GeoObjectCollection();

        normalizedPoints.forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри initMap. */ (point) => {
          const placemark = new ymaps.Placemark(
            [point.latitude, point.longitude],
            {
              hintContent: buildMarkerLabel(point, title),
              balloonContentHeader: point.title || title,
              balloonContentBody: point.created || '',
            },
            {
              preset: point.isPrimary ? 'islands#yellowCircleDotIcon' : 'islands#blueCircleDotIcon',
              iconColor: point.isPrimary ? '#d7b65d' : '#0c5da8',
              hideIconOnBalloonOpen: false,
              openBalloonOnClick: interactive,
              openEmptyBalloon: interactive,
            }
          );

          geoObjects.add(placemark);
        });

        mapInstance.geoObjects.add(geoObjects);

        if (normalizedPoints.length > 1) {
          const bounds = geoObjects.getBounds();

          if (bounds) {
            mapInstance.setBounds(bounds, {
              checkZoomRange: true,
              zoomMargin: [40, 40, 40, 40],
            });
          }
        }

        setMapState('ready');
      } catch (error) {
        if (!isCancelled) {
          setMapState('error');
        }
      }
    };

    initMap();

    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => {
      isCancelled = true;

      if (mapInstance?.destroy) {
        mapInstance.destroy();
      }

      if (mapRef.current) {
        mapRef.current.innerHTML = '';
      }
    };
  }, [interactive, locale, pointsSignature, title]);

  return (
    <div className={`earthquake-map-preview ${interactive ? 'earthquake-map-preview--interactive' : ''} ${className}`.trim()}>
      <div
        ref={mapRef}
        id={`earthquake-map-${containerId}`}
        className='earthquake-map-preview__canvas'
        aria-label={title}
      />

      {mapState !== 'ready' && (
        <div className='earthquake-map-preview__status' aria-live='polite'>
          <strong>{mapState === 'error' ? currentCopy.loadError : currentCopy.loading}</strong>
          {mapState === 'error' && <span>{currentCopy.loadHint}</span>}
        </div>
      )}

      <div className='earthquake-map-preview__hud'>
        <div className='earthquake-map-preview__topline'>
          <span className='earthquake-map-preview__badge'>{label}</span>
          <span className='earthquake-map-preview__count'>{pointCountLabel}</span>
        </div>

        <div className='earthquake-map-preview__meta'>
          <h3 className='earthquake-map-preview__title'>{title}</h3>
          {summary && <p className='earthquake-map-preview__summary'>{summary}</p>}
          <div className='earthquake-map-preview__footer'>
            {primaryPoint ? (
              <span className='earthquake-map-preview__coords'>
                {`${currentCopy.latitude} ${primaryPoint.latitude.toFixed(2)} / ${currentCopy.longitude} ${primaryPoint.longitude.toFixed(2)}`}
              </span>
            ) : (
              <span className='earthquake-map-preview__coords'>{currentCopy.unavailable}</span>
            )}
            {footnote && <span className='earthquake-map-preview__footnote'>{footnote}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

