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

export async function initializeAuthDatabase() {
  await ensureAuthDatabaseExists();

  const defaultOrganization = process.env.REPOSITORY_DEFAULT_ORGANIZATION || 'ФИЦ ЕГС РАН';

  await authPool.query(`
    CREATE TABLE IF NOT EXISTS RepositoryUsers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      full_name VARCHAR(255),
      email VARCHAR(255) NOT NULL UNIQUE,
      organization VARCHAR(255),
      position VARCHAR(255),
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
  await authPool.query(`ALTER TABLE RepositoryUsers ADD COLUMN IF NOT EXISTS position VARCHAR(255);`);
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
    CREATE TABLE IF NOT EXISTS RepositoryOrganizations (
      id SERIAL PRIMARY KEY,
      name_ru VARCHAR(255) NOT NULL,
      name_en VARCHAR(255),
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

  await authPool.query(`
    INSERT INTO RepositoryOrganizations (name_ru, name_en, status, approved_at)
    SELECT $1::varchar, $2::varchar, 'approved', CURRENT_TIMESTAMP
    WHERE NOT EXISTS (
      SELECT 1
      FROM RepositoryOrganizations
      WHERE LOWER(name_ru) = LOWER($1::varchar)
    );
  `, [defaultOrganization, defaultOrganization]);
}

export { authPool };
