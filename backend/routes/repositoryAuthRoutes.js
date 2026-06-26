import express from 'express';
import { RepositoryAuthController } from '../controllers/repositoryAuthController.js';
import { repositoryAuthMiddleware } from '../middleware/repositoryAuthMiddleware.js';
import { createRateLimitMiddleware } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();
const repositoryLoginRateLimit = createRateLimitMiddleware({
  scope: 'repository_login',
    /* Делает: Выполняет key generator. Применение: используется локально в файле backend/routes/repositoryAuthRoutes.js. */
  keyGenerator: (req) => `${req.ip}:${String(req.body?.login || '').trim().toLowerCase()}`,
});
const repositoryRegisterRateLimit = createRateLimitMiddleware({
  scope: 'repository_register',
    /* Делает: Выполняет key generator. Применение: используется локально в файле backend/routes/repositoryAuthRoutes.js. */
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email || req.body?.name || '').trim().toLowerCase()}`,
});
const repositoryForgotPasswordRateLimit = createRateLimitMiddleware({
  scope: 'repository_forgot_password',
    /* Делает: Выполняет key generator. Применение: используется локально в файле backend/routes/repositoryAuthRoutes.js. */
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email || '').trim().toLowerCase()}`,
});
const repositoryResetPasswordRateLimit = createRateLimitMiddleware({
  scope: 'repository_reset_password',
    /* Делает: Выполняет key generator. Применение: используется локально в файле backend/routes/repositoryAuthRoutes.js. */
  keyGenerator: (req) => `${req.ip}:${String(req.body?.token || '').trim().toLowerCase()}`,
});
const repositoryVerifyResetTokenRateLimit = createRateLimitMiddleware({
  scope: 'repository_verify_reset_token',
    /* Делает: Выполняет key generator. Применение: используется локально в файле backend/routes/repositoryAuthRoutes.js. */
  keyGenerator: (req) => `${req.ip}:${String(req.query?.token || '').trim().toLowerCase()}`,
});

router.post('/register', repositoryRegisterRateLimit, RepositoryAuthController.register);
router.post('/login', repositoryLoginRateLimit, RepositoryAuthController.login);
router.post('/forgot-password', repositoryForgotPasswordRateLimit, RepositoryAuthController.forgotPassword);
router.get('/verify-reset-token', repositoryVerifyResetTokenRateLimit, RepositoryAuthController.verifyResetToken);
router.post('/reset-password', repositoryResetPasswordRateLimit, RepositoryAuthController.resetPassword);
router.get('/profile', repositoryAuthMiddleware, RepositoryAuthController.getProfile);
router.post('/profile-update-requests', repositoryAuthMiddleware, RepositoryAuthController.requestProfileUpdate);
router.post('/change-password', repositoryAuthMiddleware, RepositoryAuthController.changePassword);

export default router;
