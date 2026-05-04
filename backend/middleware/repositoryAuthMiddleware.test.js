import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { RepositoryUserModel } from '../models/RepositoryUser.js';
import {
  optionalRepositoryAuthMiddleware,
  repositoryAdminMiddleware,
  repositoryAuthMiddleware,
  repositoryEditorMiddleware,
  signRepositoryToken,
} from './repositoryAuthMiddleware.js';

const repositorySecret =
  process.env.REPOSITORY_JWT_SECRET || process.env.JWT_SECRET || 'repository_fallback_secret';
const repositoryJwtIssuer = process.env.REPOSITORY_JWT_ISSUER || 'repo-backend';
const repositoryJwtAudience = process.env.REPOSITORY_JWT_AUDIENCE || 'repo-users';

const originalFindById = RepositoryUserModel.findById;

function createRequest({ authorization, repositoryUser } = {}) {
  return {
    repositoryUser,
    header(name) {
      if (name === 'Authorization') {
        return authorization;
      }
      return undefined;
    },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return body;
    },
  };
}

async function runMiddleware(middleware, req, res) {
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return nextCalled;
}

test.after(() => {
  RepositoryUserModel.findById = originalFindById;
});

test('repositoryAuthMiddleware returns 401 when Authorization header is missing', async () => {
  const req = createRequest();
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.message, 'Требуется авторизация в репозитории');
});

test('repositoryAuthMiddleware returns 401 for invalid token', async () => {
  const req = createRequest({ authorization: 'Bearer malformed-token' });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.message, 'Неверный токен репозитория');
});

test('repositoryAuthMiddleware rejects token with wrong scope', async () => {
  const token = jwt.sign(
    { repositoryUserId: 1, scope: 'generic' },
    repositorySecret,
    {
      expiresIn: '1h',
      algorithm: 'HS256',
      issuer: repositoryJwtIssuer,
      audience: repositoryJwtAudience,
    }
  );
  const req = createRequest({ authorization: `Bearer ${token}` });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.message, 'Неверный токен репозитория');
});

test('repositoryAuthMiddleware returns 401 for expired token', async () => {
  const expiredToken = jwt.sign(
    { repositoryUserId: 1, scope: 'repository' },
    repositorySecret,
    {
      expiresIn: -1,
      algorithm: 'HS256',
      issuer: repositoryJwtIssuer,
      audience: repositoryJwtAudience,
    }
  );
  const req = createRequest({ authorization: `Bearer ${expiredToken}` });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.message, 'Токен репозитория истек');
});

test('repositoryAuthMiddleware returns 401 when user is missing', async (t) => {
  RepositoryUserModel.findById = async () => null;
  t.after(() => {
    RepositoryUserModel.findById = originalFindById;
  });

  const token = signRepositoryToken({ id: 1001 });
  const req = createRequest({ authorization: `Bearer ${token}` });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.message, 'Пользователь репозитория не найден');
});

test('repositoryAuthMiddleware returns 403 for inactive user', async (t) => {
  RepositoryUserModel.findById = async () => ({ id: 1002, status: 'pending', role: 'editor' });
  t.after(() => {
    RepositoryUserModel.findById = originalFindById;
  });

  const token = signRepositoryToken({ id: 1002 });
  const req = createRequest({ authorization: `Bearer ${token}` });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.message, 'Доступ к репозиторию еще не активирован');
});

test('repositoryAuthMiddleware sets user and calls next for active user', async (t) => {
  const activeUser = { id: 1003, status: 'active', role: 'editor' };
  RepositoryUserModel.findById = async () => activeUser;
  t.after(() => {
    RepositoryUserModel.findById = originalFindById;
  });

  const token = signRepositoryToken({ id: 1003 });
  const req = createRequest({ authorization: `Bearer ${token}` });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(req.repositoryUser, activeUser);
});

test('optionalRepositoryAuthMiddleware keeps request anonymous without token', async () => {
  const req = createRequest();
  const res = createResponse();

  const nextCalled = await runMiddleware(optionalRepositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, true);
  assert.equal(req.repositoryUser, null);
});

test('optionalRepositoryAuthMiddleware swallows invalid token and continues', async () => {
  const req = createRequest({ authorization: 'Bearer invalid-token' });
  const res = createResponse();

  const nextCalled = await runMiddleware(optionalRepositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, true);
  assert.equal(req.repositoryUser, null);
});

test('optionalRepositoryAuthMiddleware sets active user for valid token', async (t) => {
  const activeUser = { id: 1004, status: 'active', role: 'admin' };
  RepositoryUserModel.findById = async () => activeUser;
  t.after(() => {
    RepositoryUserModel.findById = originalFindById;
  });

  const token = signRepositoryToken({ id: 1004 });
  const req = createRequest({ authorization: `Bearer ${token}` });
  const res = createResponse();

  const nextCalled = await runMiddleware(optionalRepositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, true);
  assert.equal(req.repositoryUser, activeUser);
});

test('repositoryEditorMiddleware blocks missing user with 401', async () => {
  const req = createRequest({ repositoryUser: null });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryEditorMiddleware, req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.message, 'Требуется авторизация в репозитории');
});

test('repositoryEditorMiddleware blocks non-editor and non-admin roles with 403', async () => {
  const req = createRequest({ repositoryUser: { id: 1, role: 'viewer' } });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryEditorMiddleware, req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.message, 'Редактирование доступно только editor или admin');
});

test('repositoryAdminMiddleware blocks non-admin role with 403', async () => {
  const req = createRequest({ repositoryUser: { id: 2, role: 'editor' } });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryAdminMiddleware, req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.message, 'Требуется роль admin репозитория');
});

test('repositoryAdminMiddleware passes admin requests', async () => {
  const req = createRequest({ repositoryUser: { id: 3, role: 'admin' } });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryAdminMiddleware, req, res);

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});
