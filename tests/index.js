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
    }/*,
    iterator: function(test) {
        test.expect(0);
        const emitter = new lib.CursorEmitter();
        Rx.Observable.of(this.dummyCollection.find({}).batchSize(100))
        .mergeMap(lib.iterator$(R.__, 100,  emitter))
        .subscribe(
            console.log,
            (err) => {console.log(err); throw err;},
            () => {test.done()}
        );
        emitter.emit('next');
    },
    main: function(test) {
        test.expect(0);
        Rx.Observable.of(this.dummyCollection.find({}).batchSize(100))
        .mergeMap(lib.cursor$(R.__, 100, 100))
        .subscribe(
            console.log,
            (err) => {console.log(err); throw err;},
            () => {test.done()}
        );
    }*/,
    mapFn: function(test) {
        test.expect(0);
        test.done();
    },
    noBuffer: function(test) {
        test.expect(0);
        test.done();
    }
}
