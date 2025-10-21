#!/bin/bash

# Test script for Vercel API endpoints
# Run these commands to test your deployed app

echo "🧪 Testing Vercel API Endpoints"
echo "================================"

echo ""
echo "1. Testing database connection..."
curl -X GET https://crm-v2-omega.vercel.app/api/setup-master
echo ""

echo ""
echo "2. Testing authentication endpoint..."
curl -X GET https://crm-v2-omega.vercel.app/api/auth/me
echo ""

echo ""
echo "3. Creating master user..."
curl -X POST https://crm-v2-omega.vercel.app/api/setup-master
echo ""

echo ""
echo "4. Verifying master user creation..."
curl -X GET https://crm-v2-omega.vercel.app/api/setup-master
echo ""

echo ""
echo "✅ Test completed!"
echo ""
echo "If you see JSON responses above, your app is working!"
echo "If you see errors, check your environment variables in Vercel."
echo ""
echo "Login credentials should be:"
echo "Username: admin"
echo "Password: admin123"
