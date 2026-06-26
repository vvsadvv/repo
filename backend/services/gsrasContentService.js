import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const backendDir = path.resolve(currentDir, '..');
const repoRoot = path.resolve(backendDir, '..');
const defaultStorageRoot = path.join(repoRoot, 'storage', 'gsras');
const DEFAULT_LIST_LIMIT = 250;

/* Делает: Нормализует путь относительного. Применение: используется локально в файле backend/services/gsrasContentService.js. */
function normalizeRelativePath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim();
}

/* Делает: Проверяет path inside. Применение: используется локально в файле backend/services/gsrasContentService.js. */
function isPathInside(parentPath, candidatePath) {
  const normalizedParent = path.resolve(parentPath);
  const normalizedCandidate = path.resolve(candidatePath);

  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

/* Делает: Гарантирует каталог. Применение: используется локально в файле backend/services/gsrasContentService.js. */
async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

/* Делает: Выполняет path exists. Применение: используется локально в файле backend/services/gsrasContentService.js. */
async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/* Делает: Читает ответ buffer from. Применение: используется локально в файле backend/services/gsrasContentService.js. */
async function readBufferFromResponse(response) {
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/* Делает: Выполняет файлы каталога has. Применение: используется локально в файле backend/services/gsrasContentService.js. */
async function directoryHasFiles(targetPath) {
  if (!(await pathExists(targetPath))) {
    return false;
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile()) {
      return true;
    }

    if (entry.isDirectory()) {
      const nestedHasFiles = await directoryHasFiles(path.join(targetPath, entry.name));

      if (nestedHasFiles) {
        return true;
      }
    }
  }

  return false;
}

/* Делает: Выполняет copy directory if missing. Применение: используется локально в файле backend/services/gsrasContentService.js. */
async function copyDirectoryIfMissing(sourceDir, destinationDir) {
  if (!(await pathExists(sourceDir))) {
    return;
  }

  await ensureDirectory(destinationDir);

  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryIfMissing(sourcePath, destinationPath);
      continue;
    }

    if (!(await pathExists(destinationPath))) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

/* Делает: Выполняет файлы walk. Применение: используется локально в файле backend/services/gsrasContentService.js. */
async function walkFiles(rootDir, relativePrefix = '') {
  const files = [];

  if (!(await pathExists(rootDir))) {
    return files;
  }

  const entries = await fs.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryRelativePath = normalizeRelativePath(path.posix.join(relativePrefix, entry.name));
    const absolutePath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolutePath, entryRelativePath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const stats = await fs.stat(absolutePath);

    files.push({
      relativePath: entryRelativePath,
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
    });
  }

  return files;
}

class GsrasContentService {
    /* Делает: Инициализирует экземпляр GsrasContentService и подготавливает его начальное состояние. Применение: вызывается при создании экземпляра класса GsrasContentService в этом модуле. */
  constructor() {
    this.storageRoot = process.env.GSRAS_STORAGE_DIR
      ? path.resolve(process.env.GSRAS_STORAGE_DIR)
      : defaultStorageRoot;
    this.dataDir = path.join(this.storageRoot, 'data');
    this.siteAssetsDir = path.join(this.storageRoot, 'site-assets');
    this.sourceDataDirs = [
      path.join(repoRoot, 'public', 'data'),
      path.join(repoRoot, 'dist', 'data'),
    ];
    this.sourceSiteAssetsDirs = [
      path.join(repoRoot, 'public', 'site-assets'),
      path.join(repoRoot, 'dist', 'site-assets'),
    ];
    this.legacySiteOrigin = 'http://www.gsras.ru';
  }

    /* Делает: Получает каталоги публичного. Применение: используется внутри класса GsrasContentService. */
  getPublicDirectories() {
    return {
      dataDir: this.dataDir,
      siteAssetsDir: this.siteAssetsDir,
    };
  }

    /* Делает: Получает каталог scope. Применение: используется внутри класса GsrasContentService. */
  getScopeDirectory(scope) {
    if (scope === 'data') {
      return this.dataDir;
    }

    if (scope === 'site-assets') {
      return this.siteAssetsDir;
    }

    throw new Error('Неизвестная область GS RAS файлов.');
  }

    /* Делает: Определяет путь scope. Применение: используется внутри класса GsrasContentService. */
  resolveScopePath(scope, relativePath) {
    const scopeDir = this.getScopeDirectory(scope);
    const normalizedRelativePath = normalizeRelativePath(relativePath);

    if (!normalizedRelativePath) {
      throw new Error('Не указан относительный путь файла.');
    }

    if (normalizedRelativePath.includes('..')) {
      throw new Error('Недопустимый относительный путь файла.');
    }

    const absolutePath = path.resolve(scopeDir, normalizedRelativePath);

    if (!isPathInside(scopeDir, absolutePath)) {
      throw new Error('Путь файла выходит за пределы GS RAS storage.');
    }

    return {
      scopeDir,
      absolutePath,
      normalizedRelativePath,
    };
  }

