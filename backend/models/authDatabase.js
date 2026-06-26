import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

const authConfig = {
  user: process.env.REPO_AUTH_DB_USER || 'postgres',
  host: process.env.REPO_AUTH_DB_HOST || 'localhost',
  database: process.env.REPO_AUTH_DB_NAME || 'repo_auth_system',
  password: process.env.REPO_AUTH_DB_PASSWORD || 'password',
  port: parseInt(process.env.REPO_AUTH_DB_PORT || '5432', 10),
};

const authPool = new Pool(authConfig);

/* Делает: Получает repository personal draft primary key columns. Применение: используется локально в файле backend/models/authDatabase.js. */
async function getRepositoryPersonalDraftPrimaryKeyColumns(client) {
  const { rows } = await client.query(`
    SELECT attribute.attname
    FROM pg_constraint constraint_info
    JOIN pg_class table_info
      ON table_info.oid = constraint_info.conrelid
    JOIN pg_namespace schema_info
      ON schema_info.oid = table_info.relnamespace
    JOIN unnest(constraint_info.conkey) WITH ORDINALITY AS key_columns(attnum, ordinality)
      ON TRUE
    JOIN pg_attribute attribute
      ON attribute.attrelid = table_info.oid
     AND attribute.attnum = key_columns.attnum
    WHERE constraint_info.contype = 'p'
      AND schema_info.nspname = current_schema()
      AND table_info.relname = 'repository_personal_drafts'
    ORDER BY key_columns.ordinality
  `);

  return rows.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getRepositoryPersonalDraftPrimaryKeyColumns. */ (row) => String(row.attname || ''));
}

/* Делает: Гарантирует ключ репозиторного персонального черновиков основного. Применение: используется локально в файле backend/models/authDatabase.js. */
async function ensureRepositoryPersonalDraftsPrimaryKey(client) {
  await client.query(`
    DELETE FROM repository_personal_drafts drafts
    USING (
      SELECT ctid
      FROM (
        SELECT ctid,
               ROW_NUMBER() OVER (
                 PARTITION BY document_id
                 ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, user_id ASC
               ) AS row_number
        FROM repository_personal_drafts
      ) duplicates
      WHERE duplicates.row_number > 1
    ) duplicates_to_delete
    WHERE drafts.ctid = duplicates_to_delete.ctid;
  `);

  const primaryKeyColumns = await getRepositoryPersonalDraftPrimaryKeyColumns(client);
  if (primaryKeyColumns.length === 1 && primaryKeyColumns[0] === 'document_id') {
    return;
  }

  await client.query(`ALTER TABLE repository_personal_drafts DROP CONSTRAINT IF EXISTS repository_personal_drafts_pkey;`);
  await client.query(`ALTER TABLE repository_personal_drafts ADD CONSTRAINT repository_personal_drafts_pkey PRIMARY KEY (document_id);`);
}

/* Делает: Гарантирует auth database exists. Применение: используется локально в файле backend/models/authDatabase.js. */
async function ensureAuthDatabaseExists() {
  const adminPool = new Pool({
    user: authConfig.user,
    host: authConfig.host,
    database: process.env.REPO_AUTH_DB_ADMIN_DB || 'postgres',
    password: authConfig.password,
    port: authConfig.port,
  });

  try {
    const { rows } = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [authConfig.database]);
    if (rows.length === 0) {
      await adminPool.query(`CREATE DATABASE "${authConfig.database.replace(/"/g, '""')}"`);
    }
  } finally {
    await adminPool.end();
  }
}

