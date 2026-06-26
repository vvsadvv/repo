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

/* Делает: Создаёт запрос. Применение: используется локально в файле backend/middleware/repositoryAuthMiddleware.test.js. */
function createRequest({ authorization, repositoryUser } = {}) {
  return {
    repositoryUser,
        /* Делает: Выполняет header. Применение: используется внутри функции createRequest. */
    header(name) {
      if (name === 'Authorization') {
        return authorization;
      }
      return undefined;
    },
  };
}

/* Делает: Создаёт ответ. Применение: используется локально в файле backend/middleware/repositoryAuthMiddleware.test.js. */
function createResponse() {
  return {
    statusCode: 200,
    payload: undefined,
        /* Делает: Выполняет статус. Применение: используется внутри функции createResponse. */
    status(code) {
      this.statusCode = code;
      return this;
    },
        /* Делает: Выполняет json. Применение: используется внутри функции createResponse. */
    json(body) {
      this.payload = body;
      return body;
    },
  };
}

/* Делает: Выполняет middleware run. Применение: используется локально в файле backend/middleware/repositoryAuthMiddleware.test.js. */
async function runMiddleware(middleware, req, res) {
  let nextCalled = false;
  await middleware(req, res, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в middleware внутри runMiddleware. */ () => {
    nextCalled = true;
  });
  return nextCalled;
}

test.after(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в after. */ () => {
  RepositoryUserModel.findById = originalFindById;
});

test('repositoryAuthMiddleware returns 401 when Authorization header is missing', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async () => {
  const req = createRequest();
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.message, 'Требуется авторизация в репозитории');
});

test('repositoryAuthMiddleware returns 401 for invalid token', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async () => {
  const req = createRequest({ authorization: 'Bearer malformed-token' });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.message, 'Неверный токен репозитория');
});

test('repositoryAuthMiddleware rejects token with wrong scope', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async () => {
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

test('repositoryAuthMiddleware returns 401 for expired token', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async () => {
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

test('repositoryAuthMiddleware returns 401 when user is missing', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async (t) => {
  RepositoryUserModel.findById = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => null;
  t.after(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в after внутри testCallback. */ () => {
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

test('repositoryAuthMiddleware returns 403 for inactive user', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async (t) => {
  RepositoryUserModel.findById = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => ({ id: 1002, status: 'pending', role: 'editor' });
  t.after(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в after внутри testCallback. */ () => {
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

test('repositoryAuthMiddleware sets user and calls next for active user', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async (t) => {
  const activeUser = { id: 1003, status: 'active', role: 'editor' };
  RepositoryUserModel.findById = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => activeUser;
  t.after(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в after внутри testCallback. */ () => {
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

test('optionalRepositoryAuthMiddleware keeps request anonymous without token', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async () => {
  const req = createRequest();
  const res = createResponse();

  const nextCalled = await runMiddleware(optionalRepositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, true);
  assert.equal(req.repositoryUser, null);
});

test('optionalRepositoryAuthMiddleware swallows invalid token and continues', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async () => {
  const req = createRequest({ authorization: 'Bearer invalid-token' });
  const res = createResponse();

  const nextCalled = await runMiddleware(optionalRepositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, true);
  assert.equal(req.repositoryUser, null);
});

test('optionalRepositoryAuthMiddleware sets active user for valid token', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async (t) => {
  const activeUser = { id: 1004, status: 'active', role: 'admin' };
  RepositoryUserModel.findById = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => activeUser;
  t.after(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в after внутри testCallback. */ () => {
    RepositoryUserModel.findById = originalFindById;
  });

  const token = signRepositoryToken({ id: 1004 });
  const req = createRequest({ authorization: `Bearer ${token}` });
  const res = createResponse();

  const nextCalled = await runMiddleware(optionalRepositoryAuthMiddleware, req, res);

  assert.equal(nextCalled, true);
  assert.equal(req.repositoryUser, activeUser);
});

test('repositoryEditorMiddleware blocks missing user with 401', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async () => {
  const req = createRequest({ repositoryUser: null });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryEditorMiddleware, req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.message, 'Требуется авторизация в репозитории');
});

test('repositoryEditorMiddleware blocks roles outside user/editor/admin with 403', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async () => {
  const req = createRequest({ repositoryUser: { id: 1, role: 'viewer' } });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryEditorMiddleware, req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.message, 'Редактирование доступно только user, editor или admin');
});

test('repositoryAdminMiddleware blocks non-admin role with 403', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async () => {
  const req = createRequest({ repositoryUser: { id: 2, role: 'editor' } });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryAdminMiddleware, req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.message, 'Требуется роль admin репозитория');
});

test('repositoryAdminMiddleware passes admin requests', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async () => {
  const req = createRequest({ repositoryUser: { id: 3, role: 'admin' } });
  const res = createResponse();

  const nextCalled = await runMiddleware(repositoryAdminMiddleware, req, res);

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});
