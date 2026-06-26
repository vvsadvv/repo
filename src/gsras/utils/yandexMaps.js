const API_BASE_URL = 'https://api-maps.yandex.ru/2.1/';
const DEFAULT_CENTER = [90, 25];
const DEFAULT_ZOOM = 2;

let yandexMapsPromise = null;

/* Делает: Получает язык script. Применение: используется локально в файле src/gsras/utils/yandexMaps.js. */
function getScriptLanguage(locale = 'ru') {
  return locale === 'en' ? 'en_US' : 'ru_RU';
}

/* Делает: Получает URL script. Применение: используется локально в файле src/gsras/utils/yandexMaps.js. */
function getScriptUrl(locale = 'ru') {
  const apiKey = (import.meta.env.VITE_YANDEX_MAPS_API_KEY ?? '').trim();
  const params = new URLSearchParams({
    lang: getScriptLanguage(locale),
  });

  if (apiKey) {
    params.set('apikey', apiKey);
  }

  return `${API_BASE_URL}?${params.toString()}`;
}

/* Делает: Загружает yandex maps. Применение: используется локально в файле src/gsras/utils/yandexMaps.js. */
export function loadYandexMaps(locale = 'ru') {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('yandex-maps-window-unavailable'));
  }

  if (window.ymaps?.Map) {
    return new Promise(/* Делает: Выполняет локальный callback в текущем месте модуля. Применение: используется локально внутри loadYandexMaps. */ (resolve) => {
      window.ymaps.ready(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в ready внутри callback. */ () => resolve(window.ymaps));
    });
  }

  if (yandexMapsPromise) {
    return yandexMapsPromise;
  }

  yandexMapsPromise = new Promise(/* Делает: Обрабатывает ошибку предыдущего промиса. Применение: передаётся как callback в catch внутри loadYandexMaps. */ (resolve, reject) => {
    const existingScript = document.querySelector('script[data-yandex-maps-script="true"]');

        /* Делает: Обрабатывает ready. Применение: используется внутри функции catchCallback. */
    const handleReady = () => {
      if (!window.ymaps) {
        reject(new Error('yandex-maps-missing-global'));
        return;
      }

      window.ymaps.ready(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в ready внутри handleReady. */ () => resolve(window.ymaps));
    };

    if (existingScript) {
      if (window.ymaps?.Map) {
        handleReady();
        return;
      }

      existingScript.addEventListener('load', handleReady, { once: true });
      existingScript.addEventListener('error', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в addEventListener внутри catchCallback. */ () => reject(new Error('yandex-maps-script-error')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = getScriptUrl(locale);
    script.async = true;
    script.defer = true;
    script.dataset.yandexMapsScript = 'true';
    script.onload = handleReady;
    script.onerror = /* Делает: Обрабатывает ошибку предыдущего промиса. Применение: передаётся как callback в catch внутри catchCallback. */ () => reject(new Error('yandex-maps-script-error'));
    document.head.appendChild(script);
  }).catch(/* Делает: Обрабатывает ошибку предыдущего промиса. Применение: передаётся как callback в catch внутри loadYandexMaps. */ (error) => {
    yandexMapsPromise = null;
    throw error;
  });

  return yandexMapsPromise;
}

/* Делает: Выполняет clamp. Применение: используется локально в файле src/gsras/utils/yandexMaps.js. */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/* Делает: Получает span zoom. Применение: используется локально в файле src/gsras/utils/yandexMaps.js. */
function getSpanZoom(span) {
  if (span <= 0.2) {
    return 8;
  }

  if (span <= 0.6) {
    return 7;
  }

  if (span <= 1.5) {
    return 6;
  }

  if (span <= 4) {
    return 5;
  }

  if (span <= 10) {
    return 4;
  }

  if (span <= 24) {
    return 3;
  }

  if (span <= 80) {
    return 2;
  }

  return 1;
}

/* Делает: Получает earthquake map viewport. Применение: используется локально в файле src/gsras/utils/yandexMaps.js. */
export function getEarthquakeMapViewport(points = []) {
  const normalizedPoints = points.filter(
    /* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри getEarthquakeMapViewport. */ (point) => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)
  );

  if (normalizedPoints.length === 0) {
    return {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      bounds: null,
    };
  }

  if (normalizedPoints.length === 1) {
    const [point] = normalizedPoints;

    return {
      center: [point.longitude, point.latitude],
      zoom: 5,
      bounds: null,
    };
  }

  const latitudes = normalizedPoints.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getEarthquakeMapViewport. */ (point) => point.latitude);
  const longitudes = normalizedPoints.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getEarthquakeMapViewport. */ (point) => point.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const latitudeSpan = maxLatitude - minLatitude;
  const longitudeSpan = maxLongitude - minLongitude;
  const span = Math.max(latitudeSpan, longitudeSpan);

  return {
    center: [
      clamp((minLongitude + maxLongitude) / 2, -180, 180),
      clamp((minLatitude + maxLatitude) / 2, -85, 85),
    ],
    zoom: getSpanZoom(span),
    bounds: [
      [minLatitude, minLongitude],
      [maxLatitude, maxLongitude],
    ],
  };
}

