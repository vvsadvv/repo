import assert from 'node:assert/strict';
import test from 'node:test';
import { createRateLimitMiddleware } from './rateLimitMiddleware.js';

let scopeCounter = 0;

function uniqueScope(prefix = 'rate-limit-test') {
  scopeCounter += 1;
  return `${prefix}-${scopeCounter}`;
}

function createRequest(overrides = {}) {
  return {
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    body: {},
    ...overrides,
  };
}

function createResponse() {
  return {
    statusCode: 200,
    payload: undefined,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      this.headersSent = true;
      return body;
    },
  };
}

function simulateRequest(
  middleware,
  { reqOverrides = {}, handlerStatus = 200, handlerBody = { success: true } } = {}
) {
  const req = createRequest(reqOverrides);
  const res = createResponse();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  if (nextCalled) {
    res.status(handlerStatus).json(handlerBody);
  }

  return { req, res, nextCalled };
}

function withMockedNow(callback) {
  const originalNow = Date.now;
  let current = 1_700_000_000_000;
  Date.now = () => current;

  const advanceMs = (ms) => {
    current += ms;
  };

  try {
    callback({ advanceMs, now: () => current });
  } finally {
    Date.now = originalNow;
  }
}

test('createRateLimitMiddleware: throws when scope is missing', () => {
  assert.throws(() => createRateLimitMiddleware(), /scope/i);
});

test('locks after repeated failed requests and blocks during active lock', () => {
  withMockedNow(({ advanceMs }) => {
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

test('successful response resets attempts for the same identity', () => {
  withMockedNow(() => {
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

test('normalizes custom keyGenerator identity to lowercase and trims edges', () => {
  withMockedNow(() => {
    const middleware = createRateLimitMiddleware({
      scope: uniqueScope(),
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

test('rate limits are isolated by identity', () => {
  withMockedNow(() => {
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

test('massive repeated failures progressively increase lock timeout up to cap', () => {
  withMockedNow(({ advanceMs }) => {
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

test('mass calls for many identities stay isolated and do not leak counters', () => {
  withMockedNow(() => {
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
