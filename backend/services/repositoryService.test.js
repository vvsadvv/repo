import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { repositoryServiceTestUtils } from './repositoryService.js';

test('repositoryService decodes managed upload URLs with Cyrillic file names', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  const documentDirectory = 'bd42e668-27fd-41d4-85b9-c513b59aa3fb';
  const encodedFileName = '%D0%97%D0%B0%D0%B4%D0%B0%D0%BD%D0%B8%D0%B5-%D0%9D%D0%98%D0%A0-01.pdf';
  const decodedFileName = 'Задание-НИР-01.pdf';
  const absoluteUrl = `http://localhost:3005/uploads/repository/2026/${documentDirectory}/${encodedFileName}`;

  const relativePath = repositoryServiceTestUtils.getManagedUploadRelativePath(absoluteUrl);
  const parsedDocumentDirectory = repositoryServiceTestUtils.getManagedUploadDocumentDirectory(absoluteUrl);
  const filePath = repositoryServiceTestUtils.getManagedUploadFilePath(absoluteUrl);

  assert.equal(
    relativePath,
    `uploads/repository/2026/${documentDirectory}/${decodedFileName}`
  );
  assert.equal(parsedDocumentDirectory, 'bd42e668-27fd-41d4-85b9-c513b59aa3fb');
  assert.equal(path.basename(filePath || ''), decodedFileName);
  assert.ok(
    String(filePath || '').endsWith(
      path.join('backend', 'uploads', 'repository', '2026', documentDirectory, decodedFileName)
    )
  );
});

test('guest can view only published repository documents', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  const guest = null;
  const verifiedDocument = { documentStatus: 'verified', meta: {} };
  const draftDocument = { documentStatus: 'draft', meta: {} };
  const reviewDocument = { documentStatus: 'under_review', meta: {} };

  assert.equal(repositoryServiceTestUtils.canActorViewDocument(verifiedDocument, guest), true);
  assert.equal(repositoryServiceTestUtils.canActorViewDocument(draftDocument, guest), false);
  assert.equal(repositoryServiceTestUtils.canActorViewDocument(reviewDocument, guest), false);
});

test('ordinary user can view published documents and only own unpublished documents', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  const user = { id: 15, email: 'user@example.com', role: 'user' };
  const publishedDocument = { documentStatus: 'verified', meta: { creatorUserId: '77' } };
  const ownDraftDocument = { documentStatus: 'draft', meta: { creatorUserId: '15' } };
  const ownReviewDocument = { documentStatus: 'under_review', meta: { creatorEmail: 'user@example.com' } };
  const foreignDraftDocument = { documentStatus: 'draft', meta: { creatorUserId: '77' } };
  const foreignReviewDocument = { documentStatus: 'needs_revision', meta: { creatorEmail: 'other@example.com' } };

  assert.equal(repositoryServiceTestUtils.canActorViewDocument(publishedDocument, user), true);
  assert.equal(repositoryServiceTestUtils.canActorViewDocument(ownDraftDocument, user), true);
  assert.equal(repositoryServiceTestUtils.canActorViewDocument(ownReviewDocument, user), true);
  assert.equal(repositoryServiceTestUtils.canActorViewDocument(foreignDraftDocument, user), false);
  assert.equal(repositoryServiceTestUtils.canActorViewDocument(foreignReviewDocument, user), false);
});

test('admin can edit document on registration', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  assert.doesNotThrow(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в doesNotThrow внутри testCallback. */ () => {
    repositoryServiceTestUtils.ensureDocumentEditable(
      { document_status: 'under_review', meta: {} },
      { role: 'admin' },
      'редактировать'
    );
  });
});

test('repository citation is rebuilt with DOI', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  const meta = repositoryServiceTestUtils.synchronizeCitationLinks(
    {
      publicationDate: '2026-06-05',
      authors: 'Иванов Иван Иванович',
      authorsEn: 'Ivanov Ivan Ivanovich',
      titleEn: 'Test dataset',
      doi: '10.35540/gsras.rjs.2026.1.5',
    },
    'Тестовый документ'
  );

  assert.match(
    meta.citationLink,
    /DOI:\s10\.35540\/gsras\.rjs\.2026\.1\.5/
  );
  assert.match(
    meta.citationLinkEn,
    /https:\/\/doi\.org\/10\.35540\/gsras\.rjs\.2026\.1\.5/
  );
});

test('xml file name prefers english title over russian document name', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  assert.equal(
    repositoryServiceTestUtils.resolveXmlDocumentName(
      { titleEn: 'North Caucasus Earthquake Catalog 2024' },
      'Каталог землетрясений 2024'
    ),
    'North Caucasus Earthquake Catalog 2024'
  );

  assert.equal(
    repositoryServiceTestUtils.resolveXmlDocumentName(
      { titleEn: '   ' },
      'Каталог землетрясений 2024'
    ),
    'Каталог землетрясений 2024'
  );
});

