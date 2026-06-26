import { useEffect, useMemo, useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { Link, Navigate } from 'react-router-dom';
import axios from 'axios';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';
import { getRepositoryToken } from '@/utils/repositoryAuthStorage';
import { extractApiErrorMessage } from '@/utils/apiErrors';
import '@/pages/AdminPanel/AdminPanel.scss';

type GsrasScope = 'data' | 'site-assets';

interface GsrasFileInfo {
  relativePath: string;
  size: number;
  updatedAt: string;
}

interface GsrasScopeSummary {
  scope: GsrasScope;
  root: string;
  fileCount: number;
  totalSize: number;
  recentFiles: GsrasFileInfo[];
}

interface GsrasEssentialFileInfo {
  relativePath: string;
  exists: boolean;
  size: number;
  updatedAt: string | null;
}

interface GsrasStorageOverview {
  storageRoot: string;
  scopes: Record<GsrasScope, GsrasScopeSummary>;
  essentialFiles: GsrasEssentialFileInfo[];
}

const API_BASE = '/api/repository-admin/gsras';
const SCOPE_DETAILS: Record<
  GsrasScope,
  {
    label: string;
    description: string;
    uploadPlaceholder: string;
    listPlaceholder: string;
    textPlaceholder: string;
    examples: string[];
  }
> = {
  data: {
    label: 'Данные сайта',
    description: 'JSON-файлы с новостями, картой сайта и отдельными страницами.',
    uploadPlaceholder: 'Например: gsras-pages/ru или gsras-pages/en',
    listPlaceholder: 'Например: gsras-pages/ru',
    textPlaceholder: 'Например: gsras-news.json или gsras-pages/ru/0001.json',
    examples: ['gsras-news.json', 'gsras-site.json', 'gsras-pages/ru/0001.json'],
  },
  'site-assets': {
    label: 'Файлы сайта',
    description: 'Картинки, PDF, документы и другие вложения, которые показываются на страницах.',
    uploadPlaceholder: 'Например: new/images или new/struct/admin_files',
    listPlaceholder: 'Например: new/struct/admin_files',
    textPlaceholder: 'Например: new/struct/readme.txt',
    examples: ['new/images/GS-logo.jpg', 'new/struct/admin_files/Vinogradov_small.jpg', 'new/conf/...'],
  },
};

const UPLOAD_PRESETS: Array<{ label: string; scope: GsrasScope; basePath: string }> = [
  { label: 'Страницы RU', scope: 'data', basePath: 'gsras-pages/ru' },
  { label: 'Страницы EN', scope: 'data', basePath: 'gsras-pages/en' },
  { label: 'Изображения разделов', scope: 'site-assets', basePath: 'new/struct/admin_files' },
  { label: 'Общие изображения', scope: 'site-assets', basePath: 'new/images' },
];

const TEXT_PRESETS: Array<{ label: string; scope: GsrasScope; relativePath: string }> = [
  { label: 'Новости сайта', scope: 'data', relativePath: 'gsras-news.json' },
  { label: 'Карта сайта RU', scope: 'data', relativePath: 'gsras-site.json' },
  { label: 'Карта сайта EN', scope: 'data', relativePath: 'gsras-site-en.json' },
  { label: 'Страница RU', scope: 'data', relativePath: 'gsras-pages/ru/0001.json' },
];

/* Делает: Форматирует file size. Применение: используется локально в файле src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */
function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} Б`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} КБ`;
  }

  return `${(size / (1024 * 1024)).toFixed(2)} МБ`;
}

/* Делает: Нормализует путь относительного. Применение: используется локально в файле src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */
function normalizeRelativePath(value: string) {
  return value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim();
}

/* Делает: Выполняет путь join относительного. Применение: используется локально в файле src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */
function joinRelativePath(basePath: string, filePath: string) {
  const normalizedBase = normalizeRelativePath(basePath);
  const normalizedFile = normalizeRelativePath(filePath);

  if (!normalizedBase) {
    return normalizedFile;
  }

  if (!normalizedFile) {
    return normalizedBase;
  }

  return `${normalizedBase}/${normalizedFile}`;
}

/* Делает: Кодирует file to base64. Применение: используется локально в файле src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */
async function encodeFileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return window.btoa(binary);
}

