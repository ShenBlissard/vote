for ($i = 0; $i -lt 120; $i++) {
  try {
    Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 2 | Out-Null
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}
Start-Process "http://localhost:3000"
