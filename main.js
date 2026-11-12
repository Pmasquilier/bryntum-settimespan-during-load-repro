import { AjaxHelper, SchedulerPro } from '@bryntum/schedulerpro';

const logElement = document.getElementById('log');
const log = message => {
    logElement.textContent += `${new Date().toLocaleTimeString()}  ${message}\n`;
    console.log(message);
};

const RESOURCE_COUNT = 200;
const CHUNK_SIZE = 50;

const resources = Array.from({ length : RESOURCE_COUNT }, (_, i) => ({ id : i + 1, name : `Employee ${i + 1}` }));
// 60 events per resource, of which the first is a weekly series master; a page of 50 resources is 3000 events.
const EVENTS_PER_RESOURCE = 60;
const events = resources.flatMap(({ id }) => Array.from({ length : EVENTS_PER_RESOURCE }, (_, i) => ({
    id         : id * 1000 + i,
    resourceId : id,
    name       : `Shift ${id}-${i}`,
    // Everything starts the week of Jan 5, before the span the repro moves to.
    startDate  : `2026-01-0${5 + (i % 3)}T${String(6 + (i % 10)).padStart(2, '0')}:00`,
    endDate    : `2026-01-0${5 + (i % 3)}T${String(7 + (i % 10)).padStart(2, '0')}:30`,
    // Duration is stated in the data, as an app that persists durations does (90 minutes, in milliseconds).
    duration     : 90 * 60 * 1000,
    durationUnit : 'millisecond',
    ...(i === 0 ? { recurrenceRule : 'FREQ=WEEKLY;INTERVAL=1' } : {})
})));

const requestPacket = options => JSON.parse(options.body ?? options.queryParams.data);

AjaxHelper.mockUrl('load', (url, params, options) => {
    const { startIndex, count } = requestPacket(options).params;
    const page = resources.slice(startIndex, startIndex + count);
    const pageIds = new Set(page.map(({ id }) => id));
    return {
        responseText : JSON.stringify({
            success   : true,
            project   : { hoursPerDay : 24, daysPerWeek : 7, daysPerMonth : 30 },
            resources : { rows : page, total : RESOURCE_COUNT },
            events    : { rows : events.filter(({ resourceId }) => pageIds.has(resourceId)) }
        }),
        delay : 300
    };
});

const createScheduler = () => new SchedulerPro({
    appendTo   : 'container',
    startDate  : new Date(2026, 0, 5),
    endDate    : new Date(2026, 0, 12),
    viewPreset : 'weekAndDayLetter',
    features   : { resourceTimeRanges : true },
    columns    : [{ text : 'Employee', field : 'name', width : 160 }],
    project    : {
        lazyLoad : { chunkSize : CHUNK_SIZE },
        loadUrl  : 'load',
        autoLoad : true
    }
});

const scheduler = createScheduler();
const { project } = scheduler;

// The time span change stands in for a user moving to another period while the rows reload. It runs on the first
// macrotask after the load resolves: the event store is already filled, the engine has not re-joined its records yet
// (that join is buffered by 10 ms).
const run = async useWorkaround => {
    const errors = [];
    const onError = event => errors.push(event.error?.stack ?? String(event.message));
    window.addEventListener('error', onError);

    const change = () => {
        try {
            scheduler.setTimeSpan(new Date(2026, 0, 12), new Date(2026, 0, 19));
            log(`setTimeSpan done (engine ready: ${scheduler.isEngineReady})`);
        }
        catch (error) {
            errors.push(error.stack);
            log(`setTimeSpan threw: ${error.message}`);
        }
    };

    let fired = false;
    project.on({
        load() {
            fired = true;
            setTimeout(() => {
                log(`rows loaded, engine ready: ${scheduler.isEngineReady}`);
                if (useWorkaround) {
                    scheduler.whenProjectReady(change);
                }
                else {
                    change();
                }
            }, 0);
        },
        once : true
    });

    project.load();
    await new Promise(resolve => setTimeout(resolve, 2000));
    window.removeEventListener('error', onError);
    log(errors.length ? `BUG — ${errors[0].split('\n')[0]}` : 'OK — no error');
    return { fired, errors };
};

document.getElementById('plain').addEventListener('click', () => run(false));
document.getElementById('workaround').addEventListener('click', () => run(true));

window.scheduler = scheduler;
window.run = run;
window.createScheduler = createScheduler;
