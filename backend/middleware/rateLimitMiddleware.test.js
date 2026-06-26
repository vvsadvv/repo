import assert from 'node:assert/strict';
import test from 'node:test';
import { createRateLimitMiddleware, createRequestThrottleMiddleware } from './rateLimitMiddleware.js';

let scopeCounter = 0;

/* Делает: Выполняет unique scope. Применение: используется локально в файле backend/middleware/rateLimitMiddleware.test.js. */
function uniqueScope(prefix = 'rate-limit-test') {
  scopeCounter += 1;
  return `${prefix}-${scopeCounter}`;
}

/* Делает: Создаёт запрос. Применение: используется локально в файле backend/middleware/rateLimitMiddleware.test.js. */
function createRequest(overrides = {}) {
  return {
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    body: {},
    ...overrides,
  };
}

/* Делает: Создаёт ответ. Применение: используется локально в файле backend/middleware/rateLimitMiddleware.test.js. */
function createResponse() {
  return {
    statusCode: 200,
    payload: undefined,
    headers: {},
    headersSent: false,
        /* Делает: Выполняет set. Применение: используется внутри функции createResponse. */
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
        /* Делает: Выполняет статус. Применение: используется внутри функции createResponse. */
    status(code) {
      this.statusCode = code;
      return this;
    },
        /* Делает: Выполняет json. Применение: используется внутри функции createResponse. */
    json(body) {
      this.payload = body;
      this.headersSent = true;
      return body;
    },
  };
}

/* Делает: Выполняет запрос simulate. Применение: используется локально в файле backend/middleware/rateLimitMiddleware.test.js. */
function simulateRequest(
  middleware,
  { reqOverrides = {}, handlerStatus = 200, handlerBody = { success: true } } = {}
) {
  const req = createRequest(reqOverrides);
  const res = createResponse();
  let nextCalled = false;

  middleware(req, res, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в middleware внутри simulateRequest. */ () => {
    nextCalled = true;
  });

  if (nextCalled) {
    res.status(handlerStatus).json(handlerBody);
  }

  return { req, res, nextCalled };
}

/* Делает: Выполняет with mocked now. Применение: используется локально в файле backend/middleware/rateLimitMiddleware.test.js. */
function withMockedNow(callback) {
  const originalNow = Date.now;
  let current = 1_700_000_000_000;
  Date.now = /* Делает: Выполняет локальный callback в текущем месте модуля. Применение: используется локально внутри withMockedNow. */ () => current;

    /* Делает: Выполняет advance ms. Применение: используется внутри функции withMockedNow. */
  const advanceMs = (ms) => {
    current += ms;
  };

  try {
    callback({ advanceMs,     /* Делает: Выполняет now. Применение: используется внутри функции withMockedNow. */
    now: () => current });
  } finally {
    Date.now = originalNow;
  }
}

test('createRateLimitMiddleware: throws when scope is missing', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  assert.throws(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в throws внутри testCallback. */ () => createRateLimitMiddleware(), /scope/i);
});

test('locks after repeated failed requests and blocks during active lock', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  withMockedNow(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в withMockedNow внутри testCallback. */ ({ advanceMs }) => {
    const middleware = createRateLimitMiddleware({ scope: uniqueScope() });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const { res, nextCalled } = simulateRequest(middleware, {
        handlerStatus: 400,
        handlerBody: { success: false },
      });
      assert.equal(nextCalled, true);
      assert.equal(res.statusCode, 400);
      assert.equal(res.payload.success, false);
    }

    const fifthFailure = simulateRequest(middleware, {
      handlerStatus: 400,
      handlerBody: { success: false },
    });
    assert.equal(fifthFailure.nextCalled, true);
    assert.equal(fifthFailure.res.statusCode, 429);
    assert.equal(fifthFailure.res.payload.retryAfterSeconds, 30);

    const blockedWhileLocked = simulateRequest(middleware, {
      handlerStatus: 200,
      handlerBody: { success: true },
    });
    assert.equal(blockedWhileLocked.nextCalled, false);
    assert.equal(blockedWhileLocked.res.statusCode, 429);
    assert.equal(blockedWhileLocked.res.payload.retryAfterSeconds, 30);

    advanceMs(30_000);

    const nextWaveFailure = simulateRequest(middleware, {
      handlerStatus: 400,
      handlerBody: { success: false },
    });
    assert.equal(nextWaveFailure.nextCalled, true);
    assert.equal(nextWaveFailure.res.statusCode, 429);
    assert.equal(nextWaveFailure.res.payload.retryAfterSeconds, 60);
  });
});

test('successful response resets attempts for the same identity', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  withMockedNow(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в withMockedNow внутри testCallback. */ () => {
    const middleware = createRateLimitMiddleware({ scope: uniqueScope() });

    simulateRequest(middleware, {
      handlerStatus: 400,
      handlerBody: { success: false },
    });

    const success = simulateRequest(middleware, {
      handlerStatus: 200,
      handlerBody: { success: true },
    });
    assert.equal(success.res.statusCode, 200);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = simulateRequest(middleware, {
        handlerStatus: 400,
        handlerBody: { success: false },
      });
      assert.equal(result.res.statusCode, 400);
    }

    const fifthAfterReset = simulateRequest(middleware, {
      handlerStatus: 400,
      handlerBody: { success: false },
    });
    assert.equal(fifthAfterReset.res.statusCode, 429);
    assert.equal(fifthAfterReset.res.payload.retryAfterSeconds, 30);
  });
});

