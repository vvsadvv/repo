export const DEFAULT_LOCALE = 'ru';
export const SITE_BASE_PATH = '/gsras';

const LOCALES = new Set(['ru', 'en']);
const LEGACY_SITE_ROOT = 'http://www.gsras.ru';

/* Делает: Разделяет path and suffix. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
function splitPathAndSuffix(path = '/') {
  const [, pathname = '/', suffix = ''] = path.match(/^([^?#]*)(.*)$/) ?? [];
  return {
    pathname,
    suffix,
  };
}

/* Делает: Нормализует pathname. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
function normalizePathname(pathname = '/') {
  const normalizedPathname = pathname.replace(/\/+$/, '');
  return normalizedPathname || '/';
}

/* Делает: Получает URL исторического ssd. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function getLegacySsdUrl(locale = DEFAULT_LOCALE) {
  return normalizeLocale(locale) === 'en'
    ? `${LEGACY_SITE_ROOT}/new/eng/ssd.htm`
    : `${LEGACY_SITE_ROOT}/new/ssd.htm`;
}

/* Делает: Получает URL исторического карты. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function getLegacyMapUrl(locale = DEFAULT_LOCALE) {
  return `${LEGACY_SITE_ROOT}/cgi-bin/new/equakes.pl?l=${normalizeLocale(locale) === 'en' ? '1' : '0'}`;
}

/* Делает: Получает URL исторического ssd archive. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function getLegacySsdArchiveUrl(locale = DEFAULT_LOCALE) {
  return `${LEGACY_SITE_ROOT}/cgi-bin/new/info_quake.pl?mode=-1&l=${normalizeLocale(locale) === 'en' ? '1' : '0'}`;
}

/* Делает: Получает URL исторического ccd quake. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function getLegacyCcdQuakeUrl() {
  return `${LEGACY_SITE_ROOT}/cgi-bin/new/ccd_quake.pl`;
}

/* Делает: Получает URL исторического карты custom. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function getLegacyMapCustomUrl() {
  return `${LEGACY_SITE_ROOT}/cgi-bin/new/mapCustom.pl`;
}

/* Делает: Получает URL исторического раздела. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function getLegacySectionUrl(sectionId, locale = DEFAULT_LOCALE) {
  if (sectionId === 'ssd') {
    return getLegacySsdUrl(locale);
  }

  return null;
}

/* Делает: Получает URL исторического страницы. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function getLegacyPageUrl(page, locale = DEFAULT_LOCALE) {
  if (!page) {
    return null;
  }

  if (page.sectionId === 'ssd' || page.routePath === '/ssd.htm') {
    return page.externalUrl || page.sourceUrl || getLegacySsdUrl(locale);
  }

  return null;
}

const mainNavigation = {
  ru: [
    { label: 'Главная', routePath: '/' },
    { label: 'Новости', routePath: '/news' },
    { label: 'ССД', routePath: '/section/ssd', externalUrl: getLegacySsdUrl('ru') },
    { label: 'Карта', routePath: '/map', externalUrl: getLegacyMapUrl('ru') },
    { label: 'Сейсм. данные', routePath: '/section/wf' },
    { label: 'ГНСС данные', routePath: '/section/gncc' },
    { label: 'Продукты', routePath: '/section/soft' },
    { label: 'Структура', routePath: '/section/struct' },
    { label: 'Публикации', routePath: '/section/public' },
    { label: 'Конференции', routePath: '/section/conf' },
    { label: 'Объявления', routePath: '/section/announ' },
    { label: 'О нас', routePath: '/section/about' },
  ],
  en: [
    { label: 'Home', routePath: '/' },
    { label: 'News', routePath: '/news' },
    { label: 'Alert Service', routePath: '/section/ssd', externalUrl: getLegacySsdUrl('en') },
    { label: 'Map', routePath: '/map', externalUrl: getLegacyMapUrl('en') },
    { label: 'Wave Forms', routePath: '/section/wf' },
    { label: 'Software', routePath: '/section/soft' },
    { label: 'Structure', routePath: '/section/struct' },
    { label: 'Publications', routePath: '/section/public' },
    { label: 'Conferences', routePath: '/section/conf' },
    { label: 'Announcements', routePath: '/section/announ' },
    { label: 'About', routePath: '/section/about' },
  ],
};

const organizationLinks = {
  ru: [
    { routePath: '/news', content: 'Новости' },
    { routePath: '/section/ssd', content: 'ССД', externalUrl: getLegacySsdUrl('ru') },
    { routePath: '/section/wf', content: 'Сейсм. данные' },
    { routePath: '/section/gncc', content: 'ГНСС данные' },
    { routePath: '/section/soft', content: 'Продукты' },
    { routePath: '/section/links', content: 'Ссылки' },
    { routePath: '/section/struct', content: 'Структура' },
    { routePath: '/section/public', content: 'Публикации' },
    { routePath: '/section/conf', content: 'Конференции' },
    { routePath: '/section/announ', content: 'Объявления' },
    { routePath: '/section/about', content: 'О нас' },
  ],
  en: [
    { routePath: '/news', content: 'News' },
    { routePath: '/section/ssd', content: 'Alert Service', externalUrl: getLegacySsdUrl('en') },
    { routePath: '/section/wf', content: 'Wave Forms' },
    { routePath: '/section/soft', content: 'Software' },
    { routePath: '/section/links', content: 'Links' },
    { routePath: '/section/struct', content: 'Structure' },
    { routePath: '/section/public', content: 'Publications' },
    { routePath: '/section/conf', content: 'Conferences' },
    { routePath: '/section/announ', content: 'Announcements' },
    { routePath: '/section/about', content: 'About' },
  ],
};

const sectionShortcutDefinitions = {
  ru: {
    struct: [
      { label: 'Контакты', sourcePath: 'struct/contact.htm' },
      { label: 'Администрация', sourcePath: 'struct/admin.htm' },
      { label: 'Структура', sourcePath: 'struct/struct_gsras.htm' },
      { label: 'Лицензии и сертификаты', sourcePath: 'doc/' },
      { label: 'Уставные документы', sourcePath: 'doc/ustav.htm' },
      { label: 'Положения / приказы', sourcePath: 'doc/polog.htm' },
      { label: 'Противодействие коррупции', sourcePath: 'doc/corrup.htm' },
      { label: 'Буклет о ФИЦ ЕГС РАН', sourcePath: 'doc/book_gsras.htm' },
      { label: 'Национальные проекты', sourcePath: 'national_project.htm' },
      {
        label: 'Совет молодых ученых и специалистов',
        externalUrl: 'https://kam.emsd.ru/general-council-of-young-scientists-and-specialists',
      },
    ],
  },
  en: {
    struct: [
      { label: 'Contacts', sourcePath: 'struct/contact.htm' },
      { label: 'Administration', sourcePath: 'struct/admin.htm' },
      { label: 'Structure', sourcePath: 'struct/struct_gsras.htm' },
      { label: 'Licenses and Certificates', sourcePath: 'doc/' },
      { label: 'Statutory Documents', sourcePath: 'doc/ustav.htm' },
      { label: 'Regulations / Orders', sourcePath: 'doc/polog.htm' },
      { label: 'Anti-Corruption', sourcePath: 'doc/corrup.htm' },
      { label: 'GS RAS Booklet', sourcePath: 'doc/book_gsras.htm' },
      { label: 'National Projects', sourcePath: 'national_project.htm' },
      {
        label: 'Council of Young Scientists and Specialists',
        externalUrl: 'https://kam.emsd.ru/general-council-of-young-scientists-and-specialists',
      },
    ],
  },
};

/* Делает: Нормализует locale. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function normalizeLocale(locale) {
  return LOCALES.has(locale) ? locale : DEFAULT_LOCALE;
}

/* Делает: Проверяет english locale. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function isEnglishLocale(locale) {
  return normalizeLocale(locale) === 'en';
}

/* Делает: Получает locale from pathname. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function getLocaleFromPathname(pathname = '/') {
  const { pathname: rawPathname } = splitPathAndSuffix(pathname);
  const normalizedPathname = normalizePathname(rawPathname);

  return normalizedPathname === `${SITE_BASE_PATH}/en`
    || normalizedPathname.startsWith(`${SITE_BASE_PATH}/en/`)
    || normalizedPathname === '/en'
    || normalizedPathname.startsWith('/en/')
    ? 'en'
    : 'ru';
}

/* Делает: Выполняет strip locale prefix. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function stripLocalePrefix(pathname = '/') {
  if (!pathname) {
    return '/';
  }

  const { pathname: rawPathname } = splitPathAndSuffix(pathname);
  const normalizedPathname = normalizePathname(rawPathname);
  const prefixes = [`${SITE_BASE_PATH}/en`, SITE_BASE_PATH, '/en'];

  for (const prefix of prefixes) {
    if (normalizedPathname === prefix) {
      return '/';
    }

    if (normalizedPathname.startsWith(`${prefix}/`)) {
      return normalizedPathname.slice(prefix.length) || '/';
    }
  }

  return normalizedPathname;
}

/* Делает: Выполняет путь localize. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function localizePath(path = '/', locale = DEFAULT_LOCALE) {
  if (!path || !path.startsWith('/')) {
    return path;
  }

  const { pathname: rawPathname, suffix } = splitPathAndSuffix(path);
  const pathname = stripLocalePrefix(rawPathname) || '/';
  const normalizedLocale = normalizeLocale(locale);

  if (normalizedLocale === 'en') {
    return `${pathname === '/' ? `${SITE_BASE_PATH}/en` : `${SITE_BASE_PATH}/en${pathname}`}${suffix}`;
  }

  return `${pathname === '/' ? SITE_BASE_PATH : `${SITE_BASE_PATH}${pathname}`}${suffix}`;
}

/* Делает: Получает маршрут главной страницы. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function getHomeRoute(locale = DEFAULT_LOCALE) {
  return localizePath('/', locale);
}

/* Делает: Получает main navigation. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function getMainNavigation(locale = DEFAULT_LOCALE) {
  return mainNavigation[normalizeLocale(locale)].map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getMainNavigation. */ (item) => ({
    ...item,
    ...(item.routePath ? { routePath: localizePath(item.routePath, locale) } : {}),
  }));
}

/* Делает: Получает organization links. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function getOrganizationLinks(locale = DEFAULT_LOCALE) {
  return organizationLinks[normalizeLocale(locale)].map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getOrganizationLinks. */ (item) => ({
    ...item,
    ...(item.routePath ? { routePath: localizePath(item.routePath, locale) } : {}),
  }));
}

/* Делает: Получает section shortcut definitions. Применение: используется локально в файле src/gsras/utils/siteLanguage.js. */
export function getSectionShortcutDefinitions(locale = DEFAULT_LOCALE, sectionId) {
  const normalizedLocale = normalizeLocale(locale);
  return sectionShortcutDefinitions[normalizedLocale][sectionId] ?? [];
}
