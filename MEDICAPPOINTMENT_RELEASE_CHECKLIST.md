# MedicAppointment Phase 4 Release Verification Checklist

Created: 2026-10-02, Asia/Manila. Updated 2026-10-03T11:07:07.595Z. Release candidate: Phase 1–3 plus the completed read-only report authorization fix.

Feature freeze applies before any further application change. No deployment, hosted seeding, production reset, real-record deletion or secret-value output is authorized. Only a confirmed release-blocking defect may justify a narrow source correction, followed by every regression suite. New verification scripts/artifacts are permitted; no new application features are planned.

| ID | Verification | Final disposition |
|---|---|---|
| RC-01 | Read audit, Phase 1–3, report-fix, final report and continuation; preserve history | CONFIRMED: all read; five historical reports byte-identical |
| RC-02 | Capture post-fix source/configuration/SQL/package hashes | CONFIRMED: 82 current hashes match; historical pre-fix baseline retained |
| RC-03 | Inspect package/lock agreement, required files, fake-only environment example | CONFIRMED: root lock agreement, required files, fake-only example |
| RC-04 | Final build, static, Phase 1–3, report regression, Edge, Phase 4, browser and diff checks | CONFIRMED: all 11 final commands pass; historical npm ci retained; audit separately flagged |
| RC-05 | Full non-demo schema.sql install and object/security inventory in disposable loopback database | CONFIRMED locally: entire schema and catalog inventory |
| RC-06 | Pre-upgrade schema → Phase 1 → Phase 2 → Phase 3 → read-only report fix; preservation/repeatability | CONFIRMED locally: snapshots/index OID unchanged; READ ONLY admin reports and role denial pass |
| RC-07 | Incompatible fixtures fail transactionally without cleanup | CONFIRMED locally: invalid duration/overlap/demographics abort unchanged |
| RC-08 | Anonymous / Patient A / Patient B / admin adversarial RLS and RPC tests | CONFIRMED local SQL; deployed REST NOT VERIFIED |
| RC-09 | Role escalation: INSERT/UPDATE/RPC/payload/metadata/REST boundary cases | CONFIRMED SQL attacks; actual hosted REST boundary NOT VERIFIED |
| RC-10 | Five exact-slot booking/reschedule concurrency combinations; seconds/fractions; cancellation/no-show reuse | CONFIRMED: five races, normalization, cancelled/no-show reuse |
| RC-11 | Patient login/profile/book/move/cancel/history/session recovery | PARTIAL: actual Chrome/Edge + persisted local SQL, synthetic Auth; genuine Supabase E2E NOT VERIFIED |
| RC-12 | Staff CRUD/calendar/booking/clinical/notes/report/CSV/settings/link flow | PARTIAL: expanded Chrome/Edge + persisted local SQL and mounted linkage/settings; genuine Supabase E2E NOT VERIFIED |
| RC-13 | Portal isolation/local signout and wrong-role rejection | CONFIRMED browser SDK with real local SQL role checks and synthetic Auth |
| RC-14 | Availability scenario matrix, privacy and common rules | CONFIRMED locally: safe common matrix and blocked-date conflicts |
| RC-15 | Manila / UTC / New York booking/display/calendar/report/reminder consistency | CONFIRMED helpers/SQL/browser display; full live workflow matrix NOT VERIFIED |
| RC-16 | Reports beyond cap, UUID/midnight/status/filter isolation, audit paging | CONFIRMED: Phase 3 1505/audit105; independent Phase 4 1211/audit185 under three SQL timezones |
| RC-17 | CSV malicious fixtures, real browser Blob and spreadsheet application | CONFIRMED: safe encoder/current browser generation; historical Excel normal open; other importers NOT VERIFIED |
| RC-18 | SQL ledger → real handlers → mocked provider → persistence/callback; retries/leases | CONFIRMED local ledger → actual handler → mock provider; real delivery NOT VERIFIED |
| RC-19 | Scheduler structure, authentication, named-job uniqueness; live staging only if explicitly authorized | CONFIRMED structure/mocks; actual Vault/cron/net/HTTP NOT VERIFIED |
| RC-20 | Staff Realtime mounted isolation/cleanup; live transport only if isolated staging authorized | CONFIRMED mounted cleanup/debounce; live cross-client Realtime NOT VERIFIED |
| RC-21 | Local Chrome/Chromium, Edge and mobile viewport availability; synthetic-only browser requests | CONFIRMED Chrome/Edge/mobile synthetic flows/screenshots; full staff responsive matrix NOT VERIFIED |
| RC-22 | All named routes, direct refresh, invalid nested URLs | CONFIRMED named route refresh; nested blank 404 accepted LOW |
| RC-23 | Private categorical current-file secret scan without values | CONFIRMED: .env untracked, secret.txt tracked anon JWT; no privileged VITE names; validity/history NOT VERIFIED |
| RC-24 | Demo/default-account material categorical review; no passwords printed | CONFIRMED local demo password definitions/guard/docs; deployed account review NOT VERIFIED |
| RC-25 | Exact existing-install migration/deployment order | CONFIRMED: Phase 1 → 2 → 3 → report fix; Phase 1–3 installations need only fix_phase4_readonly_report_auth.sql; nothing deployed |
| RC-26 | Original audit and prior/new findings traced to evidence | CONFIRMED: original E1–E21 preserved; report authorization, dependency and profile-confirmation findings added |
| RC-27 | Separate school / staging / production readiness and explicit go/no-go prerequisites | School NOT READY connected; staging READY WITH PREREQUISITES; production NOT READY |
| RC-28 | Save complete final report sections A–W; verify nonempty and all sections present | CONFIRMED: nonempty final report, all A–W |
| RC-30 | SELECT FOR SHARE read-only report authorization | FIXED LOCALLY; HOSTED DEPLOYMENT NOT VERIFIED; 14 targeted groups pass |
| RC-31 | Current dependency audit | STILL BROKEN: nine packages, six high/three moderate; no forced upgrade |
| RC-32 | Patient profile save acknowledgement | LOW/STILL BROKEN: save persists, identity refresh loses success message; documented |
| RC-33 | Genuine full-platform verification environment | NOT VERIFIED: Docker absent/Supabase CLI unusable; no isolated staging target; no hosted mutation |
| RC-29 | Freeze comparison, historical report preservation, stop at Phase 4 | CONFIRMED: 82 source hashes/five report hashes match; no continuation app/SQL/package changes |

Final outcomes and supporting commands will be recorded in MEDICAPPOINTMENT_FINAL_VERIFICATION_REPORT.md. Unavailable hosted/provider/browser capabilities must be NOT VERIFIED rather than inferred from source existence.
