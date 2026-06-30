import assert from 'node:assert/strict';
import test from 'node:test';
import { CrossrefMailboxService, crossrefMailboxServiceTestUtils } from './crossrefMailboxService.js';

test('crossref mailbox parser extracts xml payload from plain text email', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  const rawMessage = [
    'Subject: DO NOT REPLY - CrossRef submission ID: 1751391204',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<doi_batch_diagnostic status="completed">',
    '  <submission_id>1751391204</submission_id>',
    '  <batch_id>ESDB30992</batch_id>',
    '  <record_diagnostic status="Success">',
    '    <doi>10.35540/gsras.er.2026.1.25</doi>',
    '    <msg>Successfully added</msg>',
    '  </record_diagnostic>',
    '</doi_batch_diagnostic>',
  ].join('\r\n');

  const parsed = crossrefMailboxServiceTestUtils.extractCrossrefConfirmationPayload(rawMessage);

  assert.equal(parsed.subject, 'DO NOT REPLY - CrossRef submission ID: 1751391204');
  assert.match(parsed.payload, /<doi_batch_diagnostic/);
  assert.match(parsed.payload, /10\.35540\/gsras\.er\.2026\.1\.25/);
});

test('crossref mailbox parser recognizes non-crossref emails', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  const rawMessage = [
    'Subject: Обычное письмо',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'Просто сообщение без XML.',
  ].join('\r\n');

  const parsed = crossrefMailboxServiceTestUtils.extractCrossrefConfirmationPayload(rawMessage);

  assert.equal(
    crossrefMailboxServiceTestUtils.isCrossrefConfirmationMessage(parsed.subject, parsed.text, rawMessage),
    false
  );
});

test('crossref mailbox processing classifies unmatched doi as non-fatal skip', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  const classification = crossrefMailboxServiceTestUtils.classifyMailboxProcessingError({
    code: 'DOCUMENT_NOT_FOUND',
    message: 'Документ не найден',
  });

  assert.deepEqual(classification, {
    status: 'unmatched',
    logLevel: 'info',
  });
});

test('crossref mailbox redacts password in POP3 command logs', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  assert.equal(
    crossrefMailboxServiceTestUtils.redactPop3Command('PASS super-secret-password'),
    'PASS [REDACTED]'
  );
  assert.equal(
    crossrefMailboxServiceTestUtils.redactPop3Command('USER repository'),
    'USER repository'
  );
});

test('crossref mailbox seeds existing messages only on first start', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  assert.equal(
    crossrefMailboxServiceTestUtils.shouldSeedExistingMailboxMessages({
      skipExistingOnStart: true,
      existingProcessedCount: 0,
      mailboxMessageCount: 12,
    }),
    true
  );

  assert.equal(
    crossrefMailboxServiceTestUtils.shouldSeedExistingMailboxMessages({
      skipExistingOnStart: true,
      existingProcessedCount: 4,
      mailboxMessageCount: 12,
    }),
    false
  );

  assert.equal(
    crossrefMailboxServiceTestUtils.shouldSeedExistingMailboxMessages({
      skipExistingOnStart: false,
      existingProcessedCount: 0,
      mailboxMessageCount: 12,
    }),
    false
  );
});

test('crossref mailbox keeps only non-expired messages for polling', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async () => {
  const service = new CrossrefMailboxService();
  const deletedNumbers = [];
  const rawMessagesByNumber = new Map([
    [
      1,
      [
        'Date: Sat, 01 Jun 2024 10:00:00 +0000',
        'Subject: Old message',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        'Old message body',
      ].join('\r\n'),
    ],
    [
      2,
      [
        'Date: Tue, 25 Jun 2024 10:00:00 +0000',
        'Subject: Fresh message',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        'Fresh message body',
      ].join('\r\n'),
    ],
    [
      3,
      [
        'Subject: Without date',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        'No date header body',
      ].join('\r\n'),
    ],
  ]);
  const client = {
    retrieveMessage: async (messageNumber) => rawMessagesByNumber.get(messageNumber) || '',
    deleteMessage: async (messageNumber) => {
      deletedNumbers.push(messageNumber);
    },
  };

  const { activeMessages, rawMessagesByUid, deletedCount } = await service.filterExpiredMessages(
    client,
    [
      { number: 1, uid: 'old' },
      { number: 2, uid: 'fresh' },
      { number: 3, uid: 'undated' },
    ],
    { messageRetentionDays: 14 },
    new Date('2024-06-29T10:00:00Z')
  );

  assert.equal(deletedCount, 1);
  assert.deepEqual(deletedNumbers, [1]);
  assert.deepEqual(
    activeMessages.map((message) => message.uid),
    ['fresh', 'undated']
  );
  assert.equal(rawMessagesByUid.get('fresh'), rawMessagesByNumber.get(2));
  assert.equal(rawMessagesByUid.get('undated'), rawMessagesByNumber.get(3));
});

test('crossref mailbox start stops timer when initial poll fails', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async () => {
  const service = new CrossrefMailboxService();
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const intervalHandles = [];
  const clearedHandles = [];

  globalThis.setInterval = (callback, delay) => {
    const handle = { callback, delay, unref() {} };
    intervalHandles.push(handle);
    return handle;
  };
  globalThis.clearInterval = (handle) => {
    clearedHandles.push(handle);
  };

  service.getConfig = () => ({
    enabled: true,
    host: 'pop3.example.test',
    port: 110,
    secure: false,
    user: 'user',
    password: 'wrong-password',
    pollIntervalMs: 60_000,
  });
  service.ensureStateTable = async () => {};
  service.pollNow = async () => {
    throw new Error('AUTH failed');
  };

  try {
    await assert.rejects(service.start(), /AUTH failed/);
    assert.equal(intervalHandles.length, 1);
    assert.equal(clearedHandles.length, 1);
    assert.equal(service.pollTimer, null);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('crossref mailbox scheduled poll catches background errors', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ async () => {
  const service = new CrossrefMailboxService();
  const loggedErrors = [];

  service.pollNow = () => Promise.reject(new Error('AUTH failed'));
  service.logScheduledPollError = (error) => {
    loggedErrors.push(error?.message || 'UNKNOWN_ERROR');
  };

  service.schedulePoll();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(loggedErrors, ['AUTH failed']);
});
