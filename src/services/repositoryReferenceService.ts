import axios from 'axios';
import type { RepositoryAuthorReference, RepositoryOrganizationReference } from '@/types/repositoryReference';
import { getRepositoryToken } from '@/utils/repositoryAuthStorage';

const API_BASE = '/api/repository-reference';

function authHeaders() {
  const token = getRepositoryToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function toServiceError(error: unknown) {
  if (axios.isAxiosError(error)) {
    return new Error(
      (error.response?.data as { message?: string } | undefined)?.message ||
      error.message ||
      'Ошибка запроса'
    );
  }

  return error instanceof Error ? error : new Error('Ошибка запроса');
}

export const repositoryReferenceService = {
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

  async requestOrganization(payload: {
    nameRu: string;
    nameEn?: string;
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
