'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      name: { type: Sequelize.STRING, allowNull: false },
      email: { type: Sequelize.STRING, allowNull: false, unique: true },
      image: { type: Sequelize.STRING(2048), allowNull: false, defaultValue: '' },
      phone: { type: Sequelize.STRING, defaultValue: '000000000' },
      address: { type: Sequelize.JSON, allowNull: true },
      gender: { type: Sequelize.STRING, defaultValue: 'Not Selected' },
      dob: { type: Sequelize.STRING, defaultValue: 'Not Selected' },
      password: { type: Sequelize.STRING, allowNull: false },
      resetToken: { type: Sequelize.STRING, allowNull: true },
      resetTokenExpiry: { type: Sequelize.BIGINT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('doctors', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      name: { type: Sequelize.STRING, allowNull: false },
      email: { type: Sequelize.STRING, allowNull: false, unique: true },
      image: { type: Sequelize.STRING(2048), allowNull: false },
      speciality: { type: Sequelize.STRING, allowNull: false },
      degree: { type: Sequelize.STRING, allowNull: false },
      experience: { type: Sequelize.STRING, allowNull: false },
      about: { type: Sequelize.TEXT, allowNull: false },
      available: { type: Sequelize.BOOLEAN, defaultValue: true },
      fees: { type: Sequelize.INTEGER, allowNull: false },
      slots_booked: { type: Sequelize.JSON, allowNull: true },
      address: { type: Sequelize.JSON, allowNull: false },
      password: { type: Sequelize.STRING, allowNull: false },
      date: { type: Sequelize.BIGINT, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('appointments', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: { type: Sequelize.UUID, allowNull: false },
      docId: { type: Sequelize.UUID, allowNull: false },
      slotDate: { type: Sequelize.STRING, allowNull: false },
      slotTime: { type: Sequelize.STRING, allowNull: false },
      userData: { type: Sequelize.JSON, allowNull: false },
      docData: { type: Sequelize.JSON, allowNull: false },
      amount: { type: Sequelize.INTEGER, allowNull: false },
      date: { type: Sequelize.BIGINT, allowNull: false },
      cancelled: { type: Sequelize.BOOLEAN, defaultValue: false },
      payment: { type: Sequelize.BOOLEAN, defaultValue: false },
      paymentStatus: { type: Sequelize.STRING, defaultValue: 'unpaid' },
      isCompleted: { type: Sequelize.BOOLEAN, defaultValue: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('appointments', ['userId']);
    await queryInterface.addIndex('appointments', ['docId']);
    await queryInterface.addIndex('appointments', ['paymentStatus']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('appointments');
    await queryInterface.dropTable('doctors');
    await queryInterface.dropTable('users');
  },
};
