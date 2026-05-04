import { RepositoryReferenceModel } from '../models/RepositoryReference.js';

function formatRequestActor(user) {
  return user
    ? {
        id: user.id,
        name: user.name,
        full_name: user.full_name || user.name,
        email: user.email,
      }
    : null;
}

export class RepositoryReferenceController {
  static async getOrganizations(req, res) {
    try {
      const organizations = await RepositoryReferenceModel.listApprovedOrganizations();
      return res.json({ organizations });
    } catch (error) {
      console.error('Repository organizations load error:', error);
      return res.status(500).json({ message: 'Не удалось загрузить список организаций' });
    }
  }

  static async requestOrganization(req, res) {
    try {
      const nameRu = String(req.body?.nameRu || '').trim();
      const nameEn = String(req.body?.nameEn || '').trim();
      const requesterName = String(req.body?.requesterName || '').trim();
      const requesterEmail = String(req.body?.requesterEmail || '').trim();

      if (nameRu.length < 2) {
        return res.status(400).json({ message: 'Укажите название организации на русском языке' });
      }

      const organization = await RepositoryReferenceModel.createOrganizationRequest({
        name_ru: nameRu,
        name_en: nameEn,
        requester_name: requesterName,
        requester_email: requesterEmail,
        requested_by_user_id: req.repositoryUser?.id || null,
      });

      return res.status(201).json({
        message: organization?.status === 'approved'
          ? 'Организация уже доступна в списке'
          : 'Заявка на добавление организации отправлена администратору',
        organization,
      });
    } catch (error) {
      console.error('Repository organization request error:', error);
      return res.status(500).json({ message: 'Не удалось отправить заявку на организацию' });
    }
  }

  static async getAuthors(req, res) {
    try {
      const authors = await RepositoryReferenceModel.listApprovedAuthors();
      return res.json({ authors });
    } catch (error) {
      console.error('Repository authors load error:', error);
      return res.status(500).json({ message: 'Не удалось загрузить список авторов' });
    }
  }

  static async requestAuthor(req, res) {
    try {
      const actor = formatRequestActor(req.repositoryUser);
      const nameRu = String(req.body?.nameRu || '').trim();
      const nameEn = String(req.body?.nameEn || '').trim();
      const organizationId = Number(req.body?.organizationId) || null;

      if (!actor) {
        return res.status(401).json({ message: 'Требуется авторизация в репозитории' });
      }

      if (nameRu.length < 2) {
        return res.status(400).json({ message: 'Укажите автора на русском языке' });
      }

      if (nameEn.length < 2) {
        return res.status(400).json({ message: 'Укажите автора на английском языке' });
      }

      const author = await RepositoryReferenceModel.createAuthorRequest({
        name_ru: nameRu,
        name_en: nameEn,
        organization_id: organizationId,
        requested_by_user_id: actor.id,
        requester_name: actor.full_name,
        requester_email: actor.email,
      });

      return res.status(201).json({
        message: author?.status === 'approved'
          ? 'Автор уже доступен в списке'
          : 'Заявка на добавление автора отправлена администратору',
        author,
      });
    } catch (error) {
      console.error('Repository author request error:', error);
      return res.status(500).json({ message: 'Не удалось отправить заявку на автора' });
    }
  }
}

export default RepositoryReferenceController;
