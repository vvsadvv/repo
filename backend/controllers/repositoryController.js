import { repositoryService } from '../services/repositoryService.js';

function resolveStatus(error, fallback = 400) {
  if (typeof error?.httpStatus === 'number') {
    return error.httpStatus;
  }

  if (error?.code === 'EDIT_CONFLICT' || error?.code === 'CROSSREF_DEPOSIT_BUSY') {
    return 409;
  }

  return fallback;
}

function formatRepositoryActor(repositoryUser) {
  return repositoryUser
    ? {
        id: repositoryUser.id,
        name: repositoryUser.name,
        fullName: repositoryUser.full_name || repositoryUser.name,
        email: repositoryUser.email,
        organization: repositoryUser.organization,
        position: repositoryUser.position,
        role: repositoryUser.role,
      }
    : null;
}

function formatRepositoryUser(repositoryUser) {
  return repositoryUser
    ? {
        id: repositoryUser.id,
        name: repositoryUser.name,
        full_name: repositoryUser.full_name,
        email: repositoryUser.email,
        organization: repositoryUser.organization,
        position: repositoryUser.position,
        role: repositoryUser.role,
        status: repositoryUser.status,
      }
    : null;
}

export class RepositoryController {
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
      res.status(500).json({ message: error.message || 'Failed to load repository' });
    }
  }

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
      res.status(resolveStatus(error)).json({ message: error.message || 'Failed to create directory' });
    }
  }

  static async createDocument(req, res) {
    try {
      const { parentId, name, documentType } = req.body;

      if (!name?.trim() || !documentType?.trim()) {
        return res.status(400).json({ message: 'name and documentType are required' });
      }

      const result = await repositoryService.createDocument(parentId, name.trim(), documentType.trim(), formatRepositoryActor(req.repositoryUser));
      res.status(201).json(result);
    } catch (error) {
      console.error('Document create error:', error);
      res.status(resolveStatus(error)).json({ message: error.message || 'Failed to create document' });
    }
  }

  static async uploadAsset(req, res) {
    try {
      const { fileName, content, mimeType, kind, documentName, publicationDate, blockOrder } = req.body;

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
        documentName,
        publicationDate,
        blockOrder,
      });
      const baseUrl = `${req.protocol}://${req.get('host')}`;

      res.status(201).json({
        ...result,
        url: `${baseUrl}${result.url}`,
      });
    } catch (error) {
      console.error('Repository upload error:', error);
      res.status(resolveStatus(error)).json({ message: error.message || 'Failed to upload asset' });
    }
  }

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
      res.status(resolveStatus(error)).json({ message: error.message || 'Failed to update node' });
    }
  }

  static async getPersonalDraft(req, res) {
    try {
      const { id } = req.params;
      const draft = await repositoryService.getPersonalDraft(id, formatRepositoryActor(req.repositoryUser));
      res.json({ draft });
    } catch (error) {
      console.error('Get personal draft error:', error);
      res.status(resolveStatus(error)).json({ message: error.message || 'Failed to load personal draft' });
    }
  }

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
      res.status(resolveStatus(error)).json({ message: error.message || 'Failed to save personal draft' });
    }
  }

  static async deletePersonalDraft(req, res) {
    try {
      const { id } = req.params;
      const result = await repositoryService.deletePersonalDraft(id, formatRepositoryActor(req.repositoryUser));
      res.json(result);
    } catch (error) {
      console.error('Delete personal draft error:', error);
      res.status(resolveStatus(error)).json({ message: error.message || 'Failed to delete personal draft' });
    }
  }

  static async deleteNode(req, res) {
    try {
      const { id } = req.params;
      const result = await repositoryService.deleteNode(id, formatRepositoryActor(req.repositoryUser));
      res.json(result);
    } catch (error) {
      console.error('Node delete error:', error);
      res.status(resolveStatus(error)).json({ message: error.message || 'Failed to delete node' });
    }
  }

  static async submitDocumentForReview(req, res) {
    try {
      const { id } = req.params;
      const result = await repositoryService.submitDocumentForReview(id, formatRepositoryActor(req.repositoryUser));
      res.json(result);
    } catch (error) {
      console.error('Submit document for review error:', error);
      res.status(resolveStatus(error)).json({ message: error.message || 'Failed to submit document for review' });
    }
  }

  static async depositXmlToCrossref(req, res) {
    try {
      const { id } = req.params;
      const result = await repositoryService.depositXmlToCrossref(id, formatRepositoryActor(req.repositoryUser));
      res.json(result);
    } catch (error) {
      console.error('Crossref deposit error:', error);
      res.status(resolveStatus(error)).json({ message: error.message || 'Failed to deposit XML to Crossref' });
    }
  }
}
