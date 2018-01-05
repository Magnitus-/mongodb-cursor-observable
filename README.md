# Overview

This library offers 4 different observables to traverse the results of MongoDB cursors.

It offers 4 observable categories, each one with a higher level of functionality than the last:

- next$
- iterator$
- cursor$
- bufferedCursor$

## next$

### Overview

The next$ observable simply emit a batch of documents (each document being emitted separately) from the cursor that is passed to it before completing.

It is a warm observable: it will wait until it is subscribed on before emiting, but as it operates directly on the cursor passed to it, separate subscribers will just iterate further on the same cursor rather than each get a fresh one.

### Signature

```
next$(cursor, batchSize)
```

It will return an observable that emits documents.

- cursor: The MongoDB cursor that will be iterated on
- batchSize: The maximum number of documents to return before completing (note that if the cursor has fewer documents left to iterate on, fewer documents will be emitted)

### Example

```
const mongodb = require('mongodb');
const Rx = require('rxjs');
const lib = require('mongodb-cursor-observable');
const next$ = lib.next$;

mongodb.MongoClient.connect('mongodb://database:27017').then((conn) => {
    let collection = conn.db('test').collection('someCollection');

    console.log('We will now display the first 100 results of the cursor');
    Rx.Observable.of(collection.find({}).batchSize(100))
        .mergeMap((cursor) => next$(cursor, 100))
        .subscribe(
            (doc) => {console.log(doc);},
            (err) => {console.log(err);},
            () => {console.log('Iteration complete!');}
        );
})
```

## iterator$

### Overview

The iterator$ allows you to iterate over a mongoDB cursor, returing a batch of results and allowing you to trigger the next batch via an eventEmitter.

It will provide a cue when it is at the end of a batch by emitting the value 'more' and it will also emit the value 'end' (and then complete) when the cursor is exhausted.

While it technically relies on the cursor that is passed to it as an argument, it makes a separate copy of that cursor before iterating and thus behave like a cold observable (ie, will only start emitting after subscription and different subscribers will get fresh results and not interfere with one another)

Also note that this observable will not automatically emit the first batch of results after subscription (the first batch has to be triggered with the eventEmitter also). It you want to first batch to auto-emit, you can wrap this observable in another one that emits the first batch after subscription (as shown in the example below).

### Signature

```
iterator$(cursor, batchSize, nextEmitter)
```

It will return an observable that emits documents.

