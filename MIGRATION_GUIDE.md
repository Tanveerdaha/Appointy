# MongoDB to MySQL Migration Guide

## ✅ Migration Completed

Your Appointy application has been successfully migrated from MongoDB to MySQL using Sequelize ORM.

## Changes Made

### 1. **Dependencies Updated** (`package.json`)
- ❌ Removed: `mongoose`, `mongodb`
- ✅ Added: `mysql2`, `sequelize`

### 2. **Database Configuration** (`config/mysql.js`)
- Created new MySQL connection using Sequelize
- Supports environment variables for configuration
- Auto-syncs models with database

### 3. **Models Updated** (Sequelize)
- ✅ **userModel.js** - User model with Sequelize
- ✅ **doctorModel.js** - Doctor model with Sequelize
- ✅ **appointmentModel.js** - Appointment model with Sequelize

### 4. **Controllers Updated** (All use Sequelize queries)
- ✅ **userController.js** - Register, Login, Profile, Appointments
- ✅ **doctorController.js** - Doctor login, dashboard, appointments
- ✅ **adminController.js** - Admin dashboard, add doctors, manage appointments

### 5. **Server Configuration** (`server.js`)
- Updated to use MySQL connection instead of MongoDB
- Removed mongoose test endpoint

## Setup Instructions

### Step 1: Install MySQL
```bash
# Windows - Download from https://dev.mysql.com/downloads/mysql/
# or use Windows Subsystem for Linux (WSL)

# macOS
brew install mysql

# Linux
sudo apt-get install mysql-server
```

### Step 2: Create Database
```bash
mysql -u root -p
CREATE DATABASE appointy;
EXIT;
```

### Step 3: Install Dependencies
```bash
cd backend
npm install
```

### Step 4: Configure Environment Variables
Create a `.env` file in the backend folder:

```env
# MySQL Database Configuration
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_mysql_password
MYSQL_DB=appointy

# Server Configuration
PORT=4000

# JWT Configuration
JWT_SECRET=your_jwt_secret_key_here

# Cloudinary Configuration
CLOUDINARY_NAME=your_cloudinary_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

# Admin Credentials
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
CURRENCY=pkr
```

### Step 5: Start the Server
```bash
npm start
# or for development with auto-reload
npm run server
```

## Key Differences: MongoDB → MySQL

| MongoDB | MySQL (Sequelize) |
|---------|------------------|
| `mongoose.connect()` | `sequelize.authenticate()` |
| `Model.findById(id)` | `Model.findByPk(id)` |
| `Model.findOne({ email })` | `Model.findOne({ where: { email } })` |
| `Model.find({ userId })` | `Model.findAll({ where: { userId } })` |
| `new Model(); .save()` | `Model.create()` |
| `Model.findByIdAndUpdate(id, data)` | `Model.update(data, { where: { id } })` |
| `Model._id` | `Model.id` |
| Object storage | JSON column type |

## Database Schema

### Users Table
- id (UUID Primary Key)
- name, email, password
- phone, address (JSON), gender, dob
- image (LONGTEXT for base64)
- createdAt, updatedAt (Timestamps)

### Doctors Table
- id (UUID Primary Key)
- name, email, password
- speciality, degree, experience, about
- fees, available (Boolean)
- slots_booked (JSON)
- address (JSON), image (LONGTEXT)
- date (BigInt for timestamp)
- createdAt, updatedAt (Timestamps)

### Appointments Table
- id (UUID Primary Key)
- userId, docId (UUID Foreign Keys)
- slotDate, slotTime
- userData, docData (JSON)
- amount, date
- cancelled, payment, isCompleted (Boolean flags)
- createdAt, updatedAt (Timestamps)

## Testing the Connection

Run your server and check the console output:
```
MySQL Database Connected
Database models synchronized
Server started on PORT:4000
```

## Notes

1. **UUID vs MongoDB ObjectId**: All IDs are now UUID v4 for better MySQL compatibility
2. **Timestamps**: Sequelize automatically manages `createdAt` and `updatedAt`
3. **JSON Storage**: Complex objects are stored as JSON in MySQL
4. **No Migration Script**: This is a fresh database setup. If you need to migrate existing MongoDB data, contact support.
5. **Connection Pooling**: Sequelize manages a connection pool for better performance

## Troubleshooting

### Connection Issues
- Verify MySQL is running: `mysql -u root -p`
- Check MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD in .env

### Table Not Found
- Sequelize auto-creates tables on first run
- Delete database and restart: Tables will recreate automatically

### Port Already in Use
- Change PORT in .env file
- Or kill the process: `lsof -i :4000` then `kill -9 <PID>`

## MongoDB Data Recovery

If you need to keep MongoDB running alongside MySQL for data migration:
1. Run both databases in parallel
2. Create a migration script to copy data from MongoDB to MySQL
3. Contact development team for migration assistance

---

**Migration completed successfully!** Your app is now running on MySQL with Sequelize ORM.
