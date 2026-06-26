import { normalizeLocale } from '@gsras-utils/siteLanguage';
import { GSRAS_DATA_API_ROOT, normalizeGsrasAssetHtml, normalizeGsrasAssetUrl } from '@gsras-utils/assetPaths';

const SITE_DATA_URLS = {
  ru: [`${GSRAS_DATA_API_ROOT}/gsras-site.json`, `${import.meta.env.BASE_URL}data/gsras-site.json`],
  en: [`${GSRAS_DATA_API_ROOT}/gsras-site-en.json`, `${import.meta.env.BASE_URL}data/gsras-site-en.json`],
};

const SITE_PAGE_DATA_BASE_URLS = [GSRAS_DATA_API_ROOT, `${import.meta.env.BASE_URL}data`];
const cachedPayloads = new Map();
const cachedPagePayloads = new Map();

/* Делает: Получает site page data urls. Применение: используется локально в файле src/gsras/services/gsrasSiteService.js. */
function getSitePageDataUrls(contentFile) {
  const normalizedContentFile = String(contentFile ?? '').replace(/^\/+/, '');
  return SITE_PAGE_DATA_BASE_URLS.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getSitePageDataUrls. */ (baseUrl) => `${baseUrl.replace(/\/+$/, '')}/${normalizedContentFile}`);
}

/* Делает: Запрашивает first available json. Применение: используется локально в файле src/gsras/services/gsrasSiteService.js. */
async function fetchFirstAvailableJson(urls, errorMessage) {
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

  throw new Error(lastError instanceof Error ? `${errorMessage}: ${lastError.message}` : errorMessage);
}

/* Делает: Нормализует страницу сайтового. Применение: используется локально в файле src/gsras/services/gsrasSiteService.js. */
function normalizeSitePage(page = {}) {
  return {
    ...page,
    imageUrl: normalizeGsrasAssetUrl(page.imageUrl),
  };
}

/* Делает: Нормализует payload сайтового. Применение: используется локально в файле src/gsras/services/gsrasSiteService.js. */
function normalizeSitePayload(payload = {}) {
  return {
    ...payload,
    pages: Array.isArray(payload.pages) ? payload.pages.map(normalizeSitePage) : [],
  };
}

/* Делает: Нормализует payload сайтового страницы. Применение: используется локально в файле src/gsras/services/gsrasSiteService.js. */
function normalizeSitePagePayload(payload = {}) {
  return {
    ...payload,
    bodyHtml: normalizeGsrasAssetHtml(payload.bodyHtml),
  };
}

/* Делает: Получает данные GS RAS сайтового. Применение: используется локально в файле src/gsras/services/gsrasSiteService.js. */
export async function getGsrasSiteData(locale = 'ru') {
  const normalizedLocale = normalizeLocale(locale);

  if (cachedPayloads.has(normalizedLocale)) {
    return cachedPayloads.get(normalizedLocale);
  }

  const payload = normalizeSitePayload(
    await fetchFirstAvailableJson(SITE_DATA_URLS[normalizedLocale], 'Не удалось получить карту сайта')
  );
  cachedPayloads.set(normalizedLocale, payload);
  return payload;
}

/* Делает: Получает данные GS RAS сайтового страницы. Применение: используется локально в файле src/gsras/services/gsrasSiteService.js. */
export async function getGsrasSitePageData(contentFile) {
  if (!contentFile) {
    throw new Error('Не указан файл с содержимым страницы.');
  }

  const resolvedUrls = getSitePageDataUrls(contentFile);
  const cacheKey = resolvedUrls[0];

  if (cachedPagePayloads.has(cacheKey)) {
    return cachedPagePayloads.get(cacheKey);
  }

  const payload = normalizeSitePagePayload(
    await fetchFirstAvailableJson(resolvedUrls, 'Не удалось получить содержимое страницы')
  );
  cachedPagePayloads.set(cacheKey, payload);
  return payload;
}
