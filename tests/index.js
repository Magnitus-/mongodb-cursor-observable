const mongodb = require('mongodb');
const Rx = require('rxjs');
const R = require('ramda');
const lib = require('../index');

const massDelete$ = (collection) => {
    return Rx.Observable.fromPromise(collection.deleteMany({}))
    .mapTo(collection);
}

const massInsert$ = (collection) => {
    return Rx.Observable.range(1, 350)
    .map(R.assocPath(['insertOne', 'document', '_id'], R.__, {}))
    .reduce(R.flip(R.append), [])
    .mergeMap((writes) => Rx.Observable.fromPromise(collection.bulkWrite(writes)))
}

function testNextOperator(from, to, test) {
    return Rx.Observable.create(subscriber => {
        var source = this;
        source.scan(
            (index, doc) => {
                test.ok(doc._id === index && doc._id <= to, "Ensure doc._id with current value of " + doc._id + " is expected value of " + index + " and less than or equal to " + to);
                return index + 1;
            },
            from
        )
        .subscribe(
            subscriber.next.bind(subscriber),
            subscriber.error.bind(subscriber),
            subscriber.complete.bind(subscriber)
        )
    });
}

function testIteratorScanCallback(test, emitter) {
    return (breakpoints, doc) => {
        if(breakpoints[0].from <= breakpoints[0].to) {
            test.ok(R.pathEq([0, 'from'], doc._id, breakpoints), "Expect for doc._id that " + doc._id + " === " + R.path([0, 'from'], breakpoints));
            return R.over(R.lensPath([0, 'from']), R.add(1), breakpoints)
        } else {
            if(doc === 'more') {
                emitter.emit('next');
            }
            test.ok(R.pathEq([0, 'breakpoint'], doc, breakpoints), "Expect for breakpoint that " + doc + " === " + R.path([0, 'breakpoint'], breakpoints));
            return R.slice(1, Infinity, breakpoints);
        }
    }
}

function testCursorScanCallback(test) {
    return (acc, doc) => {
        test.ok(doc._id === acc.from, "Ensure doc._id with current value of " + doc._id + " === " + acc.from);
        let now = new Date();
        if(acc.from > 1 && acc.batchSize && acc.batchInterval && (acc.from % acc.batchSize === 1)) {
            test.ok((now.getTime() - acc.lastNow.getTime()) >= acc.batchInterval, "Ensure " + acc.batchInterval + "ms delay is respected between batches");
        }
        return R.compose(
            R.over(R.lensProp('from'), R.add(1)),
            R.assoc('lastNow', now)
        )(acc);
    }
}

function testBufferedCursorScanCallback(test) {
    return (acc, docs) => {
        let now = new Date();
        let expectedLength = R.min(acc.batchSize, acc.to - acc.from + 1)
        if(acc.from > 1) {
            test.ok((now.getTime() - acc.lastNow.getTime()) >= acc.batchInterval, "Ensure " + acc.batchInterval + "ms delay is respected between batches")
        }
        test.ok(docs.length === expectedLength, "Ensure that batch of document of length " + docs.length + " === " + expectedLength)

        docs.reduce((acc, doc) => {
            test.ok(doc === acc, "Ensure that doc of value " + doc + " === " + acc);
            return acc + 1
        }, acc.from)

        return R.compose(
            R.over(R.lensProp('from'), R.add(docs.length)),
            R.assoc('lastNow', now)
        )(acc)
    }
}

