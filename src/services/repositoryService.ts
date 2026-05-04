import axios from 'axios';
import type {
  RepositoryBlock,
  RepositoryDocumentMeta,
  RepositoryPersonalDraft,
  RepositoryResponse,
} from '@/types/repository';
import { getRepositoryToken, notifyRepositoryAuthInvalid } from '@/utils/repositoryAuthStorage';

const API_BASE = '/api';
const REPOSITORY_AUTH_INVALID_MESSAGES = new Set([
  'Неверный токен репозитория',
  'Токен репозитория истек',
  'Пользователь репозитория не найден',
  'Ошибка авторизации репозитория',
]);

type RepositoryUploadKind = 'image' | 'file';

function authHeaders() {
  const token = getRepositoryToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function toApiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: string } | undefined)?.message;

    if (error.response?.status === 401 && message && REPOSITORY_AUTH_INVALID_MESSAGES.has(message)) {
      notifyRepositoryAuthInvalid('repository-service-401');
    }

    return new Error(message || error.message || 'Ошибка запроса');
  }

  return error instanceof Error ? error : new Error('Ошибка запроса');
}

export const repositoryService = {
  async getRepository() {
    try {
      const response = await axios.get<RepositoryResponse>(`${API_BASE}/repository`, {
        headers: authHeaders(),
      });
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  async createDirectory(parentId: string, name: string) {
    try {
      const response = await axios.post(
        `${API_BASE}/repository/directories`,
        { parentId, name },
        { headers: authHeaders() }
      );
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  async createDocument(parentId: string, name: string, documentType: string) {
    try {
      const response = await axios.post(
        `${API_BASE}/repository/documents`,
        { parentId, name, documentType },
        { headers: authHeaders() }
      );
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  async uploadAsset(
    fileName: string,
    content: string,
    mimeType: string | undefined,
    kind: RepositoryUploadKind,
    options?: {
      documentName?: string;
      publicationDate?: string;
      blockOrder?: number;
    }
  ) {
    try {
      const response = await axios.post(
        `${API_BASE}/repository/uploads`,
        {
          fileName,
          content,
          mimeType,
          kind,
          documentName: options?.documentName,
          publicationDate: options?.publicationDate,
          blockOrder: options?.blockOrder,
        },
        { headers: authHeaders() }
      );
      return response.data as { url: string; fileName: string; mimeType?: string | null };
    } catch (error) {
      throw toApiError(error);
    }
  },

  async updateNode(
    id: string,
    payload: { name?: string; blocks?: RepositoryBlock[]; meta?: RepositoryDocumentMeta; expectedUpdatedAt?: string }
  ) {
    try {
      const response = await axios.put(`${API_BASE}/repository/nodes/${id}`, payload, {
        headers: authHeaders(),
      });
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  async getPersonalDraft(id: string) {
    try {
      const response = await axios.get<{ draft: RepositoryPersonalDraft | null }>(`${API_BASE}/repository/nodes/${id}/draft`, {
        headers: authHeaders(),
      });
      return response.data.draft;
    } catch (error) {
      throw toApiError(error);
    }
  },

  async savePersonalDraft(
    id: string,
    payload: {
      name: string;
      meta: Partial<RepositoryDocumentMeta>;
      blocks: RepositoryBlock[];
      sourceUpdatedAt?: string;
    }
  ) {
    try {
      const response = await axios.put<{ draft: RepositoryPersonalDraft }>(
        `${API_BASE}/repository/nodes/${id}/draft`,
        payload,
        {
          headers: authHeaders(),
        }
      );
      return response.data.draft;
    } catch (error) {
      throw toApiError(error);
    }
  },

  async deletePersonalDraft(id: string) {
    try {
      const response = await axios.delete<{ ok: boolean }>(`${API_BASE}/repository/nodes/${id}/draft`, {
        headers: authHeaders(),
      });
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  async deleteNode(id: string) {
    try {
      const response = await axios.delete(`${API_BASE}/repository/nodes/${id}`, {
        headers: authHeaders(),
      });
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  async submitDocumentForReview(id: string) {
    try {
      const response = await axios.post(
        `${API_BASE}/repository/nodes/${id}/submit-review`,
        {},
        {
          headers: authHeaders(),
        }
      );
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  async sendDocumentToRevisionAsAdmin(id: string, comment?: string) {
    try {
      const response = await axios.post(
        `${API_BASE}/repository-admin/documents/${id}/send-back`,
        {
          comment: typeof comment === 'string' ? comment : '',
        },
        {
          headers: authHeaders(),
        }
      );
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  async depositXmlToCrossref(id: string) {
    try {
      const response = await axios.post(
        `${API_BASE}/repository/nodes/${id}/crossref-deposit`,
        {},
        {
          headers: authHeaders(),
        }
      );
      return response.data as { ok: boolean; fileName: string; responseText: string };
    } catch (error) {
      throw toApiError(error);
    }
  },
};
