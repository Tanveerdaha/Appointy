'use strict';

/**
 * Refresh token store for JWT session rotation / revocation.
 * Tokens are stored hashed (sha256); raw values never persist.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('refresh_tokens', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.STRING(128),
        allowNull: false,
      },
      tokenHash: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
      },
      role: {
        type: Sequelize.STRING(32),
        allowNull: false,
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      revokedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('refresh_tokens', ['userId', 'role'], {
      name: 'refresh_tokens_user_role',
    });
    await queryInterface.addIndex('refresh_tokens', ['expiresAt'], {
      name: 'refresh_tokens_expires_at',
    });
    await queryInterface.addIndex('refresh_tokens', ['revokedAt'], {
      name: 'refresh_tokens_revoked_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('refresh_tokens');
  },
};
