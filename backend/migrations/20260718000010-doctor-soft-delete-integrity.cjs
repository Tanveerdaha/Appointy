'use strict';

/**
 * Doctor soft-delete + referential integrity:
 * - doctors.deletedAt for Sequelize paranoid soft-delete
 * - appointments.docId → doctors.id (RESTRICT)
 * - doctor_price_histories.doctorId → doctors.id (RESTRICT)
 */

const APPOINTMENTS_DOC_FK = 'appointments_doc_id_fkey';
const PRICE_HISTORY_DOCTOR_FK = 'doctor_price_histories_doctor_id_fkey';
const DOCTORS_DELETED_AT_INDEX = 'doctors_deleted_at';

const tableNames = async (queryInterface) => {
  const tables = await queryInterface.showAllTables();
  return tables.map((t) =>
    typeof t === 'string' ? t.toLowerCase() : String(t?.tableName || t || '').toLowerCase()
  );
};

const hasForeignKey = async (queryInterface, table, column, referencedTable) => {
  try {
    const refs = await queryInterface.getForeignKeyReferencesForTable(table);
    return (refs || []).some((fk) => {
      const col = String(fk.columnName || fk.column_name || '').toLowerCase();
      const refTable = String(
        fk.referencedTableName || fk.referenced_table_name || ''
      ).toLowerCase();
      return col === column.toLowerCase() && refTable === referencedTable.toLowerCase();
    });
  } catch {
    return false;
  }
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const doctors = await queryInterface.describeTable('doctors');
    if (!doctors.deletedAt) {
      await queryInterface.addColumn('doctors', 'deletedAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    const indexes = await queryInterface.showIndex('doctors');
    const indexNames = new Set(
      (indexes || []).map((idx) => String(idx.name || idx.Name || '').toLowerCase())
    );
    if (!indexNames.has(DOCTORS_DELETED_AT_INDEX)) {
      await queryInterface.addIndex('doctors', ['deletedAt'], {
        name: DOCTORS_DELETED_AT_INDEX,
      });
    }

    const [orphanAppointments] = await queryInterface.sequelize.query(`
      SELECT a.id AS id, a.docId AS docId
      FROM appointments a
      LEFT JOIN doctors d ON d.id = a.docId
      WHERE d.id IS NULL
      LIMIT 50
    `);
    if (orphanAppointments?.length) {
      throw new Error(
        `Migration aborted: ${orphanAppointments.length}+ appointments reference missing doctors: ${JSON.stringify(orphanAppointments)}`
      );
    }

    const tables = await tableNames(queryInterface);
    if (tables.includes('doctor_price_histories')) {
      const [orphanPrices] = await queryInterface.sequelize.query(`
        SELECT p.id AS id, p.doctorId AS doctorId
        FROM doctor_price_histories p
        LEFT JOIN doctors d ON d.id = p.doctorId
        WHERE d.id IS NULL
        LIMIT 50
      `);
      if (orphanPrices?.length) {
        throw new Error(
          `Migration aborted: ${orphanPrices.length}+ doctor_price_histories reference missing doctors: ${JSON.stringify(orphanPrices)}`
        );
      }
    }

    if (!(await hasForeignKey(queryInterface, 'appointments', 'docId', 'doctors'))) {
      await queryInterface.addConstraint('appointments', {
        fields: ['docId'],
        type: 'foreign key',
        name: APPOINTMENTS_DOC_FK,
        references: {
          table: 'doctors',
          field: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      });
    }

    if (
      tables.includes('doctor_price_histories') &&
      !(await hasForeignKey(queryInterface, 'doctor_price_histories', 'doctorId', 'doctors'))
    ) {
      await queryInterface.addConstraint('doctor_price_histories', {
        fields: ['doctorId'],
        type: 'foreign key',
        name: PRICE_HISTORY_DOCTOR_FK,
        references: {
          table: 'doctors',
          field: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('appointments', APPOINTMENTS_DOC_FK).catch(() => {});

    const tables = await tableNames(queryInterface);
    if (tables.includes('doctor_price_histories')) {
      await queryInterface
        .removeConstraint('doctor_price_histories', PRICE_HISTORY_DOCTOR_FK)
        .catch(() => {});
    }

    await queryInterface.removeIndex('doctors', DOCTORS_DELETED_AT_INDEX).catch(() => {});

    const doctors = await queryInterface.describeTable('doctors');
    if (doctors.deletedAt) {
      await queryInterface.removeColumn('doctors', 'deletedAt');
    }
  },
};
