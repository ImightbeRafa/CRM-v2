# Temporary migration script for Windows PowerShell
# Replace the connection string with your DIRECT Supabase URL

$originalUrl = $env:DATABASE_URL
$env:DATABASE_URL = "YOUR_DIRECT_SUPABASE_URL_HERE"

Write-Host "Using direct connection for migration..." -ForegroundColor Green
npx prisma db push

$env:DATABASE_URL = $originalUrl
Write-Host "Migration complete!" -ForegroundColor Green

