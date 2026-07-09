import React from 'react'

const Privacy = () => {
  return (
    <div className="py-10 max-w-3xl">
      <h1 className="text-2xl font-semibold text-gray-800 mb-4">Privacy Policy</h1>
      <p className="text-gray-600 leading-7 mb-4">
        Appointy respects your privacy. We collect only the information needed to provide appointment booking services, including your name, email, contact details, and appointment history.
      </p>
      <p className="text-gray-600 leading-7 mb-4">
        Your data is used solely to manage bookings, payments, and account access. We do not sell personal information to third parties. Payment processing is handled securely through Razorpay.
      </p>
      <p className="text-gray-600 leading-7">
        For questions about this policy, contact us at customersupport@appointy.in.
      </p>
    </div>
  )
}

export default Privacy
