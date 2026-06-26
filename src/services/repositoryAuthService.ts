import axios from 'axios';
import type {
  RepositoryAuthFieldErrors,
  RepositoryAuthResponse,
  RepositoryPasswordResponse,
  RepositoryProfileUpdateRequest,
  RepositoryUser,
} from '@/types/repositoryAuth';
import { getRepositoryToken, notifyRepositoryAuthInvalid } from '@/utils/repositoryAuthStorage';
import { ApiError, toApiError } from '@/utils/apiErrors';

const API_BASE = '/api';
const REPOSITORY_AUTH_INVALID_MESSAGES = new Set([
  'Неверный токен репозитория',
  'Токен репозитория истек',
  'Пользователь репозитория не найден',
  'Ошибка авторизации репозитория',
]);

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
    /* Делает: Проверяет корректность статус. Применение: используется локально в файле src/services/repositoryAuthService.ts. */
  validateStatus: () => true,
});

api.interceptors.request.use(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в use. */ (config) => {
  const token = getRepositoryToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

interface RepositoryProfileResponse {
  user: RepositoryUser;
}

interface RepositoryProfileUpdateResponse {
  success: boolean;
  message: string;
  request: RepositoryProfileUpdateRequest;
}

/* Делает: Гарантирует ответ репозиторного авторизационного. Применение: используется локально в файле src/services/repositoryAuthService.ts. */
function ensureRepositoryAuthResponse<T extends { message?: string; fieldErrors?: RepositoryAuthFieldErrors; retryAfterSeconds?: number }>(
  response: { status: number; data: T },
  options?: { invalidateOnUnauthorized?: boolean; fallbackMessage?: string }
) {
  const message = response.data?.message;
  const fieldErrors = response.data?.fieldErrors;
  const retryAfterSeconds = response.data?.retryAfterSeconds;

  if (
    response.status === 401 &&
    options?.invalidateOnUnauthorized !== false &&
    message &&
    REPOSITORY_AUTH_INVALID_MESSAGES.has(message)
  ) {
    notifyRepositoryAuthInvalid('repository-auth-service-401');
  }

  if (response.status >= 400) {
    throw new ApiError(message || options?.fallbackMessage || 'Ошибка запроса', {
      status: response.status,
      fieldErrors,
      retryAfterSeconds,
    });
  }

  return response.data;
}

/* Делает: Выполняет запрос perform авторизационного. Применение: используется локально в файле src/services/repositoryAuthService.ts. */
async function performAuthRequest<T extends { message?: string; fieldErrors?: RepositoryAuthFieldErrors; retryAfterSeconds?: number }>(
  request: Promise<{ status: number; data: T }>,
  fallbackMessage: string,
  options?: { invalidateOnUnauthorized?: boolean }
) {
  try {
    const response = await request;
    return ensureRepositoryAuthResponse(response, { ...options, fallbackMessage });
  } catch (error) {
    throw toApiError(error, fallbackMessage);
  }
}

export const repositoryAuthService = {
    /* Делает: Выполняет вход. Применение: используется внутри объекта repositoryAuthService. */
  async login(credentials: { login: string; password: string }): Promise<RepositoryAuthResponse> {
    return performAuthRequest(
      api.post<RepositoryAuthResponse>('/repository-auth/login', credentials),
      'Ошибка входа в репозиторий'
    );
  },

    /* Делает: Выполняет register. Применение: используется внутри объекта repositoryAuthService. */
  async register(payload: {
    name: string;
    fullName: string;
    email: string;
    organization: string;
    organizationId?: number | null;
    position: string;
    personalDataConsent: boolean;
    password: string;
    confirmPassword: string;
  }): Promise<RepositoryAuthResponse> {
    return performAuthRequest(
      api.post<RepositoryAuthResponse>('/repository-auth/register', payload),
      'Ошибка регистрации в репозитории'
    );
  },

    /* Делает: Получает профиль. Применение: используется внутри объекта repositoryAuthService. */
  async getProfile(): Promise<RepositoryProfileResponse> {
    const data = await performAuthRequest(
      api.get<RepositoryProfileResponse & { message?: string; fieldErrors?: RepositoryAuthFieldErrors }>(
        '/repository-auth/profile'
      ),
      'Не удалось получить профиль репозитория'
    );

    if (!data.user) {
      throw new Error('Не удалось получить профиль репозитория');
    }

    return data;
  },

    /* Делает: Выполняет пароль forgot. Применение: используется внутри объекта repositoryAuthService. */
  async forgotPassword(email: string): Promise<RepositoryPasswordResponse> {
    return performAuthRequest(
      api.post<RepositoryPasswordResponse>('/repository-auth/forgot-password', { email }),
      'Ошибка восстановления пароля'
    );
  },

    /* Делает: Проверяет токен сброса. Применение: используется внутри объекта repositoryAuthService. */
  async verifyResetToken(token: string): Promise<RepositoryPasswordResponse> {
    return performAuthRequest(
      api.get<RepositoryPasswordResponse>(`/repository-auth/verify-reset-token?token=${encodeURIComponent(token)}`),
      'Ошибка проверки токена'
    );
  },

    /* Делает: Выполняет пароль сброса. Применение: используется внутри объекта repositoryAuthService. */
  async resetPassword(token: string, newPassword: string): Promise<RepositoryPasswordResponse> {
    return performAuthRequest(
      api.post<RepositoryPasswordResponse>('/repository-auth/reset-password', {
        token,
        newPassword,
      }),
      'Ошибка смены пароля'
    );
  },

    /* Делает: Выполняет request profile update. Применение: используется внутри объекта repositoryAuthService. */
  async requestProfileUpdate(payload: {
    fullName: string;
    email: string;
    organizationId: number | null;
    position: string;
  }): Promise<RepositoryProfileUpdateResponse> {
    return performAuthRequest(
      api.post<RepositoryProfileUpdateResponse>('/repository-auth/profile-update-requests', payload),
      'Ошибка отправки заявки на изменение параметров'
    );
  },

    /* Делает: Выполняет пароль change. Применение: используется внутри объекта repositoryAuthService. */
  async changePassword(payload: {
    oldPassword: string;
    newPassword: string;
    confirmNewPassword: string;
  }): Promise<RepositoryPasswordResponse> {
    return performAuthRequest(
      api.post<RepositoryPasswordResponse>('/repository-auth/change-password', payload),
      'Ошибка смены пароля'
    );
  },
};
