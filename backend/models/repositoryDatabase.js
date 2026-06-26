import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const repositoryConfig = {
  user: process.env.REPOSITORY_DB_USER || process.env.DB_USER || 'postgres',
  host: process.env.REPOSITORY_DB_HOST || process.env.DB_HOST || 'localhost',
  database: process.env.REPOSITORY_DB_NAME || 'repository_system',
  password: process.env.REPOSITORY_DB_PASSWORD || process.env.DB_PASSWORD || 'password',
  port: parseInt(process.env.REPOSITORY_DB_PORT || process.env.DB_PORT || '5432', 10),
};

const repositoryPool = new Pool(repositoryConfig);

/* Делает: Проверяет наличие repository column. Применение: используется локально в файле backend/models/repositoryDatabase.js. */
async function hasRepositoryColumn(client, columnName) {
  const { rows } = await client.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'repository_nodes'
        AND column_name = $1
      LIMIT 1
    `,
    [columnName]
  );

  return rows.length > 0;
}

/* Делает: Гарантирует repository database exists. Применение: используется локально в файле backend/models/repositoryDatabase.js. */
async function ensureRepositoryDatabaseExists() {
  const adminPool = new Pool({
    user: repositoryConfig.user,
    host: repositoryConfig.host,
    database: process.env.REPOSITORY_DB_ADMIN_DB || 'postgres',
    password: repositoryConfig.password,
    port: repositoryConfig.port,
  });

  try {
    const { rows } = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [repositoryConfig.database]);
    if (rows.length === 0) {
      await adminPool.query(`CREATE DATABASE "${repositoryConfig.database.replace(/"/g, '""')}"`);
    }
  } finally {
    await adminPool.end();
  }
}

/* Делает: Выполняет базу данных initialize репозиторного. Применение: используется локально в файле backend/models/repositoryDatabase.js. */
async function initializeRepositoryDatabase() {
  await ensureRepositoryDatabaseExists();

  await repositoryPool.query(`
    CREATE TABLE IF NOT EXISTS repository_nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      meta JSONB,
      info JSONB NOT NULL DEFAULT '{}'::jsonb,
      document_type TEXT,
      doi TEXT,
      xml_path TEXT,
      document_status VARCHAR(32) NOT NULL DEFAULT 'draft',
      review_requested_at TIMESTAMP,
      verified_at TIMESTAMP,
      blocks JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS info JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await repositoryPool.query(`UPDATE repository_nodes SET info = '{}'::jsonb WHERE info IS NULL`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ALTER COLUMN info SET DEFAULT '{}'::jsonb`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ALTER COLUMN info SET NOT NULL`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS document_type TEXT`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS doi TEXT`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS xml_path TEXT`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS document_status VARCHAR(32) NOT NULL DEFAULT 'draft'`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ALTER COLUMN document_status SET DEFAULT 'draft'`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMP`);
  await repositoryPool.query(`ALTER TABLE repository_nodes ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP`);

  await repositoryPool.query(`ALTER TABLE repository_nodes DROP CONSTRAINT IF EXISTS repository_nodes_document_status_check`);

  const client = await repositoryPool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`DROP INDEX IF EXISTS repository_nodes_parent_idx`);

    const hasType = await hasRepositoryColumn(client, 'type');
    if (hasType) {
      await client.query(`DELETE FROM repository_nodes WHERE type IS DISTINCT FROM 'document'`);
    }

    await client.query(`DELETE FROM repository_nodes WHERE id = 'root'`);

    if (await hasRepositoryColumn(client, 'parent_id')) {
      await client.query(`ALTER TABLE repository_nodes DROP COLUMN parent_id`);
    }

    if (await hasRepositoryColumn(client, 'sort_order')) {
      await client.query(`ALTER TABLE repository_nodes DROP COLUMN sort_order`);
    }

    if (hasType) {
      await client.query(`ALTER TABLE repository_nodes DROP COLUMN type`);
    }

    await client.query(`
      UPDATE repository_nodes
      SET info = COALESCE(info, '{}'::jsonb) || jsonb_build_object(
        'creatorName', COALESCE(NULLIF(info ->> 'creatorName', ''), meta ->> 'creatorName', ''),
        'creatorEmail', COALESCE(NULLIF(info ->> 'creatorEmail', ''), meta ->> 'creatorEmail', ''),
        'reviewEditorName', COALESCE(NULLIF(info ->> 'reviewEditorName', ''), meta ->> 'reviewEditorName', ''),
        'reviewEditorEmail', COALESCE(NULLIF(info ->> 'reviewEditorEmail', ''), meta ->> 'reviewEditorEmail', ''),
        'revisionComment', COALESCE(NULLIF(info ->> 'revisionComment', ''), meta ->> 'revisionComment', ''),
        'revisionCommentAuthor', COALESCE(NULLIF(info ->> 'revisionCommentAuthor', ''), meta ->> 'revisionCommentAuthor', ''),
        'revisionCommentUpdatedAt', COALESCE(NULLIF(info ->> 'revisionCommentUpdatedAt', ''), meta ->> 'revisionCommentUpdatedAt', '')
      ),
          meta = COALESCE(meta, '{}'::jsonb)
            - 'creatorName'
            - 'creatorEmail'
            - 'reviewEditorName'
            - 'reviewEditorEmail'
            - 'revisionComment'
            - 'revisionCommentAuthor'
            - 'revisionCommentUpdatedAt'
    `);

    await client.query(`
      UPDATE repository_nodes
      SET document_type = COALESCE(NULLIF(document_type, ''), meta ->> 'documentType', '')
    `);

    await client.query(`
      UPDATE repository_nodes
      SET doi = COALESCE(NULLIF(doi, ''), meta ->> 'doi', '')
    `);

    await client.query(`
      UPDATE repository_nodes
      SET xml_path = COALESCE(NULLIF(xml_path, ''), meta ->> 'xmlPath', '')
    `);

    await client.query(`
      UPDATE repository_nodes
      SET document_status = CASE
        WHEN document_status IN ('draft', 'needs_revision', 'under_review', 'verified') THEN document_status
        ELSE 'draft'
      END
    `);

    await client.query(`
      ALTER TABLE repository_nodes
      ADD CONSTRAINT repository_nodes_document_status_check
      CHECK (document_status IN ('draft', 'needs_revision', 'under_review', 'verified'))
    `);

    await client.query(`DROP INDEX IF EXISTS repository_nodes_document_status_idx`);
    await client.query(`
      CREATE INDEX repository_nodes_document_status_idx
      ON repository_nodes(document_status, updated_at DESC);
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export { repositoryPool, initializeRepositoryDatabase };
