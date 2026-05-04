import express from 'express';
import { RepositoryReferenceController } from '../controllers/repositoryReferenceController.js';
import { optionalRepositoryAuthMiddleware, repositoryAuthMiddleware } from '../middleware/repositoryAuthMiddleware.js';

const router = express.Router();

router.get('/organizations', optionalRepositoryAuthMiddleware, RepositoryReferenceController.getOrganizations);
router.post('/organizations/request', optionalRepositoryAuthMiddleware, RepositoryReferenceController.requestOrganization);
router.get('/authors', optionalRepositoryAuthMiddleware, RepositoryReferenceController.getAuthors);
router.post('/authors/request', repositoryAuthMiddleware, RepositoryReferenceController.requestAuthor);

export default router;
