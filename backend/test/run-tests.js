import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const backendDir = path.resolve(currentDir, '..');

const testFilePattern = /\.(test|spec)\.js$/i;
const ignoredDirs = new Set(['node_modules', 'dist']);

async function collectTestFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        files.push(...(await collectTestFiles(fullPath)));
      }
      continue;
    }

    if (testFilePattern.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

const testFiles = (await collectTestFiles(backendDir))
  .filter((filePath) => filePath !== currentFilePath)
  .sort((left, right) => left.localeCompare(right));

if (testFiles.length === 0) {
  console.warn('No backend test files found.');
} else {
  for (const testFile of testFiles) {
    await import(pathToFileURL(testFile).href);
  }
}

