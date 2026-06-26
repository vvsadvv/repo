import { getLegacyPageUrl, localizePath } from '@gsras-utils/siteLanguage';

import { GSRAS_SITE_ASSETS_API_ROOT, normalizeGsrasAssetUrl } from '@gsras-utils/assetPaths';

/* Делает: Нормализует путь маршрута. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
export function normalizeRoutePath(routePath) {
  if (!routePath || routePath === '/') {
    return '/';
  }

  return routePath.endsWith('/') ? routePath.slice(0, -1) : routePath;
}

const LEGACY_SITE_ORIGIN = 'http://www.gsras.ru';
const LEGACY_SECTION_ROOT = `${LEGACY_SITE_ORIGIN}/new/`;
const LOCAL_SITE_ASSETS_ROOT = GSRAS_SITE_ASSETS_API_ROOT;
const ALLOWED_LEGACY_EXTERNAL_PATTERNS = [
  /^\/cgi-bin\/new\/equakes\.pl$/i,
  /^\/cgi-bin\/new\/ccd_quake\.pl$/i,
  /^\/cgi-bin\/new\/mapCustom\.pl$/i,
  /^\/cgi-bin\/new\/catalog\.pl$/i,
  /^\/cgi-bin\/new\/info_quake\.pl$/i,
  /^\/new\/ssd(?:_news)?\.htm$/i,
];
const LEAD_NOISE_PATTERNS = [
  /RUS\s+ENG/i,
  /Вы ощутили землетрясение/i,
  /©\s*ФИЦ ЕГС РАН/i,
  /Новости\s*\|\s*Каталоги/i,
  /Архив новостей/i,
  /Последние землетрясения/i,
];
const LEAD_MENU_TOKENS = [
  'Контакты',
  'Администрация',
  'Структура',
  'Лицензии',
  'Сертификаты',
  'Уставные документы',
  'Положения / приказы',
  'Противодействие коррупции',
  'Буклет о ФИЦ ЕГС РАН',
  'Совет молодых ученых',
  'Национальные проекты',
  'Архив вакансий',
  'Архив объявлений',
  'Вакансии',
  'Образцы документов',
];

/* Делает: Форматирует дату sync. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
export function formatSyncDate(dateString, locale = 'ru') {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

/* Делает: Собирает текст страницы поискового. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function buildPageSearchText(page) {
  const directSearchText = typeof page.searchText === 'string' ? page.searchText.trim() : '';

  if (directSearchText) {
    return directSearchText.toLowerCase();
  }

  return normalizeLeadText(
    [page.title, page.sectionLabel, page.excerpt, page.sourcePath, page.routePath]
      .filter(Boolean)
      .join(' ')
  ).toLowerCase();
}

/* Делает: Фильтрует страницы сайтового. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
export function filterSitePages(pages, query, sectionId = 'all') {
  const normalizedQuery = query.trim().toLowerCase();
  const seenRouteKeys = new Set();

  return pages.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри filterSitePages. */ (page) => {
    const matchesSection = sectionId === 'all' || page.sectionId === sectionId;
    const matchesQuery = !normalizedQuery || buildPageSearchText(page).includes(normalizedQuery);
    const dedupeKey = normalizeRoutePath((page.routePath ?? '').replace(/\/index\.html?$/i, '') || `/${page.id}`);

    if (!matchesSection || !matchesQuery || seenRouteKeys.has(dedupeKey)) {
      return false;
    }

    seenRouteKeys.add(dedupeKey);
    return true;
  });
}

/* Делает: Получает маршрут раздела. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
export function getSectionRoute(sectionId, locale = 'ru') {
  if (!sectionId || sectionId === 'home') {
    return localizePath('/', locale);
  }

  if (sectionId === 'news') {
    return localizePath('/news', locale);
  }

  return localizePath(`/section/${sectionId}`, locale);
}

/* Делает: Получает маршрут страницы. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
export function getPageRoute(page, locale = 'ru') {
  if (!page) {
    return localizePath('/', locale);
  }

  if (page.sectionId === 'home') {
    return localizePath('/', locale);
  }

  if (page.routePath === '/news') {
    return localizePath('/news', locale);
  }

  if (page.routePath === '/news/archive') {
    return localizePath('/news/archive', locale);
  }

  const pageRouteKey = page.pageKey || encodeURIComponent(page.id);
  return localizePath(`/page/${pageRouteKey}`, locale);
}

/* Делает: Получает идентификатор страницы by. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
export function getPageById(pages, pageId) {
  if (!pageId) {
    return null;
  }

  const rawPageId = String(pageId);
  let decodedPageId = rawPageId;

  try {
    decodedPageId = decodeURIComponent(rawPageId);
  } catch {
    decodedPageId = rawPageId;
  }

  return pages.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри getPageById. */ (page) => {
    const pageKey = typeof page.pageKey === 'string' ? page.pageKey : '';
    return page.id === rawPageId || page.id === decodedPageId || pageKey === rawPageId || pageKey === decodedPageId;
  }) ?? null;
}

