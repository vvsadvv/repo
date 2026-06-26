import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { RepositoryReferenceModel } from '../models/RepositoryReference.js';
import { RepositoryUserModel } from '../models/RepositoryUser.js';
import { RepositoryAuthController } from './repositoryAuthController.js';

const originalHash = bcrypt.hash;
const originalFindByName = RepositoryUserModel.findByName;
const originalFindByEmail = RepositoryUserModel.findByEmail;
const originalCreate = RepositoryUserModel.create;
const originalFindActiveAdmins = RepositoryUserModel.findActiveAdmins;
const originalFindOrganizationById = RepositoryReferenceModel.findOrganizationById;
const originalFindOrganizationByName = RepositoryReferenceModel.findOrganizationByName;

/* Делает: Создаёт ответ. Применение: используется локально в файле backend/controllers/repositoryAuthController.register.test.js. */
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

/* Делает: Создаёт запрос valid register. Применение: используется локально в файле backend/controllers/repositoryAuthController.register.test.js. */
function createValidRegisterRequest(overrides = {}) {
  return {
    body: {
      name: 'race_user',
      fullName: 'Иванов Иван Иванович',
      email: 'race@example.com',
      organization: 'ФИЦ ЕГС РАН',
      position: 'Исследователь',
      personalDataConsent: true,
      password: 'Secret123!',
      confirmPassword: 'Secret123!',
      ...overrides,
    },
  };
}

/* Делает: Создаёт ошибку уникального violation. Применение: используется локально в файле backend/controllers/repositoryAuthController.register.test.js. */
function createUniqueViolationError() {
  const error = new Error('duplicate key value violates unique constraint');
  error.code = '23505';
  return error;
}

/* Делает: Выполняет restore all. Применение: используется локально в файле backend/controllers/repositoryAuthController.register.test.js. */
function restoreAll() {
  bcrypt.hash = originalHash;
  RepositoryUserModel.findByName = originalFindByName;
  RepositoryUserModel.findByEmail = originalFindByEmail;
  RepositoryUserModel.create = originalCreate;
  RepositoryUserModel.findActiveAdmins = originalFindActiveAdmins;
  RepositoryReferenceModel.findOrganizationById = originalFindOrganizationById;
  RepositoryReferenceModel.findOrganizationByName = originalFindOrganizationByName;
}

test.after(restoreAll);

test('RepositoryAuthController.register returns 400 when concurrent duplicate request loses name/email race', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async (t) => {
  let nameLookupCount = 0;
  let emailLookupCount = 0;

  bcrypt.hash = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => 'hashed-password';
  RepositoryReferenceModel.findOrganizationByName = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => ({
    id: 1,
    name_ru: 'ФИЦ ЕГС РАН',
    status: 'approved',
  });
  RepositoryReferenceModel.findOrganizationById = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => null;
  RepositoryUserModel.findByName = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => {
    nameLookupCount += 1;
    return nameLookupCount === 1 ? null : { id: 101, name: 'race_user' };
  };
  RepositoryUserModel.findByEmail = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => {
    emailLookupCount += 1;
    return emailLookupCount === 1 ? null : { id: 101, email: 'race@example.com' };
  };
  RepositoryUserModel.create = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => {
    throw createUniqueViolationError();
  };
  RepositoryUserModel.findActiveAdmins = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => [];

  t.after(restoreAll);

  const req = createValidRegisterRequest();
  const res = createResponse();

  await RepositoryAuthController.register(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.success, false);
  assert.equal(
    res.payload.message,
    'Пользователь с именем "race_user" и email "race@example.com" уже существует'
  );
  assert.deepEqual(res.payload.fieldErrors, {
    name: 'Пользователь с именем "race_user" уже существует',
    email: 'Пользователь с email "race@example.com" уже существует',
  });
});

test('RepositoryAuthController.register returns 400 when concurrent insert loses email-only race', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async (t) => {
  let emailLookupCount = 0;

  bcrypt.hash = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => 'hashed-password';
  RepositoryReferenceModel.findOrganizationByName = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => ({
    id: 1,
    name_ru: 'ФИЦ ЕГС РАН',
    status: 'approved',
  });
  RepositoryReferenceModel.findOrganizationById = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => null;
  RepositoryUserModel.findByName = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => null;
  RepositoryUserModel.findByEmail = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => {
    emailLookupCount += 1;
    return emailLookupCount === 1 ? null : { id: 202, email: 'race@example.com' };
  };
  RepositoryUserModel.create = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => {
    throw createUniqueViolationError();
  };
  RepositoryUserModel.findActiveAdmins = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => [];

  t.after(restoreAll);

  const req = createValidRegisterRequest({ name: 'race_user_2' });
  const res = createResponse();

  await RepositoryAuthController.register(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.success, false);
  assert.equal(res.payload.message, 'Пользователь с email "race@example.com" уже существует');
  assert.deepEqual(res.payload.fieldErrors, {
    email: 'Пользователь с email "race@example.com" уже существует',
  });
});

test('RepositoryAuthController.register returns fieldErrors for invalid email', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async (t) => {
  t.after(restoreAll);

  const req = createValidRegisterRequest({ email: 'invalid-email' });
  const res = createResponse();

  await RepositoryAuthController.register(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.success, false);
  assert.equal(res.payload.message, 'Укажите корректный email');
  assert.deepEqual(res.payload.fieldErrors, {
    email: 'Укажите корректный email',
  });
});

test('RepositoryAuthController.register returns fieldErrors when personal data consent is not accepted', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async (t) => {
  t.after(restoreAll);

  const req = createValidRegisterRequest({ personalDataConsent: false });
  const res = createResponse();

  await RepositoryAuthController.register(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.success, false);
  assert.equal(
    res.payload.message,
    'Для регистрации необходимо дать согласие на обработку персональных данных'
  );
  assert.deepEqual(res.payload.fieldErrors, {
    personalDataConsent: 'Для регистрации необходимо дать согласие на обработку персональных данных',
  });
});

test('RepositoryAuthController.register generates login from email when username is omitted', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async (t) => {
  let createdUserData = null;

  bcrypt.hash = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => 'hashed-password';
  RepositoryReferenceModel.findOrganizationByName = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => ({
    id: 1,
    name_ru: 'ФИЦ ЕГС РАН',
    status: 'approved',
  });
  RepositoryReferenceModel.findOrganizationById = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => null;
  RepositoryUserModel.findByName = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => null;
  RepositoryUserModel.findByEmail = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => null;
  RepositoryUserModel.create = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async (userData) => {
    createdUserData = userData;
    return {
      id: 303,
      name: userData.name,
      full_name: userData.full_name,
      email: userData.email,
      organization: userData.organization,
      organization_id: userData.organization_id,
      position: userData.position,
      role: userData.role,
      status: userData.status,
      created_at: '2026-06-25T00:00:00.000Z',
      approved_at: null,
      approved_by: null,
    };
  };
  RepositoryUserModel.findActiveAdmins = /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test внутри testCallback. */ async () => [];

  t.after(restoreAll);

  const req = createValidRegisterRequest({
    name: '',
    email: 'generated.login@example.com',
  });
  const res = createResponse();

  await RepositoryAuthController.register(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(createdUserData?.name, 'generated_login');
  assert.equal(res.payload.user.name, 'generated_login');
});
