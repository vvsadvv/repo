import jwt from 'jsonwebtoken';
import { RepositoryUserModel } from '../models/RepositoryUser.js';

const configuredRepositorySecret = process.env.REPOSITORY_JWT_SECRET || process.env.JWT_SECRET || '';
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !configuredRepositorySecret) {
  throw new Error('REPOSITORY_JWT_SECRET (or JWT_SECRET) must be configured in production');
}

const repositorySecret = configuredRepositorySecret || 'repository_fallback_secret';
const repositoryJwtIssuer = process.env.REPOSITORY_JWT_ISSUER || 'repo-backend';
const repositoryJwtAudience = process.env.REPOSITORY_JWT_AUDIENCE || 'repo-users';
const repositoryTokenCookieName = 'repository_token';

function extractRepositoryCookieToken(req) {
  const cookieHeader = req.header('Cookie');
  if (!cookieHeader) {
    return null;
  }

  const tokenCookie = cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${repositoryTokenCookieName}=`));

  if (!tokenCookie) {
    return null;
  }

  const rawToken = tokenCookie.slice(repositoryTokenCookieName.length + 1);

  try {
    return decodeURIComponent(rawToken);
  } catch {
    return rawToken;
  }
}

function extractBearerToken(req) {
  const authHeader = req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.replace('Bearer ', '');
  }

  return extractRepositoryCookieToken(req);
}

function verifyRepositoryToken(token) {
  const decoded = jwt.verify(token, repositorySecret, {
    algorithms: ['HS256'],
    issuer: repositoryJwtIssuer,
    audience: repositoryJwtAudience,
  });

  if (decoded?.scope !== 'repository') {
    throw new jwt.JsonWebTokenError('Invalid repository token scope');
  }

  return decoded;
}

export const optionalRepositoryAuthMiddleware = async (req, res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      req.repositoryUser = null;
      return next();
    }

    const decoded = verifyRepositoryToken(token);
    const user = await RepositoryUserModel.findById(decoded.repositoryUserId);
    req.repositoryUser = user && user.status === 'active' ? user : null;
    return next();
  } catch {
    req.repositoryUser = null;
    return next();
  }
};

export const repositoryAuthMiddleware = async (req, res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Требуется авторизация в репозитории' });
    }

    const decoded = verifyRepositoryToken(token);
    const user = await RepositoryUserModel.findById(decoded.repositoryUserId);

    if (!user) {
      return res.status(401).json({ message: 'Пользователь репозитория не найден' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ message: 'Доступ к репозиторию еще не активирован' });
    }

    req.repositoryUser = user;
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Неверный токен репозитория' });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Токен репозитория истек' });
    }

    console.error('Repository auth middleware error:', error);
    return res.status(401).json({ message: 'Ошибка авторизации репозитория' });
  }
};

export const repositoryEditorMiddleware = async (req, res, next) => {
  if (!req.repositoryUser) {
    return res.status(401).json({ message: 'Требуется авторизация в репозитории' });
  }

  if (!['admin', 'editor', 'user'].includes(req.repositoryUser.role)) {
    return res.status(403).json({ message: 'Редактирование доступно только user, editor или admin' });
  }

  return next();
};

export const repositoryAdminMiddleware = async (req, res, next) => {
  if (!req.repositoryUser) {
    return res.status(401).json({ message: 'Требуется авторизация в репозитории' });
  }

  if (req.repositoryUser.role !== 'admin') {
    return res.status(403).json({ message: 'Требуется роль admin репозитория' });
  }

  return next();
};

export const signRepositoryToken = (user) =>
  jwt.sign(
    { repositoryUserId: user.id, scope: 'repository' },
    repositorySecret,
    {
      expiresIn: '24h',
      algorithm: 'HS256',
      issuer: repositoryJwtIssuer,
      audience: repositoryJwtAudience,
    }
  );
