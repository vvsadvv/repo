import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import repositoryRoutes from './routes/repositoryRoutes.js';
import repositoryAuthRoutes from './routes/repositoryAuthRoutes.js';
import repositoryAdminRoutes from './routes/repositoryAdminRoutes.js';
import repositoryReferenceRoutes from './routes/repositoryReferenceRoutes.js';
import { initializeAuthDatabase } from './models/authDatabase.js';
import { initializeRepositoryDatabase } from './models/repositoryDatabase.js';
import { repositoryService } from './services/repositoryService.js';
import { getEmailService } from './services/emailService.js';
import { crossrefMailboxService } from './services/crossrefMailboxService.js';
import { gsrasContentService } from './services/gsrasContentService.js';

const app = express();
const PORT = Number(process.env.PORT || 3005);
const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const isDev = process.env.NODE_ENV !== 'production';
const uploadsDir = process.env.REPOSITORY_UPLOADS_DIR
  ? path.resolve(process.env.REPOSITORY_UPLOADS_DIR)
  : path.join(currentDir, 'uploads');
const repositoryXmlDir = process.env.REPOSITORY_XML_DIR
  ? path.resolve(process.env.REPOSITORY_XML_DIR)
  : path.join(uploadsDir, 'repository', 'xml');
const configuredOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map. */ (origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: isDev ? ['http://localhost:5174'] : configuredOrigins.length > 0 ? configuredOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use('/uploads/repository/xml', express.static(repositoryXmlDir));
app.use('/uploads', express.static(uploadsDir));
app.use('/api/gsras/data', express.static(gsrasContentService.getPublicDirectories().dataDir));
app.use('/api/gsras/site-assets', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в use. */ async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  const relativePath = String(req.path || '').replace(/^\/+/, '');

  if (!relativePath) {
    return next();
  }

  try {
    await gsrasContentService.ensureSiteAssetAvailable(relativePath);
  } catch (error) {
    console.warn('GS RAS asset availability check failed:', error.message);
  }

  return next();
});
app.use('/api/gsras/site-assets', express.static(gsrasContentService.getPublicDirectories().siteAssetsDir));

app.use('/api/repository-auth', repositoryAuthRoutes);
app.use('/api/repository-admin', repositoryAdminRoutes);
app.use('/api/repository-reference', repositoryReferenceRoutes);
app.use('/api', repositoryRoutes);

app.get('/api/health', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в get. */ (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use('*', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в use. */ (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в use. */ (err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    message: 'Internal Server Error',
    details: isDev ? err.message : undefined,
  });
});

let server = null;

/* Делает: Выполняет start server. Применение: используется локально в файле backend/server.js. */
async function startServer() {
  try {
    await initializeAuthDatabase();
    await initializeRepositoryDatabase();
    await repositoryService.migrateJsonRepositoryIfNeeded();
    await gsrasContentService.ensureStorageReady();

    try {
      await getEmailService();
      console.log('Repo email service is active');
    } catch (error) {
      console.warn('Repo email service unavailable at startup, will retry on demand:', error.message);
    }

    try {
      await crossrefMailboxService.start();
    } catch (error) {
      console.warn('Crossref POP3 watcher unavailable at startup, will stay disabled:', error.message);
    }

    server = app.listen(PORT, /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в listen внутри startServer. */ () => {
      console.log(`Repo backend started: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Critical startup error:', error);
    process.exit(1);
  }
}

/* Делает: Выполняет shutdown. Применение: используется локально в файле backend/server.js. */
async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down Repo backend...`);

  try {
    await crossrefMailboxService.stop();
  } catch (error) {
    console.warn('Crossref POP3 watcher shutdown warning:', error.message);
  }

  if (!server) {
    process.exit(0);
  }
  server.close(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в close внутри shutdown. */ () => process.exit(0));
}

process.on('SIGINT', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в on. */ () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в on. */ () => {
  void shutdown('SIGTERM');
});

void startServer();
