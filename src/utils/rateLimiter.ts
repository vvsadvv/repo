/**
 * Rate Limiter Utility
 * Управляет прогрессивным timeout при множественных неудачных попытках
 */

interface RateLimitData {
  attempts: number;
  lockedUntil: number | null;
  lastAttempt: number;
}

interface PasswordChangeData {
  lastChange: number;
  email: string;
}

const STORAGE_KEY_PREFIX = 'rate_limit_';
const PASSWORD_CHANGE_KEY = 'password_change_history';

// Базовый timeout в секундах (30 сек)
const BASE_TIMEOUT_SECONDS = 30;
// Максимальное количество попыток до блокировки
const MAX_ATTEMPTS_BEFORE_LOCK = 5;
// Множитель для прогрессивного увеличения timeout
const TIMEOUT_MULTIPLIER = 2;
// Максимальный timeout в секундах (30 минут)
const MAX_TIMEOUT_SECONDS = 30 * 60;

/**
 * Получить данные rate limit из localStorage
 */
function getRateLimitData(key: string): RateLimitData {
  const storageKey = STORAGE_KEY_PREFIX + key;
  const data = localStorage.getItem(storageKey);

  if (!data) {
    return {
      attempts: 0,
      lockedUntil: null,
      lastAttempt: 0,
    };
  }

  try {
    return JSON.parse(data);
  } catch {
    return {
      attempts: 0,
      lockedUntil: null,
      lastAttempt: 0,
    };
  }
}

/**
 * Сохранить данные rate limit в localStorage
 */
function setRateLimitData(key: string, data: RateLimitData): void {
  const storageKey = STORAGE_KEY_PREFIX + key;
  localStorage.setItem(storageKey, JSON.stringify(data));
}

/**
 * Рассчитать время блокировки на основе количества превышений лимита
 */
function calculateLockoutTime(lockoutCount: number): number {
  // Прогрессивное увеличение: 30s, 60s, 120s, 240s... до 30 минут
  const timeout = BASE_TIMEOUT_SECONDS * Math.pow(TIMEOUT_MULTIPLIER, lockoutCount);
  return Math.min(timeout, MAX_TIMEOUT_SECONDS);
}

/**
 * Проверить, заблокирован ли пользователь
 * @returns оставшееся время блокировки в секундах или 0 если не заблокирован
 */
export function checkRateLimitStatus(key: string): number {
  const data = getRateLimitData(key);

  if (data.lockedUntil) {
    const now = Date.now();
    if (now < data.lockedUntil) {
      return Math.ceil((data.lockedUntil - now) / 1000);
    }
  }

  return 0;
}

/**
 * Записать неудачную попытку
 * @returns время блокировки в секундах если превышен лимит, иначе 0
 */
export function recordFailedAttempt(key: string): number {
  const data = getRateLimitData(key);
  const now = Date.now();

  // Если прошло больше часа с последней попытки - сбросить счетчик
  const ONE_HOUR = 60 * 60 * 1000;
  if (now - data.lastAttempt > ONE_HOUR) {
    data.attempts = 0;
  }

  data.attempts += 1;
  data.lastAttempt = now;

  // Если превышен лимит попыток
  if (data.attempts >= MAX_ATTEMPTS_BEFORE_LOCK) {
    // Считаем количество блокировок (каждые MAX_ATTEMPTS_BEFORE_LOCK попыток)
    const lockoutCount = Math.floor(data.attempts / MAX_ATTEMPTS_BEFORE_LOCK) - 1;
    const lockoutSeconds = calculateLockoutTime(lockoutCount);
    data.lockedUntil = now + (lockoutSeconds * 1000);

    setRateLimitData(key, data);
    return lockoutSeconds;
  }

  setRateLimitData(key, data);
  return 0;
}

/**
 * Сбросить счетчик попыток при успешном входе
 */
export function resetRateLimit(key: string): void {
  const storageKey = STORAGE_KEY_PREFIX + key;
  localStorage.removeItem(storageKey);
}

/**
 * Получить количество оставшихся попыток
 */
export function getRemainingAttempts(key: string): number {
  const data = getRateLimitData(key);

  // Если прошло больше часа с последней попытки - попытки сброшены
  const ONE_HOUR = 60 * 60 * 1000;
  if (Date.now() - data.lastAttempt > ONE_HOUR) {
    return MAX_ATTEMPTS_BEFORE_LOCK;
  }

  const remaining = MAX_ATTEMPTS_BEFORE_LOCK - (data.attempts % MAX_ATTEMPTS_BEFORE_LOCK);
  return remaining === MAX_ATTEMPTS_BEFORE_LOCK && data.attempts > 0 ? 0 : remaining;
}

/**
 * Форматировать время в читаемый формат
 */
export function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return '';

  if (seconds < 60) {
    return `${seconds} сек.`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes} мин. ${remainingSeconds} сек.`
      : `${minutes} мин.`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} ч. ${remainingMinutes} мин.`;
}

/* ==================== Ограничение смены пароля ==================== */

/**
 * Проверить, может ли пользователь сменить пароль (1 раз в день)
 * @param email email пользователя
 * @returns оставшееся время до следующей смены в секундах, или 0 если можно менять
 */
export function checkPasswordChangeLimit(email: string): number {
  const data = localStorage.getItem(PASSWORD_CHANGE_KEY);

  if (!data) {
    return 0;
  }

  try {
    const history: PasswordChangeData[] = JSON.parse(data);
    const userRecord = history.find(h => h.email.toLowerCase() === email.toLowerCase());

    if (!userRecord) {
      return 0;
    }

    const ONE_DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const timeSinceLastChange = now - userRecord.lastChange;

    if (timeSinceLastChange < ONE_DAY) {
      return Math.ceil((ONE_DAY - timeSinceLastChange) / 1000);
    }

    return 0;
  } catch {
    return 0;
  }
}

/**
 * Записать успешную смену пароля
 */
export function recordPasswordChange(email: string): void {
  const data = localStorage.getItem(PASSWORD_CHANGE_KEY);
  let history: PasswordChangeData[] = [];

  if (data) {
    try {
      history = JSON.parse(data);
    } catch {
      history = [];
    }
  }

  // Удалить старую запись для этого email
  history = history.filter(h => h.email.toLowerCase() !== email.toLowerCase());

  // Добавить новую запись
  history.push({
    email: email.toLowerCase(),
    lastChange: Date.now(),
  });

  // Очистить записи старше 2 дней
  const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  history = history.filter(h => now - h.lastChange < TWO_DAYS);

  localStorage.setItem(PASSWORD_CHANGE_KEY, JSON.stringify(history));
}

/**
 * Форматировать время до следующей смены пароля
 */
export function formatPasswordChangeWait(seconds: number): string {
  if (seconds <= 0) return '';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours} ч. ${minutes} мин.`;
  }

  return `${minutes} мин.`;
}

export { MAX_ATTEMPTS_BEFORE_LOCK };
