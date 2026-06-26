const BASE_TIMEOUT_SECONDS = 30;
const MAX_ATTEMPTS_BEFORE_LOCK = 5;
const TIMEOUT_MULTIPLIER = 2;
const MAX_TIMEOUT_SECONDS = 30 * 60;
const ONE_HOUR_MS = 60 * 60 * 1000;

const rateLimitStore = new Map();
const requestThrottleStore = new Map();

/* Делает: Собирает ключ store. Применение: используется локально в файле backend/middleware/rateLimitMiddleware.js. */
function buildStoreKey(scope, identity) {
  return `${scope}:${identity}`;
}

/* Делает: Выполняет calculate lockout seconds. Применение: используется локально в файле backend/middleware/rateLimitMiddleware.js. */
function calculateLockoutSeconds(lockoutCount) {
  const timeout = BASE_TIMEOUT_SECONDS * Math.pow(TIMEOUT_MULTIPLIER, lockoutCount);
  return Math.min(timeout, MAX_TIMEOUT_SECONDS);
}

/* Делает: Получает identity. Применение: используется локально в файле backend/middleware/rateLimitMiddleware.js. */
function getIdentity(req, customKeyGenerator) {
  if (typeof customKeyGenerator === 'function') {
    return customKeyGenerator(req);
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/* Делает: Получает remaining attempts. Применение: используется локально в файле backend/middleware/rateLimitMiddleware.js. */
function getRemainingAttempts(record) {
  const remaining = MAX_ATTEMPTS_BEFORE_LOCK - (record.attempts % MAX_ATTEMPTS_BEFORE_LOCK);
  return remaining === MAX_ATTEMPTS_BEFORE_LOCK && record.attempts > 0 ? 0 : remaining;
}

/* Делает: Создаёт middleware ограничения частоты limit. Применение: используется локально в файле backend/middleware/rateLimitMiddleware.js. */
export function createRateLimitMiddleware({
  scope,
  keyGenerator,
  failureStatuses = [400, 401, 403, 409, 429],
} = {}) {
  if (!scope) {
    throw new Error('Rate limit scope is required');
  }

  return /* Делает: Выполняет локальный callback в текущем месте модуля. Применение: используется локально внутри createRateLimitMiddleware. */ (req, res, next) => {
    const identity = String(getIdentity(req, keyGenerator) || 'unknown').trim().toLowerCase();
    const storeKey = buildStoreKey(scope, identity);
    const now = Date.now();
    const current = rateLimitStore.get(storeKey) || {
      attempts: 0,
      lockouts: 0,
      lockedUntil: null,
      lastAttempt: 0,
    };

    if (current.lockedUntil && now < current.lockedUntil) {
      const retryAfterSeconds = Math.ceil((current.lockedUntil - now) / 1000);
      return res.status(429).json({
        success: false,
        message: `Слишком много попыток. Повторите через ${retryAfterSeconds} сек.`,
        retryAfterSeconds,
      });
    }

    if (current.lastAttempt && now - current.lastAttempt > ONE_HOUR_MS) {
      current.attempts = 0;
      current.lockedUntil = null;
    }

    const originalJson = res.json.bind(res);
    res.json = /* Делает: Выполняет локальный callback в текущем месте модуля. Применение: используется локально внутри callback. */ (body) => {
      const statusCode = res.statusCode || 200;
      const shouldCountFailure =
        failureStatuses.includes(statusCode) ||
        (body && typeof body === 'object' && body.success === false);

      if (shouldCountFailure) {
        current.attempts += 1;
        current.lastAttempt = Date.now();

        if (current.attempts >= MAX_ATTEMPTS_BEFORE_LOCK) {
          const lockoutSeconds = calculateLockoutSeconds(current.lockouts);
          current.lockouts += 1;
          current.lockedUntil = current.lastAttempt + lockoutSeconds * 1000;
          rateLimitStore.set(storeKey, current);

          if (!res.headersSent && statusCode !== 429) {
            res.status(429);
            return originalJson({
              success: false,
              message: `Превышен лимит попыток. Доступ заблокирован на ${lockoutSeconds} сек.`,
              retryAfterSeconds: lockoutSeconds,
            });
          }
        } else {
          rateLimitStore.set(storeKey, current);
        }
      } else {
        rateLimitStore.delete(storeKey);
      }

      return originalJson(body);
    };

    next();
  };
}

/* Делает: Создаёт middleware запроса throttle. Применение: используется локально в файле backend/middleware/rateLimitMiddleware.js. */
export function createRequestThrottleMiddleware({
  scope,
  keyGenerator,
  windowMs = 15 * 60 * 1000,
  maxRequests = 10,
  message = 'Слишком много запросов. Повторите позже.',
} = {}) {
  if (!scope) {
    throw new Error('Throttle scope is required');
  }

  return /* Делает: Выполняет локальный callback в текущем месте модуля. Применение: используется локально внутри createRequestThrottleMiddleware. */ (req, res, next) => {
    const identity = String(getIdentity(req, keyGenerator) || 'unknown').trim().toLowerCase();
    const storeKey = buildStoreKey(scope, identity);
    const now = Date.now();
    const current = requestThrottleStore.get(storeKey);

    if (!current || now >= current.resetAt) {
      requestThrottleStore.set(storeKey, {
        count: 1,
        resetAt: now + windowMs,
      });
      return next();
    }

    if (current.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message,
        retryAfterSeconds,
      });
    }

    current.count += 1;
    requestThrottleStore.set(storeKey, current);
    return next();
  };
}
