# setTimeSpan right after a lazy-loaded reload throws "Cannot read properties of undefined (reading 'activeTransaction')"

Minimal repro for Bryntum support. Scheduler Pro 7.3.7, plain JS + Vite, the stock CrudManager transport
(`loadUrl` mocked with `AjaxHelper.mockUrl`), `lazyLoad: true`, `resourceTimeRanges` feature on, weekly recurring
events whose duration is stated in the data (`duration` in milliseconds, `durationUnit: 'millisecond'`).

## Run

```sh
npm install   # needs access to npm.bryntum.com (licensed or trial account)
npm run dev
```

Open http://localhost:5192/ and click a button, or let a script do it in a fresh page each time (10 runs per case):

```sh
npm run dev                    # in one terminal
REPRO_RUNS=10 npm run repro    # in another
```

## Steps

1. Load the scheduler: 200 resources, lazy-loaded 50 at a time, 60 events each, the first one of each a weekly series master.
2. Click "Reload the rows, then setTimeSpan right after the load" (`project.load()`).
3. On the first macrotask after the load resolves, call `scheduler.setTimeSpan(Jan 12, Jan 19)`.

The second button does the same but waits for `scheduler.whenProjectReady()` before `setTimeSpan`.

## Expected

The time span changes, no error.

## Actual

`setTimeSpan` throws:

```
TypeError: Cannot read properties of undefined (reading 'activeTransaction')
    at ModelClass.run                          (Entity.run)
    at get durationMS                          (SchedulerPro/model/EventModel.js:738)
    at WeeklyRecurrenceIterator.processIterationConfig
    at RecurrenceModel.forEachOccurrence
    at hasOccurrencesInDateRange
    at Array.some                              (TimelineBase.hasVisibleEvents)
```

Same stack as a production error we see in our app (4 events).

## Results (Playwright headless, clean `npm install`, Scheduler Pro 7.3.7)

| Case | Runs that threw |
| --- | --- |
| `setTimeSpan` right after the load | 10/10 |
| `whenProjectReady` first, then `setTimeSpan` | 0/10 |

Same 10/10 and 0/10 on 7.3.8, the current `latest`.

## Where it comes from (7.3.7 source, `source/lib/`)

- `Scheduler/data/mixin/ProjectCrudManager.js:149-157`: when a load response arrives with `repopulateOnDataset`, the
  project unlinks the replica; the records leave the engine graph (`record.graph` is undefined).
- `Engine/quark/model/scheduler_basic/SchedulerBasicProjectMixin.js:656-668` and `:1220`: re-entering the records is
  `repopulateReplica`, buffered by 10 ms. In between `isEngineReady()` is false (`:1161`), while the event store is already filled.
- `Scheduler/view/TimelineBase.js:2121`: `refresh()` evaluates `hasVisibleEvents` before it checks `isEngineReady`.
- `Scheduler/view/TimelineBase.js:966-972`: with the `resourceTimeRanges` feature on (`ResourceTimeRangesBase.js:74-80`
  returns true when it has no range in view), `hasVisibleEvents` runs `t.hasOccurrencesInDateRange(...)` on every record.
- `Scheduler/data/util/recurrence/AbstractRecurrenceIterator.js:115`: reads `timeSpan.durationMS` of the series master.
- `SchedulerPro/model/EventModel.js:738-745`: `durationMS` calls `this.run('convertDurationGen', ...)` when the duration is a
  number and the project has its unit rates.
- `ChronoGraph/replica/Entity.js:246`: `run()` does `this.graph.activeTransaction`; `this.graph` is undefined. Throws.

Without `resourceTimeRanges` the guard `!this.noFeatureElementsInAxis()` is always true (the default returns `undefined`),
so `hasVisibleEvents` never reaches the records and nothing throws.

## Notes

- A real gesture reaches this when the period changes while rows reload. The window only lasts as long as the engine
  re-join (10 ms buffer, longer with more data), so the button queues `setTimeSpan` on the first macrotask after the load.
- The same call inside `onCrudManagerBeforeApplyResponse` / `ApplyResponse` is safe: `CrudManagerView.js:117-128`
  suspends the view refresh there. The throw needs the refresh to be active, which it is again right after the load.
- Not checked on the official demos: no demo has a lazy-loaded project with recurring events and `setTimeSpan`.
