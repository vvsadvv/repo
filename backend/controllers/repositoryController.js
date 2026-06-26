import { repositoryService } from '../services/repositoryService.js';

const DEFAULT_DOCUMENT_CLASSIFICATION = 'dataset';

/* Делает: Определяет статус. Применение: используется локально в файле backend/controllers/repositoryController.js. */
function resolveStatus(error, fallback = 400) {
  if (typeof error?.httpStatus === 'number') {
    return error.httpStatus;
  }

  if (error?.code === 'EDIT_CONFLICT' || error?.code === 'CROSSREF_DEPOSIT_BUSY') {
    return 409;
  }

  return fallback;
}

/* Делает: Определяет сообщение. Применение: используется локально в файле backend/controllers/repositoryController.js. */
function resolveMessage(error, fallback) {
  if (error?.code === 'ENOENT') {
    return 'Прикрепленный файл не найден на сервере. Прикрепите его заново и повторите сохранение.';
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
}

/* Делает: Форматирует repository actor. Применение: используется локально в файле backend/controllers/repositoryController.js. */
function formatRepositoryActor(repositoryUser) {
  const organizationName = repositoryUser?.organization_reference_name_ru || repositoryUser?.organization;

  return repositoryUser
    ? {
        id: repositoryUser.id,
        name: repositoryUser.name,
        fullName: repositoryUser.full_name || repositoryUser.name,
        email: repositoryUser.email,
        organization: organizationName,
        organizationId: repositoryUser.organization_id ?? null,
        position: repositoryUser.position,
        role: repositoryUser.role,
      }
    : null;
}

/* Делает: Форматирует пользователя репозиторного. Применение: используется локально в файле backend/controllers/repositoryController.js. */
function formatRepositoryUser(repositoryUser) {
  const organizationName = repositoryUser?.organization_reference_name_ru || repositoryUser?.organization;

  return repositoryUser
    ? {
        id: repositoryUser.id,
        name: repositoryUser.name,
        full_name: repositoryUser.full_name,
        email: repositoryUser.email,
        organization: organizationName,
        organization_id: repositoryUser.organization_id ?? null,
        organizationId: repositoryUser.organization_id ?? null,
        position: repositoryUser.position,
        role: repositoryUser.role,
        status: repositoryUser.status,
      }
    : null;
}

export class RepositoryController {
    /* Делает: Получает репозиторий. Применение: используется внутри класса RepositoryController. */
  static async getRepository(req, res) {
    try {
      const data = await repositoryService.getRepositorySummary(formatRepositoryActor(req.repositoryUser));
      res.json({
        ...data,
        canEdit: ['admin', 'editor', 'user'].includes(req.repositoryUser?.role),
        repositoryUser: formatRepositoryUser(req.repositoryUser),
      });
    } catch (error) {
      console.error('Repository read error:', error);
      res.status(500).json({ message: resolveMessage(error, 'Failed to load repository') });
    }
  }

    /* Делает: Получает документы my. Применение: используется внутри класса RepositoryController. */
  static async getMyDocuments(req, res) {
    try {
      const data = await repositoryService.getRepositoryUserDocuments(formatRepositoryActor(req.repositoryUser));
      res.json(data);
    } catch (error) {
      console.error('Repository user documents read error:', error);
      res.status(resolveStatus(error)).json({ message: resolveMessage(error, 'Failed to load user documents') });
    }
  }

    /* Делает: Создаёт каталог. Применение: используется внутри класса RepositoryController. */
  static async createDirectory(req, res) {
    try {
      const { parentId, name } = req.body;

      if (!parentId || !name?.trim()) {
        return res.status(400).json({ message: 'parentId and name are required' });
      }

      const result = await repositoryService.createDirectory(parentId, name.trim());
      res.status(201).json(result);
    } catch (error) {
      console.error('Directory create error:', error);
      res.status(resolveStatus(error)).json({ message: resolveMessage(error, 'Failed to create directory') });
    }
  }

    /* Делает: Создаёт документ. Применение: используется внутри класса RepositoryController. */
  static async createDocument(req, res) {
    try {
      const { parentId, name, documentType } = req.body;

      if (!name?.trim()) {
        return res.status(400).json({ message: 'name is required' });
      }

      const result = await repositoryService.createDocument(
        parentId,
        name.trim(),
        documentType?.trim() || DEFAULT_DOCUMENT_CLASSIFICATION,
        formatRepositoryActor(req.repositoryUser)
      );
      res.status(201).json(result);
    } catch (error) {
      console.error('Document create error:', error);
      res.status(resolveStatus(error)).json({ message: resolveMessage(error, 'Failed to create document') });
    }
  }

    /* Делает: Выполняет ресурс загрузки. Применение: используется внутри класса RepositoryController. */
  static async uploadAsset(req, res) {
    try {
      const { fileName, content, mimeType, kind, documentId, documentName, publicationDate, blockOrder, desiredName, storageKey } = req.body;

      if (!fileName || !content || !kind) {
        return res.status(400).json({ message: 'fileName, content and kind are required' });
      }

      if (!['image', 'file'].includes(kind)) {
        return res.status(400).json({ message: 'Unsupported upload kind' });
      }

      const result = await repositoryService.saveUploadedAsset({
        fileName,
        content,
        mimeType,
        kind,
        documentId,
        documentName,
        publicationDate,
        blockOrder,
        desiredName,
        storageKey,
        actor: formatRepositoryActor(req.repositoryUser),
      });
      const baseUrl = `${req.protocol}://${req.get('host')}`;

      res.status(201).json({
        ...result,
        url: `${baseUrl}${result.url}`,
      });
    } catch (error) {
      console.error('Repository upload error:', error);
      res.status(resolveStatus(error)).json({ message: resolveMessage(error, 'Failed to upload asset') });
    }
  }

    /* Делает: Удаляет ресурс загрузки. Применение: используется внутри класса RepositoryController. */
  static async deleteUploadAsset(req, res) {
    try {
      const { url, documentId } = req.body || {};

      if (!url || !documentId) {
        return res.status(400).json({ message: 'url and documentId are required' });
      }

      const result = await repositoryService.deleteUploadedAsset({
        url,
        documentId,
        actor: formatRepositoryActor(req.repositoryUser),
      });

      res.json(result);
    } catch (error) {
      console.error('Repository upload delete error:', error);
      res.status(resolveStatus(error)).json({ message: resolveMessage(error, 'Failed to delete upload asset') });
    }
  }

    /* Делает: Обновляет узел. Применение: используется внутри класса RepositoryController. */
  static async updateNode(req, res) {
    try {
      const { id } = req.params;
      const { name, blocks, meta, expectedUpdatedAt } = req.body;
      const result = await repositoryService.updateNode(id, {
        name,
        blocks,
        meta,
        expectedUpdatedAt,
        actor: formatRepositoryActor(req.repositoryUser),
      });
      res.json(result);
    } catch (error) {
      console.error('Node update error:', error);
      res.status(resolveStatus(error)).json({ message: resolveMessage(error, 'Failed to update node') });
    }
  }

    /* Делает: Получает черновик персонального. Применение: используется внутри класса RepositoryController. */
  static async getPersonalDraft(req, res) {
    try {
      const { id } = req.params;
      const draft = await repositoryService.getPersonalDraft(id, formatRepositoryActor(req.repositoryUser));
      res.json({ draft });
    } catch (error) {
      console.error('Get personal draft error:', error);
      res.status(resolveStatus(error)).json({ message: resolveMessage(error, 'Failed to load personal draft') });
    }
  }

    /* Делает: Сохраняет черновик персонального. Применение: используется внутри класса RepositoryController. */
  static async savePersonalDraft(req, res) {
    try {
      const { id } = req.params;
      const { name, meta, blocks, sourceUpdatedAt } = req.body;
      const draft = await repositoryService.savePersonalDraft(
        id,
        {
          name,
          meta,
          blocks,
          sourceUpdatedAt,
        },
        formatRepositoryActor(req.repositoryUser)
      );
      res.json({ draft });
    } catch (error) {
      console.error('Save personal draft error:', error);
      res.status(resolveStatus(error)).json({ message: resolveMessage(error, 'Failed to save personal draft') });
    }
  }

    /* Делает: Удаляет черновик персонального. Применение: используется внутри класса RepositoryController. */
  static async deletePersonalDraft(req, res) {
    try {
      const { id } = req.params;
      const result = await repositoryService.deletePersonalDraft(id, formatRepositoryActor(req.repositoryUser));
      res.json(result);
    } catch (error) {
      console.error('Delete personal draft error:', error);
      res.status(resolveStatus(error)).json({ message: resolveMessage(error, 'Failed to delete personal draft') });
    }
  }

    /* Делает: Удаляет узел. Применение: используется внутри класса RepositoryController. */
  static async deleteNode(req, res) {
    try {
      const { id } = req.params;
      const result = await repositoryService.deleteNode(id, formatRepositoryActor(req.repositoryUser));
      res.json(result);
    } catch (error) {
      console.error('Node delete error:', error);
      res.status(resolveStatus(error)).json({ message: resolveMessage(error, 'Failed to delete node') });
    }
  }

    /* Делает: Отправляет проверку документа for. Применение: используется внутри класса RepositoryController. */
  static async submitDocumentForReview(req, res) {
    try {
      const { id } = req.params;
      const result = await repositoryService.submitDocumentForReview(id, formatRepositoryActor(req.repositoryUser));
      res.json(result);
    } catch (error) {
      console.error('Submit document for review error:', error);
      res.status(resolveStatus(error)).json({ message: resolveMessage(error, 'Failed to submit document for registration') });
    }
  }

    /* Делает: Выполняет Crossref deposit XML to. Применение: используется внутри класса RepositoryController. */
  static async depositXmlToCrossref(req, res) {
    try {
      const { id } = req.params;
      const result = await repositoryService.depositXmlToCrossref(id, formatRepositoryActor(req.repositoryUser));
      res.json(result);
    } catch (error) {
      console.error('Crossref deposit error:', error);
      res.status(resolveStatus(error)).json({ message: resolveMessage(error, 'Failed to deposit XML to Crossref') });
    }
  }

    /* Делает: Подтверждает email crossref публикации by. Применение: используется внутри класса RepositoryController. */
  static async confirmCrossrefPublicationByEmail(req, res) {
    try {
      const { id } = req.params;
      const message = typeof req.body?.message === 'string' ? req.body.message : '';
      const result = await repositoryService.confirmCrossrefPublicationByEmail(
        id,
        message,
        formatRepositoryActor(req.repositoryUser)
      );
      res.json(result);
    } catch (error) {
      console.error('Crossref confirmation error:', error);
      res.status(resolveStatus(error)).json({ message: resolveMessage(error, 'Failed to confirm Crossref publication') });
    }
  }
}
