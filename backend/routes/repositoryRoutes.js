import express from 'express';
import { RepositoryController } from '../controllers/repositoryController.js';
import {
  optionalRepositoryAuthMiddleware,
  repositoryAdminMiddleware,
  repositoryAuthMiddleware,
  repositoryEditorMiddleware,
} from '../middleware/repositoryAuthMiddleware.js';

const router = express.Router();

router.get('/repository', optionalRepositoryAuthMiddleware, RepositoryController.getRepository);
router.post('/repository/directories', repositoryAuthMiddleware, repositoryEditorMiddleware, RepositoryController.createDirectory);
router.post('/repository/documents', repositoryAuthMiddleware, repositoryEditorMiddleware, RepositoryController.createDocument);
router.post('/repository/uploads', repositoryAuthMiddleware, repositoryEditorMiddleware, RepositoryController.uploadAsset);
router.get('/repository/nodes/:id/draft', repositoryAuthMiddleware, repositoryEditorMiddleware, RepositoryController.getPersonalDraft);
router.put('/repository/nodes/:id/draft', repositoryAuthMiddleware, repositoryEditorMiddleware, RepositoryController.savePersonalDraft);
router.delete('/repository/nodes/:id/draft', repositoryAuthMiddleware, repositoryEditorMiddleware, RepositoryController.deletePersonalDraft);
router.post('/repository/nodes/:id/submit-review', repositoryAuthMiddleware, repositoryEditorMiddleware, RepositoryController.submitDocumentForReview);
router.post('/repository/nodes/:id/crossref-deposit', repositoryAuthMiddleware, repositoryAdminMiddleware, RepositoryController.depositXmlToCrossref);
router.put('/repository/nodes/:id', repositoryAuthMiddleware, repositoryEditorMiddleware, RepositoryController.updateNode);
router.delete('/repository/nodes/:id', repositoryAuthMiddleware, repositoryEditorMiddleware, RepositoryController.deleteNode);

export default router;
