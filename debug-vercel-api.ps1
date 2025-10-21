# Debug script for Vercel API endpoints
# This will show detailed error information

Write-Host "🔍 Debugging Vercel API Endpoints" -ForegroundColor Green
Write-Host "===================================" -ForegroundColor Green

Write-Host ""
Write-Host "1. Testing basic connectivity..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://crm-v2-omega.vercel.app" -Method GET
    Write-Host "✅ App is accessible (Status: $($response.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "❌ App not accessible: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "2. Testing setup-master endpoint with detailed error..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://crm-v2-omega.vercel.app/api/setup-master" -Method GET
    Write-Host "✅ Setup-master endpoint accessible (Status: $($response.StatusCode))" -ForegroundColor Green
    Write-Host "Response content:" -ForegroundColor Cyan
    $response.Content
} catch {
    Write-Host "❌ Setup-master endpoint failed:" -ForegroundColor Red
    Write-Host "Status Code: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    
    # Try to get response content
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response Body: $responseBody" -ForegroundColor Yellow
    } catch {
        Write-Host "Could not read response body" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "3. Testing other API endpoints..." -ForegroundColor Yellow
$endpoints = @(
    "https://crm-v2-omega.vercel.app/api/auth/me",
    "https://crm-v2-omega.vercel.app/api/users",
    "https://crm-v2-omega.vercel.app/api/test"
)

foreach ($endpoint in $endpoints) {
    try {
        $response = Invoke-WebRequest -Uri $endpoint -Method GET
        Write-Host "✅ $endpoint (Status: $($response.StatusCode))" -ForegroundColor Green
    } catch {
        Write-Host "❌ $endpoint (Status: $($_.Exception.Response.StatusCode))" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "🔧 Troubleshooting Steps:" -ForegroundColor Cyan
Write-Host "1. Check Vercel deployment logs for detailed errors" -ForegroundColor White
Write-Host "2. Verify all environment variables are set correctly" -ForegroundColor White
Write-Host "3. Try redeploying the app" -ForegroundColor White
Write-Host "4. Check if the database is accessible" -ForegroundColor White
