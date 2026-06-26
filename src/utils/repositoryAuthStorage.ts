import type { RepositoryUser } from '@/types/repositoryAuth';

const REPOSITORY_TOKEN_KEY = 'repository_token';
const REPOSITORY_TOKEN_COOKIE_KEY = 'repository_token';
const REPOSITORY_USER_KEY = 'repository_user';
export const REPOSITORY_AUTH_INVALID_EVENT = 'repository-auth-invalid';

let repositoryTokenMemory = '';

/* Делает: Проверяет наличие window. Применение: используется локально в файле src/utils/repositoryAuthStorage.ts. */
function hasWindow() {
  return typeof window !== 'undefined';
}

/* Делает: Читает cookie репозиторного токена. Применение: используется локально в файле src/utils/repositoryAuthStorage.ts. */
function readRepositoryTokenCookie() {
  if (!hasWindow()) {
    return '';
  }

  const cookie = window.document.cookie
    .split(';')
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри readRepositoryTokenCookie. */ (entry) => entry.trim())
    .find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри readRepositoryTokenCookie. */ (entry) => entry.startsWith(`${REPOSITORY_TOKEN_COOKIE_KEY}=`));

  if (!cookie) {
    return '';
  }

  const rawValue = cookie.slice(REPOSITORY_TOKEN_COOKIE_KEY.length + 1);

  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

/* Делает: Записывает cookie репозиторного токена. Применение: используется локально в файле src/utils/repositoryAuthStorage.ts. */
function writeRepositoryTokenCookie(token: string) {
  if (!hasWindow()) {
    return;
  }

  const secureSuffix = window.location.protocol === 'https:' ? '; Secure' : '';
  window.document.cookie = `${REPOSITORY_TOKEN_COOKIE_KEY}=${encodeURIComponent(token)}; Path=/; SameSite=Lax${secureSuffix}`;
}

/* Делает: Очищает cookie репозиторного токена. Применение: используется локально в файле src/utils/repositoryAuthStorage.ts. */
function clearRepositoryTokenCookie() {
  if (!hasWindow()) {
    return;
  }

  const secureSuffix = window.location.protocol === 'https:' ? '; Secure' : '';
  window.document.cookie = `${REPOSITORY_TOKEN_COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax${secureSuffix}`;
}

/* Делает: Получает токен репозиторного. Применение: используется локально в файле src/utils/repositoryAuthStorage.ts. */
export function getRepositoryToken() {
  if (hasWindow()) {
    const storedToken = window.localStorage.getItem(REPOSITORY_TOKEN_KEY);
    if (storedToken && storedToken.trim()) {
      repositoryTokenMemory = storedToken;
      writeRepositoryTokenCookie(storedToken);
      return storedToken;
    }

    const cookieToken = readRepositoryTokenCookie();
    if (cookieToken && cookieToken.trim()) {
      repositoryTokenMemory = cookieToken;
      window.localStorage.setItem(REPOSITORY_TOKEN_KEY, cookieToken);
      return cookieToken;
    }
  }

  return repositoryTokenMemory;
}

/* Делает: Выполняет токен set репозиторного. Применение: используется локально в файле src/utils/repositoryAuthStorage.ts. */
export function setRepositoryToken(token: string) {
  repositoryTokenMemory = token;
  if (hasWindow()) {
    window.localStorage.setItem(REPOSITORY_TOKEN_KEY, token);
    writeRepositoryTokenCookie(token);
  }
}

/* Делает: Очищает токен репозиторного. Применение: используется локально в файле src/utils/repositoryAuthStorage.ts. */
export function clearRepositoryToken() {
  repositoryTokenMemory = '';
  if (hasWindow()) {
    window.localStorage.removeItem(REPOSITORY_TOKEN_KEY);
    clearRepositoryTokenCookie();
  }
}

/* Делает: Получает пользователя сохранённого репозиторного. Применение: используется локально в файле src/utils/repositoryAuthStorage.ts. */
export function getStoredRepositoryUser() {
  if (!hasWindow()) {
    return null;
  }

  const raw = window.localStorage.getItem(REPOSITORY_USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as RepositoryUser;
  } catch {
    return null;
  }
}

/* Делает: Выполняет пользователя set сохранённого репозиторного. Применение: используется локально в файле src/utils/repositoryAuthStorage.ts. */
export function setStoredRepositoryUser(user: RepositoryUser) {
  if (hasWindow()) {
    window.localStorage.setItem(REPOSITORY_USER_KEY, JSON.stringify(user));
  }
}

/* Делает: Очищает пользователя сохранённого репозиторного. Применение: используется локально в файле src/utils/repositoryAuthStorage.ts. */
export function clearStoredRepositoryUser() {
  if (hasWindow()) {
    window.localStorage.removeItem(REPOSITORY_USER_KEY);
  }
}

/* Делает: Проверяет наличие токен репозиторного. Применение: используется локально в файле src/utils/repositoryAuthStorage.ts. */
export function hasRepositoryToken() {
  return Boolean(getRepositoryToken().trim());
}

/* Делает: Отправляет уведомление repository auth invalid. Применение: используется локально в файле src/utils/repositoryAuthStorage.ts. */
export function notifyRepositoryAuthInvalid(reason = 'unauthorized') {
  clearRepositoryToken();
  clearStoredRepositoryUser();

  if (hasWindow()) {
    window.dispatchEvent(new CustomEvent(REPOSITORY_AUTH_INVALID_EVENT, { detail: { reason } }));
  }
}
