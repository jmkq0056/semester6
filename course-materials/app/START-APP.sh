#!/bin/bash

echo "🚀 Starting Course Materials PDF Viewer..."
echo ""
echo "📍 Working directory: $(pwd)"
echo ""

# Kill any existing processes
echo "🧹 Cleaning up existing processes..."
lsof -ti:3000,3001 | xargs kill -9 2>/dev/null || true
sleep 1

# Start backend server
echo "🔧 Starting backend server on port 3000..."
cd server
node server.js > ../backend.log 2>&1 &
BACKEND_PID=$!
echo "   Backend PID: $BACKEND_PID"
cd ..

# Wait for backend to start
sleep 2

# Start frontend dev server
echo "🎨 Starting frontend dev server on port 3001..."
cd client
npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!
echo "   Frontend PID: $FRONTEND_PID"
cd ..

echo ""
echo "✅ Application started successfully!"
echo ""
echo "📱 Frontend: http://localhost:3001"
echo "🔌 Backend:  http://localhost:3000"
echo ""
echo "📋 Logs:"
echo "   Backend:  tail -f backend.log"
echo "   Frontend: tail -f frontend.log"
echo ""
echo "🛑 To stop: kill $BACKEND_PID $FRONTEND_PID"
echo ""
