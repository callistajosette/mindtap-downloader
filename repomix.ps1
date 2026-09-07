Write-Host "Spinning up Node container to generate Repomix context..."

docker run -it --rm `
  -v "$PSScriptRoot`:/app" `
  -w /app `
  node:24-slim `
  sh -c "npx --yes repomix --ignore 'chromium-win/**,*.pdf,*.html,.git/**'"

Write-Host "Success! Check repomix-output.txt in your folder."