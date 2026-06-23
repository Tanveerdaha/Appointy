#!/bin/bash

# Appointy System Setup Script

echo "======================================"
echo "Appointy - System Setup"
echo "======================================"

# Check if MySQL is installed
echo ""
echo "[1/4] Checking MySQL installation..."
if command -v mysql &> /dev/null; then
    echo "✓ MySQL found"
else
    echo "✗ MySQL not found. Please install MySQL:"
    echo "  Windows: Download from https://dev.mysql.com/downloads/mysql/"
    echo "  macOS: brew install mysql"
    echo "  Linux: sudo apt-get install mysql-server"
    exit 1
fi

# Create database
echo ""
echo "[2/4] Creating database..."
mysql -u root -e "CREATE DATABASE IF NOT EXISTS appointy; SHOW DATABASES LIKE 'appointy';" 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✓ Database 'appointy' ready"
else
    echo "! Note: Could not create database. Server will auto-create on first run."
fi

# Check dependencies
echo ""
echo "[3/4] Checking dependencies..."
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
