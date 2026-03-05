import fs from "fs"
import { execSync } from "child_process"

function run(cmd){
  try { return execSync(cmd,{encoding:"utf8"}).trim() }
  catch(e){ return String(e.stdout||e.message) }
}

function sanitizeRepo(text){
  return String(text||"")
    .replace(/ghp_[A-Za-z0-9_]+/g, "ghp_REDACTED")
    .replace(/https:\/\/[^\s/@]+@github\.com/g, "https://***@github.com");
}

const report = {
  time: new Date().toISOString(),
  repo: sanitizeRepo(run("git remote -v")),
  branch: run("git branch --show-current"),
  commit: run("git rev-parse HEAD"),
  apiFiles: run("ls api || true"),
  jobsHead: run("sed -n '1,160p' api/jobs.ts || true"),
  remixCheck: run("rg -n \"videoUrl\" client/src/pages/RemixStudio.tsx || true"),
  endpoints: {
    blobPutImage: run("curl -sSL https://mvstudiopro.com/api/jobs?op=blobPutImage || true"),
    sunoCreate: run("curl -sSL https://mvstudiopro.com/api/jobs?op=aimusicSunoCreate || true"),
    udioCreate: run("curl -sSL https://mvstudiopro.com/api/jobs?op=aimusicUdioCreate || true"),
    klingCreate: run("curl -sSL https://mvstudiopro.com/api/jobs?op=klingCreate || true")
  }
}

const md = `
# MVStudioPro Error Report 2

Generated: ${report.time}

## Repository
\`\`\`
${report.repo}
\`\`\`

## Branch
${report.branch}

## Commit
${report.commit}

## API Directory
\`\`\`
${report.apiFiles}
\`\`\`

## api/jobs.ts (head)
\`\`\`ts
${report.jobsHead}
\`\`\`

## RemixStudio video player check
\`\`\`
${report.remixCheck}
\`\`\`

## Endpoint diagnostics

### blobPutImage
\`\`\`
${report.endpoints.blobPutImage}
\`\`\`

### sunoCreate
\`\`\`
${report.endpoints.sunoCreate}
\`\`\`

### udioCreate
\`\`\`
${report.endpoints.udioCreate}
\`\`\`

### klingCreate
\`\`\`
${report.endpoints.klingCreate}
\`\`\`

## Known Issues

- Udio endpoint incomplete
- Veo upload path instability
- RemixStudio videoUrl runtime error
- jobs.ts syntax instability history

## Goal

Stabilize production AI Studio pipeline:
Kling / Suno / Udio / Veo / Gemini / Nano Banana
`

fs.writeFileSync("reports/error-report-2.md", md)

console.log("report generated: reports/error-report-2.md")