/* Делает: Получает раздел страниц by. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
export function getPagesBySection(pages, sectionId) {
  return filterSitePages(pages, '', sectionId);
}

/* Делает: Получает маршрут страницы by. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
export function getPageByRoute(pages, routePath) {
  const normalizedRoutePath = normalizeRoutePath(routePath);
  return pages.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри getPageByRoute. */ (page) => normalizeRoutePath(page.routePath) === normalizedRoutePath) ?? null;
}

/* Делает: Получает legacy path aliases. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function getLegacyPathAliases(pathname) {
  const aliases = new Set();
  const normalizedPathname = normalizeRoutePath(pathname);

  aliases.add(normalizedPathname);

  if (/\/index\.html?$/i.test(normalizedPathname)) {
    aliases.add(normalizeRoutePath(normalizedPathname.replace(/\/index\.html?$/i, '') || '/'));
  }

  for (const prefix of ['/new/eng', '/new']) {
    if (!normalizedPathname.startsWith(`${prefix}/`)) {
      continue;
    }

    const strippedPath = normalizeRoutePath(normalizedPathname.slice(prefix.length) || '/');
    aliases.add(strippedPath);

    if (/\/index\.html?$/i.test(strippedPath)) {
      aliases.add(normalizeRoutePath(strippedPath.replace(/\/index\.html?$/i, '') || '/'));
    }
  }

  return [...aliases].filter(Boolean);
}

/* Делает: Проверяет URL исторического social. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function isLegacySocialUrl(value) {
  return /(?:vk\.com|instagram\.com)/i.test(value);
}

/* Делает: Проверяет legacy language toggle. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function isLegacyLanguageToggle(anchor) {
  const href = anchor.getAttribute('href') ?? '';
  const text = normalizeLeadText(anchor.textContent ?? '').toUpperCase();

  return (text === 'RUS' || text === 'ENG') && /\/new(?:\/eng\/)?/i.test(href);
}

/* Делает: Проверяет URL исторического GS RAS. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function isLegacyGsrasUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'www.gsras.ru' && (parsed.pathname.startsWith('/new/') || parsed.pathname.startsWith('/cgi-bin/new/'));
  } catch {
    return false;
  }
}

/* Делает: Проверяет URL allowed внешнего. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function isAllowedExternalUrl(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname === 'mseism.gsras.ru') {
      return true;
    }

    if (parsed.hostname !== 'www.gsras.ru') {
      return true;
    }

    return ALLOWED_LEGACY_EXTERNAL_PATTERNS.some(/* Делает: Проверяет наличие подходящего элемента в коллекции. Применение: передаётся как callback в some внутри isAllowedExternalUrl. */ (pattern) => pattern.test(parsed.pathname));
  } catch {
    return false;
  }
}

/* Делает: Очищает legacy artifacts. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function cleanupLegacyArtifacts(contentRoot) {
  contentRoot.querySelectorAll('a[href]').forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри cleanupLegacyArtifacts. */ (anchor) => {
    const href = anchor.getAttribute('href') ?? '';

    if (!isLegacySocialUrl(href) && !isLegacyLanguageToggle(anchor)) {
      return;
    }

    const parent = anchor.parentElement;
    anchor.remove();

    if (parent && parent.children.length === 0 && !normalizeLeadText(parent.textContent ?? '')) {
      parent.remove();
    }
  });

  contentRoot.querySelectorAll('img[src]').forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри cleanupLegacyArtifacts. */ (image) => {
    const source = image.getAttribute('src') ?? '';

    if (/\/(?:vk_icon|instagram_icon)\.(?:gif|png|jpe?g|svg)$/i.test(source)) {
      image.remove();
    }
  });

  contentRoot.querySelectorAll('p, div, span, td').forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри cleanupLegacyArtifacts. */ (node) => {
    if (node.children.length === 0 && !normalizeLeadText(node.textContent ?? '')) {
      node.remove();
    }
  });
}

