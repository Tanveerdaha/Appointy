import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

/**
 * Migration basenames on disk (same names sequelize-cli stores in SequelizeMeta.name).
 */
export const listMigrationFiles = (migrationsDir = MIGRATIONS_DIR) => {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.cjs') || name.endsWith('.js'))
    .sort();
};

const isMissingMetaTableError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  const code = error?.original?.code || error?.parent?.code;
  return (
    code === 'ER_NO_SUCH_TABLE' ||
    message.includes('no such table') ||
    message.includes("doesn't exist") ||
    message.includes('does not exist') ||
    message.includes('unknown table')
  );
};

/**
 * Returns migration filenames that exist on disk but are not in SequelizeMeta.
 * If SequelizeMeta is missing, all on-disk migrations are treated as pending.
 */
export const getPendingMigrations = async (
  sequelize,
  migrationsDir = MIGRATIONS_DIR
) => {
  const files = listMigrationFiles(migrationsDir);
  if (files.length === 0) {
    return [];
  }

  let applied = [];
  try {
    const [rows] = await sequelize.query(
      'SELECT name FROM `SequelizeMeta` ORDER BY name'
    );
    applied = rows.map((row) => row.name);
  } catch (error) {
    if (isMissingMetaTableError(error)) {
      return files;
    }
    throw error;
  }

  const appliedSet = new Set(applied);
  return files.filter((name) => !appliedSet.has(name));
};

/**
 * Throws if any migration file has not been recorded in SequelizeMeta.
 */
export const assertNoPendingMigrations = async (
  sequelize,
  migrationsDir = MIGRATIONS_DIR
) => {
  const pending = await getPendingMigrations(sequelize, migrationsDir);
  if (pending.length === 0) {
    return;
  }

  throw new Error(
    `Pending database migrations (${pending.length}): ${pending.join(', ')}. ` +
      'Run `npm run db:migrate` before starting the server.'
  );
};
