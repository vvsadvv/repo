const BASE_TIMEOUT_SECONDS = 30;
const MAX_ATTEMPTS_BEFORE_LOCK = 5;
const TIMEOUT_MULTIPLIER = 2;
const MAX_TIMEOUT_SECONDS = 30 * 60;
const ONE_HOUR_MS = 60 * 60 * 1000;

const rateLimitStore = new Map();

function buildStoreKey(scope, identity) {
  return `${scope}:${identity}`;
}

function calculateLockoutSeconds(lockoutCount) {
  const timeout = BASE_TIMEOUT_SECONDS * Math.pow(TIMEOUT_MULTIPLIER, lockoutCount);
  return Math.min(timeout, MAX_TIMEOUT_SECONDS);
}

function getIdentity(req, customKeyGenerator) {
  if (typeof customKeyGenerator === 'function') {
    return customKeyGenerator(req);
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function getRemainingAttempts(record) {
  const remaining = MAX_ATTEMPTS_BEFORE_LOCK - (record.attempts % MAX_ATTEMPTS_BEFORE_LOCK);
  return remaining === MAX_ATTEMPTS_BEFORE_LOCK && record.attempts > 0 ? 0 : remaining;
}

export function createRateLimitMiddleware({
  scope,
  keyGenerator,
  failureStatuses = [400, 401, 403, 409, 429],
} = {}) {
  if (!scope) {
    throw new Error('Rate limit scope is required');
  }

  return (req, res, next) => {
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
    res.json = (body) => {
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

