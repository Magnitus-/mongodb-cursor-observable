const Rx = require('rxjs');
const R = require('ramda');
const EventEmitter = require('events');

class CursorEmitter extends EventEmitter {}

const next$ = R.curry((cursor, batchSize) => {
    return Rx.Observable.create(function (observer) {
        const cursorEvents = new CursorEmitter();

        Rx.Observable.fromEvent(cursorEvents, 'next')
            .scan(R.add(1), 0)
            .takeWhile(R.gte(batchSize))
            .mergeMap(() => {
                return Rx.Observable.fromPromise(cursor.next());
            })
            .takeWhile(R.compose(R.not, R.isNil))
            .do(() => {
                cursorEvents.emit('next');
            })
            .subscribe(
                observer.next.bind(observer),
                observer.error.bind(observer),
                observer.complete.bind(observer)
            );

        cursorEvents.emit('next');
    });
});

const iterator$ = R.curry((cursor, batchSize, cursorEvents) => {
    return Rx.Observable.create(function (observer) {
        const cursorComplete$ = Rx.Observable.fromEvent(cursorEvents, 'complete').take(1);
        let cursorCopy = cursor.clone();

        Rx.Observable.fromEvent(cursorEvents, 'next')
            .takeUntil(cursorComplete$)
            .mergeMap(() => {
                return Rx.Observable.concat(
                    next$(cursorCopy, batchSize),
                    Rx.Observable.of(cursorCopy)
                        .mergeMap((cursorCopy) => {
                            if(cursorCopy.isClosed()) {
                                return Rx.Observable.of(false);
                            } else {
                                return Rx.Observable.fromPromise(cursorCopy.hasNext())
                            }
                        })
                        .map(R.ifElse(
                            R.identity,
                            () => 'more',
                            () => 'end'
                        ))
                        .do((result) => {
                            if(result === 'end') {
                                if(!cursorCopy.isClosed()) {
                                    cursorCopy.close();
                                }
                                cursorEvents.emit('complete');
                            }
                        })
                )
            })
            .subscribe(
                observer.next.bind(observer),
                observer.error.bind(observer),
                observer.complete.bind(observer)
            )
    });
});

const cursor$ = R.curry((cursor, batchSize, batchInterval) => {
    return Rx.Observable.create(function (observer) {
        const cursorEvents = new CursorEmitter();

        iterator$(cursor, batchSize, cursorEvents)
            .do((doc) => {
                if(doc === 'more') {
                    if(batchInterval > 0) {
                        setTimeout(() => { cursorEvents.emit('next'); }, batchInterval);
                    } else {
                        cursorEvents.emit('next');
                    }
                } else if(doc === 'end') {
                    cursorEvents.emit('complete');
                }
            })
            .filter(R.is(Object))
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
