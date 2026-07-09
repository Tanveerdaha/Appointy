import Doctor from '../models/doctorModel.js'

/**
 * Lock doctor row inside a transaction to prevent slot race conditions.
 */
export const lockDoctorForUpdate = async (docId, transaction) => {
    const dialect = Doctor.sequelize.getDialect()
    if (dialect === 'mysql') {
        return Doctor.findByPk(docId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        })
    }
    // SQLite: re-read within transaction (best-effort serialization)
    return Doctor.findByPk(docId, { transaction })
}
