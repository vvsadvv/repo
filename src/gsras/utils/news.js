import { localizePath } from '@gsras-utils/siteLanguage';

/* Делает: Нормализует whitespace. Применение: используется локально в файле src/gsras/utils/news.js. */
function normalizeWhitespace(value = '') {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Делает: Нормализует значение поискового. Применение: используется локально в файле src/gsras/utils/news.js. */
export function normalizeSearchValue(value) {
  return value.trim().toLowerCase();
}

/* Делает: Выполняет strip html tags. Применение: используется локально в файле src/gsras/utils/news.js. */
export function stripHtmlTags(value = '') {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Делает: Проверяет finite coordinate. Применение: используется локально в файле src/gsras/utils/news.js. */
function isFiniteCoordinate(coordinate) {
  return Number.isFinite(coordinate?.latitude) && Number.isFinite(coordinate?.longitude);
}

/* Делает: Форматирует подпись даты. Применение: используется локально в файле src/gsras/utils/news.js. */
export function formatDateLabel(dateString, locale = 'ru') {
  const [day, month, year] = dateString.split('.');

  if (!day || !month || !year) {
    return dateString;
  }

  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/* Делает: Выполняет pad date part. Применение: используется локально в файле src/gsras/utils/news.js. */
function padDatePart(value) {
  return String(value).padStart(2, '0');
}

/* Делает: Разбирает earthquake date time. Применение: используется локально в файле src/gsras/utils/news.js. */
function parseEarthquakeDateTime(dateString) {
  if (!dateString) {
    return null;
  }

  let match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);

  if (match) {
    const [, year, month, day, hours = '00', minutes = '00', seconds = '00'] = match;

    return {
      year,
      month,
      day,
      hours,
      minutes,
      seconds,
      dayKey: `${year}-${month}-${day}`,
      timestamp: Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds)),
    };
  }

  match = dateString.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);

  if (match) {
    const [, day, month, year, hours = '00', minutes = '00', seconds = '00'] = match;

    return {
      year,
      month,
      day,
      hours,
      minutes,
      seconds,
      dayKey: `${year}-${month}-${day}`,
      timestamp: Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds)),
    };
  }

  match = dateString.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);

  if (match) {
    const [, day, month, year] = match;

    return {
      year,
      month,
      day,
      hours: '00',
      minutes: '00',
      seconds: '00',
      dayKey: `${year}-${month}-${day}`,
      timestamp: Date.UTC(Number(year), Number(month) - 1, Number(day)),
    };
  }

  return null;
}

/* Делает: Форматирует earthquake date time. Применение: используется локально в файле src/gsras/utils/news.js. */
export function formatEarthquakeDateTime(dateString, locale = 'ru') {
  const parsed = parseEarthquakeDateTime(dateString);

  if (!parsed) {
    return dateString;
  }

  const date = new Date(parsed.timestamp);

  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

/* Делает: Получает элементы carousel. Применение: используется локально в файле src/gsras/utils/news.js. */
export function getCarouselItems(items, startIndex, count) {
  if (!items.length) {
    return [];
  }

  return Array.from({ length: Math.min(count, items.length) }, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в from внутри getCarouselItems. */ (_, offset) => items[(startIndex + offset) % items.length]);
}

/* Делает: Нормализует earthquake updates. Применение: используется локально в файле src/gsras/utils/news.js. */
export function normalizeEarthquakeUpdates(updates = []) {
  return updates
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри normalizeEarthquakeUpdates. */ (update) => {
      const title = update.title?.trim() ?? '';
      const messageText = stripHtmlTags(update.messageHtml ?? '');
      const coordinates = (update.coordinates ?? [])
        .filter(isFiniteCoordinate)
        .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри mapCallback. */ (coordinate) => ({
          latitude: Number(coordinate.latitude),
          longitude: Number(coordinate.longitude),
        }));

      return {
        ...update,
        title,
        messageText,
        coordinates,
      };
    })
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри normalizeEarthquakeUpdates. */ (update) => update.title || update.messageText || update.coordinates.length > 0);
}

/* Делает: Нормализует magnitude. Применение: используется локально в файле src/gsras/utils/news.js. */
function normalizeMagnitude(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const numericValue = Number.parseFloat(String(value).replace(',', '.'));

  if (!Number.isFinite(numericValue)) {
    return String(value).trim() || '-';
  }

  return numericValue.toFixed(1);
}