/* Делает: Создаёт карту native маршрута. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function createNativeRouteMap(pages, locale = 'ru') {
  const routeMap = new Map();

  for (const page of pages) {
    const nativeRoute = getLegacyPageUrl(page, locale) ?? getPageRoute(page, locale);
    routeMap.set(normalizeRoutePath(page.routePath), nativeRoute);
    routeMap.set(page.sourceUrl, nativeRoute);

    try {
      const sourceUrl = new URL(page.sourceUrl);
      const normalizedPathname = normalizeRoutePath(sourceUrl.pathname);

      for (const alias of getLegacyPathAliases(normalizedPathname)) {
        routeMap.set(alias, nativeRoute);
      }
    } catch {
      // Ignore malformed URLs in crawled data and keep the known route aliases.
    }
  }

  routeMap.set('/news', localizePath('/news', locale));
  routeMap.set('/news/archive', localizePath('/news/archive', locale));

  return routeMap;
}

/* Делает: Получает route candidates. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function getRouteCandidates(value, baseUrl) {
  if (!value) {
    return [];
  }

  const candidates = [normalizeRoutePath(value)];

  try {
    const resolvedUrl = new URL(value, baseUrl);
    const normalizedPathname = normalizeRoutePath(resolvedUrl.pathname);
    candidates.push(resolvedUrl.toString(), ...getLegacyPathAliases(normalizedPathname));
  } catch {
    // Some legacy URLs may be malformed; in that case we keep the raw candidate only.
  }

  return [...new Set(candidates.filter(Boolean))];
}

/* Делает: Определяет URL исторического. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function resolveLegacyUrl(value, baseUrl) {
  if (!value || value.startsWith('#') || value.startsWith('mailto:') || value.startsWith('tel:') || value.startsWith('javascript:')) {
    return value;
  }

  if (value.startsWith(`${GSRAS_SITE_ASSETS_API_ROOT}/`) || value === GSRAS_SITE_ASSETS_API_ROOT) {
    return value;
  }

  if (value.startsWith('/site-assets')) {
    return value;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (value.startsWith('/cgi-bin/') || value.startsWith('/new/')) {
    return `${LEGACY_SITE_ORIGIN}${value}`;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value.startsWith('/') ? `${LEGACY_SECTION_ROOT}${value.replace(/^\//, '')}` : value;
  }
}

/* Делает: Определяет URL исторического ресурса. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function resolveLegacyAssetUrl(value, baseUrl) {
  if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('mailto:') || value.startsWith('tel:') || value.startsWith('javascript:')) {
    return value;
  }

  const normalizedAssetUrl = normalizeGsrasAssetUrl(value);

  if (
    normalizedAssetUrl?.startsWith(`${GSRAS_SITE_ASSETS_API_ROOT}/`) ||
    normalizedAssetUrl === GSRAS_SITE_ASSETS_API_ROOT
  ) {
    return normalizedAssetUrl;
  }

  if (normalizedAssetUrl?.startsWith('/site-assets')) {
    return normalizedAssetUrl;
  }

  try {
    const resolvedUrl = new URL(normalizedAssetUrl ?? value, baseUrl);

    if (resolvedUrl.hostname === 'www.gsras.ru' && resolvedUrl.pathname.startsWith('/new/')) {
      return `${LOCAL_SITE_ASSETS_ROOT}${resolvedUrl.pathname}`;
    }

    return resolvedUrl.toString();
  } catch {
    if (value.startsWith('/new/')) {
      return `${LOCAL_SITE_ASSETS_ROOT}${value}`;
    }

    return resolveLegacyUrl(value, baseUrl);
  }
}

/* Делает: Выполняет strip inline handlers. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function stripInlineHandlers(node) {
  [...node.attributes].forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри stripInlineHandlers. */ (attribute) => {
    if (attribute.name.toLowerCase().startsWith('on')) {
      node.removeAttribute(attribute.name);
    }
  });
}

