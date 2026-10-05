# Notification operations — Phase 3

SMS is the connected channel because `patients.contact_number` is the existing destination. Twilio is supported; email/Resend is not wired to a patient destination and is not claimed operational. No provider configured means a durable **stubbed/not sent** result, without logging the recipient or message.

## Architecture and boundaries

`appointment RPC commit -> phase3_enqueue_notification trigger -> notification_attempts -> atomic claim -> provider -> durable result`.

Booking/rescheduling/cancellation transactions enqueue appropriate versioned notices atomically; a failed appointment operation leaves no event. Browser calls from both portals are a best-effort fast path after success. The server worker drains the same queue even if the browser closes or `VITE_NOTIFY_ENABLED` is false. There is no patient-supplied destination, message or medical reason in an invocation.

| Function | Invocation | Authorization |
|---|---|---|
| `send-confirmation` | POST `{appointment_id, type?}`; type confirmation/reschedule/cancellation | Real caller JWT verified through Auth, then SQL requires admin or owning patient. Restrictive origin allowlist and OPTIONS support. |
| `send-reminders` | Five-minute scheduled POST; also drains pending non-reminder events | Exact strong server-only `x-cron-secret`; ordinary user JWTs do not authorize it. |
| `notification-status` | Twilio form-encoded status callback, if configured | HMAC-SHA1 verification using the exact configured callback URL, all sorted form parameters and server-only provider auth token. No patient/admin JWT shortcut. |

The CLI config disables gateway JWT checking for these handlers so preflight/custom auth can execute. Each handler retains its own mandatory authentication. Configure exact origins with `NOTIFY_ALLOWED_ORIGINS`; there is no wildcard origin or cookie-credential allowance. CORS headers are present on allowed-origin successes and failures.

## What success means

- Appointment success: authoritative RPC committed the visit/change.
- Function execution: handler reached its processing/result path (`executed:true`).
- Provider acceptance: Twilio returned a successful valid message reference; result `ok:true`, `accepted:true`, `stubbed:false`. This is not proof of delivery.
- Delivery: independently authenticated provider callback records `delivery_status`/`delivered_at`. Without a verified callback the delivery state remains `not_verified`.

Provider rejects, missing destination, missing provider configuration, rate limits and unknown transport outcomes are separate structured results. Frontend never says “Confirmation sent” merely because invoke returned HTTP 200. Notification failure cannot roll back an already committed appointment.

Messages contain only clinic appointment action/date/time in Manila and a contact-clinic hint. They omit names, phone numbers in body, doctor specialties, reasons, diagnoses and room data. Sending necessarily transmits the destination to the chosen provider; app logs and responses do not reproduce it. There are no message-body/destination debug logs or raw provider errors.

## Durable idempotency and retry policy

`appointment_notification_versions` separates notification revisions from appointment history. `notification_attempts` uniquely identifies appointment/type/revision/channel. The ledger references the existing patient UUID without copying contact/name/medical text. It stores operational status, attempt count/timestamps, provider reference, sanitized error category and optional delivery time.

Current statuses: pending, processing, accepted, failed, unknown, stubbed, superseded. Browser patients cannot read the ledger. Admins can SELECT; only service-only definer RPCs claim/finish worker attempts. No browser may directly update ledger state.

Claims serialize under appointment/ledger locks and skip claimed rows. A lease token binds completion to the claimed attempt. Known rate-limit rejection schedules bounded backoff (5 then 10 minutes), at most three attempts. Invalid destination/permanent provider rejection is not automatically retried. Provider 5xx, network timeout or expired processing lease may represent an already accepted message; those become **unknown and held**, not blindly resent. This conservative policy prevents duplicate automated sends at the cost of requiring private operator/provider reconciliation after ambiguity. Exactly-once external delivery cannot be promised across a network failure.

Stubbed attempts are retained as not sent and do not automatically replay when provider secrets are later added. Review and deliberately reconcile them before real usage. Accepted notices are never claimed again for UI retries. A meaningful doctor/time move increments revision; obsolete pending/failed notices become superseded. Reverting a time later is still a different revision, so a genuine later change can notify once.

Cancellation and reminder claims revalidate current authoritative appointment status/time/version. Completed/cancelled/no-show appointments are not reminded. A request already in flight to a provider cannot be unsent by a later cancellation/reschedule; do not claim cross-service atomicity. Newly queued notices use the new state. Callbacks arriving before acceptance is recorded receive 503; actual provider retry/early-callback behavior must be exercised in staging.

## Reminder schedule

The worker runs every five minutes. It derives tomorrow from `(clock AT TIME ZONE 'Asia/Manila')::date + 1`, uses half-open Manila midnight bounds, and queues scheduled appointments after **07:00 Manila**. The same revision's reminder is unique. Newly booked/rescheduled tomorrow visits after 07:00 are included on the next pass. Only five events are claimed per function batch; with a 20-second provider timeout this bounds sequential provider work. Monitor backlog for the actual clinic volume; increased throughput requires measured staging validation.

For an October 10 09:00 Manila visit, the October 9 morning pass selects the October 10 clinic day, regardless of Edge Function or PostgreSQL session timezone. Rescheduling supersedes the old revision and reminders use the new timestamp. Durable reminder deduplication survives repeated cron calls.

## Manual staging installation

No migration/function/job was installed by this remediation.

1. Apply Phase 1 and Phase 2, then review/install `fix_phase3_notifications_reports.sql` in isolated staging. It preserves existing appointments and backfills only separate version state; it does not enqueue historical confirmations.
2. Configure the Edge Function runtime variables listed in setup.md, exact allowed browser origins and mocked/synthetic provider settings. Review config.toml and the three handlers before any later authorized function deployment.
3. If tracking delivery, set `NOTIFY_STATUS_CALLBACK_URL` to the exact public HTTPS URL of `notification-status`. Twilio signs that URL; proxy/internal hostname differences must not change the configured public canonical URL. The request sends `StatusCallback` only when configured. Protect and rotate provider credentials through the secret manager.
4. Enable Supabase Vault, pg_cron and pg_net in staging. Securely create these named Vault secrets without putting values in SQL/source/output: `medicappointment_url` (project endpoint), `medicappointment_anon_key` (public key), `medicappointment_cron_secret` (same strong server-only CRON_SECRET as the handler).
5. Review/install `fix_phase3_scheduler.sql`. It fails safely if capabilities/secrets are missing, installs one named `medicappointment-notification-worker` job, and reads Vault inside a private function. Do not use `cron.sql` as a plaintext template; it now points to the executable definition.
6. Inspect scheduler run history and HTTP outcomes privately. A successful pg_net enqueue is not an HTTP/function/provider success. Check ledger results and backlog; do not copy decrypted secrets/HTTP auth headers into screenshots or logs.
7. Validate OPTIONS, malformed payloads, ownership, both booking portals, retry idempotency, provider rejection and signed delivery callbacks with synthetic data. Only then enable the browser flag and decide on a separately authorized real rollout.

`delivered_at` is evidence only when a validated callback says delivered. Provider acceptance/status APIs and callbacks still need actual staging verification; local tests mock the transport and verify signatures/SQL behavior. No production SMS/email was sent.
