import express from 'express';
import { RepositoryAdminController } from '../controllers/repositoryAdminController.js';
import { repositoryAdminMiddleware, repositoryAuthMiddleware } from '../middleware/repositoryAuthMiddleware.js';

const router = express.Router();

router.use(repositoryAuthMiddleware);
router.use(repositoryAdminMiddleware);

router.get('/users', RepositoryAdminController.getAllUsers);
router.get('/users/pending', RepositoryAdminController.getPendingUsers);
router.get('/documents/review', RepositoryAdminController.getDocumentsForReview);
router.get('/organizations/pending', RepositoryAdminController.getPendingOrganizations);
router.post('/organizations/:id/approve', RepositoryAdminController.approveOrganization);
router.post('/organizations/:id/reject', RepositoryAdminController.rejectOrganization);
router.get('/authors/pending', RepositoryAdminController.getPendingAuthors);
router.post('/authors/:id/approve', RepositoryAdminController.approveAuthor);
router.post('/authors/:id/reject', RepositoryAdminController.rejectAuthor);
router.post('/documents/:id/send-back', RepositoryAdminController.sendDocumentToRevision);
router.put('/users/:id', RepositoryAdminController.updateUser);
router.delete('/users/:id', RepositoryAdminController.deleteUser);

export default router;