/* Делает: Выполняет узел unwrap. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
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

/* Делает: Очищает и нормализует inline style. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function sanitizeInlineStyle(node) {
  if (!(node instanceof HTMLElement) || !node.hasAttribute('style')) {
    return;
  }

  const allowedProperties = node.tagName === 'IMG'
    ? new Set(['width', 'height', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right'])
    : new Set([
        'color',
        'background-color',
        'text-align',
        'font-weight',
        'font-style',
        'font-size',
        'font-family',
        'text-decoration',
        'text-indent',
        'line-height',
        'letter-spacing',
      ]);

  const normalizedStyles = [];

  for (const propertyName of node.style) {
    if (allowedProperties.has(propertyName)) {
      normalizedStyles.push(`${propertyName}: ${node.style.getPropertyValue(propertyName)}`);
    }
  }

  if (normalizedStyles.length > 0) {
    node.setAttribute('style', normalizedStyles.join('; '));
    return;
  }

  node.removeAttribute('style');
}

/* Делает: Нормализует legacy markup. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function normalizeLegacyMarkup(contentRoot) {
  const nodes = [...contentRoot.querySelectorAll('*')];

  for (const node of nodes) {
    stripInlineHandlers(node);

    if (node.tagName.includes(':')) {
      if (!node.textContent?.trim() && node.childNodes.length === 0) {
        node.remove();
      } else {
        unwrapNode(node);
      }

      continue;
    }

    if (node.tagName === 'CENTER') {
      const centeredWrapper = contentRoot.ownerDocument.createElement('div');
      centeredWrapper.style.textAlign = 'center';

      while (node.firstChild) {
        centeredWrapper.appendChild(node.firstChild);
      }

      node.replaceWith(centeredWrapper);
      continue;
    }

    sanitizeInlineStyle(node);

    if (node.tagName !== 'IMG') {
      node.removeAttribute('width');
      node.removeAttribute('height');
    }

    node.removeAttribute('align');
    node.removeAttribute('valign');
    node.removeAttribute('bgcolor');

    if (node.tagName !== 'IMG') {
      node.removeAttribute('background');
    }
  }
}

/* Делает: Выполняет flatten legacy structure diagram. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function flattenLegacyStructureDiagram(contentRoot) {
  const chartRoot = contentRoot.querySelector('#all');
  const baseImage = chartRoot?.querySelector('#base img');

  if (!chartRoot || !(baseImage instanceof HTMLImageElement)) {
    return;
  }

  const figure = contentRoot.ownerDocument.createElement('figure');
  figure.className = 'legacy-structure';

  const image = contentRoot.ownerDocument.createElement('img');
  image.className = 'legacy-structure__image';
  image.src = baseImage.getAttribute('src') ?? '';
  image.alt = baseImage.getAttribute('alt') ?? 'Структура';
  image.loading = 'lazy';

  figure.appendChild(image);
  chartRoot.replaceWith(figure);
}

/* Делает: Выполняет контент unwrap native. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function unwrapNativeContent(documentRoot, sectionId) {
  const selectors = [
    'td[height="100%"][valign="top"][align="center"]',
    'td[height="100%"][valign="top"]',
    'div[style*="margin-right: 20px"][style*="width: 1150px"]',
    'table[width="90%"]',
    'table[width="95%"]',
  ];

  for (const selector of selectors) {
    const candidate = documentRoot.querySelector(selector);

    if (candidate?.innerHTML?.trim()) {
      return candidate.innerHTML;
    }
  }

  if (sectionId === 'ssd' || sectionId === 'home') {
    const fieldsets = documentRoot.querySelectorAll('fieldset');

    if (fieldsets.length > 0) {
      return [...fieldsets]
        .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри unwrapNativeContent. */ (fieldset) => fieldset.outerHTML)
        .join('');
    }
  }

  return documentRoot.innerHTML;
}

/* Делает: Нормализует текст lead. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function normalizeLeadText(text) {
  return text
    ?.replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim() ?? '';
}

/* Делает: Экранирует reg exp. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Делает: Выполняет strip repeated title. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function stripRepeatedTitle(text, page) {
  const normalizedTitle = normalizeLeadText(page.title);

  if (!normalizedTitle) {
    return text;
  }

  const titlePattern = new RegExp(`^${escapeRegExp(normalizedTitle)}[\\s:.,;-]*`, 'i');
  return text.replace(titlePattern, '').trim();
}

/* Делает: Выполняет matches menu cluster. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function matchesMenuCluster(text) {
  const matchedTokens = LEAD_MENU_TOKENS.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри matchesMenuCluster. */ (token) => text.includes(token)).length;
  return matchedTokens >= 3 && !/[.!?]/.test(text);
}