test('editable document doi is recalculated from current metadata', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  const staleMeta = {
    publicationDate: '2026-06-05',
    journalCode: 'rjs',
    volume: '2',
    articleNumber: '05',
    doi: '10.35540/gsras.rjs.2026.1.1',
  };

  const nextDoi = repositoryServiceTestUtils.resolveEditableDocumentDoi('doc-1', 'Документ', staleMeta);
  assert.equal(nextDoi, '10.35540/gsras.rjs.2026.2.05');

  const defaultJournalDoi = repositoryServiceTestUtils.resolveEditableDocumentDoi('doc-1', 'Документ', {
    ...staleMeta,
    journalCode: '',
  });
  assert.equal(defaultJournalDoi, '10.35540/gsras.pub.2026.2.05');

  const incompleteDoi = repositoryServiceTestUtils.resolveEditableDocumentDoi('doc-1', 'Документ', {
    ...staleMeta,
    volume: '',
  });
  assert.equal(incompleteDoi, '');
});

test('duplicate doi receives incremental suffix', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  const uniqueDoi = repositoryServiceTestUtils.resolveUniqueDoiCandidate(
    '10.35540/gsras.rjs.2026.2.05',
    []
  );
  assert.equal(uniqueDoi, '10.35540/gsras.rjs.2026.2.05');

  const firstDuplicateDoi = repositoryServiceTestUtils.resolveUniqueDoiCandidate(
    '10.35540/gsras.rjs.2026.2.05',
    ['10.35540/gsras.rjs.2026.2.05']
  );
  assert.equal(firstDuplicateDoi, '10.35540/gsras.rjs.2026.2.05-01');

  const secondDuplicateDoi = repositoryServiceTestUtils.resolveUniqueDoiCandidate(
    '10.35540/gsras.rjs.2026.2.05',
    [
      '10.35540/gsras.rjs.2026.2.05',
      '10.35540/gsras.rjs.2026.2.05-01',
    ]
  );
  assert.equal(secondDuplicateDoi, '10.35540/gsras.rjs.2026.2.05-02');

  const skipsOccupiedSuffixes = repositoryServiceTestUtils.resolveUniqueDoiCandidate(
    '10.35540/gsras.rjs.2026.2.05',
    [
      '10.35540/gsras.rjs.2026.2.05',
      '10.35540/gsras.rjs.2026.2.05-01',
      '10.35540/gsras.rjs.2026.2.05-02',
      '10.35540/gsras.rjs.2026.2.05-04',
    ]
  );
  assert.equal(skipsOccupiedSuffixes, '10.35540/gsras.rjs.2026.2.05-03');
});

test('crossref confirmation email parser extracts successful doi registration', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  const parsed = repositoryServiceTestUtils.parseCrossrefConfirmationEmail(`<?xml version="1.0" encoding="UTF-8"?>
<doi_batch_diagnostic status="completed" sp="ip-10-4-2-147.ec2.internal">
  <submission_id>1751391204</submission_id>
  <batch_id>ESDB30992</batch_id>
  <record_diagnostic status="Success">
    <doi>10.35540/gsras.er.2026.1.25</doi>
    <msg>Successfully added</msg>
  </record_diagnostic>
</doi_batch_diagnostic>`);

  assert.equal(parsed.doi, '10.35540/gsras.er.2026.1.25');
  assert.equal(parsed.submissionId, '1751391204');
  assert.equal(parsed.batchId, 'ESDB30992');
  assert.equal(parsed.recordStatus, 'Success');
});

test('crossref confirmation email parser rejects non-successful response', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  assert.throws(
    /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в throws внутри testCallback. */ () => repositoryServiceTestUtils.parseCrossrefConfirmationEmail(`<?xml version="1.0" encoding="UTF-8"?>
<doi_batch_diagnostic status="completed">
  <record_diagnostic status="Failure">
    <doi>10.35540/gsras.er.2026.1.25</doi>
    <msg>Duplicate DOI found</msg>
  </record_diagnostic>
</doi_batch_diagnostic>`),
    /Crossref не подтвердил создание DOI/
  );
});

test('editable document xml refresh runs only when xml path and doi are available', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в test. */ () => {
  assert.equal(
    repositoryServiceTestUtils.shouldRefreshEditableDocumentXml({
      doi: '10.35540/gsras.rjs.2026.2.05',
      xmlPath: '/uploads/repository/2026/doc.xml',
    }),
    true
  );

  assert.equal(
    repositoryServiceTestUtils.shouldRefreshEditableDocumentXml({
      doi: '',
      xmlPath: '/uploads/repository/2026/doc.xml',
    }),
    false
  );

  assert.equal(
    repositoryServiceTestUtils.shouldRefreshEditableDocumentXml({
      doi: '10.35540/gsras.rjs.2026.2.05',
      xmlPath: '',
    }),
    false
  );
});
