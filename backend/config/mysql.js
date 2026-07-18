import { Sequelize } from 'sequelize';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dialect = (process.env.DB_DIALECT || 'mysql').toLowerCase();
const isTest = process.env.NODE_ENV === 'test';

// SQLite is only for automated tests; runtime/default is MySQL.
if (dialect === 'sqlite' && !isTest) {
  console.warn(
    'DB_DIALECT=sqlite is intended for tests only. Prefer mysql for local/Docker/production.'
  );
}

const sequelize =
  dialect === 'mysql'
    ? new Sequelize(
        process.env.MYSQL_DB || 'appointy',
        process.env.MYSQL_USER || 'root',
        process.env.MYSQL_PASSWORD || '',
        {
          host: process.env.MYSQL_HOST || 'localhost',
          port: process.env.MYSQL_PORT || 3306,
          dialect: 'mysql',
          logging: false,
          pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000,
          },
        }
      )
    : new Sequelize({
        dialect: 'sqlite',
        storage:
          process.env.SQLITE_STORAGE ||
          path.join(__dirname, '..', 'data', 'appointy.sqlite'),
        logging: false,
        pool: { max: 1, min: 0, idle: 10000 },
        retry: { max: 3 },
      });

export const connectDB = async () => {
  try {
    await sequelize.authenticate();
    if (dialect === 'sqlite') {
      await sequelize.query('PRAGMA busy_timeout = 5000');
    }
    console.log(
      dialect === 'mysql' ? 'MySQL Database Connected' : 'SQLite Database Connected'
    );

    if (process.env.USE_MIGRATIONS === 'true') {
      console.log('Using migrations (run npm run db:migrate to apply)');
      return;
    }

    // alter:true only for local/dev — never auto-alter production schemas
    const shouldAlter =
      process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';
    await sequelize.sync(shouldAlter ? { alter: true } : { alter: false });
    console.log('Database models synchronized');
  } catch (error) {
    console.error('Database connection error:', error);
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
    throw error;
  }
};

export default sequelize;