    /* Делает: Гарантирует storage ready. Применение: используется внутри класса GsrasContentService. */
  async ensureStorageReady() {
    await ensureDirectory(this.storageRoot);
    await ensureDirectory(this.dataDir);
    await ensureDirectory(this.siteAssetsDir);
    await this.syncDefaults();
  }

    /* Делает: Синхронизирует defaults. Применение: используется внутри класса GsrasContentService. */
  async syncDefaults() {
    for (const sourceDataDir of this.sourceDataDirs) {
      await copyDirectoryIfMissing(sourceDataDir, this.dataDir);
    }

    for (const sourceSiteAssetsDir of this.sourceSiteAssetsDirs) {
      await copyDirectoryIfMissing(sourceSiteAssetsDir, this.siteAssetsDir);
    }
  }

    /* Делает: Гарантирует site asset available. Применение: используется внутри класса GsrasContentService. */
  async ensureSiteAssetAvailable(relativePath) {
    const { absolutePath, normalizedRelativePath } = this.resolveScopePath('site-assets', relativePath);

    if (await pathExists(absolutePath)) {
      return absolutePath;
    }

    await this.syncDefaults();

    if (await pathExists(absolutePath)) {
      return absolutePath;
    }

    if (!normalizedRelativePath.startsWith('new/')) {
      return null;
    }

    const legacyUrl = `${this.legacySiteOrigin}/${normalizedRelativePath}`;

    try {
      const response = await fetch(legacyUrl);

      if (!response.ok) {
        return null;
      }

      const contentBuffer = await readBufferFromResponse(response);
      await ensureDirectory(path.dirname(absolutePath));
      await fs.writeFile(absolutePath, contentBuffer);
      return absolutePath;
    } catch {
      return null;
    }
  }

    /* Делает: Возвращает список файлы. Применение: используется внутри класса GsrasContentService. */
  async listFiles(scope, { prefix = '', limit = DEFAULT_LIST_LIMIT } = {}) {
    const scopeDir = this.getScopeDirectory(scope);
    const normalizedPrefix = normalizeRelativePath(prefix);
    const files = await walkFiles(scopeDir);
    const filteredFiles = normalizedPrefix
      ? files.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри listFiles. */ (file) => file.relativePath.startsWith(normalizedPrefix))
      : files;

    return filteredFiles
      .sort(/* Делает: Сравнивает элементы при сортировке. Применение: передаётся как callback в sort внутри listFiles. */ (left, right) => left.relativePath.localeCompare(right.relativePath, 'ru'))
      .slice(0, Math.max(1, limit));
  }

    /* Делает: Получает overview. Применение: используется внутри класса GsrasContentService. */
  async getOverview() {
    const [dataFiles, siteAssetFiles] = await Promise.all([
      walkFiles(this.dataDir),
      walkFiles(this.siteAssetsDir),
    ]);

        /* Делает: Собирает сводку. Применение: используется внутри функции getOverview. */
    const buildSummary = (scope, files) => ({
      scope,
      root: this.getScopeDirectory(scope),
      fileCount: files.length,
      totalSize: files.reduce(/* Делает: Накопляет итоговое значение при обходе коллекции. Применение: передаётся как callback в reduce внутри buildSummary. */ (sum, file) => sum + file.size, 0),
      recentFiles: [...files]
        .sort(/* Делает: Сравнивает элементы при сортировке. Применение: передаётся как callback в sort внутри buildSummary. */ (left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 12),
    });

    const essentialFiles = [
      'gsras-site.json',
      'gsras-site-en.json',
      'gsras-news.json',
    ];

    return {
      storageRoot: this.storageRoot,
      scopes: {
        data: buildSummary('data', dataFiles),
        'site-assets': buildSummary('site-assets', siteAssetFiles),
      },
      essentialFiles: await Promise.all(
        essentialFiles.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getOverview. */ async (relativePath) => {
          const absolutePath = path.join(this.dataDir, relativePath);
          const exists = await pathExists(absolutePath);

          if (!exists) {
            return {
              relativePath,
              exists: false,
              size: 0,
              updatedAt: null,
            };
          }

          const stats = await fs.stat(absolutePath);
          return {
            relativePath,
            exists: true,
            size: stats.size,
            updatedAt: stats.mtime.toISOString(),
          };
        })
      ),
    };
  }

    /* Делает: Сохраняет файл. Применение: используется внутри класса GsrasContentService. */
  async saveFile(scope, relativePath, contentBuffer) {
    const { absolutePath, normalizedRelativePath } = this.resolveScopePath(scope, relativePath);
    await ensureDirectory(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, contentBuffer);
    const stats = await fs.stat(absolutePath);

    return {
      scope,
      relativePath: normalizedRelativePath,
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
    };
  }
}

export const gsrasContentService = new GsrasContentService();