/* Делает: Выполняет базу данных initialize авторизационного. Применение: используется локально в файле backend/models/authDatabase.js. */
export async function initializeAuthDatabase() {
  await ensureAuthDatabaseExists();

  const defaultOrganization = process.env.REPOSITORY_DEFAULT_ORGANIZATION || 'ФИЦ ЕГС РАН';
  const defaultOrganizationFullRu =
    process.env.REPOSITORY_DEFAULT_ORGANIZATION_FULL_RU ||
    'Федеральный исследовательский центр Единая геофизическая служба Российской академии наук';
  const defaultOrganizationFullEn =
    process.env.REPOSITORY_DEFAULT_ORGANIZATION_FULL_EN ||
    'Geophysical Survey of the Russian Academy of Sciences';

  await authPool.query(`
    CREATE TABLE IF NOT EXISTS RepositoryUsers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      full_name VARCHAR(255),
      email VARCHAR(255) NOT NULL UNIQUE,
      organization VARCHAR(255),
      organization_id INTEGER,
      position VARCHAR(255),
      personal_data_consent BOOLEAN NOT NULL DEFAULT FALSE,
      personal_data_consent_at TIMESTAMP,
      password VARCHAR(255) NOT NULL,
      password_changed_at TIMESTAMP,
      role VARCHAR(20) NOT NULL DEFAULT 'user',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      approved_by INTEGER,
      approved_at TIMESTAMP,
      FOREIGN KEY (approved_by) REFERENCES RepositoryUsers(id),
      CONSTRAINT repository_users_role_check CHECK (role IN ('admin', 'editor', 'user')),
      CONSTRAINT repository_users_status_check CHECK (status IN ('pending', 'active', 'blocked'))
    );
  `);

  await authPool.query(`ALTER TABLE RepositoryUsers ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);`);
  await authPool.query(`ALTER TABLE RepositoryUsers ADD COLUMN IF NOT EXISTS organization_id INTEGER;`);
  await authPool.query(`ALTER TABLE RepositoryUsers ADD COLUMN IF NOT EXISTS position VARCHAR(255);`);
  await authPool.query(`ALTER TABLE RepositoryUsers ADD COLUMN IF NOT EXISTS personal_data_consent BOOLEAN NOT NULL DEFAULT FALSE;`);
  await authPool.query(`ALTER TABLE RepositoryUsers ADD COLUMN IF NOT EXISTS personal_data_consent_at TIMESTAMP;`);
  await authPool.query(`ALTER TABLE RepositoryUsers ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP;`);
  await authPool.query(`ALTER TABLE RepositoryUsers ALTER COLUMN role SET DEFAULT 'user';`);
  await authPool.query(`ALTER TABLE RepositoryUsers ALTER COLUMN status SET DEFAULT 'active';`);
  await authPool.query(`ALTER TABLE RepositoryUsers DROP CONSTRAINT IF EXISTS repository_users_role_check;`);
  await authPool.query(`
    ALTER TABLE RepositoryUsers
    ADD CONSTRAINT repository_users_role_check
    CHECK (role IN ('admin', 'editor', 'user'));
  `);

  await authPool.query(`
    CREATE TABLE IF NOT EXISTS RepositoryPasswordResetTokens (
      id SERIAL PRIMARY KEY,
      repository_user_id INTEGER NOT NULL,
      token VARCHAR(255) NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (repository_user_id) REFERENCES RepositoryUsers(id) ON DELETE CASCADE
    );
  `);

  await authPool.query(`
    CREATE INDEX IF NOT EXISTS repository_password_reset_user_idx
    ON RepositoryPasswordResetTokens (repository_user_id, expires_at);
  `);

  await authPool.query(`
    CREATE TABLE IF NOT EXISTS RepositoryUserProfileUpdateRequests (
      id SERIAL PRIMARY KEY,
      repository_user_id INTEGER NOT NULL,
      requested_changes JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      admin_comment TEXT,
      reviewed_by INTEGER,
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (repository_user_id) REFERENCES RepositoryUsers(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES RepositoryUsers(id) ON DELETE SET NULL,
      CONSTRAINT repository_user_profile_update_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
    );
  `);
  await authPool.query(`ALTER TABLE RepositoryUserProfileUpdateRequests ADD COLUMN IF NOT EXISTS requested_changes JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await authPool.query(`ALTER TABLE RepositoryUserProfileUpdateRequests ADD COLUMN IF NOT EXISTS admin_comment TEXT;`);
  await authPool.query(`ALTER TABLE RepositoryUserProfileUpdateRequests ADD COLUMN IF NOT EXISTS reviewed_by INTEGER;`);
  await authPool.query(`ALTER TABLE RepositoryUserProfileUpdateRequests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;`);
  await authPool.query(`ALTER TABLE RepositoryUserProfileUpdateRequests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
  await authPool.query(`ALTER TABLE RepositoryUserProfileUpdateRequests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
  await authPool.query(`ALTER TABLE RepositoryUserProfileUpdateRequests DROP CONSTRAINT IF EXISTS repository_user_profile_update_requests_status_check;`);
  await authPool.query(`
    UPDATE RepositoryUserProfileUpdateRequests
    SET status = 'pending'
    WHERE status IS NULL OR status NOT IN ('pending', 'approved', 'rejected');
  `);
  await authPool.query(`
    ALTER TABLE RepositoryUserProfileUpdateRequests
    ADD CONSTRAINT repository_user_profile_update_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'));
  `);
  await authPool.query(`
    CREATE INDEX IF NOT EXISTS repository_user_profile_update_requests_status_idx
    ON RepositoryUserProfileUpdateRequests (status, created_at DESC);
  `);
  await authPool.query(`
    CREATE INDEX IF NOT EXISTS repository_user_profile_update_requests_user_idx
    ON RepositoryUserProfileUpdateRequests (repository_user_id, created_at DESC);
  `);
  await authPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS repository_user_profile_update_requests_pending_user_unique_idx
    ON RepositoryUserProfileUpdateRequests (repository_user_id)
    WHERE status = 'pending';
  `);

  await authPool.query(`
    CREATE TABLE IF NOT EXISTS RepositoryOrganizations (
      id SERIAL PRIMARY KEY,
      name_ru VARCHAR(255) NOT NULL,
      name_en VARCHAR(255),
      full_name_ru TEXT,
      full_name_en TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'approved',
      requested_by_user_id INTEGER,
      requester_name VARCHAR(255),
      requester_email VARCHAR(255),
      approved_by INTEGER,
      approved_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (requested_by_user_id) REFERENCES RepositoryUsers(id) ON DELETE SET NULL,
      FOREIGN KEY (approved_by) REFERENCES RepositoryUsers(id) ON DELETE SET NULL,
      CONSTRAINT repository_organizations_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
    );
  `);

  await authPool.query(`ALTER TABLE RepositoryOrganizations ADD COLUMN IF NOT EXISTS name_en VARCHAR(255);`);
  await authPool.query(`ALTER TABLE RepositoryOrganizations ADD COLUMN IF NOT EXISTS full_name_ru TEXT;`);
  await authPool.query(`ALTER TABLE RepositoryOrganizations ADD COLUMN IF NOT EXISTS full_name_en TEXT;`);
  await authPool.query(`ALTER TABLE RepositoryOrganizations ALTER COLUMN full_name_ru TYPE TEXT;`);
  await authPool.query(`ALTER TABLE RepositoryOrganizations ALTER COLUMN full_name_en TYPE TEXT;`);
  await authPool.query(`ALTER TABLE RepositoryOrganizations ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved';`);
  await authPool.query(`ALTER TABLE RepositoryOrganizations ADD COLUMN IF NOT EXISTS requested_by_user_id INTEGER;`);
  await authPool.query(`ALTER TABLE RepositoryOrganizations ADD COLUMN IF NOT EXISTS requester_name VARCHAR(255);`);
  await authPool.query(`ALTER TABLE RepositoryOrganizations ADD COLUMN IF NOT EXISTS requester_email VARCHAR(255);`);
  await authPool.query(`ALTER TABLE RepositoryOrganizations ADD COLUMN IF NOT EXISTS approved_by INTEGER;`);
  await authPool.query(`ALTER TABLE RepositoryOrganizations ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;`);
  await authPool.query(`ALTER TABLE RepositoryOrganizations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
  await authPool.query(`ALTER TABLE RepositoryOrganizations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
  await authPool.query(`
    UPDATE RepositoryOrganizations
    SET status = 'approved'
    WHERE status IS NULL OR status NOT IN ('pending', 'approved', 'rejected');
  `);
  await authPool.query(`ALTER TABLE RepositoryOrganizations DROP CONSTRAINT IF EXISTS repository_organizations_status_check;`);
  await authPool.query(`
    ALTER TABLE RepositoryOrganizations
    ADD CONSTRAINT repository_organizations_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'));
  `);

  await authPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS repository_organizations_name_ru_unique_idx
    ON RepositoryOrganizations (LOWER(name_ru));
  `);
  await authPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS repository_organizations_name_en_unique_idx
    ON RepositoryOrganizations (LOWER(name_en))
    WHERE name_en IS NOT NULL AND name_en <> '';
  `);

  await authPool.query(`
    CREATE TABLE IF NOT EXISTS RepositoryAuthors (
      id SERIAL PRIMARY KEY,
      name_ru VARCHAR(255) NOT NULL,
      name_en VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'approved',
      requested_by_user_id INTEGER,
      requester_name VARCHAR(255),
      requester_email VARCHAR(255),
      approved_by INTEGER,
      approved_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (requested_by_user_id) REFERENCES RepositoryUsers(id) ON DELETE SET NULL,
      FOREIGN KEY (approved_by) REFERENCES RepositoryUsers(id) ON DELETE SET NULL,
      CONSTRAINT repository_authors_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
    );
  `);

  await authPool.query(`ALTER TABLE RepositoryAuthors ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved';`);
  await authPool.query(`ALTER TABLE RepositoryAuthors ADD COLUMN IF NOT EXISTS requested_by_user_id INTEGER;`);
  await authPool.query(`ALTER TABLE RepositoryAuthors ADD COLUMN IF NOT EXISTS requester_name VARCHAR(255);`);
  await authPool.query(`ALTER TABLE RepositoryAuthors ADD COLUMN IF NOT EXISTS requester_email VARCHAR(255);`);
  await authPool.query(`ALTER TABLE RepositoryAuthors ADD COLUMN IF NOT EXISTS approved_by INTEGER;`);
  await authPool.query(`ALTER TABLE RepositoryAuthors ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;`);
  await authPool.query(`ALTER TABLE RepositoryAuthors ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
  await authPool.query(`ALTER TABLE RepositoryAuthors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
  await authPool.query(`
    UPDATE RepositoryAuthors
    SET status = 'approved'
    WHERE status IS NULL OR status NOT IN ('pending', 'approved', 'rejected');
  `);
  await authPool.query(`ALTER TABLE RepositoryAuthors DROP CONSTRAINT IF EXISTS repository_authors_status_check;`);
  await authPool.query(`
    ALTER TABLE RepositoryAuthors
    ADD CONSTRAINT repository_authors_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'));
  `);

  await authPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS repository_authors_name_pair_unique_idx
    ON RepositoryAuthors (LOWER(name_ru), LOWER(name_en));
  `);

  await authPool.query(`
    CREATE TABLE IF NOT EXISTS RepositoryAuthorOrganizations (
      id SERIAL PRIMARY KEY,
      author_id INTEGER NOT NULL,
      organization_id INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'approved',
      requested_by_user_id INTEGER,
      approved_by INTEGER,
      approved_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES RepositoryAuthors(id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id) REFERENCES RepositoryOrganizations(id) ON DELETE CASCADE,
      FOREIGN KEY (requested_by_user_id) REFERENCES RepositoryUsers(id) ON DELETE SET NULL,
      FOREIGN KEY (approved_by) REFERENCES RepositoryUsers(id) ON DELETE SET NULL,
      CONSTRAINT repository_author_organizations_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
      CONSTRAINT repository_author_organizations_unique UNIQUE (author_id, organization_id)
    );
  `);

  await authPool.query(`ALTER TABLE RepositoryAuthorOrganizations ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved';`);
  await authPool.query(`ALTER TABLE RepositoryAuthorOrganizations ADD COLUMN IF NOT EXISTS requested_by_user_id INTEGER;`);
  await authPool.query(`ALTER TABLE RepositoryAuthorOrganizations ADD COLUMN IF NOT EXISTS approved_by INTEGER;`);
  await authPool.query(`ALTER TABLE RepositoryAuthorOrganizations ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;`);
  await authPool.query(`ALTER TABLE RepositoryAuthorOrganizations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
  await authPool.query(`ALTER TABLE RepositoryAuthorOrganizations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
  await authPool.query(`
    UPDATE RepositoryAuthorOrganizations
    SET status = 'approved'
    WHERE status IS NULL OR status NOT IN ('pending', 'approved', 'rejected');
  `);
  await authPool.query(`ALTER TABLE RepositoryAuthorOrganizations DROP CONSTRAINT IF EXISTS repository_author_organizations_status_check;`);
  await authPool.query(`
    ALTER TABLE RepositoryAuthorOrganizations
    ADD CONSTRAINT repository_author_organizations_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'));
  `);
  await authPool.query(`
    DELETE FROM RepositoryAuthorOrganizations link
    USING (
      SELECT id
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY author_id, organization_id
                 ORDER BY
                   CASE status
                     WHEN 'approved' THEN 0
                     WHEN 'pending' THEN 1
                     ELSE 2
                   END,
                   id ASC
               ) AS row_number
        FROM RepositoryAuthorOrganizations
      ) duplicates
      WHERE duplicates.row_number > 1
    ) duplicates_to_delete
    WHERE link.id = duplicates_to_delete.id;
  `);
  await authPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS repository_author_organizations_author_organization_unique_idx
    ON RepositoryAuthorOrganizations (author_id, organization_id);
  `);

  await authPool.query(`
    CREATE TABLE IF NOT EXISTS repository_personal_drafts (
      user_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
      document_status VARCHAR(32) NOT NULL DEFAULT 'draft',
      review_requested_at TIMESTAMP,
      verified_at TIMESTAMP,
      source_updated_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (document_id),
      CONSTRAINT repository_personal_drafts_document_status_check
        CHECK (document_status IN ('draft', 'needs_revision', 'under_review', 'verified'))
    );
  `);

  await authPool.query(`ALTER TABLE repository_personal_drafts ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMP;`);
  await authPool.query(`ALTER TABLE repository_personal_drafts ADD COLUMN IF NOT EXISTS document_status VARCHAR(32) NOT NULL DEFAULT 'draft';`);
  await authPool.query(`ALTER TABLE repository_personal_drafts ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMP;`);
  await authPool.query(`ALTER TABLE repository_personal_drafts ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;`);
  await authPool.query(`ALTER TABLE repository_personal_drafts ALTER COLUMN user_id TYPE TEXT USING user_id::text;`);
  await authPool.query(`ALTER TABLE repository_personal_drafts DROP CONSTRAINT IF EXISTS repository_personal_drafts_document_status_check;`);
  await authPool.query(`
    UPDATE repository_personal_drafts
    SET document_status = 'draft'
    WHERE document_status IS NULL
       OR document_status NOT IN ('draft', 'needs_revision', 'under_review', 'verified');
  `);
  await authPool.query(`
    ALTER TABLE repository_personal_drafts
    ADD CONSTRAINT repository_personal_drafts_document_status_check
    CHECK (document_status IN ('draft', 'needs_revision', 'under_review', 'verified'));
  `);
  await ensureRepositoryPersonalDraftsPrimaryKey(authPool);
  await authPool.query(`DROP INDEX IF EXISTS repository_personal_drafts_document_idx;`);
  await authPool.query(`
    CREATE INDEX IF NOT EXISTS repository_personal_drafts_user_idx
    ON repository_personal_drafts(user_id, updated_at DESC);
  `);
  await authPool.query(`
    CREATE INDEX IF NOT EXISTS repository_personal_drafts_status_idx
    ON repository_personal_drafts(document_status, updated_at DESC);
  `);

  await authPool.query(`
    INSERT INTO RepositoryOrganizations (name_ru, name_en, full_name_ru, full_name_en, status, approved_at)
    SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, 'approved', CURRENT_TIMESTAMP
    WHERE NOT EXISTS (
      SELECT 1
      FROM RepositoryOrganizations
      WHERE LOWER(name_ru) = LOWER($1::varchar)
    );
  `, [
    defaultOrganization,
    defaultOrganization,
    defaultOrganizationFullRu,
    defaultOrganizationFullEn,
  ]);

  await authPool.query(`
    UPDATE RepositoryOrganizations
    SET full_name_ru = COALESCE(NULLIF(full_name_ru, ''), $2::varchar),
        full_name_en = COALESCE(NULLIF(full_name_en, ''), $3::varchar),
        updated_at = CURRENT_TIMESTAMP
    WHERE LOWER(name_ru) = LOWER($1::varchar);
  `, [defaultOrganization, defaultOrganizationFullRu, defaultOrganizationFullEn]);

  await authPool.query(`
    UPDATE RepositoryUsers ru
    SET organization_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE ru.organization_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM RepositoryOrganizations ro
        WHERE ro.id = ru.organization_id
      );
  `);

  await authPool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'repository_users_organization_id_fkey'
      ) THEN
        ALTER TABLE RepositoryUsers
        ADD CONSTRAINT repository_users_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES RepositoryOrganizations(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await authPool.query(`
    CREATE INDEX IF NOT EXISTS repository_users_organization_id_idx
    ON RepositoryUsers (organization_id);
  `);

  await authPool.query(`
    UPDATE RepositoryUsers ru
    SET organization_id = ro.id,
        organization = ro.name_ru,
        updated_at = CURRENT_TIMESTAMP
    FROM RepositoryOrganizations ro
    WHERE ru.organization_id IS NULL
      AND ru.organization IS NOT NULL
      AND ru.organization <> ''
      AND (
        LOWER(ru.organization) = LOWER(ro.name_ru)
        OR LOWER(ru.organization) = LOWER(COALESCE(ro.name_en, ''))
        OR LOWER(ru.organization) = LOWER(COALESCE(ro.full_name_ru, ''))
        OR LOWER(ru.organization) = LOWER(COALESCE(ro.full_name_en, ''))
      );
  `);
}

export { authPool };
