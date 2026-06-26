import { GSRAS_DATA_API_ROOT, normalizeGsrasAssetHtml, normalizeGsrasAssetUrl } from '@gsras-utils/assetPaths';

const NEWS_DATA_URLS = [`${GSRAS_DATA_API_ROOT}/gsras-news.json`, `${import.meta.env.BASE_URL}data/gsras-news.json`];

let cachedPayload = null;

/* Делает: Запрашивает first available json. Применение: используется локально в файле src/gsras/services/gsrasNewsService.js. */
async function fetchFirstAvailableJson(urls) {
  let lastError = null;

  for (const url of urls) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        lastError = new Error(`${response.status} ${response.statusText}`);
        continue;
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError instanceof Error ? `Не удалось получить данные: ${lastError.message}` : 'Не удалось получить данные.');
}

/* Делает: Нормализует точку входа новостей. Применение: используется локально в файле src/gsras/services/gsrasNewsService.js. */
function normalizeNewsEntry(entry = {}) {
  return {
    ...entry,
    imageUrl: normalizeGsrasAssetUrl(entry.imageUrl),
    bodyHtml: normalizeGsrasAssetHtml(entry.bodyHtml),
  };
}

/* Делает: Нормализует payload новостей. Применение: используется локально в файле src/gsras/services/gsrasNewsService.js. */
function normalizeNewsPayload(payload = {}) {
  return {
    ...payload,
    featuredNews: Array.isArray(payload.featuredNews) ? payload.featuredNews.map(normalizeNewsEntry) : [],
    archiveEntries: Array.isArray(payload.archiveEntries) ? payload.archiveEntries.map(normalizeNewsEntry) : [],
    earthquake: payload.earthquake
      ? {
          ...payload.earthquake,
          updates: Array.isArray(payload.earthquake.updates)
            ? payload.earthquake.updates.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри normalizeNewsPayload. */ (update) => ({
                ...update,
                messageHtml: normalizeGsrasAssetHtml(update.messageHtml),
              }))
            : [],
        }
      : payload.earthquake,
  };
}

/* Делает: Получает данные GS RAS новостей. Применение: используется локально в файле src/gsras/services/gsrasNewsService.js. */
export async function getGsrasNewsData() {
  if (cachedPayload) {
    return cachedPayload;
  }

  cachedPayload = normalizeNewsPayload(await fetchFirstAvailableJson(NEWS_DATA_URLS));
  return cachedPayload;
}