module.exports = {
    setUp: function (callback) {
        Rx.Observable.fromPromise(
            mongodb.MongoClient.connect('mongodb://database:27017', {native_parser:true})
        )
        .do((conn) => {
            this.conn = conn;
        })
        .mergeMap((conn) => Rx.Observable.fromPromise(conn.db('test').createCollection('dummy')))
        .do((dummyCollection) => {
            this.dummyCollection = dummyCollection;
        })
        .mergeMap(massDelete$)
        .mergeMap(massInsert$)
        .subscribe(
            () => {},
            (err) => {console.log(err); throw err;},
            () => {callback();}
        );
    },
    tearDown: function (callback) {
        Rx.Observable.fromPromise(this.dummyCollection.drop())
        .mergeMap(() => Rx.Observable.fromPromise(this.conn.close(true)))
        .subscribe(
            () => {},
            (err) => {console.log(err); throw err;},
            () => {callback();}
        );
    },
    next: function(test) {
        test.expect(350);
        Rx.Observable.of(this.dummyCollection.find({}).batchSize(100))
        .mergeMap((cursor) => {
            return Rx.Observable.concat(
                testNextOperator.call(lib.next$(cursor, 100), 1, 100, test),
                testNextOperator.call(lib.next$(cursor, 100), 101, 200, test),
                testNextOperator.call(lib.next$(cursor, 100), 201, 300,test),
                testNextOperator.call(lib.next$(cursor, 100), 301, 350,test)
            )
        })
        //.mergeMap(lib.next$(R.__, 100))
        .subscribe(
            () => {},
            (err) => {console.log(err); throw err;},
            () => {test.done()}
        );
    },
    iterator: function(test) {
        test.expect(354);
        const emitter = new lib.CursorEmitter();
        Rx.Observable.of(this.dummyCollection.find({}).batchSize(100))
        .mergeMap(lib.iterator$(R.__, 100,  emitter))
        .scan(
            testIteratorScanCallback(test, emitter),
            [
                {
                    from: 1,
                    to: 100,
                    breakpoint: 'more'
                },
                {
                    from: 101,
                    to: 200,
                    breakpoint: 'more'
                },
                {
                    from: 201,
                    to: 300,
                    breakpoint: 'more'
                },
                {
                    from: 301,
                    to: 350,
                    breakpoint: 'end'
                }
            ]
        )
        .subscribe(
            () => {},
            (err) => {console.log(err); throw err;},
            () => {test.done()}
        );
        emitter.emit('next');
    },
    iteratorWithBatchSizeModuloZero: function(test) {
        test.expect(351);
        const emitter = new lib.CursorEmitter();
        Rx.Observable.of(this.dummyCollection.find({}).batchSize(350))
        .mergeMap(lib.iterator$(R.__, 350,  emitter))
        .scan(
            testIteratorScanCallback(test, emitter),
            [
                {
                    from: 1,
                    to: 350,
                    breakpoint: 'end'
                }
            ]
        )
        .subscribe(
            () => {},
            (err) => {console.log(err); throw err;},
            () => {test.done()}
        );
        emitter.emit('next');
    },
    iteratorColdness: function(test) {
        test.expect(702);

        const testIterator$ = (cursor) => {
            return Rx.Observable.create((subscriber) => {
                const emitter = new lib.CursorEmitter();

                lib.iterator$(cursor, 350,  emitter)
                    .scan(
                        testIteratorScanCallback(test, emitter),
                        [
                            {
                                from: 1,
                                to: 350,
                                breakpoint: 'end'
                            }
                        ]
                    )
                    .subscribe(
                        subscriber.next.bind(subscriber),
                        subscriber.error.bind(subscriber),
                        subscriber.complete.bind(subscriber)
                    )

                emitter.emit('next');
            });
        }

        Rx.Observable.of(this.dummyCollection.find({}).batchSize(350))
            .mergeMap((cursor) => {
                return Rx.Observable.concat(
                    testIterator$(cursor),
                    testIterator$(cursor)
                );
            })
            .subscribe(
                () => {},
                (err) => {console.log(err); throw err;},
                () => {test.done()}
        );
    },
    cursor: function(test) {
        test.expect(350);
        Rx.Observable.of(this.dummyCollection.find({}).batchSize(100))
            .mergeMap(lib.cursor$(R.__, 100,  0))
            .scan(
                testCursorScanCallback(test),
                {
                    from: 1,
                    to: 350
                }
            )
            .subscribe(
                () => {},
                (err) => {console.log(err); throw err;},
                () => {test.done()}
            );
    },
    cursorWithInterval: function(test) {
        test.expect(353);
        Rx.Observable.of(this.dummyCollection.find({}).batchSize(100))
            .mergeMap(lib.cursor$(R.__, 100,  100))
            .scan(
                testCursorScanCallback(test),
                {
                    from: 1,
                    to: 350,
                    batchSize: 100,
                    batchInterval: 100
                }
            )
            .subscribe(
                () => {},
                (err) => {console.log(err); throw err;},
                () => {test.done()}
            );
    },
    bufferedCursor: function(test) {
        test.expect(357);
        Rx.Observable.of(this.dummyCollection.find({}).batchSize(100))
        .mergeMap(lib.bufferedCursor$(R.__, 100,  100, R.prop('_id')))
        .scan(
            testBufferedCursorScanCallback(test),
            {
                from: 1,
                to: 350,
                batchSize: 100,
                batchInterval: 100
            }
        )
        .subscribe(
            () => {},
            (err) => {console.log(err); throw err;},
            () => {test.done()}
        );
    }
}
