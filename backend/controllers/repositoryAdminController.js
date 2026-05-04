import { RepositoryUserModel } from '../models/RepositoryUser.js';
import { RepositoryReferenceModel } from '../models/RepositoryReference.js';
import { repositoryService } from '../services/repositoryService.js';

function formatRepositoryUser(user) {
  return {
    id: user.id,
    name: user.name,
    full_name: user.full_name,
    email: user.email,
    organization: user.organization,
    position: user.position,
    role: user.role,
    status: user.status,
    created_at: user.created_at,
    approved_at: user.approved_at,
    approver_name: user.approver_full_name || user.approver_name,
  };
}

export class RepositoryAdminController {
  static async getAllUsers(req, res) {
    try {
      const users = await RepositoryUserModel.findAll();
      return res.json({ users: users.map(formatRepositoryUser) });
    } catch (error) {
      console.error('Repository admin get users error:', error);
      return res.status(500).json({ message: 'Ошибка при получении пользователей репозитория' });
    }
  }

  static async getPendingUsers(req, res) {
    try {
      const users = await RepositoryUserModel.getPendingUsers();
      return res.json({ users: users.map(formatRepositoryUser) });
    } catch (error) {
      console.error('Repository admin get pending users error:', error);
      return res.status(500).json({ message: 'Ошибка при получении ожидающих пользователей репозитория' });
    }
  }

  static async getDocumentsForReview(req, res) {
    try {
      const documents = await repositoryService.getDocumentsForReview();
      return res.json({ documents });
    } catch (error) {
      console.error('Repository admin get review documents error:', error);
      return res.status(500).json({ message: 'Ошибка при получении документов на проверке' });
    }
  }

  static async sendDocumentToRevision(req, res) {
    try {
      const { id } = req.params;
      const revisionComment = typeof req.body?.comment === 'string' ? req.body.comment : '';
      const result = await repositoryService.sendDocumentToRevision(id, {
        id: req.repositoryUser.id,
        role: req.repositoryUser.role,
        fullName: req.repositoryUser.full_name || req.repositoryUser.name,
        name: req.repositoryUser.name,
        email: req.repositoryUser.email,
      }, revisionComment);
      return res.json(result);
    } catch (error) {
      console.error('Repository admin send document to revision error:', error);
      return res.status(error.httpStatus || 400).json({ message: error.message || 'Ошибка при отправке документа на доработку' });
    }
  }

  static async updateUser(req, res) {
    try {
      const { id } = req.params;
      const { role, status } = req.body;
      const currentUser = req.repositoryUser;
      const user = await RepositoryUserModel.findById(id);

      if (!user) {
        return res.status(404).json({ message: 'Пользователь репозитория не найден' });
      }

      const updates = {};
      if (role !== undefined) updates.role = role;
      if (status !== undefined) updates.status = status;

      if (role === 'user' || role === 'editor' || role === 'admin') {
        updates.role = role;
        updates.status = 'active';
        updates.approved_by = currentUser.id;
      } else if (status === 'active') {
        updates.role = user.role;
        updates.status = 'active';
        updates.approved_by = currentUser.id;
      }

      const updatedUser = await RepositoryUserModel.update(id, updates);
      return res.json({
        message: 'Пользователь репозитория обновлен',
        user: formatRepositoryUser(updatedUser),
      });
    } catch (error) {
      console.error('Repository admin update user error:', error);
      return res.status(500).json({ message: 'Ошибка при обновлении пользователя репозитория' });
    }
  }

  static async deleteUser(req, res) {
    try {
      const { id } = req.params;
      const currentUser = req.repositoryUser;
      const user = await RepositoryUserModel.findById(id);

      if (!user) {
        return res.status(404).json({ message: 'Пользователь репозитория не найден' });
      }
      if (user.role === 'admin') {
        return res.status(400).json({ message: 'Нельзя удалить администратора репозитория' });
      }
      if (currentUser.id === user.id) {
        return res.status(400).json({ message: 'Нельзя удалить свою учетную запись репозитория' });
      }

      await RepositoryUserModel.delete(id);
      return res.json({ message: 'Пользователь репозитория удален' });
    } catch (error) {
      console.error('Repository admin delete user error:', error);
      return res.status(500).json({ message: 'Ошибка при удалении пользователя репозитория' });
    }
  }

  static async getPendingOrganizations(req, res) {
    try {
      const organizations = await RepositoryReferenceModel.listPendingOrganizations();
      return res.json({ organizations });
    } catch (error) {
      console.error('Repository admin get pending organizations error:', error);
      return res.status(500).json({ message: 'Ошибка при получении заявок на организации' });
    }
  }

  static async approveOrganization(req, res) {
    try {
      const organization = await RepositoryReferenceModel.approveOrganization(req.params.id, req.repositoryUser.id);
      if (!organization) {
        return res.status(404).json({ message: 'Организация не найдена' });
      }

      return res.json({ message: 'Организация одобрена', organization });
    } catch (error) {
      console.error('Repository admin approve organization error:', error);
      return res.status(500).json({ message: 'Ошибка при одобрении организации' });
    }
  }

  static async rejectOrganization(req, res) {
    try {
      const organization = await RepositoryReferenceModel.rejectOrganization(req.params.id, req.repositoryUser.id);
      if (!organization) {
        return res.status(404).json({ message: 'Организация не найдена' });
      }

      return res.json({ message: 'Заявка на организацию отклонена', organization });
    } catch (error) {
      console.error('Repository admin reject organization error:', error);
      return res.status(500).json({ message: 'Ошибка при отклонении организации' });
    }
  }

  static async getPendingAuthors(req, res) {
    try {
      const authors = await RepositoryReferenceModel.listPendingAuthors();
      return res.json({ authors });
    } catch (error) {
      console.error('Repository admin get pending authors error:', error);
      return res.status(500).json({ message: 'Ошибка при получении заявок на авторов' });
    }
  }

  static async approveAuthor(req, res) {
    try {
      const author = await RepositoryReferenceModel.approveAuthor(req.params.id, req.repositoryUser.id);
      if (!author) {
        return res.status(404).json({ message: 'Автор не найден' });
      }

      return res.json({ message: 'Автор одобрен', author });
    } catch (error) {
      console.error('Repository admin approve author error:', error);
      return res.status(500).json({ message: 'Ошибка при одобрении автора' });
    }
  }

  static async rejectAuthor(req, res) {
    try {
      const author = await RepositoryReferenceModel.rejectAuthor(req.params.id, req.repositoryUser.id);
      if (!author) {
        return res.status(404).json({ message: 'Автор не найден' });
      }

      return res.json({ message: 'Заявка на автора отклонена', author });
    } catch (error) {
      console.error('Repository admin reject author error:', error);
      return res.status(500).json({ message: 'Ошибка при отклонении автора' });
    }
  }
}
