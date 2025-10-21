# Test script for Vercel API endpoints
# Run these commands to test your deployed app

Write-Host "🧪 Testing Vercel API Endpoints" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green

Write-Host ""
Write-Host "1. Testing database connection..." -ForegroundColor Yellow
try {
    $response1 = Invoke-RestMethod -Uri "https://crm-v2-omega.vercel.app/api/setup-master" -Method GET
    Write-Host "✅ Database connection successful!" -ForegroundColor Green
    $response1 | ConvertTo-Json -Depth 3
} catch {
    Write-Host "❌ Database connection failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "2. Testing authentication endpoint..." -ForegroundColor Yellow
try {
    $response2 = Invoke-RestMethod -Uri "https://crm-v2-omega.vercel.app/api/auth/me" -Method GET
    Write-Host "✅ Authentication endpoint working!" -ForegroundColor Green
    $response2 | ConvertTo-Json -Depth 3
} catch {
    Write-Host "⚠️  Authentication endpoint error (expected if not logged in): $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "3. Creating master user..." -ForegroundColor Yellow
try {
    $response3 = Invoke-RestMethod -Uri "https://crm-v2-omega.vercel.app/api/setup-master" -Method POST
    Write-Host "✅ Master user creation successful!" -ForegroundColor Green
    $response3 | ConvertTo-Json -Depth 3
} catch {
    Write-Host "❌ Master user creation failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "4. Verifying master user creation..." -ForegroundColor Yellow
try {
    $response4 = Invoke-RestMethod -Uri "https://crm-v2-omega.vercel.app/api/setup-master" -Method GET
    Write-Host "✅ Master user verification successful!" -ForegroundColor Green
    $response4 | ConvertTo-Json -Depth 3
} catch {
    Write-Host "❌ Master user verification failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "✅ Test completed!" -ForegroundColor Green
Write-Host ""
Write-Host "If you see JSON responses above, your app is working!" -ForegroundColor Cyan
Write-Host "If you see errors, check your environment variables in Vercel." -ForegroundColor Yellow
Write-Host ""
Write-Host "Login credentials should be:" -ForegroundColor Cyan
Write-Host "Username: admin" -ForegroundColor White
Write-Host "Password: admin123" -ForegroundColor White