/* Делает: Нормализует recent earthquake events. Применение: используется локально в файле src/gsras/utils/news.js. */
export function normalizeRecentEarthquakeEvents(earthquake = {}, locale = 'ru') {
  const rawEvents = Array.isArray(earthquake?.recentEvents) ? earthquake.recentEvents : [];

  if (rawEvents.length > 0) {
    return rawEvents
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри normalizeRecentEarthquakeEvents. */ (event) => {
        const parsedDate = parseEarthquakeDateTime(event.date);
        const latitude = Number(event.latitude);
        const longitude = Number(event.longitude);

        return {
          id: String(event.eventId ?? `${event.date}-${latitude}-${longitude}`),
          eventId: Number(event.eventId ?? 0),
          date: event.date,
          formattedDate: formatEarthquakeDateTime(event.date, locale),
          dayKey: parsedDate?.dayKey ?? '',
          timestamp: parsedDate?.timestamp ?? 0,
          latitude,
          longitude,
          depth: Number(event.depth ?? 0),
          nsta: Number(event.nsta ?? 0),
          ms: normalizeMagnitude(event.ms),
          mpv: normalizeMagnitude(event.mpv),
          i0: String(event.i0 ?? '').trim() || '-',
          name: locale === 'en'
            ? (event.nameEn || event.nameRu || '')
            : (event.nameRu || event.nameEn || ''),
          nameRu: event.nameRu || event.nameEn || '',
          nameEn: event.nameEn || event.nameRu || '',
          searchText: normalizeWhitespace(
            `${event.date} ${event.nameRu ?? ''} ${event.nameEn ?? ''} ${event.mpv ?? ''} ${event.ms ?? ''}`
          ).toLowerCase(),
        };
      })
      .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри normalizeRecentEarthquakeEvents. */ (event) => Number.isFinite(event.latitude) && Number.isFinite(event.longitude))
      .sort(/* Делает: Сравнивает элементы при сортировке. Применение: передаётся как callback в sort внутри normalizeRecentEarthquakeEvents. */ (left, right) => right.timestamp - left.timestamp || right.eventId - left.eventId);
  }

  return normalizeEarthquakeUpdates(earthquake?.updates ?? [])
    .flatMap(/* Делает: Преобразует элемент и разворачивает результат. Применение: передаётся как callback в flatMap внутри normalizeRecentEarthquakeEvents. */ (update, updateIndex) => {
      const parsedDate = parseEarthquakeDateTime(update.updated || update.created || '');

      return update.coordinates.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри flatMapCallback. */ (coordinate, coordinateIndex) => ({
        id: `${update.id}-${coordinateIndex}`,
        eventId: updateIndex + 1,
        date: update.updated || update.created || '',
        formattedDate: formatEarthquakeDateTime(update.updated || update.created || '', locale),
        dayKey: parsedDate?.dayKey ?? '',
        timestamp: parsedDate?.timestamp ?? 0,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        depth: 0,
        nsta: 0,
        ms: '-',
        mpv: '-',
        i0: '-',
        name: update.title,
        nameRu: update.title,
        nameEn: update.title,
        searchText: normalizeWhitespace(`${update.title} ${update.messageText}`).toLowerCase(),
      }));
    })
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри normalizeRecentEarthquakeEvents. */ (event) => Number.isFinite(event.latitude) && Number.isFinite(event.longitude));
}

/* Делает: Выполняет to radians. Применение: используется локально в файле src/gsras/utils/news.js. */
function toRadians(value) {
  return (value * Math.PI) / 180;
}

/* Делает: Выполняет calculate distance km. Применение: используется локально в файле src/gsras/utils/news.js. */
export function calculateDistanceKm(fromLatitude, fromLongitude, toLatitude, toLongitude) {
  const earthRadiusKm = 6371;
  const latDistance = toRadians(toLatitude - fromLatitude);
  const lonDistance = toRadians(toLongitude - fromLongitude);
  const a =
    Math.sin(latDistance / 2) ** 2 +
    Math.cos(toRadians(fromLatitude)) * Math.cos(toRadians(toLatitude)) * Math.sin(lonDistance / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* Делает: Фильтрует recent earthquake events. Применение: используется локально в файле src/gsras/utils/news.js. */
export function filterRecentEarthquakeEvents(events, filters = {}) {
  const {
    count = 10,
    dayKey = '',
    latitude = null,
    longitude = null,
    radiusKm = null,
  } = filters;

  const hasRegionFilter = Number.isFinite(latitude) && Number.isFinite(longitude);

  if (hasRegionFilter) {
    const normalizedRadiusKm = Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 500;

    return events
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри filterRecentEarthquakeEvents. */ (event) => ({
        ...event,
        distanceKm: calculateDistanceKm(latitude, longitude, event.latitude, event.longitude),
      }))
      .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри filterRecentEarthquakeEvents. */ (event) => event.distanceKm <= normalizedRadiusKm)
      .sort(/* Делает: Сравнивает элементы при сортировке. Применение: передаётся как callback в sort внутри filterRecentEarthquakeEvents. */ (left, right) => left.distanceKm - right.distanceKm || right.timestamp - left.timestamp);
  }

  if (dayKey) {
    return events.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри filterRecentEarthquakeEvents. */ (event) => event.dayKey === dayKey);
  }

  return events.slice(0, Math.max(1, count));
}