- cursor: The MongoDB cursor that will be iterated on (note that a separate copy of that cursor is made so if you set the original cursor to never timeout, you'll have to clean it manually afterwards)
- batchSize: The maximum number of documents that will be emitted per batch before waiting for **nextEmitter** to emit **next** (again, the number of results emitted in the final batch may be smaller than this amount if the cursor has fewer results to return before exhaustion)
- nextEmitter: The eventEmitter instance that the observable will listen to for 'next' events in order to emit each batch of documents.

### Example

```
const mongodb = require('mongodb');
const Rx = require('rxjs');

const lib = require('mongodb-cursor-observable');
const iterator$ = lib.iterator$;
const CursorEmitter = lib.CursorEmitter;

mongodb.MongoClient.connect('mongodb://database:27017').then((conn) => {
    let collection = conn.db('test').collection('someCollection');

    //We user the eventEmitter derivative provided by the library there,
    //but any derivative of eventEmitter would do
    const nextEmitter = new CursorEmitter();

    //iterator that will emit 'next' right after subscription for the first batch of results
    const autoStartIterator$ = (cursor, batchSize, nextEmitter) => {
        return Rx.Observable.create((subscriber) => {
            iterator$(cursor, batchSize,  nextEmitter)
                .subscribe(
                    subscriber.next.bind(subscriber),
                    subscriber.error.bind(subscriber),
                    subscriber.complete.bind(subscriber)
                );
            nextEmitter.emit('next');
        });
    }

    console.log('We will now display all the results of the cursor');
    Rx.Observable.of(collection.find({}).batchSize(100))
        .mergeMap((cursor) => autoStartIterator$(cursor, 100, nextEmitter))
        .subscribe(
            (doc) => {
                if(doc === 'more') {
                    console.log('100 results traversed already. On to the next 100...');
                    nextEmitter.emit('next');
                } else if(doc === 'end') {
                    console.log('The cursor is now exhausted. The observable will now complete.');
                } else {
                    console.log(doc);
                }
            },
            (err) => {console.log(err);},
            () => {console.log('Iteration complete!');}
        );
})
```

## cursor$

### Overview

The cursor$ observable will emit documents from the provided cursor argument until exhaustion.

Like the iterator$ observable, it is cold, but unlike the iterator$ observable, the documents will be emitted automatically until exhaustion without the need to manually trigger batches.

However, documents are still iterated in batches under the hood and this observable optionally allows the caller to introduce a delay (in milliseconds) between batches which will result in a corresponding pause between the emittion of the last document of a batch and the first document of the next batch.

The optional delay might come in handy if, for example, you have a background job that needs to perform more database operations (updates, deletions, etc) based on cursor results and you don't want to risk the database becoming less responsive to other traffic during that processing.

### Signature

```
cursor$(cursor, batchSize, batchInterval)
```

It will return an observable that emits documents.

- cursor: The MongoDB cursor that will be iterated on (note that a separate copy of that cursor is made so if you set the original cursor to never timeout, you'll have to clean it manually afterwards)
- batchSize: The number of documents that will be emitted for each batch. Note that if batchInterval is 0 (ie, no delay between batches), this value will have no visible outward effect.
- batchInterval: The number of milliseconds to pause between the emittion of the last document in a batch and the first document in the next batch. If the value is 0, then there is no pause.

### Example

```
const mongodb = require('mongodb');
const Rx = require('rxjs');

const lib = require('mongodb-cursor-observable');
const cursor$ = lib.cursor$;

mongodb.MongoClient.connect('mongodb://database:27017').then((conn) => {
    let collection = conn.db('test').collection('someCollection');

    console.log('We will now display all the results of the cursor');
    console.log('There will be a pause of 200ms for every 500th document displayed...')
    Rx.Observable.of(collection.find({}).batchSize(500))
        .mergeMap((cursor) => cursor$(cursor, 500, 200))
        .subscribe(
            (doc) => {console.log(doc);},
            (err) => {console.log(err);},
            () => {console.log('Iteration complete!');}
        );
})
```

## bufferedCursor$

### Overview

The bufferedCursor$ observable is almost the same as the cursor$ observable, with one notable difference: instead of emitting individual documents, it emits arrays of documents.

The number of documents in each emitted array is the batch size, except probably for the last emitted array (due to cursor exhaustion when the batch size is not a divisor of the number of documents returned by the cursor).

### Signature

```
bufferedCursor$(cursor, batchSize, batchInterval)
```

It will return an observable that emits arrays of documents.

- cursor: The MongoDB cursor that will be iterated on (note that a separate copy of that cursor is made so if you set the original cursor to never timeout, you'll have to clean it manually afterwards)
- batchSize: The number of documents that will be present in each emitted array (except probably the last emitted array before cursor exhaustion which is likely to contain fewer documents)
- batchInterval: The number of milliseconds to pause between emittions. If the value is 0, then there is no pause.

### Example

```
const mongodb = require('mongodb');
const Rx = require('rxjs');

const lib = require('mongodb-cursor-observable');
const bufferedCursor$ = lib.bufferedCursor$;

mongodb.MongoClient.connect('mongodb://database:27017').then((conn) => {
    let collection = conn.db('test').collection('someCollection');

    console.log('We will now display all the results of the cursor grouped in arrays of size 20');
    console.log('There will be a pause of 50ms between every emittion...')
    Rx.Observable.of(collection.find({}).batchSize(20))
        .mergeMap((cursor) => bufferedCursor$(cursor, 20, 50))
        .subscribe(
            (docs) => {console.log(docs);},
            (err) => {console.log(err);},
            () => {console.log('Iteration complete!');}
        );
})
```
