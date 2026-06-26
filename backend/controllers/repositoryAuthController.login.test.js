import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { RepositoryUserModel } from '../models/RepositoryUser.js';
import { RepositoryAuthController } from './repositoryAuthController.js';

const originalFindByLogin = RepositoryUserModel.findByLogin;
const originalCompare = bcrypt.compare;

/* Делает: Создаёт ответ. Применение: используется локально в файле backend/controllers/repositoryAuthController.login.test.js. */
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

test.after(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в after. */ () => {
  RepositoryUserModel.findByLogin = originalFindByLogin;
  bcrypt.compare = originalCompare;
});

test('RepositoryAuthController.login returns 400 for unknown user', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async (t) => {
  RepositoryUserModel.findByLogin = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => null;
  bcrypt.compare = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => true;

  t.after(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в after внутри testCallback. */ () => {
    RepositoryUserModel.findByLogin = originalFindByLogin;
    bcrypt.compare = originalCompare;
  });

  const req = {
    body: {
      login: 'unknown@example.com',
      password: 'Secret123!',
    },
  };
  const res = createResponse();

  await RepositoryAuthController.login(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.success, false);
  assert.equal(res.payload.message, 'Неверный логин или пароль');
});

test('RepositoryAuthController.login returns 400 for wrong password', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async (t) => {
  RepositoryUserModel.findByLogin = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => ({
    id: 10,
    name: 'editor',
    full_name: 'Иванов Иван Иванович',
    email: 'editor@example.com',
    organization: 'Org',
    position: 'Editor',
    role: 'editor',
    status: 'active',
    password: 'hash',
    created_at: '2026-04-14T00:00:00.000Z',
    approved_at: null,
    approver_name: null,
  });
  bcrypt.compare = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => false;

  t.after(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в after внутри testCallback. */ () => {
    RepositoryUserModel.findByLogin = originalFindByLogin;
    bcrypt.compare = originalCompare;
  });

  const req = {
    body: {
      login: 'editor@example.com',
      password: 'Wrong123!',
    },
  };
  const res = createResponse();

  await RepositoryAuthController.login(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.success, false);
  assert.equal(res.payload.message, 'Неверный логин или пароль');
});

test('RepositoryAuthController.login returns 403 for inactive account', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async (t) => {
  RepositoryUserModel.findByLogin = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => ({
    id: 11,
    name: 'pending_editor',
    full_name: 'Петров Петр Петрович',
    email: 'pending@example.com',
    organization: 'Org',
    position: 'Editor',
    role: 'editor',
    status: 'pending',
    password: 'hash',
    created_at: '2026-04-14T00:00:00.000Z',
    approved_at: null,
    approver_name: null,
  });
  bcrypt.compare = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => true;

  t.after(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в after внутри testCallback. */ () => {
    RepositoryUserModel.findByLogin = originalFindByLogin;
    bcrypt.compare = originalCompare;
  });

  const req = {
    body: {
      login: 'pending@example.com',
      password: 'Secret123!',
    },
  };
  const res = createResponse();

  await RepositoryAuthController.login(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.success, false);
  assert.equal(
    res.payload.message,
    'Аккаунт репозитория еще не активирован. Дождитесь выдачи роли editor администратором.'
  );
});

test('RepositoryAuthController.login returns token and user for active account', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async (t) => {
  const activeUser = {
    id: 12,
    name: 'active_editor',
    full_name: 'Сидоров Сидор Сидорович',
    email: 'active@example.com',
    organization: 'Org',
    position: 'Editor',
    role: 'editor',
    status: 'active',
    password: 'hash',
    created_at: '2026-04-14T00:00:00.000Z',
    approved_at: '2026-04-14T01:00:00.000Z',
    approver_name: 'admin',
  };

  RepositoryUserModel.findByLogin = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => activeUser;
  bcrypt.compare = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => true;

  t.after(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в after внутри testCallback. */ () => {
    RepositoryUserModel.findByLogin = originalFindByLogin;
    bcrypt.compare = originalCompare;
  });

  const req = {
    body: {
      login: 'active@example.com',
      password: 'Secret123!',
    },
  };
  const res = createResponse();

  await RepositoryAuthController.login(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.message, 'Вход в репозиторий выполнен');
  assert.equal(typeof res.payload.token, 'string');
  assert.ok(res.payload.token.length > 20);
  assert.deepEqual(res.payload.user, {
    id: activeUser.id,
    name: activeUser.name,
    full_name: activeUser.full_name,
    email: activeUser.email,
    organization: activeUser.organization,
    organization_id: activeUser.organization_id ?? null,
    organizationId: activeUser.organization_id ?? null,
    position: activeUser.position,
    role: activeUser.role,
    status: activeUser.status,
    created_at: activeUser.created_at,
    approved_at: activeUser.approved_at,
    approver_name: activeUser.approver_name,
  });
});

test('RepositoryAuthController.login returns 500 when model throws', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async (t) => {
  RepositoryUserModel.findByLogin = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => {
    throw new Error('db unavailable');
  };
  bcrypt.compare = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => true;
  const originalConsoleError = console.error;
  console.error = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ () => {};

  t.after(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в after внутри testCallback. */ () => {
    RepositoryUserModel.findByLogin = originalFindByLogin;
    bcrypt.compare = originalCompare;
    console.error = originalConsoleError;
  });

  const req = {
    body: {
      login: 'any@example.com',
      password: 'Secret123!',
    },
  };
  const res = createResponse();

  await RepositoryAuthController.login(req, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.success, false);
  assert.equal(res.payload.message, 'Ошибка входа в репозиторий');
});
