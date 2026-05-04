import express from 'express';
import { RepositoryAuthController } from '../controllers/repositoryAuthController.js';
import { repositoryAuthMiddleware } from '../middleware/repositoryAuthMiddleware.js';
import { createRateLimitMiddleware } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();
const repositoryLoginRateLimit = createRateLimitMiddleware({
  scope: 'repository_login',
  keyGenerator: (req) => `${req.ip}:${String(req.body?.login || '').trim().toLowerCase()}`,
});
const repositoryRegisterRateLimit = createRateLimitMiddleware({
  scope: 'repository_register',
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email || req.body?.name || '').trim().toLowerCase()}`,
});
const repositoryForgotPasswordRateLimit = createRateLimitMiddleware({
  scope: 'repository_forgot_password',
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email || '').trim().toLowerCase()}`,
});
const repositoryResetPasswordRateLimit = createRateLimitMiddleware({
  scope: 'repository_reset_password',
  keyGenerator: (req) => `${req.ip}:${String(req.body?.token || '').trim().toLowerCase()}`,
});

router.post('/register', repositoryRegisterRateLimit, RepositoryAuthController.register);
router.post('/login', repositoryLoginRateLimit, RepositoryAuthController.login);
router.post('/forgot-password', repositoryForgotPasswordRateLimit, RepositoryAuthController.forgotPassword);
router.get('/verify-reset-token', RepositoryAuthController.verifyResetToken);
router.post('/reset-password', repositoryResetPasswordRateLimit, RepositoryAuthController.resetPassword);
router.get('/profile', repositoryAuthMiddleware, RepositoryAuthController.getProfile);

export default router;
