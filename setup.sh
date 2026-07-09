#!/bin/bash

# Appointy System Setup Script

echo "======================================"
echo "Appointy - System Setup"
echo "======================================"

echo ""
echo "[1/4] Database setup..."
echo "SQLite is used by default (no MySQL required for local dev)."
echo "Set DB_DIALECT=mysql in backend/.env to use MySQL instead."

if command -v mysql &> /dev/null; then
    echo "MySQL found — creating database if using MySQL..."
    mysql -u root -e "CREATE DATABASE IF NOT EXISTS appointy; SHOW DATABASES LIKE 'appointy';" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "✓ Database 'appointy' ready (for MySQL mode)"
    else
        echo "! Could not create MySQL database. SQLite will still work."
    fi
else
    echo "MySQL not installed — skipping (SQLite works out of the box)."
fi

echo ""
echo "[2/4] Checking dependencies..."
if [ -d "backend/node_modules" ]; then
    echo "✓ Backend dependencies installed"
else
    echo "✗ Backend dependencies missing. Run: cd backend && npm install"
fi

if [ -d "frontend/node_modules" ]; then
    echo "✓ Frontend dependencies installed"
else
    echo "✗ Frontend dependencies missing. Run: cd frontend && npm install"
fi

if [ -d "admin/node_modules" ]; then
    echo "✓ Admin dependencies installed"
else
    echo "✗ Admin dependencies missing. Run: cd admin && npm install"
fi

echo ""
echo "[3/4] Environment files..."
if [ ! -f "backend/.env" ]; then
    echo "! Copy backend/.env.example to backend/.env and configure values"
fi
if [ ! -f "frontend/.env" ]; then
    echo "! Copy frontend/.env.example to frontend/.env"
fi
if [ ! -f "admin/.env" ]; then
    echo "! Copy admin/.env.example to admin/.env"
fi

echo ""
echo "[4/4] Starting services..."
echo ""
echo "To start the application:"
echo "  1. Terminal 1 (Backend):"
echo "     cd backend && npm run server"
echo ""
echo "  2. Terminal 2 (Frontend):"
echo "     cd frontend && npm run dev"
echo ""
echo "  3. Terminal 3 (Admin):"
echo "     cd admin && npm run dev"
echo ""
echo "======================================"
echo "Setup complete!"
echo "======================================"