/* Делает: Получает earthquake preview points. Применение: используется локально в файле src/gsras/utils/news.js. */
export function getEarthquakePreviewPoints(updates, limit = 10) {
  return updates
    .flatMap(/* Делает: Преобразует элемент и разворачивает результат. Применение: передаётся как callback в flatMap внутри getEarthquakePreviewPoints. */ (update, updateIndex) =>
      update.coordinates.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри flatMapCallback. */ (coordinate, coordinateIndex) => ({
        id: `${update.id}-${coordinateIndex}`,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        isPrimary: updateIndex === 0 && coordinateIndex === 0,
        title: update.title,
        created: update.created,
      }))
    )
    .slice(0, limit);
}

/* Делает: Получает recent earthquake preview points. Применение: используется локально в файле src/gsras/utils/news.js. */
export function getRecentEarthquakePreviewPoints(events, limit = 10) {
  return events.slice(0, limit).map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getRecentEarthquakePreviewPoints. */ (event, index) => ({
    id: event.id,
    latitude: event.latitude,
    longitude: event.longitude,
    isPrimary: index === 0,
    title: event.name,
    created: event.formattedDate,
  }));
}

/* Делает: Фильтрует archive entries. Применение: используется локально в файле src/gsras/utils/news.js. */
export function filterArchiveEntries(entries, searchValue, yearFilter) {
  const normalizedSearch = normalizeSearchValue(searchValue);

  return entries.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри filterArchiveEntries. */ (entry) => {
    const matchesYear = yearFilter === 'all' || entry.year === yearFilter;
    const matchesSearch = !normalizedSearch || entry.searchText.includes(normalizedSearch);

    return matchesYear && matchesSearch;
  });
}

/* Делает: Группирует год entries by. Применение: используется локально в файле src/gsras/utils/news.js. */
export function groupEntriesByYear(entries) {
  return entries.reduce(/* Делает: Накопляет итоговое значение при обходе коллекции. Применение: передаётся как callback в reduce внутри groupEntriesByYear. */ (accumulator, entry) => {
    const existingYear = accumulator.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри reduceCallback. */ (group) => group.year === entry.year);

    if (existingYear) {
      existingYear.entries.push(entry);
      return accumulator;
    }

    accumulator.push({
      year: entry.year,
      entries: [entry],
    });

    return accumulator;
  }, []);
}

/* Делает: Выполняет узел unwrap. Применение: используется локально в файле src/gsras/utils/news.js. */
function unwrapNode(node) {
  const parent = node.parentNode;

  if (!parent) {
    return;
  }

  while (node.firstChild) {
    parent.insertBefore(node.firstChild, node);
  }

  parent.removeChild(node);
}

/* Делает: Собирает маршрут новостей archive. Применение: используется локально в файле src/gsras/utils/news.js. */
function buildNewsArchiveRoute(entryId, locale = 'ru') {
  return localizePath(`/news/archive?entry=${encodeURIComponent(entryId)}`, locale);
}

/* Делает: Очищает и нормализует news html. Применение: используется локально в файле src/gsras/utils/news.js. */
export function sanitizeNewsHtml(html, archiveEntries = [], locale = 'ru') {
  if (typeof window === 'undefined' || !html) {
    return html;
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(`<div class="news-html-root">${html}</div>`, 'text/html');
  const root = documentNode.querySelector('.news-html-root');

  if (!root) {
    return html;
  }

  const routeMap = new Map();

  archiveEntries.forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри sanitizeNewsHtml. */ (entry) => {
    const internalRoute = buildNewsArchiveRoute(entry.id, locale);

    if (entry.sourceUrl) {
      routeMap.set(entry.sourceUrl, internalRoute);
    }

    if (entry.archiveUrl) {
      routeMap.set(entry.archiveUrl, internalRoute);
    }
  });

  root.querySelectorAll('a[href]').forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри sanitizeNewsHtml. */ (anchor) => {
    const href = anchor.getAttribute('href');

    if (!href) {
      return;
    }

    let resolvedHref = href;

    try {
      resolvedHref = new URL(href, 'http://www.gsras.ru/new/news/').toString();
    } catch {
      resolvedHref = href;
    }

    const internalRoute = routeMap.get(resolvedHref);

    if (internalRoute) {
      anchor.setAttribute('href', internalRoute);
      anchor.setAttribute('data-native-link', 'true');
      anchor.removeAttribute('target');
      anchor.removeAttribute('rel');
      return;
    }

    if (/^https?:\/\/www\.gsras\.ru\/new\/.*\.(?:htm|html)(?:[#?].*)?$/i.test(resolvedHref)) {
      unwrapNode(anchor);
      return;
    }

    if (/^https?:\/\//i.test(resolvedHref)) {
      anchor.setAttribute('href', resolvedHref);
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noreferrer');
    }
  });

  return root.innerHTML.trim();
}

