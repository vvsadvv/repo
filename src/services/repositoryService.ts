import axios from 'axios';
import type {
  RepositoryBlock,
  RepositoryDirectory,
  RepositoryDocumentMeta,
  RepositoryDocumentSummary,
  RepositoryNode,
  RepositoryPersonalDraft,
  RepositoryResponse,
} from '@/types/repository';
import type { RepositoryUser } from '@/types/repositoryAuth';
import { getRepositoryToken, notifyRepositoryAuthInvalid } from '@/utils/repositoryAuthStorage';
import { getApiErrorDetails, toApiError as normalizeApiError } from '@/utils/apiErrors';

const API_BASE = '/api';
const REPOSITORY_AUTH_INVALID_MESSAGES = new Set([
  'Неверный токен репозитория',
  'Токен репозитория истек',
  'Пользователь репозитория не найден',
  'Ошибка авторизации репозитория',
]);

type RepositoryUploadKind = 'image' | 'file';

/* Делает: Выполняет auth headers. Применение: используется локально в файле src/services/repositoryService.ts. */
function authHeaders() {
  const token = getRepositoryToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* Делает: Выполняет ошибку to api. Применение: используется локально в файле src/services/repositoryService.ts. */
function toApiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const details = getApiErrorDetails(error, 'Ошибка запроса');

    if (error.response?.status === 401 && details.message && REPOSITORY_AUTH_INVALID_MESSAGES.has(details.message)) {
      notifyRepositoryAuthInvalid('repository-service-401');
    }
  }

  return normalizeApiError(error, 'Ошибка запроса');
}

/* Делает: Проверяет документ опубликованного. Применение: используется локально в файле src/services/repositoryService.ts. */
function isPublishedDocument(node: Pick<RepositoryDocumentSummary, 'documentStatus'>) {
  return node.documentStatus === 'verified';
}

/* Делает: Нормализует identity. Применение: используется локально в файле src/services/repositoryService.ts. */
function normalizeIdentity(value: string | number | null | undefined) {
  return String(value ?? '').trim().toLowerCase();
}

/* Делает: Проверяет пользователя документа owned by репозиторного. Применение: используется локально в файле src/services/repositoryService.ts. */
function isDocumentOwnedByRepositoryUser(
  document: Pick<RepositoryDocumentSummary, 'meta'>,
  repositoryUser: RepositoryUser | null | undefined
) {
  if (!repositoryUser) {
    return false;
  }

  const actorId = normalizeIdentity(repositoryUser.id);
  const creatorUserId = normalizeIdentity(document.meta?.creatorUserId);
  if (actorId && creatorUserId && actorId === creatorUserId) {
    return true;
  }

  const actorEmail = normalizeIdentity(repositoryUser.email);
  const creatorEmail = normalizeIdentity(document.meta?.creatorEmail);
  return Boolean(actorEmail && creatorEmail && actorEmail === creatorEmail);
}

/* Делает: Проверяет возможность документ репозиторного пользовательского view. Применение: используется локально в файле src/services/repositoryService.ts. */
function canRepositoryUserViewDocument(
  document: Pick<RepositoryDocumentSummary, 'documentStatus' | 'meta'>,
  repositoryUser: RepositoryUser | null | undefined
) {
  if (isPublishedDocument(document)) {
    return true;
  }

  if (!repositoryUser) {
    return false;
  }

  if (repositoryUser.role === 'admin' || repositoryUser.role === 'editor') {
    return true;
  }

  return isDocumentOwnedByRepositoryUser(document, repositoryUser);
}

/* Делает: Фильтрует дерево репозиторного. Применение: используется локально в файле src/services/repositoryService.ts. */
function filterRepositoryTree(node: RepositoryNode, repositoryUser: RepositoryUser | null | undefined): RepositoryNode | null {
  if (node.type === 'document') {
    return canRepositoryUserViewDocument(node, repositoryUser) ? node : null;
  }

  return {
    ...node,
    children: node.children
      .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри filterRepositoryTree. */ (child) => filterRepositoryTree(child, repositoryUser))
      .filter(Boolean) as RepositoryNode[],
  };
}