/* Делает: Получает link density. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function getLinkDensity(node, text) {
  if (!text) {
    return 1;
  }

  const linkText = normalizeLeadText(
    [...node.querySelectorAll('a')]
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getLinkDensity. */ (anchor) => anchor.textContent ?? '')
      .join(' ')
  );

  return linkText.length / text.length;
}

/* Делает: Проверяет lead noise. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function isLeadNoise(text, page, node) {
  if (!text || text.length < 28) {
    return true;
  }

  const normalizedTitle = normalizeLeadText(page.title);
  const normalizedSection = normalizeLeadText(page.sectionLabel);

  if (text === normalizedTitle || text === normalizedSection) {
    return true;
  }

  if (LEAD_NOISE_PATTERNS.some(/* Делает: Проверяет наличие подходящего элемента в коллекции. Применение: передаётся как callback в some внутри isLeadNoise. */ (pattern) => pattern.test(text))) {
    return true;
  }

  if (matchesMenuCluster(text)) {
    return true;
  }

  const linkCount = node.querySelectorAll('a').length;
  const linkDensity = getLinkDensity(node, text);

  if (linkCount >= 2 && linkDensity > 0.72) {
    return true;
  }

  if (text.length > 280 && !/[.!?]/.test(text)) {
    return true;
  }

  return false;
}

/* Делает: Определяет, нужно ли skip lead container. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function shouldSkipLeadContainer(node) {
  if (node.matches('td, div')) {
    return Boolean(node.querySelector('p, h1, h2, h3, h4, h5, ul, ol, table, figure, form'));
  }

  return false;
}

/* Делает: Выполняет score lead candidate. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function scoreLeadCandidate(node, text) {
  let score = 0;

  if (node.matches('p')) {
    score += 7;
  } else if (node.matches('h2, h3, h4, h5, blockquote')) {
    score += 6;
  } else if (node.matches('li')) {
    score += 1;
  }

  if (/[.!?]/.test(text)) {
    score += 4;
  }

  if (text.length >= 60 && text.length <= 240) {
    score += 4;
  } else if (text.length > 240) {
    score -= 1;
  }

  if (node.querySelectorAll('a').length === 0) {
    score += 2;
  }

  return score;
}

/* Делает: Очищает и нормализует page excerpt. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function sanitizePageExcerpt(page) {
  const text = stripRepeatedTitle(normalizeLeadText(page.excerpt), page);

  if (!text || LEAD_NOISE_PATTERNS.some(/* Делает: Проверяет наличие подходящего элемента в коллекции. Применение: передаётся как callback в some внутри sanitizePageExcerpt. */ (pattern) => pattern.test(text)) || matchesMenuCluster(text)) {
    return '';
  }

  return text;
}

