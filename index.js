const Rx = require('rxjs');
const R = require('ramda');
const EventEmitter = require('events');

class CursorEmitter extends EventEmitter {}

const filterStatusGivenBatchSize = (batchSize) => {
    return R.ifElse(
        R.propEq('ordDoc', 'halt'),
        R.ifElse(
            R.pathEq(['last', 'ord'], batchSize),
            () => 'more',
            () => 'end'
        ),
        R.prop('ordDoc')
    )
};

const docIfHas = R.ifElse(
    R.has('doc'),
    R.prop('doc'),
    R.identity
);

const next$ = R.curry((cursor, batchSize) => {
    return Rx.Observable.range(1, batchSize)
        .mergeMap((index) => {
            return Rx.Observable.fromPromise(cursor.next());
        })
        .scan((acc, doc) => {
            return {
                doc: doc,
                ord: acc.ord + 1
            }
        }, {ord: 0})
        .takeWhile((ordDoc) => {
            return ordDoc.doc !== null;
        });
});

const iterator$ = R.curry((cursor, batchSize, cursorEvents) => {
    const cursorComplete$ = Rx.Observable.fromEvent(cursorEvents, 'complete');
    const filterStatus = filterStatusGivenBatchSize(batchSize);

    return Rx.Observable.fromEvent(cursorEvents, 'next')
        .takeUntil(cursorComplete$)
        .mergeMap(() => {
            return Rx.Observable.concat(next$(cursor, batchSize), Rx.Observable.of('halt'));
        })
        .scan((last, ordDoc) => {
            return filterStatus({'ordDoc': ordDoc, 'last': last})
        }, {ord: 0})
        .map(docIfHas)
});

const waitingCursor$ = R.curry((cursor, batchSize, batchInterval, cursorEvents) => {
    return iterator$(cursor, batchSize, cursorEvents)
        .do((doc) => {
            if(doc === 'more') {
                setTimeout(() => { cursorEvents.emit('next'); }, batchInterval);
            } else if(doc === 'end') {
                cursorEvents.emit('complete');
            }
        })
        .filter(R.is(Object))
});

const cursor$ = R.curry((cursor, batchSize, batchInterval) => {
    const cursorEvents = new CursorEmitter();

    return Rx.Observable.create(function (observer) {
        waitingCursor$(cursor, batchSize, batchInterval, cursorEvents)
        .subscribe(
            observer.next.bind(observer),
            observer.error.bind(observer),
            observer.complete.bind(observer)
        );
        cursorEvents.emit('next');
    });
});

const bufferedCursor$ = R.curry((cursor, batchSize, batchInterval, mapFn) => {
    let _cursor$ = cursor$(cursor, batchSize, batchInterval)
    if(mapFn) {
        return _cursor$
            .map(mapFn)
            .bufferCount(batchSize);
    } else {
        return _cursor$
            .bufferCount(batchSize);
    }
});

module.exports = {
    'CursorEmitter': CursorEmitter,
    'next$': next$,
    'iterator$': iterator$,
    'cursor$': cursor$,
    'bufferedCursor$': bufferedCursor$
}
