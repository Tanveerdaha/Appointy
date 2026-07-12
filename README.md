# Appointy - Doctor Appointment Web App

**Appointy** is a full-stack web application for booking doctor appointments. It supports three roles — **Patient**, **Doctor**, and **Admin** — with Stripe online payments. Built with **React + Node/Express + Sequelize (SQLite/MySQL)**.

## Tech Stack

- **Frontend (patient)**: React, Vite, Tailwind CSS — `frontend/` (port 5173)
- **Admin/Doctor panel**: React, Vite — `admin/` (port 5174)
- **Backend API**: Node.js, Express, Sequelize — `backend/` (port 4000)
- **Database**: SQLite (default local dev) or MySQL via `DB_DIALECT=mysql`
- **Payments**: Stripe Checkout
- **Auth**: JWT (7-day expiry)

## Key Features

### Patient
- Browse and search doctors by specialty
- Book, cancel, and reschedule appointments
- Pay online via Stripe
- Manage profile (name, phone, address, gender, DOB, image)

### Doctor
- Dashboard with earnings, appointments, and patients
- View, cancel, and complete appointments
- Update profile (fees, address, about, availability)

### Admin
- Dashboard analytics
- Add, edit, and delete doctors
- View all appointments; cancel or mark complete

## Project Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/Tanveerdaha/Appointy.git
cd Appointy

cd backend && npm install
cd ../frontend && npm install
cd ../admin && npm install
```

### 2. Configure environment variables

**Backend** — copy `backend/.env.example` to `backend/.env`:

```env
DB_DIALECT=sqlite
SQLITE_STORAGE=./data/appointy.sqlite
PORT=4000
JWT_SECRET=your_jwt_secret
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your_secure_password
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
CURRENCY=pkr
FRONTEND_URL=http://localhost:5173
```

For MySQL production, set `DB_DIALECT=mysql` and configure `MYSQL_*` variables.

**Frontend** — copy `frontend/.env.example` to `frontend/.env`:

```env
VITE_BACKEND_URL=http://localhost:4000
VITE_ADMIN_URL=http://localhost:5174
```

**Admin** — copy `admin/.env.example` to `admin/.env`:

```env
VITE_BACKEND_URL=
VITE_CURRENCY=INR
```

### 3. Seed demo doctors (optional)

```bash
cd backend && npm run seed:doctors
```

### 4. Run the application

Open three terminals:

```bash
# Terminal 1 — API
cd backend && npm run server

# Terminal 2 — Patient app
cd frontend && npm run dev

# Terminal 3 — Admin/Doctor panel
cd admin && npm run dev
```

- Patient app: http://localhost:5173
- Admin panel: http://localhost:5174
- API: http://localhost:4000

## Folder Structure

```plaintext
Appointy/
├── frontend/     # Patient-facing React SPA
├── admin/        # Admin + Doctor dashboard
├── backend/      # Express API + Sequelize models
├── setup.sh      # Optional setup helper
└── MIGRATION_GUIDE.md
```

## Payment Integration

- **Stripe Checkout** is the supported online payment gateway
- After payment, the patient returns to My Appointments and the backend verifies the Stripe session before marking the appointment as paid

## Production Notes

- Set `NODE_ENV=production` and `USE_MIGRATIONS=true`, then run `npm run db:migrate` in `backend/`
- Use MySQL with `DB_DIALECT=mysql` for production deployments
- Deploy frontends via Vercel (`frontend/vercel.json`, `admin/vercel.json`)
- Docker: `docker compose up --build` starts API + MySQL

## Testing

```bash
cd backend && npm test          # API integration tests (Jest + Supertest)
cd frontend && npm test         # Frontend unit tests (Vitest)
cd frontend && npm run lint     # ESLint
cd admin && npm run lint
```

## API Health

`GET /api/health` — returns database connectivity status

## Contributing

Issues and pull requests are welcome.
