import { gsrasContentService } from '../services/gsrasContentService.js';

/* Делает: Разбирает limit. Применение: используется локально в файле backend/controllers/gsrasAdminController.js. */
function parseLimit(rawValue, fallback = 250) {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/* Делает: Декодирует контент base64. Применение: используется локально в файле backend/controllers/gsrasAdminController.js. */
function decodeBase64Content(rawValue) {
  if (typeof rawValue !== 'string') {
    throw new Error('Не передано содержимое файла.');
  }

  return Buffer.from(rawValue, 'base64');
}

export class GsrasAdminController {
    /* Делает: Получает storage overview. Применение: используется внутри класса GsrasAdminController. */
  static async getStorageOverview(req, res) {
    try {
      const overview = await gsrasContentService.getOverview();
      return res.json(overview);
    } catch (error) {
      console.error('GS RAS admin get storage overview error:', error);
      return res.status(500).json({ message: 'Ошибка при получении состояния GS RAS storage' });
    }
  }

    /* Делает: Возвращает список файлы. Применение: используется внутри класса GsrasAdminController. */
  static async listFiles(req, res) {
    try {
      const scope = String(req.query.scope || '').trim();
      const prefix = String(req.query.prefix || '').trim();
      const limit = parseLimit(req.query.limit, 250);

      if (scope !== 'data' && scope !== 'site-assets') {
        return res.status(400).json({ message: 'Нужно указать scope=data или scope=site-assets' });
      }

      const files = await gsrasContentService.listFiles(scope, { prefix, limit });
      return res.json({ scope, files });
    } catch (error) {
      console.error('GS RAS admin list files error:', error);
      return res.status(400).json({ message: error.message || 'Ошибка при получении списка GS RAS файлов' });
    }
  }

    /* Делает: Выполняет файл загрузки. Применение: используется внутри класса GsrasAdminController. */
  static async uploadFile(req, res) {
    try {
      const scope = String(req.body?.scope || '').trim();
      const relativePath = String(req.body?.relativePath || '').trim();
      const contentBuffer = decodeBase64Content(req.body?.contentBase64);

      if (scope !== 'data' && scope !== 'site-assets') {
        return res.status(400).json({ message: 'Нужно указать scope=data или scope=site-assets' });
      }

      const result = await gsrasContentService.saveFile(scope, relativePath, contentBuffer);

      return res.status(201).json({
        message: 'GS RAS файл сохранен',
        file: result,
      });
    } catch (error) {
      console.error('GS RAS admin upload file error:', error);
      return res.status(400).json({ message: error.message || 'Ошибка при сохранении GS RAS файла' });
    }
  }

    /* Делает: Синхронизирует файлы базового. Применение: используется внутри класса GsrasAdminController. */
  static async syncDefaultFiles(req, res) {
    try {
      await gsrasContentService.syncDefaults();
      const overview = await gsrasContentService.getOverview();

      return res.json({
        message: 'Встроенные файлы GS RAS синхронизированы',
        overview,
      });
    } catch (error) {
      console.error('GS RAS admin sync defaults error:', error);
      return res.status(500).json({ message: error.message || 'Ошибка при синхронизации встроенных GS RAS файлов' });
    }
  }
}
