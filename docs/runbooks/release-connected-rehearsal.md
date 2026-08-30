# Private connected release rehearsal

This runbook covers the opt-in private G13 rehearsal only. It resets only synthetic `case-rv-1028`, runs the signed Resolvia Demo Provider and scoped Demo Partner paths through private Cloud Run, Pub/Sub, Firestore, Scheduler, and Gemini, then checks deterministic authority and duplicate handling.

It does not authorize Identity Platform, public access, a load balancer, Cloud Armor, a merge, a tag, a video upload, or a hackathon submission. The Scheduler job must be enabled only for the bounded rehearsal and returned to `PAUSED` afterward.

Set the non-secret connected configuration and run:

```powershell
$env:RUN_RELEASE_CONNECTED_REHEARSAL = "1"
$env:RESOLVIA_RUNTIME_MODE = "CONNECTED"
$env:GOOGLE_CLOUD_PROJECT = "your-gcp-project"
$env:RESOLVIA_GCP_REGION = "asia-southeast2"
$env:RESOLVIA_FIRESTORE_DATABASE = "(default)"
$env:RESOLVIA_WEB_URL = (& gcloud.cmd run services describe resolvia-web --project your-gcp-project --region asia-southeast2 --format='value(status.url)').Trim()
$env:RESOLVIA_SCHEDULER_JOB = "resolvia-automation-v1"
$env:GCLOUD_PATH = (Get-Command gcloud.cmd).Source

try {
  gcloud.cmd scheduler jobs resume resolvia-automation-v1 --project your-gcp-project --location asia-southeast2 --quiet
  npm.cmd run test:release:connected
} finally {
  gcloud.cmd scheduler jobs pause resolvia-automation-v1 --project your-gcp-project --location asia-southeast2 --quiet
}
```

The proof must pass twice from deterministic v4. Each run must finish at v7 `RESOLVED` only because the deterministic policy observes same-case provider success and independently confirmed customer receipt. The merchant assertion remains `UNVERIFIED`; Gemini remains advisory and can append only a validated AgentRun. Duplicate provider, partner, and Scheduler triggers must not create a second semantic effect.

Never print or persist the Demo Provider secret, Gemini API key, raw partner token, signatures, identity tokens, or raw payloads. A skipped test is not a pass.
