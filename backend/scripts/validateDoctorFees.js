/**
 * Scan doctor fees for invalid / out-of-range values.
 *
 * Usage:
 *   node scripts/validateDoctorFees.js           # report only
 *   node scripts/validateDoctorFees.js --fix    # remediate null/<=0 and clamp oversize
 *
 * Does not delete doctors. Remediation writes doctor_price_histories rows.
 */
import 'dotenv/config'
import sequelize, { connectDB } from '../config/mysql.js'
import Doctor from '../models/doctorModel.js'
import DoctorPriceHistory from '../models/doctorPriceHistoryModel.js'
import { getFeeLimits, normalizeFee } from '../services/pricingService.js'

const FIX = process.argv.includes('--fix')

const main = async () => {
  await connectDB()
  const { min, max } = getFeeLimits()

  const doctors = await Doctor.unscoped().findAll({
    attributes: ['id', 'name', 'email', 'fees'],
  })

  const issues = []

  for (const doc of doctors) {
    const raw = doc.fees
    const numeric = Number(raw)
    const problem =
      raw == null ||
      !Number.isFinite(numeric) ||
      numeric <= 0 ||
      numeric < min ||
      numeric > max

    if (!problem) continue

    const issue = {
      doctorId: doc.id,
      name: doc.name,
      email: doc.email,
      fees: raw,
      reason:
        raw == null || !Number.isFinite(numeric)
          ? 'null_or_non_numeric'
          : numeric <= 0
            ? 'non_positive'
            : numeric < min
              ? 'below_min'
              : 'above_max',
    }
    issues.push(issue)

    if (!FIX) continue

    const oldFee = Number.isFinite(numeric) && numeric > 0 ? normalizeFee(numeric) : min
    let newFee = oldFee
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric < min) newFee = min
    else if (numeric > max) newFee = max

    await sequelize.transaction(async (transaction) => {
      await doc.update({ fees: newFee }, { transaction })
      await DoctorPriceHistory.create(
        {
          doctorId: doc.id,
          oldFee: Number.isFinite(numeric) ? numeric : 0,
          newFee,
          changedBy: 'system:validateDoctorFees',
          changedByRole: 'system',
        },
        { transaction }
      )
    })

    issue.remediatedTo = newFee
  }

  if (!issues.length) {
    console.log(JSON.stringify({ ok: true, message: 'All doctor fees within limits', min, max }))
  } else {
    console.log(
      JSON.stringify(
        {
          ok: false,
          fixed: FIX,
          min,
          max,
          count: issues.length,
          issues,
        },
        null,
        2
      )
    )
  }

  await sequelize.close()
  process.exit(issues.length && !FIX ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
