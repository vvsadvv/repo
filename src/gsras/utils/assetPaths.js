export const GSRAS_DATA_API_ROOT = '/api/gsras/data';
export const GSRAS_SITE_ASSETS_API_ROOT = '/api/gsras/site-assets';

/* Делает: Выполняет strip trailing slash. Применение: используется локально в файле src/gsras/utils/assetPaths.js. */
function stripTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/* Делает: Нормализует URL GS RAS ресурса. Применение: используется локально в файле src/gsras/utils/assetPaths.js. */
export function normalizeGsrasAssetUrl(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }

  const normalizedApiRoot = stripTrailingSlash(GSRAS_SITE_ASSETS_API_ROOT);

  if (value.startsWith(`${normalizedApiRoot}/`) || value === normalizedApiRoot) {
    return value;
  }

  if (value.startsWith('/site-assets/')) {
    return `${normalizedApiRoot}${value.slice('/site-assets'.length)}`;
  }

  if (value.startsWith('/new/')) {
    return `${normalizedApiRoot}${value}`;
  }

  if (/^https?:\/\/www\.gsras\.ru\/new\//i.test(value)) {
    return `${normalizedApiRoot}${value.replace(/^https?:\/\/www\.gsras\.ru/i, '')}`;
  }

  return value;
}

/* Делает: Нормализует gsras asset html. Применение: используется локально в файле src/gsras/utils/assetPaths.js. */
export function normalizeGsrasAssetHtml(html) {
  if (!html || typeof html !== 'string') {
    return html;
  }

  if (typeof window === 'undefined') {
    return html;
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(`<div class="gsras-asset-root">${html}</div>`, 'text/html');
  const root = documentNode.querySelector('.gsras-asset-root');

  if (!root) {
    return html;
  }

  root.querySelectorAll('[src]').forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри normalizeGsrasAssetHtml. */ (node) => {
    const source = node.getAttribute('src');

    if (source) {
      node.setAttribute('src', normalizeGsrasAssetUrl(source));
    }
  });

  root.querySelectorAll('[background]').forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри normalizeGsrasAssetHtml. */ (node) => {
    const background = node.getAttribute('background');

    if (background) {
      node.setAttribute('background', normalizeGsrasAssetUrl(background));
    }
  });

  return root.innerHTML;
}