test('normalizes custom keyGenerator identity to lowercase and trims edges', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  withMockedNow(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в withMockedNow внутри testCallback. */ () => {
    const middleware = createRateLimitMiddleware({
      scope: uniqueScope(),
            /* Делает: Выполняет key generator. Применение: используется внутри функции withMockedNowCallback. */
      keyGenerator: (req) => `   ${req.ip}:${req.body.login}   `,
    });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = simulateRequest(middleware, {
        reqOverrides: { ip: '10.10.10.10', body: { login: 'EDITOR' } },
        handlerStatus: 401,
        handlerBody: { success: false },
      });
      assert.equal(result.res.statusCode, 401);
    }

    const lockWithLowercaseLogin = simulateRequest(middleware, {
      reqOverrides: { ip: '10.10.10.10', body: { login: 'editor' } },
      handlerStatus: 401,
      handlerBody: { success: false },
    });

    assert.equal(lockWithLowercaseLogin.res.statusCode, 429);
    assert.equal(lockWithLowercaseLogin.res.payload.retryAfterSeconds, 30);
  });
});

test('rate limits are isolated by identity', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  withMockedNow(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в withMockedNow внутри testCallback. */ () => {
    const middleware = createRateLimitMiddleware({ scope: uniqueScope() });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      simulateRequest(middleware, {
        reqOverrides: { ip: '192.168.1.10' },
        handlerStatus: 400,
        handlerBody: { success: false },
      });
    }

    const blockedIdentity = simulateRequest(middleware, {
      reqOverrides: { ip: '192.168.1.10' },
      handlerStatus: 200,
      handlerBody: { success: true },
    });
    assert.equal(blockedIdentity.nextCalled, false);
    assert.equal(blockedIdentity.res.statusCode, 429);

    const otherIdentity = simulateRequest(middleware, {
      reqOverrides: { ip: '192.168.1.11' },
      handlerStatus: 400,
      handlerBody: { success: false },
    });
    assert.equal(otherIdentity.nextCalled, true);
    assert.equal(otherIdentity.res.statusCode, 400);
  });
});

test('massive repeated failures progressively increase lock timeout up to cap', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  withMockedNow(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в withMockedNow внутри testCallback. */ ({ advanceMs }) => {
    const middleware = createRateLimitMiddleware({ scope: uniqueScope('rate-limit-mass') });
    const expectedTimeouts = [30, 60, 120, 240, 480, 960, 1800, 1800];
    const observedTimeouts = [];

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = simulateRequest(middleware, {
        handlerStatus: 400,
        handlerBody: { success: false },
      });
      assert.equal(result.res.statusCode, 400);
    }

    for (const expectedTimeout of expectedTimeouts) {
      const lockResult = simulateRequest(middleware, {
        handlerStatus: 400,
        handlerBody: { success: false },
      });

      assert.equal(lockResult.res.statusCode, 429);
      assert.equal(lockResult.res.payload.retryAfterSeconds, expectedTimeout);
      observedTimeouts.push(lockResult.res.payload.retryAfterSeconds);

      advanceMs(expectedTimeout * 1000);
    }

    assert.deepEqual(observedTimeouts, expectedTimeouts);
  });
});

test('mass calls for many identities stay isolated and do not leak counters', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  withMockedNow(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в withMockedNow внутри testCallback. */ () => {
    const middleware = createRateLimitMiddleware({ scope: uniqueScope('rate-limit-isolation-mass') });
    const identityCount = 20;

    for (let identityIndex = 1; identityIndex <= identityCount; identityIndex += 1) {
      const ip = `10.0.0.${identityIndex}`;

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const result = simulateRequest(middleware, {
          reqOverrides: { ip },
          handlerStatus: 400,
          handlerBody: { success: false },
        });

        assert.equal(result.res.statusCode, 400);
      }
    }

    for (let identityIndex = 1; identityIndex <= identityCount; identityIndex += 1) {
      const ip = `10.0.0.${identityIndex}`;
      const lockResult = simulateRequest(middleware, {
        reqOverrides: { ip },
        handlerStatus: 400,
        handlerBody: { success: false },
      });

      assert.equal(lockResult.res.statusCode, 429);
      assert.equal(lockResult.res.payload.retryAfterSeconds, 30);
    }

    const brandNewIdentity = simulateRequest(middleware, {
      reqOverrides: { ip: '10.0.0.250' },
      handlerStatus: 400,
      handlerBody: { success: false },
    });
    assert.equal(brandNewIdentity.res.statusCode, 400);
  });
});

test('createRequestThrottleMiddleware blocks repeated successful requests in a fixed window', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  withMockedNow(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в withMockedNow внутри testCallback. */ ({ advanceMs }) => {
    const middleware = createRequestThrottleMiddleware({
      scope: uniqueScope('request-throttle'),
      maxRequests: 2,
      windowMs: 10_000,
    });

    const first = simulateRequest(middleware);
    assert.equal(first.nextCalled, true);
    assert.equal(first.res.statusCode, 200);

    const second = simulateRequest(middleware);
    assert.equal(second.nextCalled, true);
    assert.equal(second.res.statusCode, 200);

    const blocked = simulateRequest(middleware);
    assert.equal(blocked.nextCalled, false);
    assert.equal(blocked.res.statusCode, 429);
    assert.equal(blocked.res.headers['Retry-After'], '10');

    advanceMs(10_000);

    const afterReset = simulateRequest(middleware);
    assert.equal(afterReset.nextCalled, true);
    assert.equal(afterReset.res.statusCode, 200);
  });
});