/* Делает: Очищает и нормализует ответ репозиторного. Применение: используется локально в файле src/services/repositoryService.ts. */
function sanitizeRepositoryResponse(response: RepositoryResponse) {
  const repositoryUser = response.repositoryUser;
  if (repositoryUser?.role === 'admin' || repositoryUser?.role === 'editor') {
    return response;
  }

  const filteredTree = filterRepositoryTree(response.tree, repositoryUser) as RepositoryDirectory | null;
  return {
    ...response,
    tree: filteredTree || { ...response.tree, children: [] },
    documents: response.documents.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри sanitizeRepositoryResponse. */ (document) => canRepositoryUserViewDocument(document, repositoryUser)),
  };
}

export const repositoryService = {
    /* Делает: Получает репозиторий. Применение: используется внутри объекта repositoryService. */
  async getRepository() {
    try {
      const response = await axios.get<RepositoryResponse>(`${API_BASE}/repository`, {
        headers: authHeaders(),
      });
      return sanitizeRepositoryResponse(response.data);
    } catch (error) {
      throw toApiError(error);
    }
  },

    /* Делает: Получает документы my. Применение: используется внутри объекта repositoryService. */
  async getMyDocuments() {
    try {
      const response = await axios.get<Pick<RepositoryResponse, 'documents'>>(`${API_BASE}/repository/my-documents`, {
        headers: authHeaders(),
      });
      return response.data.documents || [];
    } catch (error) {
      throw toApiError(error);
    }
  },

    /* Делает: Создаёт каталог. Применение: используется внутри объекта repositoryService. */
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

    /* Делает: Создаёт документ. Применение: используется внутри объекта repositoryService. */
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

    /* Делает: Выполняет ресурс загрузки. Применение: используется внутри объекта repositoryService. */
  async uploadAsset(
    fileName: string,
    content: string,
    mimeType: string | undefined,
    kind: RepositoryUploadKind,
    options?: {
      documentId?: string;
      documentName?: string;
      publicationDate?: string;
      blockOrder?: number;
      desiredName?: string;
      storageKey?: string;
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
          documentId: options?.documentId,
          documentName: options?.documentName,
          publicationDate: options?.publicationDate,
          blockOrder: options?.blockOrder,
          desiredName: options?.desiredName,
          storageKey: options?.storageKey,
        },
        { headers: authHeaders() }
      );
      return response.data as { url: string; fileName: string; mimeType?: string | null; fileSize?: number };
    } catch (error) {
      throw toApiError(error);
    }
  },

    /* Делает: Удаляет ресурс загрузки. Применение: используется внутри объекта repositoryService. */
  async deleteUploadAsset(url: string, documentId: string) {
    try {
      const response = await axios.delete<{ ok: boolean }>(`${API_BASE}/repository/uploads`, {
        headers: authHeaders(),
        data: { url, documentId },
      });
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

    /* Делает: Обновляет узел. Применение: используется внутри объекта repositoryService. */
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

    /* Делает: Получает черновик персонального. Применение: используется внутри объекта repositoryService. */
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

    /* Делает: Сохраняет черновик персонального. Применение: используется внутри объекта repositoryService. */
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

    /* Делает: Удаляет черновик персонального. Применение: используется внутри объекта repositoryService. */
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

    /* Делает: Удаляет узел. Применение: используется внутри объекта repositoryService. */
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

    /* Делает: Отправляет проверку документа for. Применение: используется внутри объекта repositoryService. */
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

    /* Делает: Выполняет админский модуль send документа to доработки as. Применение: используется внутри объекта repositoryService. */
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

    /* Делает: Выполняет Crossref deposit XML to. Применение: используется внутри объекта repositoryService. */
  async depositXmlToCrossref(id: string) {
    try {
      const response = await axios.post(
        `${API_BASE}/repository/nodes/${id}/crossref-deposit`,
        {},
        {
          headers: authHeaders(),
        }
      );
      return response.data as { ok: boolean; fileName: string; responseText: string; resubmitted?: boolean };
    } catch (error) {
      throw toApiError(error);
    }
  },

    /* Делает: Подтверждает email crossref публикации by. Применение: используется внутри объекта repositoryService. */
  async confirmCrossrefPublicationByEmail(id: string, message: string) {
    try {
      const response = await axios.post(
        `${API_BASE}/repository/nodes/${id}/crossref-confirm`,
        {
          message,
        },
        {
          headers: authHeaders(),
        }
      );
      return response.data as {
        ok: boolean;
        confirmedDoi: string;
        submissionId?: string;
        batchId?: string;
        responseMessage?: string;
      };
    } catch (error) {
      throw toApiError(error);
    }
  },
};
