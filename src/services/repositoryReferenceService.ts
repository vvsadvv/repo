import axios from 'axios';
import type { RepositoryAuthorReference, RepositoryOrganizationReference } from '@/types/repositoryReference';
import { getRepositoryToken } from '@/utils/repositoryAuthStorage';
import { toApiError } from '@/utils/apiErrors';

const API_BASE = '/api/repository-reference';

/* Делает: Выполняет auth headers. Применение: используется локально в файле src/services/repositoryReferenceService.ts. */
function authHeaders() {
  const token = getRepositoryToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* Делает: Выполняет ошибку to сервиса. Применение: используется локально в файле src/services/repositoryReferenceService.ts. */
function toServiceError(error: unknown) {
  return toApiError(error, 'Ошибка запроса');
}

export const repositoryReferenceService = {
    /* Делает: Получает организации. Применение: используется внутри объекта repositoryReferenceService. */
  async getOrganizations() {
    try {
      const response = await axios.get<{ organizations: RepositoryOrganizationReference[] }>(`${API_BASE}/organizations`, {
        headers: authHeaders(),
      });
      return response.data.organizations;
    } catch (error) {
      throw toServiceError(error);
    }
  },

    /* Делает: Выполняет организацию запроса. Применение: используется внутри объекта repositoryReferenceService. */
  async requestOrganization(payload: {
    nameRu: string;
    nameEn?: string;
    fullNameRu?: string;
    fullNameEn?: string;
    requesterName?: string;
    requesterEmail?: string;
  }) {
    try {
      const response = await axios.post<{ message: string; organization: RepositoryOrganizationReference }>(
        `${API_BASE}/organizations/request`,
        payload,
        {
          headers: authHeaders(),
        }
      );
      return response.data;
    } catch (error) {
      throw toServiceError(error);
    }
  },

    /* Делает: Получает авторов. Применение: используется внутри объекта repositoryReferenceService. */
  async getAuthors() {
    try {
      const response = await axios.get<{ authors: RepositoryAuthorReference[] }>(`${API_BASE}/authors`, {
        headers: authHeaders(),
      });
      return response.data.authors;
    } catch (error) {
      throw toServiceError(error);
    }
  },

    /* Делает: Выполняет автора запроса. Применение: используется внутри объекта repositoryReferenceService. */
  async requestAuthor(payload: {
    nameRu: string;
    nameEn: string;
    organizationId?: number | null;
  }) {
    try {
      const response = await axios.post<{ message: string; author: RepositoryAuthorReference | null }>(
        `${API_BASE}/authors/request`,
        payload,
        {
          headers: authHeaders(),
        }
      );
      return response.data;
    } catch (error) {
      throw toServiceError(error);
    }
  },
};

export default repositoryReferenceService;
