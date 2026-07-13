# Appointy - Doctor Appointment Web App

**Appointy** is a full-stack web app for booking doctor appointments. It supports three roles — **Patient**, **Doctor**, and **Admin** — with Stripe Checkout payments and Cloudinary image uploads. Built with **React + Node/Express + Sequelize (MySQL)**.

## Tech Stack

| Layer | Stack | Port |
|-------|--------|------|
| Patient app | React, Vite, Tailwind — `frontend/` | 5173 |
| Admin / Doctor panel | React, Vite — `admin/` | 5174 |
| API | Node.js, Express, Sequelize — `backend/` | 4000 |
| Database | **MySQL 8** (default). SQLite only for automated tests | 3306 |
| Payments | Stripe Checkout | — |
| Images | Cloudinary (profile / doctor photos) | — |
| Auth | JWT (7-day expiry) | — |

## Key Features

### Patient
- Browse and search doctors by specialty
- Book, cancel, and reschedule appointments
- Pay online via Stripe (or pay later)
- Manage profile (name, phone, address, gender, DOB, image)

### Doctor
- Dashboard with earnings, appointments, and patients
- View, cancel, and complete appointments
- Update profile (fees, address, about, availability)

### Admin
- Dashboard analytics (counts + revenue)
- Add, edit, and delete doctors (image upload required)
- View all appointments; cancel or mark complete

---

## Quick start with Docker (recommended)

Runs **MySQL + backend + frontend + admin** together.

### 1. Configure env

```bash
git clone https://github.com/Tanveerdaha/Appointy.git
cd Appointy

cp example.env .env
cp example.env backend/.env
```

Edit `.env` and `backend/.env` and set your real keys:

- `CLOUDINARY_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- `STRIPE_SECRET_KEY`
- `JWT_SECRET` (change from the placeholder)

> For the API container, Compose overrides `MYSQL_HOST` to `mysql` (Docker DNS). Keep `MYSQL_HOST=localhost` in `backend/.env` for local `npm run server` against Docker MySQL on port 3306.

### 2. Start the stack

```bash
docker compose up --build
```

| App | URL |
|-----|-----|
| Patient | http://localhost:5173 |
| Admin / Doctor | http://localhost:5174 |
| API | http://localhost:4000 |
| MySQL | localhost:3306 |

Default admin login (change in env):

- Email: `admin@example.com`
- Password: `admin123456`

Seed demo doctors (optional, with stack running or MySQL up):

```bash
docker compose exec backend npm run seed:doctors
# or locally:
cd backend && npm run seed:doctors
```

Stop:

```bash
docker compose down
```

---

## Local development (without Docker for apps)

You still need MySQL (Docker MySQL alone is fine).

### 1. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
cd ../admin && npm install
```

### 2. Environment

```bash
cp example.env backend/.env
# fill Cloudinary + Stripe + JWT

cp frontend/.env.example frontend/.env   # VITE_BACKEND_URL=http://localhost:4000
cp admin/.env.example admin/.env         # VITE_BACKEND_URL=http://localhost:4000
```

Start MySQL only:

```bash
docker compose up -d mysql
```

Ensure `backend/.env` has:

```env
DB_DIALECT=mysql
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=rootpassword
MYSQL_DB=appointy
```

### 3. Run apps (three terminals)

```bash
cd backend && npm run server
cd frontend && npm run dev
cd admin && npm run dev
```

---

## Environment variables

Root template: [`example.env`](example.env) (copy to `.env` and `backend/.env`).

| Variable | Purpose |
|----------|---------|
| `DB_DIALECT` | `mysql` (default). Use `sqlite` only in tests |
| `MYSQL_*` | Host, port, user, password, database |
| `JWT_SECRET` | Signing secret for tokens |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin panel credentials |
| `CLOUDINARY_*` | Required for image uploads |
| `STRIPE_SECRET_KEY` | Stripe Checkout |
| `CURRENCY` | e.g. `pkr` |
| `FRONTEND_URL` | Stripe return URLs + password-reset links |
| `ALLOWED_ORIGINS` | CORS allowlist (comma-separated) |
| `VITE_BACKEND_URL` | Browser-reachable API URL (baked into frontend/admin Docker images at **build** time) |

Image uploads go to **Cloudinary only** (no local/base64 storage).

---

## Folder structure

```plaintext
Appointy/
├── example.env          # Shared env template
├── docker-compose.yml   # mysql + backend + frontend + admin
├── frontend/            # Patient SPA (+ Dockerfile / nginx)
├── admin/               # Admin + Doctor SPA (+ Dockerfile / nginx)
└── backend/             # Express API, Sequelize models, migrations
```

---

## Payments

- Stripe Checkout is the online payment gateway
- Patient can book with **pay now** or **pay later**
- After Checkout, return to My Appointments; the API verifies the Stripe session and marks the appointment paid

## Images

- Doctor and patient images upload via Multer → **Cloudinary**
- Configure Cloudinary keys before adding doctors or updating profile photos

## Production notes

- Set strong `JWT_SECRET` and `ADMIN_PASSWORD`; never ship placeholder Stripe/Cloudinary keys
- Prefer `USE_MIGRATIONS=true` and `npm run db:migrate` in `backend/` for schema changes
- Compose sets `NODE_ENV=production` on the API image; schema sync uses `alter: false` in production
- Rebuild frontend/admin images after changing `VITE_*` values (`docker compose up --build`)
- Optional Vercel deploy: `frontend/vercel.json`, `admin/vercel.json`

## Testing

```bash
cd backend && npm test              # unit
cd backend && npm run test:integration
cd frontend && npm test             # Vitest
cd frontend && npm run lint
cd admin && npm run lint
```

Backend tests use in-memory SQLite (`DB_DIALECT=sqlite`); runtime/default is MySQL.

## API health

`GET /api/health` — database connectivity status

## Contributing

Issues and pull requests are welcome.
