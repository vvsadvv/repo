import axios from 'axios';
import type { RepositoryAuthResponse, RepositoryUser } from '@/types/repositoryAuth';
import { getRepositoryToken, notifyRepositoryAuthInvalid } from '@/utils/repositoryAuthStorage';

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
  validateStatus: (status) => status < 500,
});

api.interceptors.request.use((config) => {
  const token = getRepositoryToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

interface RepositoryProfileResponse {
  user: RepositoryUser;
}

interface RepositoryPasswordResponse {
  success: boolean;
  message: string;
  email?: string;
  retryAfterSeconds?: number;
}

function ensureRepositoryAuthResponse<T extends { message?: string }>(
  response: { status: number; data: T },
  options?: { invalidateOnUnauthorized?: boolean }
) {
  const message = response.data?.message;

  if (
    response.status === 401 &&
    options?.invalidateOnUnauthorized !== false &&
    message &&
    REPOSITORY_AUTH_INVALID_MESSAGES.has(message)
  ) {
    notifyRepositoryAuthInvalid('repository-auth-service-401');
  }

  if (response.status >= 400) {
    throw new Error(message || 'Ошибка запроса');
  }

  return response.data;
}

export const repositoryAuthService = {
  async login(credentials: { login: string; password: string }): Promise<RepositoryAuthResponse> {
    const { data } = await api.post<RepositoryAuthResponse>('/repository-auth/login', credentials);
    return data;
  },

  async register(payload: {
    name: string;
    fullName: string;
    email: string;
    organization: string;
    organizationId?: number | null;
    position: string;
    password: string;
    confirmPassword: string;
  }): Promise<RepositoryAuthResponse> {
    const { data } = await api.post<RepositoryAuthResponse>('/repository-auth/register', payload);
    return data;
  },

  async getProfile(): Promise<RepositoryProfileResponse> {
    const response = await api.get<RepositoryProfileResponse & { message?: string }>('/repository-auth/profile');
    const data = ensureRepositoryAuthResponse(response);

    if (!data.user) {
      throw new Error('Не удалось получить профиль репозитория');
    }

    return data;
  },

  async forgotPassword(email: string): Promise<RepositoryPasswordResponse> {
    const { data } = await api.post<RepositoryPasswordResponse>('/repository-auth/forgot-password', { email });
    return data;
  },

  async verifyResetToken(token: string): Promise<RepositoryPasswordResponse> {
    const { data } = await api.get<RepositoryPasswordResponse>(
      `/repository-auth/verify-reset-token?token=${encodeURIComponent(token)}`
    );
    return data;
  },

  async resetPassword(token: string, newPassword: string): Promise<RepositoryPasswordResponse> {
    const { data } = await api.post<RepositoryPasswordResponse>('/repository-auth/reset-password', {
      token,
      newPassword,
    });
    return data;
  },
};
