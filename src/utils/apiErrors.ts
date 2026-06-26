import axios from 'axios';

export type ApiFieldErrors = Record<string, string>;

interface ApiErrorPayload {
  message?: string;
  fieldErrors?: ApiFieldErrors;
  retryAfterSeconds?: number;
}

export interface ApiErrorDetails {
  message: string;
  status?: number;
  fieldErrors?: ApiFieldErrors;
  retryAfterSeconds?: number;
}

export class ApiError extends Error {
  status?: number;
  fieldErrors?: ApiFieldErrors;
  retryAfterSeconds?: number;

    /* Делает: Инициализирует экземпляр ApiError и подготавливает его начальное состояние. Применение: вызывается при создании экземпляра класса ApiError в этом модуле. */
  constructor(message: string, options: Omit<ApiErrorDetails, 'message'> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.fieldErrors = options.fieldErrors;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/* Делает: Разбирает payload api ошибки. Применение: используется локально в файле src/utils/apiErrors.ts. */
function parseApiErrorPayload(data: unknown): ApiErrorPayload {
  if (!data) {
    return {};
  }

  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed) {
      return {};
    }

    try {
      return parseApiErrorPayload(JSON.parse(trimmed));
    } catch {
      return { message: trimmed };
    }
  }

  if (typeof data !== 'object') {
    return {};
  }

  const payload = data as {
    message?: unknown;
    fieldErrors?: unknown;
    retryAfterSeconds?: unknown;
  };

  const fieldErrors =
    payload.fieldErrors && typeof payload.fieldErrors === 'object'
      ? Object.entries(payload.fieldErrors as Record<string, unknown>).reduce<ApiFieldErrors>(/* Делает: Накопляет итоговое значение при обходе коллекции. Применение: передаётся как callback в reduce внутри parseApiErrorPayload. */ (accumulator, [key, value]) => {
          if (key && typeof value === 'string' && value.trim()) {
            accumulator[key] = value;
          }

          return accumulator;
        }, {})
      : undefined;

  return {
    message: typeof payload.message === 'string' && payload.message.trim() ? payload.message.trim() : undefined,
    fieldErrors: fieldErrors && Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
    retryAfterSeconds:
      typeof payload.retryAfterSeconds === 'number' && Number.isFinite(payload.retryAfterSeconds)
        ? payload.retryAfterSeconds
        : undefined,
  };
}

/* Делает: Получает api error details. Применение: используется локально в файле src/utils/apiErrors.ts. */
export function getApiErrorDetails(error: unknown, fallback = 'Ошибка запроса'): ApiErrorDetails {
  if (error instanceof ApiError) {
    return {
      message: error.message || fallback,
      status: error.status,
      fieldErrors: error.fieldErrors,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }

  if (axios.isAxiosError(error)) {
    const payload = parseApiErrorPayload(error.response?.data);
    const status = error.response?.status;

    if (!error.response) {
      if (error.code === 'ECONNABORTED') {
        return { message: 'Сервер не ответил вовремя. Попробуйте еще раз.' };
      }

      return { message: 'Не удалось связаться с сервером. Проверьте подключение и повторите попытку.' };
    }

    return {
      message: payload.message || fallback || error.message || 'Ошибка запроса',
      status,
      fieldErrors: payload.fieldErrors,
      retryAfterSeconds: payload.retryAfterSeconds,
    };
  }

  if (error instanceof Error) {
    return { message: error.message || fallback };
  }

  return { message: fallback };
}

/* Делает: Выполняет ошибку to api. Применение: используется локально в файле src/utils/apiErrors.ts. */
export function toApiError(error: unknown, fallback = 'Ошибка запроса') {
  const details = getApiErrorDetails(error, fallback);
  return new ApiError(details.message, {
    status: details.status,
    fieldErrors: details.fieldErrors,
    retryAfterSeconds: details.retryAfterSeconds,
  });
}

/* Делает: Извлекает сообщение api ошибки. Применение: используется локально в файле src/utils/apiErrors.ts. */
export function extractApiErrorMessage(error: unknown, fallback = 'Ошибка запроса') {
  return getApiErrorDetails(error, fallback).message;
}