/* Делает: Выполняет текст trim preview. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
function trimPreviewText(text, maxLength = 220) {
  if (!text) {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim().replace(/[.,;:!?-]+$/u, '')}...`;
}

/* Делает: Собирает native page html. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
export function buildNativePageHtml(page, allPages, locale = 'ru') {
  if (typeof window === 'undefined') {
    return page.bodyHtml;
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(`<div class="site-native-root">${page.bodyHtml}</div>`, 'text/html');
  const root = documentNode.querySelector('.site-native-root');

  if (!root) {
    return page.bodyHtml;
  }

  root.querySelectorAll('script, style, meta, link, noscript').forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри buildNativePageHtml. */ (node) => node.remove());

  let html = unwrapNativeContent(root, page.sectionId);
  const contentDocument = parser.parseFromString(`<div class="site-native-content">${html}</div>`, 'text/html');
  const contentRoot = contentDocument.querySelector('.site-native-content');

  if (!contentRoot) {
    return html;
  }

  contentRoot.querySelectorAll('script, style, meta, link, noscript').forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри buildNativePageHtml. */ (node) => node.remove());

  if (page.sectionId !== 'ssd' && page.sectionId !== 'home') {
    contentRoot.querySelectorAll('#news_div, #in_scrfocus, iframe').forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри buildNativePageHtml. */ (node) => node.remove());
  }

  const routeMap = createNativeRouteMap(allPages, locale);
  const pageBaseUrl = page.sourceUrl || LEGACY_SECTION_ROOT;

  normalizeLegacyMarkup(contentRoot);

  contentRoot.querySelectorAll('[src]').forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри buildNativePageHtml. */ (node) => {
    const source = node.getAttribute('src');
    const resolvedSource = resolveLegacyAssetUrl(source, pageBaseUrl);

    if (resolvedSource) {
      node.setAttribute('src', resolvedSource);
    }
  });

  contentRoot.querySelectorAll('[background]').forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри buildNativePageHtml. */ (node) => {
    const background = node.getAttribute('background');
    const resolvedBackground = resolveLegacyAssetUrl(background, pageBaseUrl);

    if (resolvedBackground) {
      node.setAttribute('background', resolvedBackground);
    }
  });

  contentRoot.querySelectorAll('a[href], area[href]').forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри buildNativePageHtml. */ (anchor) => {
    const href = anchor.getAttribute('href');

    if (!href) {
      return;
    }

    const resolvedRoute = getRouteCandidates(href, pageBaseUrl)
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри forEachCallback. */ (candidate) => routeMap.get(candidate))
      .find(Boolean);

    if (resolvedRoute) {
      anchor.setAttribute('href', resolvedRoute);
      anchor.removeAttribute('target');
      anchor.removeAttribute('rel');

      if (resolvedRoute.startsWith('/')) {
        anchor.setAttribute('data-native-link', 'true');
      } else {
        anchor.removeAttribute('data-native-link');
      }

      return;
    }

    const resolvedHref = resolveLegacyUrl(href, pageBaseUrl);

    if (resolvedHref) {
      if (isLegacyGsrasUrl(resolvedHref) && !isAllowedExternalUrl(resolvedHref)) {
        unwrapNode(anchor);
        return;
      }

      anchor.setAttribute('href', resolvedHref);

      if (/^https?:\/\//i.test(resolvedHref)) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noreferrer');
      }
    }
  });

  contentRoot.querySelectorAll('form').forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри buildNativePageHtml. */ (form) => {
    const action = form.getAttribute('action');
    const resolvedAction = resolveLegacyUrl(action, pageBaseUrl);

    if (resolvedAction) {
      if (isLegacyGsrasUrl(resolvedAction) && !isAllowedExternalUrl(resolvedAction)) {
        form.remove();
        return;
      }

      form.setAttribute('action', resolvedAction);
    }

    form.setAttribute('target', '_blank');
    form.classList.add('html-content__form');
  });

  cleanupLegacyArtifacts(contentRoot);
  flattenLegacyStructureDiagram(contentRoot);

  return contentRoot.innerHTML.trim();
}

/* Делает: Собирает page lead. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
export function buildPageLead(page, nativeHtml) {
  if (typeof window === 'undefined' || !nativeHtml) {
    return sanitizePageExcerpt(page);
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(`<div class="site-native-lead">${nativeHtml}</div>`, 'text/html');
  const root = documentNode.querySelector('.site-native-lead');

  if (!root) {
    return sanitizePageExcerpt(page);
  }

  root
    .querySelectorAll('script, style, noscript, iframe, form, fieldset, map, area, hr, .sticky, .legacy-structure, #news_div, #in_scrfocus')
    .forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри buildPageLead. */ (node) => node.remove());

  const candidates = [...root.querySelectorAll('p, h1, h2, h3, h4, h5, blockquote, li, td, div')];
  let bestLead = '';
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    if (shouldSkipLeadContainer(candidate)) {
      continue;
    }

    const text = stripRepeatedTitle(normalizeLeadText(candidate.textContent ?? ''), page);

    if (isLeadNoise(text, page, candidate)) {
      continue;
    }

    const score = scoreLeadCandidate(candidate, text);

    if (score > bestScore) {
      bestLead = text;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestLead : sanitizePageExcerpt(page);
}

/* Делает: Собирает page preview. Применение: используется локально в файле src/gsras/utils/siteContent.js. */
export function buildPagePreview(page, allPages, locale = 'ru') {
  const sanitizedExcerpt = sanitizePageExcerpt(page);

  if (sanitizedExcerpt) {
    return trimPreviewText(sanitizedExcerpt);
  }

  if (typeof window === 'undefined') {
    return '';
  }

  const previewText = buildPageLead(page, buildNativePageHtml(page, allPages, locale));
  return trimPreviewText(previewText);
}

