import express from 'express';
import { RepositoryReferenceController } from '../controllers/repositoryReferenceController.js';
import { optionalRepositoryAuthMiddleware, repositoryAuthMiddleware } from '../middleware/repositoryAuthMiddleware.js';
import { createRequestThrottleMiddleware } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();
const organizationRequestThrottle = createRequestThrottleMiddleware({
  scope: 'repository_organization_request',
    /* Делает: Выполняет key generator. Применение: используется локально в файле backend/routes/repositoryReferenceRoutes.js. */
  keyGenerator: (req) => req.ip,
  maxRequests: 10,
  windowMs: 15 * 60 * 1000,
  message: 'Слишком много заявок на добавление организаций. Повторите позже.',
});

router.get('/organizations', optionalRepositoryAuthMiddleware, RepositoryReferenceController.getOrganizations);
router.post('/organizations/request', organizationRequestThrottle, optionalRepositoryAuthMiddleware, RepositoryReferenceController.requestOrganization);
router.get('/authors', optionalRepositoryAuthMiddleware, RepositoryReferenceController.getAuthors);
router.post('/authors/request', repositoryAuthMiddleware, RepositoryReferenceController.requestAuthor);

export default router;
