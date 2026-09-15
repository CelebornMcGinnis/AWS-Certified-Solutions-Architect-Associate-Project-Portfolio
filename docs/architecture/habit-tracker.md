# Habit Tracker — Architecture

Companion guide for `habit-tracker.drawio`.

Reflects the actual CDK stack in `cdk/lib/habit-tracker-stack.ts`. This is an
**anonymous, device-local** demo — no Cognito, no sign-up. The browser generates a
random id and stores it in `localStorage`, sending it as plain request data. That
tradeoff is disclosed on the page itself; it's deliberate given there's nothing here
worth the friction of a real account system.

## Flow

1. **Website Visitor** calls **Amazon API Gateway** (HTTP API) to create/list/delete
   habits and record check-ins.
2. Five separate Lambda functions handle the API surface: create-habit, list-habits,
   delete-habit, check-in, and list-check-ins. They read/write two DynamoDB tables —
   `HabitsTable` (with an `OwnerIndex` GSI) and a separate `CheckInsTable` keyed by
   `habitId` + `date`.
3. A sixth Lambda, `ResetStreaksFunction`, is invoked on a **daily EventBridge
   Scheduler** cron (00:10 UTC, not exactly midnight, to avoid racing a check-in right
   at the day boundary) — it scans every habit and zeroes the streak for any owner who
   missed the previous day's check-in.

The diagram simplifies the six Lambdas + two tables to a single "habit_handler" node
and one "Habits Table" for readability — the scheduled reset path is shown in full,
since it's the one architecturally distinct piece: **this is the only project on the
site with a scheduled background job** rather than a purely request- or event-driven
one.

## Services

| Service | Role |
|---|---|
| Amazon API Gateway | HTTP API for habit CRUD and check-ins |
| AWS Lambda | Create/list/delete/check-in/list-checkins handlers, plus the scheduled reset |
| Amazon EventBridge Scheduler | Daily cron triggering `ResetStreaksFunction` |
| Amazon DynamoDB | `HabitsTable` (+`OwnerIndex` GSI) and `CheckInsTable` |

## Key design decisions

- **No auth, by design.** The device-id-in-localStorage model is intentionally
  lightweight; `moderated-image-gallery` is this site's example of a properly
  authenticated project.
- **Streak reset is the site's only scheduled job.** Every other project reacts to a
  request or an S3 event; this is the sole EventBridge Scheduler cron.
- **Both stages fully destroy.** An anonymous, device-local demo has no data worth
  protecting past a redeploy, so both prod and beta use `RemovalPolicy.DESTROY`.