/* Делает: Кодирует text to base64. Применение: используется локально в файле src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */
function encodeTextToBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';

  bytes.forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри encodeTextToBase64. */ (byte) => {
    binary += String.fromCharCode(byte);
  });

  return window.btoa(binary);
}

/* Делает: Рендерит React-компонент RepositoryGsrasAdminPanel и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function RepositoryGsrasAdminPanel() {
  const { repositoryUser, loading } = useRepositoryAuth();
  const [overview, setOverview] = useState<GsrasStorageOverview | null>(null);
  const [files, setFiles] = useState<GsrasFileInfo[]>([]);
  const [selectedScope, setSelectedScope] = useState<GsrasScope>('data');
  const [listPrefix, setListPrefix] = useState('');
  const [uploadBasePath, setUploadBasePath] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [textScope, setTextScope] = useState<GsrasScope>('data');
  const [textRelativePath, setTextRelativePath] = useState('gsras-news.json');
  const [textContent, setTextContent] = useState('');
  const [pageLoading, setPageLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [syncingDefaults, setSyncingDefaults] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const requestConfig = useMemo(
    /* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryGsrasAdminPanel. */ () => ({
      headers: {
        Authorization: `Bearer ${getRepositoryToken() || ''}`,
      },
    }),
    []
  );
  const selectedScopeDetails = SCOPE_DETAILS[selectedScope];
  const textScopeDetails = SCOPE_DETAILS[textScope];

    /* Делает: Загружает overview. Применение: используется внутри функции RepositoryGsrasAdminPanel. */
  const loadOverview = async () => {
    const response = await axios.get<GsrasStorageOverview>(`${API_BASE}/storage`, requestConfig);
    setOverview(response.data);
  };

    /* Делает: Загружает файлы. Применение: используется внутри функции RepositoryGsrasAdminPanel. */
  const loadFiles = async (scope: GsrasScope, prefix = '') => {
    const response = await axios.get<{ scope: GsrasScope; files: GsrasFileInfo[] }>(`${API_BASE}/files`, {
      ...requestConfig,
      params: {
        scope,
        prefix,
        limit: 250,
      },
    });
    setFiles(response.data.files);
  };

    /* Делает: Обновляет all. Применение: используется внутри функции RepositoryGsrasAdminPanel. */
  const refreshAll = async (scope = selectedScope, prefix = listPrefix) => {
    setPageLoading(true);
    try {
      await Promise.all([loadOverview(), loadFiles(scope, prefix)]);
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка загрузки GS RAS storage') });
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryGsrasAdminPanel. */ () => {
    if (repositoryUser?.role === 'admin') {
      void refreshAll();
    }
  }, [repositoryUser]);

  if (loading) {
    return <div className='admin-panel loading'>Загрузка...</div>;
  }

  if (!repositoryUser) {
    return <Navigate to='/repository/login' replace />;
  }

  if (repositoryUser.role !== 'admin') {
    return <Navigate to='/repository' replace />;
  }

    /* Делает: Обрабатывает scope change. Применение: используется внутри функции RepositoryGsrasAdminPanel. */
  const handleScopeChange = async (nextScope: GsrasScope) => {
    setSelectedScope(nextScope);
    setPageLoading(true);

    try {
      await loadFiles(nextScope, listPrefix);
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка загрузки списка GS RAS файлов') });
    } finally {
      setPageLoading(false);
    }
  };

    /* Делает: Выполняет apply upload preset. Применение: используется внутри функции RepositoryGsrasAdminPanel. */
  const applyUploadPreset = (scope: GsrasScope, basePath: string) => {
    setUploadBasePath(basePath);
    void handleScopeChange(scope);
  };

    /* Делает: Выполняет apply text preset. Применение: используется внутри функции RepositoryGsrasAdminPanel. */
  const applyTextPreset = (scope: GsrasScope, relativePath: string) => {
    setTextScope(scope);
    setTextRelativePath(relativePath);
  };

    /* Делает: Выполняет apply prefix filter. Применение: используется внутри функции RepositoryGsrasAdminPanel. */
  const applyPrefixFilter = async () => {
    setPageLoading(true);

    try {
      await loadFiles(selectedScope, listPrefix);
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка фильтрации GS RAS файлов') });
    } finally {
      setPageLoading(false);
    }
  };

    /* Делает: Синхронизирует файлы базового. Применение: используется внутри функции RepositoryGsrasAdminPanel. */
  const syncDefaultFiles = async () => {
    setSyncingDefaults(true);
    setNotification(null);

    try {
      const response = await axios.post<{ message?: string; overview?: GsrasStorageOverview }>(
        `${API_BASE}/sync-defaults`,
        {},
        requestConfig
      );

      if (response.data?.overview) {
        setOverview(response.data.overview);
      }

      await loadFiles(selectedScope, listPrefix);
      setNotification({
        type: 'success',
        text: response.data?.message || 'Встроенные файлы GS RAS синхронизированы.',
      });
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка синхронизации встроенных GS RAS файлов') });
    } finally {
      setSyncingDefaults(false);
    }
  };

    /* Делает: Выполняет файлы загрузки chosen. Применение: используется внутри функции RepositoryGsrasAdminPanel. */
  const uploadChosenFiles = async () => {
    if (selectedFiles.length === 0) {
      setNotification({ type: 'error', text: 'Выберите хотя бы один файл для загрузки.' });
      return;
    }

    setUploading(true);
    setNotification(null);

    try {
      for (const file of selectedFiles) {
        const relativePath = file.webkitRelativePath
          ? joinRelativePath(uploadBasePath, file.webkitRelativePath)
          : joinRelativePath(uploadBasePath, file.name);
        const contentBase64 = await encodeFileToBase64(file);

        await axios.post(
          `${API_BASE}/files`,
          {
            scope: selectedScope,
            relativePath,
            contentBase64,
          },
          requestConfig
        );
      }

      setNotification({
        type: 'success',
        text: `Загружено файлов: ${selectedFiles.length}.`,
      });
      setSelectedFiles([]);
      await refreshAll(selectedScope, listPrefix);
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка загрузки GS RAS файлов') });
    } finally {
      setUploading(false);
    }
  };

    /* Делает: Сохраняет файл текста. Применение: используется внутри функции RepositoryGsrasAdminPanel. */
  const saveTextFile = async () => {
    const relativePath = normalizeRelativePath(textRelativePath);

    if (!relativePath) {
      setNotification({ type: 'error', text: 'Укажите относительный путь файла.' });
      return;
    }

    setCreating(true);
    setNotification(null);

    try {
      await axios.post(
        `${API_BASE}/files`,
        {
          scope: textScope,
          relativePath,
          contentBase64: encodeTextToBase64(textContent),
        },
        requestConfig
      );

      setNotification({ type: 'success', text: `Файл ${relativePath} сохранен.` });
      await refreshAll(selectedScope, listPrefix);
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка сохранения GS RAS файла') });
    } finally {
      setCreating(false);
    }
  };

  const scopeCards = overview ? [overview.scopes.data, overview.scopes['site-assets']] : [];
  const selectedFilePreview = selectedFiles.slice(0, 5).map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryGsrasAdminPanel. */ (file) => file.webkitRelativePath || file.name);
  const directoryInputProps = {
    type: 'file',
    multiple: true,
        /* Делает: Выполняет on change. Применение: используется внутри функции RepositoryGsrasAdminPanel. */
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setSelectedFiles(Array.from(event.target.files ?? []));
    },
    webkitdirectory: '',
    directory: '',
  } as InputHTMLAttributes<HTMLInputElement>;

  return (
    <div className='admin-panel'>
      <div className='admin-panel__reference-card-header'>
        <div>
          <h1>GS RAS контент</h1>
          <p>Управление маршрутами `/gsras`, JSON-данными, деталями страниц и локальными ассетами сайта.</p>
        </div>
        <div className='user-actions'>
          <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ () => void syncDefaultFiles()} disabled={syncingDefaults}>
            {syncingDefaults ? 'Синхронизация...' : 'Подтянуть встроенные файлы'}
          </button>
          <Link to='/repository/admin' className='btn-approve'>
            Назад в админ-панель
          </Link>
        </div>
      </div>

      {notification && (
        <div className={`admin-notification admin-notification--${notification.type}`}>
          {notification.text}
        </div>
      )}

      {pageLoading ? (
        <div className='admin-panel loading'>Загрузка...</div>
      ) : (
        <>
          {overview && (
            <div className='users-grid'>
              {scopeCards.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryGsrasAdminPanel. */ (scope) => (
                <div key={scope.scope} className='user-card admin-panel__reference-card'>
                  <div className='admin-panel__reference-card-header'>
                    <h3>{SCOPE_DETAILS[scope.scope].label}</h3>
                    <span className='status-badge status-active'>{scope.fileCount} файлов</span>
                  </div>
                  <p>{SCOPE_DETAILS[scope.scope].description}</p>
                  <div className='admin-panel__detail-list'>
                    <div className='admin-panel__detail-row'>
                      <span>Каталог</span>
                      <strong>{scope.root}</strong>
                    </div>
                    <div className='admin-panel__detail-row'>
                      <span>Общий размер</span>
                      <strong>{formatFileSize(scope.totalSize)}</strong>
                    </div>
                    <div className='admin-panel__detail-row'>
                      <span>Примеры</span>
                      <strong>{SCOPE_DETAILS[scope.scope].examples.join(' · ')}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {overview && (
            <div className='admin-panel__reference-layout'>
              <div className='admin-panel__reference-create-card'>
                <h2>Критичные файлы</h2>
                <p className='admin-panel__hint'>
                  Если изображения или документы уже есть в проекте, но не появились на сайте, нажмите сверху
                  <strong> «Подтянуть встроенные файлы»</strong>. Это докопирует недостающие файлы в рабочее хранилище без
                  перезаписи ваших загруженных материалов.
                </p>
                <div className='admin-panel__detail-list'>
                  {overview.essentialFiles.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryGsrasAdminPanel. */ (file) => (
                    <div key={file.relativePath} className='admin-panel__detail-row'>
                      <span>{file.relativePath}</span>
                      <strong>{file.exists ? `${formatFileSize(file.size)} · ${file.updatedAt}` : 'Отсутствует'}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className='admin-panel__reference-create-card'>
                <h2>Загрузка файлов</h2>
                <p className='admin-panel__hint'>
                  Сначала выберите, что именно вы добавляете: данные сайта или обычные файлы. Затем укажите папку внутри хранилища и загрузите файлы.
                </p>
                <div className='admin-panel__chips'>
                  {UPLOAD_PRESETS.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryGsrasAdminPanel. */ (preset) => (
                    <button
                      key={`${preset.scope}:${preset.basePath}`}
                      type='button'
                      className='admin-panel__chip'
                      onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ () => applyUploadPreset(preset.scope, preset.basePath)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className='admin-panel__reference-form'>
                  <label className='admin-panel__field'>
                    Тип содержимого
                    <select value={selectedScope} onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ (event) => void handleScopeChange(event.target.value as GsrasScope)}>
                      <option value='data'>{SCOPE_DETAILS.data.label}</option>
                      <option value='site-assets'>{SCOPE_DETAILS['site-assets'].label}</option>
                    </select>
                    <span className='admin-panel__field-hint'>{selectedScopeDetails.description}</span>
                  </label>
                  <label className='admin-panel__field'>
                    Папка внутри хранилища
                    <input
                      type='text'
                      value={uploadBasePath}
                      onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ (event) => setUploadBasePath(event.target.value)}
                      placeholder={selectedScopeDetails.uploadPlaceholder}
                    />
                    <span className='admin-panel__field-hint'>
                      Пример: {selectedScopeDetails.examples.join(' · ')}
                    </span>
                  </label>
                  <label className='admin-panel__field'>
                    Отдельные файлы с компьютера
                    <input
                      type='file'
                      multiple
                      onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ (event) => setSelectedFiles(Array.from(event.target.files ?? []))}
                    />
                    <span className='admin-panel__field-hint'>Подходит, если нужно добавить 1-5 файлов вручную.</span>
                  </label>
                  <label className='admin-panel__field'>
                    Или целая папка
                    <input {...directoryInputProps} />
                    <span className='admin-panel__field-hint'>Удобно, если переносите целый каталог с вложенными файлами.</span>
                  </label>
                </div>
                <div className='admin-panel__reference-meta'>
                  <span><strong>Выбрано:</strong> {selectedFiles.length}</span>
                  <span><strong>Каталог на сервере:</strong> {overview.storageRoot}</span>
                </div>
                {selectedFilePreview.length > 0 && (
                  <div className='admin-panel__selected-files'>
                    <strong>Первые выбранные файлы:</strong>
                    <ul>
                      {selectedFilePreview.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryGsrasAdminPanel. */ (fileName) => (
                        <li key={fileName}>{fileName}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className='user-actions'>
                  <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ () => void uploadChosenFiles()} disabled={uploading}>
                    {uploading ? 'Загрузка...' : 'Загрузить файлы'}
                  </button>
                </div>
              </div>

              <div className='admin-panel__reference-create-card'>
                <h2>Создание или замена текстового файла</h2>
                <p className='admin-panel__hint'>
                  Используйте этот блок, если хотите быстро вставить JSON или другой текст руками, без загрузки файла с компьютера.
                </p>
                <div className='admin-panel__chips'>
                  {TEXT_PRESETS.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryGsrasAdminPanel. */ (preset) => (
                    <button
                      key={`${preset.scope}:${preset.relativePath}`}
                      type='button'
                      className='admin-panel__chip'
                      onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ () => applyTextPreset(preset.scope, preset.relativePath)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className='admin-panel__reference-form'>
                  <label className='admin-panel__field'>
                    Тип содержимого
                    <select value={textScope} onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ (event) => setTextScope(event.target.value as GsrasScope)}>
                      <option value='data'>{SCOPE_DETAILS.data.label}</option>
                      <option value='site-assets'>{SCOPE_DETAILS['site-assets'].label}</option>
                    </select>
                    <span className='admin-panel__field-hint'>{textScopeDetails.description}</span>
                  </label>
                  <label className='admin-panel__field'>
                    Путь к файлу
                    <input
                      type='text'
                      value={textRelativePath}
                      onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ (event) => setTextRelativePath(event.target.value)}
                      placeholder={textScopeDetails.textPlaceholder}
                    />
                    <span className='admin-panel__field-hint'>
                      Файл будет создан или заменен по указанному пути.
                    </span>
                  </label>
                  <label className='admin-panel__field'>
                    Содержимое
                    <textarea
                      className='admin-panel__revision-comment-textarea'
                      value={textContent}
                      onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ (event) => setTextContent(event.target.value)}
                      placeholder='Вставьте JSON, HTML или другой текстовый контент'
                      style={{ minHeight: 220 }}
                    />
                  </label>
                </div>
                <div className='user-actions'>
                  <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ () => void saveTextFile()} disabled={creating}>
                    {creating ? 'Сохранение...' : 'Сохранить текстовый файл'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className='admin-panel__reference-create-card'>
            <div className='admin-panel__reference-card-header'>
              <h2>Просмотр файлов</h2>
              <div className='user-actions'>
                <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ () => void refreshAll()}>
                  Обновить список
                </button>
              </div>
            </div>
            <p className='admin-panel__hint'>
              Здесь можно проверить, что файл действительно лежит в нужной папке и попал в нужный тип хранилища.
            </p>
            <div className='admin-panel__reference-form'>
              <label className='admin-panel__field'>
                Тип содержимого
                <select value={selectedScope} onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ (event) => void handleScopeChange(event.target.value as GsrasScope)}>
                  <option value='data'>{SCOPE_DETAILS.data.label}</option>
                  <option value='site-assets'>{SCOPE_DETAILS['site-assets'].label}</option>
                </select>
              </label>
              <label className='admin-panel__field'>
                Начало пути
                <input
                  type='text'
                  value={listPrefix}
                  onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ (event) => setListPrefix(event.target.value)}
                  placeholder={selectedScopeDetails.listPlaceholder}
                />
                <span className='admin-panel__field-hint'>
                  Например, `gsras-pages/ru` покажет только русские страницы.
                </span>
              </label>
            </div>
            <div className='user-actions'>
              <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryGsrasAdminPanel/RepositoryGsrasAdminPanel.tsx. */ () => void applyPrefixFilter()}>
                Применить фильтр
              </button>
            </div>
            {files.length === 0 ? (
              <p>По текущему фильтру файлов не найдено.</p>
            ) : (
              <div className='users-table'>
                <table>
                  <thead>
                    <tr>
                      <th>Путь</th>
                      <th>Размер</th>
                      <th>Обновлен</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryGsrasAdminPanel. */ (file) => (
                      <tr key={file.relativePath}>
                        <td>{file.relativePath}</td>
                        <td>{formatFileSize(file.size)}</td>
                        <td>{new Date(file.updatedAt).toLocaleString('ru-RU')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
