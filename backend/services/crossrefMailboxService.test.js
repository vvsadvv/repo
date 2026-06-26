import assert from 'node:assert/strict';
import test from 'node:test';
import { crossrefMailboxServiceTestUtils } from './crossrefMailboxService.js';

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
