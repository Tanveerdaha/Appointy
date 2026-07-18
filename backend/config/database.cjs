'use strict'

const path = require('path')

const dialect = (process.env.DB_DIALECT || 'mysql').toLowerCase()

module.exports = {
  development: {
    dialect: dialect === 'mysql' ? 'mysql' : 'sqlite',
    storage: process.env.SQLITE_STORAGE || path.join(__dirname, '..', 'data', 'appointy.sqlite'),
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    username: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DB || 'appointy',
    logging: false,
  },
  test: {
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false,
  },
  production: {
    dialect: 'mysql',
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    username: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DB,
    logging: false,
  },
}
