(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

(function() {
  function toArray(arr) {
    return Array.prototype.slice.call(arr);
  }

  function promisifyRequest(request) {
    return new Promise(function(resolve, reject) {
      request.onsuccess = function() {
        resolve(request.result);
      };

      request.onerror = function() {
        reject(request.error);
      };
    });
  }

  function promisifyRequestCall(obj, method, args) {
    var request;
    var p = new Promise(function(resolve, reject) {
      request = obj[method].apply(obj, args);
      promisifyRequest(request).then(resolve, reject);
    });

    p.request = request;
    return p;
  }
  
  function promisifyCursorRequestCall(obj, method, args) {
    var p = promisifyRequestCall(obj, method, args);
    return p.then(function(value) {
      if (!value) return;
      return new Cursor(value, p.request);
    });
  }

  function proxyProperties(ProxyClass, targetProp, properties) {
    properties.forEach(function(prop) {
      Object.defineProperty(ProxyClass.prototype, prop, {
        get: function() {
          return this[targetProp][prop];
        }
      });
    });
  }

  function proxyRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return promisifyRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function proxyMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return this[targetProp][prop].apply(this[targetProp], arguments);
      };
    });
  }

  function proxyCursorRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return promisifyCursorRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function Index(index) {
    this._index = index;
  }

  proxyProperties(Index, '_index', [
    'name',
    'keyPath',
    'multiEntry',
    'unique'
  ]);

  proxyRequestMethods(Index, '_index', IDBIndex, [
    'get',
    'getKey',
    'getAll',
    'getAllKeys',
    'count'
  ]);

  proxyCursorRequestMethods(Index, '_index', IDBIndex, [
    'openCursor',
    'openKeyCursor'
  ]);

  function Cursor(cursor, request) {
    this._cursor = cursor;
    this._request = request;
  }

  proxyProperties(Cursor, '_cursor', [
    'direction',
    'key',
    'primaryKey',
    'value'
  ]);

  proxyRequestMethods(Cursor, '_cursor', IDBCursor, [
    'update',
    'delete'
  ]);

  // proxy 'next' methods
  ['advance', 'continue', 'continuePrimaryKey'].forEach(function(methodName) {
    if (!(methodName in IDBCursor.prototype)) return;
    Cursor.prototype[methodName] = function() {
      var cursor = this;
      var args = arguments;
      return Promise.resolve().then(function() {
        cursor._cursor[methodName].apply(cursor._cursor, args);
        return promisifyRequest(cursor._request).then(function(value) {
          if (!value) return;
          return new Cursor(value, cursor._request);
        });
      });
    };
  });

  function ObjectStore(store) {
    this._store = store;
  }

  ObjectStore.prototype.createIndex = function() {
    return new Index(this._store.createIndex.apply(this._store, arguments));
  };

  ObjectStore.prototype.index = function() {
    return new Index(this._store.index.apply(this._store, arguments));
  };

  proxyProperties(ObjectStore, '_store', [
    'name',
    'keyPath',
    'indexNames',
    'autoIncrement'
  ]);

  proxyRequestMethods(ObjectStore, '_store', IDBObjectStore, [
    'put',
    'add',
    'delete',
    'clear',
    'get',
    'getAll',
    'getAllKeys',
    'count'
  ]);

  proxyCursorRequestMethods(ObjectStore, '_store', IDBObjectStore, [
    'openCursor',
    'openKeyCursor'
  ]);

  proxyMethods(ObjectStore, '_store', IDBObjectStore, [
    'deleteIndex'
  ]);

  function Transaction(idbTransaction) {
    this._tx = idbTransaction;
    this.complete = new Promise(function(resolve, reject) {
      idbTransaction.oncomplete = function() {
        resolve();
      };
      idbTransaction.onerror = function() {
        reject(idbTransaction.error);
      };
    });
  }

  Transaction.prototype.objectStore = function() {
    return new ObjectStore(this._tx.objectStore.apply(this._tx, arguments));
  };

  proxyProperties(Transaction, '_tx', [
    'objectStoreNames',
    'mode'
  ]);

  proxyMethods(Transaction, '_tx', IDBTransaction, [
    'abort'
  ]);

  function UpgradeDB(db, oldVersion, transaction) {
    this._db = db;
    this.oldVersion = oldVersion;
    this.transaction = new Transaction(transaction);
  }

  UpgradeDB.prototype.createObjectStore = function() {
    return new ObjectStore(this._db.createObjectStore.apply(this._db, arguments));
  };

  proxyProperties(UpgradeDB, '_db', [
    'name',
    'version',
    'objectStoreNames'
  ]);

  proxyMethods(UpgradeDB, '_db', IDBDatabase, [
    'deleteObjectStore',
    'close'
  ]);

  function DB(db) {
    this._db = db;
  }

  DB.prototype.transaction = function() {
    return new Transaction(this._db.transaction.apply(this._db, arguments));
  };

  proxyProperties(DB, '_db', [
    'name',
    'version',
    'objectStoreNames'
  ]);

  proxyMethods(DB, '_db', IDBDatabase, [
    'close'
  ]);

  // Add cursor iterators
  // TODO: remove this once browsers do the right thing with promises
  ['openCursor', 'openKeyCursor'].forEach(function(funcName) {
    [ObjectStore, Index].forEach(function(Constructor) {
      Constructor.prototype[funcName.replace('open', 'iterate')] = function() {
        var args = toArray(arguments);
        var callback = args[args.length - 1];
        var nativeObject = this._store || this._index;
        var request = nativeObject[funcName].apply(nativeObject, args.slice(0, -1));
        request.onsuccess = function() {
          callback(request.result);
        };
      };
    });
  });

  // polyfill getAll
  [Index, ObjectStore].forEach(function(Constructor) {
    if (Constructor.prototype.getAll) return;
    Constructor.prototype.getAll = function(query, count) {
      var instance = this;
      var items = [];

      return new Promise(function(resolve) {
        instance.iterateCursor(query, function(cursor) {
          if (!cursor) {
            resolve(items);
            return;
          }
          items.push(cursor.value);

          if (count !== undefined && items.length == count) {
            resolve(items);
            return;
          }
          cursor.continue();
        });
      });
    };
  });

  var exp = {
    open: function(name, version, upgradeCallback) {
      var p = promisifyRequestCall(indexedDB, 'open', [name, version]);
      var request = p.request;

      request.onupgradeneeded = function(event) {
        if (upgradeCallback) {
          upgradeCallback(new UpgradeDB(request.result, event.oldVersion, request.transaction));
        }
      };

      return p.then(function(db) {
        return new DB(db);
      });
    },
    delete: function(name) {
      return promisifyRequestCall(indexedDB, 'deleteDatabase', [name]);
    }
  };

  if (typeof module !== 'undefined') {
    module.exports = exp;
  }
  else {
    self.idb = exp;
  }
}());

},{}],2:[function(require,module,exports){
'use strict';

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _idb = require('idb');

var _idb2 = _interopRequireDefault(_idb);

// more on usage of this API here : https://github.com/jakearchibald/idb
// goes as follows idb.open(name, version, upgradeCallback)
// Example:
// This returns a promise, let's store that for later with a var

var dbPromise = _idb2['default'].open('test-db', 2,
// this defines the database
function (upgradeDb) {

  // this creates a switch to update the browser with the new version of the indexDB, to the new one
  switch (upgradeDb.oldVersion) {

    // case 0 is called if the browser does not have the first version installed, then it installs it if it does not
    case 0:
      // this store has a key that's separate to the data, which is what we want to store in keyvalStore
      var keyValStore = upgradeDb.createObjectStore('keyval');

      //objectStore documentation here: https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore
      // accepts the values of objectStore(name, optionalKey)
      keyValStore.put(
      // this is the object name:
      'world',
      // and this is the optional key
      'hello');

    // after case 1 is called, this stores  the new objectStore after the first case hase been creater, or if already created
    // it installs case 1 after confirming case 0 is created
    case 1:

      // object stores can only be called within the upgradeDb function nowhere else.
      // below is the code  to create a new object store for the 'people' object
      // This sets the object's 'name' as the key, which is stored by name rather than by key
      // when adding new object stores, the version needs to be changed
      upgradeDb.createObjectStore('people', { keyPath: 'name' });
  }
});

// this calls our database, and reads from it, after the promise has been fulfilled (dbPromise)
dbPromise.then(function (db) {

  // this is the function to read from the database which accepts the objectStore which was created above, in this case keyval
  // this function selects the 'keyval' object store, ready to use, with an optional 'do something' argument
  var transaction = db.transaction('keyval');

  // this calls the object store (DB) we want to display
  var keyValDB = transaction.objectStore('keyval');

  // this returns a key within the keyval object, in thie case the 'hello' created above
  // this returns a promise
  return keyValDB.get('hello');

  // within the promise, we grab the value of hello, which in this case is world.
  // the value of this key store is the function argument
}).then(function (val) {
  console.log('The value of "hello" is:', val);
});

// the following is used to add values to exsisting object stores
dbPromise.then(function (db) {
  // once again grabs our DB, but this time, 'readwrite' is added to the optional valueto write something
  var transaction = db.transaction('keyval', 'readwrite');

  // this once again calls our db after its been registered
  var keyValWrite = transaction.objectStore('keyval');

  // this stores new values into ur DB, with the value being the first argument and the key being the second argument
  keyValWrite.put('bar', 'foo');

  // this returns a promise, that only returns if and when the transaction completes, and rejects if it fails
  return transaction.complete;
}).then(function () {
  console.log('Added foo:bar to keyval');
});

// the following is used to add values to exsisting object stores
dbPromise.then(function (db) {
  // once again grabs our DB, but this time, 'readwrite' is added to the optional valueto write something
  var transaction = db.transaction('keyval', 'readwrite');

  // this once again calls our db after its been registered
  var keyValWrite = transaction.objectStore('keyval');

  // this stores new values into ur DB, with the value being the first argument and the key being the second argument
  keyValWrite.put('dog', 'favoriteAnimal');

  // this returns a promise, that only returns if and when the transaction completes, and rejects if it fails
  return transaction.complete;
}).then(function () {
  console.log('Added favoriteAnimal key : dog');
});

// the following creates the values to the people Object store:
dbPromise.then(function (db) {
  // once again grabs our DB, but this time, 'readwrite' is added to the optional valueto write something
  var transaction = db.transaction('people', 'readwrite');

  // this once again calls our db after its been registered
  var peopleStore = transaction.objectStore('people');

  // this stores new values into ur DB, creating an object with whatever values I set within the transaction.put arguments.
  // There is no key necessary here, since we have told this specific store to add the name property as the key for this DB
  // Example here:
  peopleStore.put({
    name: 'Sam Munoz',
    age: 25,
    favoriteAnimal: 'dog'
  });

  // here are more to people to add to this DB objectStore:
  peopleStore.put({
    name: 'Hermione Granger',
    age: 18,
    favoriteAnimal: 'cat'
  });

  peopleStore.put({
    name: 'Harry Potter',
    age: 19,
    favoriteAnimal: 'owl'
  });

  peopleStore.put({
    name: 'Ronald Wesley',
    age: 19,
    favoriteAnimal: 'rat'
  });

  // this returns a promise, that only returns if and when the transaction completes, and rejects if it fails
  return transaction.complete;
}).then(function () {
  console.log('People added');
});

// the following reads the values of the people objectStore
// this calls our database, and reads from it, after the promise has been fulfilled (dbPromise)
dbPromise.then(function (db) {

  // this is the function to read from the database which accepts the objectStore which was created above, in this case keyval
  // this function selects the 'keyval' object store, ready to use, with an optional 'do something' argument
  var transaction = db.transaction('people');

  // this calls the object store (DB) we want to display
  var peopleRead = transaction.objectStore('people');

  // this returns all keys and values within the people objectSTore
  return peopleRead.getAll();

  // once fulfilled, this logs the values of the people store
  // this grabs ALL the values of the DB and logs them in alphabetical order
  // VERY IMPORTANT this is exactly how the values will be grabbed from the transportation API and placed within the view of the application
  //
}).then(function (val) {
  console.log('People:', val);
});

},{"idb":1}]},{},[2])

//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaWRiL2xpYi9pZGIuanMiLCJEOi9Eb2N1bWVudHMvU2Nob29sL3VkYWNpdHkvY291cnNlcy9vZmZsaW5lLWFwcGxpY2F0aW9ucy9sZXNzb24tMi93aXR0ci9wdWJsaWMvanMvaWRiLXRlc3QvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7O21CQy9TZ0IsS0FBSzs7Ozs7Ozs7O0FBT3JCLElBQUksU0FBUyxHQUFHLGlCQUFJLElB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RUFBRSxLQUFLO0dBQ3RCLENBQUMsQ0FBQzs7QUFFSCxhQUFXLENBQUMsR0FBRyxDQUFDO0FBQ2QsUUFBSSxFQUFDLGVBQWU7QUFDcEIsT0FBRyxFQUFFLEVBQUU7QUFDUCxrQkFBYyxFQUFFLEtBQUs7R0FDdEIsQ0FBQyxDQUFDOzs7QUFHSCxTQUFPLFdBQVcsQ0FBQyxRQUFRLENBQUM7Q0FDN0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxZQUFVO0FBQ2hCLFNBQU8sQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLENBQUM7Q0FDN0IsQ0FBQyxDQUFDOzs7O0FBSUgsU0FBUyxDQUFDLElBQUksQ0FBQyxVQUFTLEVBQUUsRUFBQzs7OztBQUl6QixNQUFJLFdBQVcsR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDOzs7QUFHM0MsTUFBSSxVQUFVLEdBQUcsV0FBVyxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsQ0FBQzs7O0FBR25ELFNBQU8sVUFBVSxDQUFDLE1BQU0sRUFBRSxDQUFDOzs7Ozs7Q0FNNUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFTLEdBQUcsRUFBQztBQUNuQixTQUFPLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxHQUFHLENBQUMsQ0FBQztDQUM3QixDQUFDLENBQUMiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xuXG4oZnVuY3Rpb24oKSB7XG4gIGZ1bmN0aW9uIHRvQXJyYXkoYXJyKSB7XG4gICAgcmV0dXJuIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFycik7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9taXNpZnlSZXF1ZXN0KHJlcXVlc3QpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICByZXF1ZXN0Lm9uc3VjY2VzcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXNvbHZlKHJlcXVlc3QucmVzdWx0KTtcbiAgICAgIH07XG5cbiAgICAgIHJlcXVlc3Qub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QocmVxdWVzdC5lcnJvcik7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5UmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpIHtcbiAgICB2YXIgcmVxdWVzdDtcbiAgICB2YXIgcCA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgcmVxdWVzdCA9IG9ialttZXRob2RdLmFwcGx5KG9iaiwgYXJncyk7XG4gICAgICBwcm9taXNpZnlSZXF1ZXN0KHJlcXVlc3QpLnRoZW4ocmVzb2x2ZSwgcmVqZWN0KTtcbiAgICB9KTtcblxuICAgIHAucmVxdWVzdCA9IHJlcXVlc3Q7XG4gICAgcmV0dXJuIHA7XG4gIH1cbiAgXG4gIGZ1bmN0aW9uIHByb21pc2lmeUN1cnNvclJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKSB7XG4gICAgdmFyIHAgPSBwcm9taXNpZnlSZXF1ZXN0Q2FsbChvYmosIG1ldGhvZCwgYXJncyk7XG4gICAgcmV0dXJuIHAudGhlbihmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgaWYgKCF2YWx1ZSkgcmV0dXJuO1xuICAgICAgcmV0dXJuIG5ldyBDdXJzb3IodmFsdWUsIHAucmVxdWVzdCk7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eVByb3BlcnRpZXMoUHJveHlDbGFzcywgdGFyZ2V0UHJvcCwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoUHJveHlDbGFzcy5wcm90b3R5cGUsIHByb3AsIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gdGhpc1t0YXJnZXRQcm9wXVtwcm9wXTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eVJlcXVlc3RNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2lmeVJlcXVlc3RDYWxsKHRoaXNbdGFyZ2V0UHJvcF0sIHByb3AsIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF0uYXBwbHkodGhpc1t0YXJnZXRQcm9wXSwgYXJndW1lbnRzKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2lmeUN1cnNvclJlcXVlc3RDYWxsKHRoaXNbdGFyZ2V0UHJvcF0sIHByb3AsIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gSW5kZXgoaW5kZXgpIHtcbiAgICB0aGlzLl9pbmRleCA9IGluZGV4O1xuICB9XG5cbiAgcHJveHlQcm9wZXJ0aWVzKEluZGV4LCAnX2luZGV4JywgW1xuICAgICduYW1lJyxcbiAgICAna2V5UGF0aCcsXG4gICAgJ211bHRpRW50cnknLFxuICAgICd1bmlxdWUnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoSW5kZXgsICdfaW5kZXgnLCBJREJJbmRleCwgW1xuICAgICdnZXQnLFxuICAgICdnZXRLZXknLFxuICAgICdnZXRBbGwnLFxuICAgICdnZXRBbGxLZXlzJyxcbiAgICAnY291bnQnXG4gIF0pO1xuXG4gIHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoSW5kZXgsICdfaW5kZXgnLCBJREJJbmRleCwgW1xuICAgICdvcGVuQ3Vyc29yJyxcbiAgICAnb3BlbktleUN1cnNvcidcbiAgXSk7XG5cbiAgZnVuY3Rpb24gQ3Vyc29yKGN1cnNvciwgcmVxdWVzdCkge1xuICAgIHRoaXMuX2N1cnNvciA9IGN1cnNvcjtcbiAgICB0aGlzLl9yZXF1ZXN0ID0gcmVxdWVzdDtcbiAgfVxuXG4gIHByb3h5UHJvcGVydGllcyhDdXJzb3IsICdfY3Vyc29yJywgW1xuICAgICdkaXJlY3Rpb24nLFxuICAgICdrZXknLFxuICAgICdwcmltYXJ5S2V5JyxcbiAgICAndmFsdWUnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoQ3Vyc29yLCAnX2N1cnNvcicsIElEQkN1cnNvciwgW1xuICAgICd1cGRhdGUnLFxuICAgICdkZWxldGUnXG4gIF0pO1xuXG4gIC8vIHByb3h5ICduZXh0JyBtZXRob2RzXG4gIFsnYWR2YW5jZScsICdjb250aW51ZScsICdjb250aW51ZVByaW1hcnlLZXknXS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZE5hbWUpIHtcbiAgICBpZiAoIShtZXRob2ROYW1lIGluIElEQkN1cnNvci5wcm90b3R5cGUpKSByZXR1cm47XG4gICAgQ3Vyc29yLnByb3RvdHlwZVttZXRob2ROYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGN1cnNvciA9IHRoaXM7XG4gICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKGZ1bmN0aW9uKCkge1xuICAgICAgICBjdXJzb3IuX2N1cnNvclttZXRob2ROYW1lXS5hcHBseShjdXJzb3IuX2N1cnNvciwgYXJncyk7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0KGN1cnNvci5fcmVxdWVzdCkudGhlbihmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgIGlmICghdmFsdWUpIHJldHVybjtcbiAgICAgICAgICByZXR1cm4gbmV3IEN1cnNvcih2YWx1ZSwgY3Vyc29yLl9yZXF1ZXN0KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9O1xuICB9KTtcblxuICBmdW5jdGlvbiBPYmplY3RTdG9yZShzdG9yZSkge1xuICAgIHRoaXMuX3N0b3JlID0gc3RvcmU7XG4gIH1cblxuICBPYmplY3RTdG9yZS5wcm90b3R5cGUuY3JlYXRlSW5kZXggPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IEluZGV4KHRoaXMuX3N0b3JlLmNyZWF0ZUluZGV4LmFwcGx5KHRoaXMuX3N0b3JlLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBPYmplY3RTdG9yZS5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IEluZGV4KHRoaXMuX3N0b3JlLmluZGV4LmFwcGx5KHRoaXMuX3N0b3JlLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBwcm94eVByb3BlcnRpZXMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBbXG4gICAgJ25hbWUnLFxuICAgICdrZXlQYXRoJyxcbiAgICAnaW5kZXhOYW1lcycsXG4gICAgJ2F1dG9JbmNyZW1lbnQnXG4gIF0pO1xuXG4gIHByb3h5UmVxdWVzdE1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdwdXQnLFxuICAgICdhZGQnLFxuICAgICdkZWxldGUnLFxuICAgICdjbGVhcicsXG4gICAgJ2dldCcsXG4gICAgJ2dldEFsbCcsXG4gICAgJ2dldEFsbEtleXMnLFxuICAgICdjb3VudCdcbiAgXSk7XG5cbiAgcHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhPYmplY3RTdG9yZSwgJ19zdG9yZScsIElEQk9iamVjdFN0b3JlLCBbXG4gICAgJ29wZW5DdXJzb3InLFxuICAgICdvcGVuS2V5Q3Vyc29yJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdkZWxldGVJbmRleCdcbiAgXSk7XG5cbiAgZnVuY3Rpb24gVHJhbnNhY3Rpb24oaWRiVHJhbnNhY3Rpb24pIHtcbiAgICB0aGlzLl90eCA9IGlkYlRyYW5zYWN0aW9uO1xuICAgIHRoaXMuY29tcGxldGUgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIGlkYlRyYW5zYWN0aW9uLm9uY29tcGxldGUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfTtcbiAgICAgIGlkYlRyYW5zYWN0aW9uLm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KGlkYlRyYW5zYWN0aW9uLmVycm9yKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBUcmFuc2FjdGlvbi5wcm90b3R5cGUub2JqZWN0U3RvcmUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IE9iamVjdFN0b3JlKHRoaXMuX3R4Lm9iamVjdFN0b3JlLmFwcGx5KHRoaXMuX3R4LCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBwcm94eVByb3BlcnRpZXMoVHJhbnNhY3Rpb24sICdfdHgnLCBbXG4gICAgJ29iamVjdFN0b3JlTmFtZXMnLFxuICAgICdtb2RlJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoVHJhbnNhY3Rpb24sICdfdHgnLCBJREJUcmFuc2FjdGlvbiwgW1xuICAgICdhYm9ydCdcbiAgXSk7XG5cbiAgZnVuY3Rpb24gVXBncmFkZURCKGRiLCBvbGRWZXJzaW9uLCB0cmFuc2FjdGlvbikge1xuICAgIHRoaXMuX2RiID0gZGI7XG4gICAgdGhpcy5vbGRWZXJzaW9uID0gb2xkVmVyc2lvbjtcbiAgICB0aGlzLnRyYW5zYWN0aW9uID0gbmV3IFRyYW5zYWN0aW9uKHRyYW5zYWN0aW9uKTtcbiAgfVxuXG4gIFVwZ3JhZGVEQi5wcm90b3R5cGUuY3JlYXRlT2JqZWN0U3RvcmUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IE9iamVjdFN0b3JlKHRoaXMuX2RiLmNyZWF0ZU9iamVjdFN0b3JlLmFwcGx5KHRoaXMuX2RiLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBwcm94eVByb3BlcnRpZXMoVXBncmFkZURCLCAnX2RiJywgW1xuICAgICduYW1lJyxcbiAgICAndmVyc2lvbicsXG4gICAgJ29iamVjdFN0b3JlTmFtZXMnXG4gIF0pO1xuXG4gIHByb3h5TWV0aG9kcyhVcGdyYWRlREIsICdfZGInLCBJREJEYXRhYmFzZSwgW1xuICAgICdkZWxldGVPYmplY3RTdG9yZScsXG4gICAgJ2Nsb3NlJ1xuICBdKTtcblxuICBmdW5jdGlvbiBEQihkYikge1xuICAgIHRoaXMuX2RiID0gZGI7XG4gIH1cblxuICBEQi5wcm90b3R5cGUudHJhbnNhY3Rpb24gPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IFRyYW5zYWN0aW9uKHRoaXMuX2RiLnRyYW5zYWN0aW9uLmFwcGx5KHRoaXMuX2RiLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBwcm94eVByb3BlcnRpZXMoREIsICdfZGInLCBbXG4gICAgJ25hbWUnLFxuICAgICd2ZXJzaW9uJyxcbiAgICAnb2JqZWN0U3RvcmVOYW1lcydcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKERCLCAnX2RiJywgSURCRGF0YWJhc2UsIFtcbiAgICAnY2xvc2UnXG4gIF0pO1xuXG4gIC8vIEFkZCBjdXJzb3IgaXRlcmF0b3JzXG4gIC8vIFRPRE86IHJlbW92ZSB0aGlzIG9uY2UgYnJvd3NlcnMgZG8gdGhlIHJpZ2h0IHRoaW5nIHdpdGggcHJvbWlzZXNcbiAgWydvcGVuQ3Vyc29yJywgJ29wZW5LZXlDdXJzb3InXS5mb3JFYWNoKGZ1bmN0aW9uKGZ1bmNOYW1lKSB7XG4gICAgW09iamVjdFN0b3JlLCBJbmRleF0uZm9yRWFjaChmdW5jdGlvbihDb25zdHJ1Y3Rvcikge1xuICAgICAgQ29uc3RydWN0b3IucHJvdG90eXBlW2Z1bmNOYW1lLnJlcGxhY2UoJ29wZW4nLCAnaXRlcmF0ZScpXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgYXJncyA9IHRvQXJyYXkoYXJndW1lbnRzKTtcbiAgICAgICAgdmFyIGNhbGxiYWNrID0gYXJnc1thcmdzLmxlbmd0aCAtIDFdO1xuICAgICAgICB2YXIgbmF0aXZlT2JqZWN0ID0gdGhpcy5fc3RvcmUgfHwgdGhpcy5faW5kZXg7XG4gICAgICAgIHZhciByZXF1ZXN0ID0gbmF0aXZlT2JqZWN0W2Z1bmNOYW1lXS5hcHBseShuYXRpdmVPYmplY3QsIGFyZ3Muc2xpY2UoMCwgLTEpKTtcbiAgICAgICAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjYWxsYmFjayhyZXF1ZXN0LnJlc3VsdCk7XG4gICAgICAgIH07XG4gICAgICB9O1xuICAgIH0pO1xuICB9KTtcblxuICAvLyBwb2x5ZmlsbCBnZXRBbGxcbiAgW0luZGV4LCBPYmplY3RTdG9yZV0uZm9yRWFjaChmdW5jdGlvbihDb25zdHJ1Y3Rvcikge1xuICAgIGlmIChDb25zdHJ1Y3Rvci5wcm90b3R5cGUuZ2V0QWxsKSByZXR1cm47XG4gICAgQ29uc3RydWN0b3IucHJvdG90eXBlLmdldEFsbCA9IGZ1bmN0aW9uKHF1ZXJ5LCBjb3VudCkge1xuICAgICAgdmFyIGluc3RhbmNlID0gdGhpcztcbiAgICAgIHZhciBpdGVtcyA9IFtdO1xuXG4gICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSkge1xuICAgICAgICBpbnN0YW5jZS5pdGVyYXRlQ3Vyc29yKHF1ZXJ5LCBmdW5jdGlvbihjdXJzb3IpIHtcbiAgICAgICAgICBpZiAoIWN1cnNvcikge1xuICAgICAgICAgICAgcmVzb2x2ZShpdGVtcyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGl0ZW1zLnB1c2goY3Vyc29yLnZhbHVlKTtcblxuICAgICAgICAgIGlmIChjb3VudCAhPT0gdW5kZWZpbmVkICYmIGl0ZW1zLmxlbmd0aCA9PSBjb3VudCkge1xuICAgICAgICAgICAgcmVzb2x2ZShpdGVtcyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGN1cnNvci5jb250aW51ZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH07XG4gIH0pO1xuXG4gIHZhciBleHAgPSB7XG4gICAgb3BlbjogZnVuY3Rpb24obmFtZSwgdmVyc2lvbiwgdXBncmFkZUNhbGxiYWNrKSB7XG4gICAgICB2YXIgcCA9IHByb21pc2lmeVJlcXVlc3RDYWxsKGluZGV4ZWREQiwgJ29wZW4nLCBbbmFtZSwgdmVyc2lvbl0pO1xuICAgICAgdmFyIHJlcXVlc3QgPSBwLnJlcXVlc3Q7XG5cbiAgICAgIHJlcXVlc3Qub251cGdyYWRlbmVlZGVkID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgaWYgKHVwZ3JhZGVDYWxsYmFjaykge1xuICAgICAgICAgIHVwZ3JhZGVDYWxsYmFjayhuZXcgVXBncmFkZURCKHJlcXVlc3QucmVzdWx0LCBldmVudC5vbGRWZXJzaW9uLCByZXF1ZXN0LnRyYW5zYWN0aW9uKSk7XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIHJldHVybiBwLnRoZW4oZnVuY3Rpb24oZGIpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBEQihkYik7XG4gICAgICB9KTtcbiAgICB9LFxuICAgIGRlbGV0ZTogZnVuY3Rpb24obmFtZSkge1xuICAgICAgcmV0dXJuIHByb21pc2lmeVJlcXVlc3RDYWxsKGluZGV4ZWREQiwgJ2RlbGV0ZURhdGFiYXNlJywgW25hbWVdKTtcbiAgICB9XG4gIH07XG5cbiAgaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBleHA7XG4gIH1cbiAgZWxzZSB7XG4gICAgc2VsZi5pZGIgPSBleHA7XG4gIH1cbn0oKSk7XG4iLCJpbXBvcnQgaWRiIGZyb20gJ2lkYic7XHJcblxyXG4vLyBtb3JlIG9uIHVzYWdlIG9mIHRoaXMgQVBJIGhlcmUgOiBodHRwczovL2dpdGh1Yi5jb20vamFrZWFyY2hpYmFsZC9pZGJcclxuLy8gZ29lcyBhcyBmb2xsb3dzIGlkYi5vcGVuKG5hbWUsIHZlcnNpb24sIHVwZ3JhZGVDYWxsYmFjaylcclxuLy8gRXhhbXBsZTogXHJcbi8vIFRoaXMgcmV0dXJucyBhIHByb21pc2UsIGxldCdzIHN0b3JlIHRoYXQgZm9yIGxhdGVyIHdpdGggYSB2YXJcclxuXHJcbnZhciBkYlByb21pc2UgPSBpZGIub3BlbigndGVzdC1kYicsIDIsIFxyXG4gIC8vIHRoaXMgZGVmaW5lcyB0aGUgZGF0YWJhc2VcclxuICBmdW5jdGlvbih1cGdyYWRlRGIpe1xyXG4gICAgXHJcbiAgICAvLyB0aGlzIGNyZWF0ZXMgYSBzd2l0Y2ggdG8gdXBkYXRlIHRoZSBicm93c2VyIHdpdGggdGhlIG5ldyB2ZXJzaW9uIG9mIHRoZSBpbmRleERCLCB0byB0aGUgbmV3IG9uZVxyXG4gICAgc3dpdGNoKHVwZ3JhZGVEYi5vbGRWZXJzaW9uKXtcclxuXHJcbiAgICAgLy8gY2FzZSAwIGlzIGNhbGxlZCBpZiB0aGUgYnJvd3NlciBkb2VzIG5vdCBoYXZlIHRoZSBmaXJzdCB2ZXJzaW9uIGluc3RhbGxlZCwgdGhlbiBpdCBpbnN0YWxscyBpdCBpZiBpdCBkb2VzIG5vdCBcclxuICAgICAgY2FzZSAwOlxyXG4gICAgICAvLyB0aGlzIHN0b3JlIGhhcyBhIGtleSB0aGF0J3Mgc2VwYXJhdGUgdG8gdGhlIGRhdGEsIHdoaWNoIGlzIHdoYXQgd2Ugd2FudCB0byBzdG9yZSBpbiBrZXl2YWxTdG9yZVxyXG4gICAgICB2YXIga2V5VmFsU3RvcmUgPSB1cGdyYWRlRGIuY3JlYXRlT2JqZWN0U3RvcmUoJ2tleXZhbCcpO1xyXG5cclxuICAgICAgLy9vYmplY3RTdG9yZSBkb2N1bWVudGF0aW9uIGhlcmU6IGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9JREJPYmplY3RTdG9yZVxyXG4gICAgICAvLyBhY2NlcHRzIHRoZSB2YWx1ZXMgb2Ygb2JqZWN0U3RvcmUobmFtZSwgb3B0aW9uYWxLZXkpXHJcbiAgICAgIGtleVZhbFN0b3JlLnB1dChcclxuICAgICAgICAvLyB0aGlzIGlzIHRoZSBvYmplY3QgbmFtZTpcclxuICAgICAgICAnd29ybGQnLCBcclxuICAgICAgICAvLyBhbmQgdGhpcyBpcyB0aGUgb3B0aW9uYWwga2V5XHJcbiAgICAgICAgJ2hlbGxvJyk7XHJcblxyXG4gICAgLy8gYWZ0ZXIgY2FzZSAxIGlzIGNhbGxlZCwgdGhpcyBzdG9yZXMgIHRoZSBuZXcgb2JqZWN0U3RvcmUgYWZ0ZXIgdGhlIGZpcnN0IGNhc2UgaGFzZSBiZWVuIGNyZWF0ZXIsIG9yIGlmIGFscmVhZHkgY3JlYXRlZFxyXG4gICAgLy8gaXQgaW5zdGFsbHMgY2FzZSAxIGFmdGVyIGNvbmZpcm1pbmcgY2FzZSAwIGlzIGNyZWF0ZWRcclxuICAgIGNhc2UgMTpcclxuICAgIFxyXG4gICAgICAvLyBvYmplY3Qgc3RvcmVzIGNhbiBvbmx5IGJlIGNhbGxlZCB3aXRoaW4gdGhlIHVwZ3JhZGVEYiBmdW5jdGlvbiBub3doZXJlIGVsc2UuXHJcbiAgICAgIC8vIGJlbG93IGlzIHRoZSBjb2RlICB0byBjcmVhdGUgYSBuZXcgb2JqZWN0IHN0b3JlIGZvciB0aGUgJ3Blb3BsZScgb2JqZWN0XHJcbiAgICAgIC8vIFRoaXMgc2V0cyB0aGUgb2JqZWN0J3MgJ25hbWUnIGFzIHRoZSBrZXksIHdoaWNoIGlzIHN0b3JlZCBieSBuYW1lIHJhdGhlciB0aGFuIGJ5IGtleVxyXG4gICAgICAvLyB3aGVuIGFkZGluZyBuZXcgb2JqZWN0IHN0b3JlcywgdGhlIHZlcnNpb24gbmVlZHMgdG8gYmUgY2hhbmdlZFxyXG4gICAgICB1cGdyYWRlRGIuY3JlYXRlT2JqZWN0U3RvcmUoJ3Blb3BsZScsIHtrZXlQYXRoOiAnbmFtZSd9KTtcclxuICAgIH1cclxuXHJcbn0pO1xyXG5cclxuLy8gdGhpcyBjYWxscyBvdXIgZGF0YWJhc2UsIGFuZCByZWFkcyBmcm9tIGl0LCBhZnRlciB0aGUgcHJvbWlzZSBoYXMgYmVlbiBmdWxmaWxsZWQgKGRiUHJvbWlzZSlcclxuZGJQcm9taXNlLnRoZW4oZnVuY3Rpb24oZGIpe1xyXG5cclxuICAvLyB0aGlzIGlzIHRoZSBmdW5jdGlvbiB0byByZWFkIGZyb20gdGhlIGRhdGFiYXNlIHdoaWNoIGFjY2VwdHMgdGhlIG9iamVjdFN0b3JlIHdoaWNoIHdhcyBjcmVhdGVkIGFib3ZlLCBpbiB0aGlzIGNhc2Uga2V5dmFsXHJcbiAgLy8gdGhpcyBmdW5jdGlvbiBzZWxlY3RzIHRoZSAna2V5dmFsJyBvYmplY3Qgc3RvcmUsIHJlYWR5IHRvIHVzZSwgd2l0aCBhbiBvcHRpb25hbCAnZG8gc29tZXRoaW5nJyBhcmd1bWVudFxyXG4gIHZhciB0cmFuc2FjdGlvbiA9IGRiLnRyYW5zYWN0aW9uKCdrZXl2YWwnKTtcclxuXHJcbiAgLy8gdGhpcyBjYWxscyB0aGUgb2JqZWN0IHN0b3JlIChEQikgd2Ugd2FudCB0byBkaXNwbGF5XHJcbiAgdmFyIGtleVZhbERCID0gdHJhbnNhY3Rpb24ub2JqZWN0U3RvcmUoJ2tleXZhbCcpO1xyXG5cclxuICAvLyB0aGlzIHJldHVybnMgYSBrZXkgd2l0aGluIHRoZSBrZXl2YWwgb2JqZWN0LCBpbiB0aGllIGNhc2UgdGhlICdoZWxsbycgY3JlYXRlZCBhYm92ZVxyXG4gIC8vIHRoaXMgcmV0dXJucyBhIHByb21pc2VcclxuICByZXR1cm4ga2V5VmFsREIuZ2V0KCdoZWxsbycpO1xyXG5cclxuICAvLyB3aXRoaW4gdGhlIHByb21pc2UsIHdlIGdyYWIgdGhlIHZhbHVlIG9mIGhlbGxvLCB3aGljaCBpbiB0aGlzIGNhc2UgaXMgd29ybGQuXHJcbiAgLy8gdGhlIHZhbHVlIG9mIHRoaXMga2V5IHN0b3JlIGlzIHRoZSBmdW5jdGlvbiBhcmd1bWVudFxyXG59KS50aGVuKGZ1bmN0aW9uKHZhbCl7XHJcbiAgY29uc29sZS5sb2coJ1RoZSB2YWx1ZSBvZiBcImhlbGxvXCIgaXM6JywgdmFsKTtcclxufSk7XHJcblxyXG4vLyB0aGUgZm9sbG93aW5nIGlzIHVzZWQgdG8gYWRkIHZhbHVlcyB0byBleHNpc3Rpbmcgb2JqZWN0IHN0b3Jlc1xyXG5kYlByb21pc2UudGhlbihmdW5jdGlvbihkYil7XHJcbiAgLy8gb25jZSBhZ2FpbiBncmFicyBvdXIgREIsIGJ1dCB0aGlzIHRpbWUsICdyZWFkd3JpdGUnIGlzIGFkZGVkIHRvIHRoZSBvcHRpb25hbCB2YWx1ZXRvIHdyaXRlIHNvbWV0aGluZ1xyXG4gIHZhciB0cmFuc2FjdGlvbiA9IGRiLnRyYW5zYWN0aW9uKCdrZXl2YWwnLCAncmVhZHdyaXRlJyk7XHJcblxyXG4gIC8vIHRoaXMgb25jZSBhZ2FpbiBjYWxscyBvdXIgZGIgYWZ0ZXIgaXRzIGJlZW4gcmVnaXN0ZXJlZFxyXG4gIHZhciBrZXlWYWxXcml0ZSA9IHRyYW5zYWN0aW9uLm9iamVjdFN0b3JlKCdrZXl2YWwnKTtcclxuXHJcbiAgLy8gdGhpcyBzdG9yZXMgbmV3IHZhbHVlcyBpbnRvIHVyIERCLCB3aXRoIHRoZSB2YWx1ZSBiZWluZyB0aGUgZmlyc3QgYXJndW1lbnQgYW5kIHRoZSBrZXkgYmVpbmcgdGhlIHNlY29uZCBhcmd1bWVudFxyXG4gIGtleVZhbFdyaXRlLnB1dCgnYmFyJywgJ2ZvbycpO1xyXG5cclxuICAvLyB0aGlzIHJldHVybnMgYSBwcm9taXNlLCB0aGF0IG9ubHkgcmV0dXJucyBpZiBhbmQgd2hlbiB0aGUgdHJhbnNhY3Rpb24gY29tcGxldGVzLCBhbmQgcmVqZWN0cyBpZiBpdCBmYWlsc1xyXG4gIHJldHVybiB0cmFuc2FjdGlvbi5jb21wbGV0ZTtcclxufSkudGhlbihmdW5jdGlvbigpe1xyXG4gIGNvbnNvbGUubG9nKCdBZGRlZCBmb286YmFyIHRvIGtleXZhbCcpO1xyXG59KTtcclxuXHJcbi8vIHRoZSBmb2xsb3dpbmcgaXMgdXNlZCB0byBhZGQgdmFsdWVzIHRvIGV4c2lzdGluZyBvYmplY3Qgc3RvcmVzXHJcbmRiUHJvbWlzZS50aGVuKGZ1bmN0aW9uKGRiKXtcclxuICAvLyBvbmNlIGFnYWluIGdyYWJzIG91ciBEQiwgYnV0IHRoaXMgdGltZSwgJ3JlYWR3cml0ZScgaXMgYWRkZWQgdG8gdGhlIG9wdGlvbmFsIHZhbHVldG8gd3JpdGUgc29tZXRoaW5nXHJcbiAgdmFyIHRyYW5zYWN0aW9uID0gZGIudHJhbnNhY3Rpb24oJ2tleXZhbCcsICdyZWFkd3JpdGUnKTtcclxuXHJcbiAgLy8gdGhpcyBvbmNlIGFnYWluIGNhbGxzIG91ciBkYiBhZnRlciBpdHMgYmVlbiByZWdpc3RlcmVkXHJcbiAgdmFyIGtleVZhbFdyaXRlID0gdHJhbnNhY3Rpb24ub2JqZWN0U3RvcmUoJ2tleXZhbCcpO1xyXG5cclxuICAvLyB0aGlzIHN0b3JlcyBuZXcgdmFsdWVzIGludG8gdXIgREIsIHdpdGggdGhlIHZhbHVlIGJlaW5nIHRoZSBmaXJzdCBhcmd1bWVudCBhbmQgdGhlIGtleSBiZWluZyB0aGUgc2Vjb25kIGFyZ3VtZW50XHJcbiAga2V5VmFsV3JpdGUucHV0KCdkb2cnLCAnZmF2b3JpdGVBbmltYWwnKTtcclxuXHJcbiAgLy8gdGhpcyByZXR1cm5zIGEgcHJvbWlzZSwgdGhhdCBvbmx5IHJldHVybnMgaWYgYW5kIHdoZW4gdGhlIHRyYW5zYWN0aW9uIGNvbXBsZXRlcywgYW5kIHJlamVjdHMgaWYgaXQgZmFpbHNcclxuICByZXR1cm4gdHJhbnNhY3Rpb24uY29tcGxldGU7XHJcbn0pLnRoZW4oZnVuY3Rpb24oKXtcclxuICBjb25zb2xlLmxvZygnQWRkZWQgZmF2b3JpdGVBbmltYWwga2V5IDogZG9nJyk7XHJcbn0pO1xyXG5cclxuLy8gdGhlIGZvbGxvd2luZyBjcmVhdGVzIHRoZSB2YWx1ZXMgdG8gdGhlIHBlb3BsZSBPYmplY3Qgc3RvcmU6XHJcbmRiUHJvbWlzZS50aGVuKGZ1bmN0aW9uKGRiKXtcclxuICAvLyBvbmNlIGFnYWluIGdyYWJzIG91ciBEQiwgYnV0IHRoaXMgdGltZSwgJ3JlYWR3cml0ZScgaXMgYWRkZWQgdG8gdGhlIG9wdGlvbmFsIHZhbHVldG8gd3JpdGUgc29tZXRoaW5nXHJcbiAgdmFyIHRyYW5zYWN0aW9uID0gZGIudHJhbnNhY3Rpb24oJ3Blb3BsZScsICdyZWFkd3JpdGUnKTtcclxuXHJcbiAgLy8gdGhpcyBvbmNlIGFnYWluIGNhbGxzIG91ciBkYiBhZnRlciBpdHMgYmVlbiByZWdpc3RlcmVkXHJcbiAgdmFyIHBlb3BsZVN0b3JlID0gdHJhbnNhY3Rpb24ub2JqZWN0U3RvcmUoJ3Blb3BsZScpO1xyXG5cclxuICAvLyB0aGlzIHN0b3JlcyBuZXcgdmFsdWVzIGludG8gdXIgREIsIGNyZWF0aW5nIGFuIG9iamVjdCB3aXRoIHdoYXRldmVyIHZhbHVlcyBJIHNldCB3aXRoaW4gdGhlIHRyYW5zYWN0aW9uLnB1dCBhcmd1bWVudHMuXHJcbiAgLy8gVGhlcmUgaXMgbm8ga2V5IG5lY2Vzc2FyeSBoZXJlLCBzaW5jZSB3ZSBoYXZlIHRvbGQgdGhpcyBzcGVjaWZpYyBzdG9yZSB0byBhZGQgdGhlIG5hbWUgcHJvcGVydHkgYXMgdGhlIGtleSBmb3IgdGhpcyBEQlxyXG4gIC8vIEV4YW1wbGUgaGVyZTogXHJcbiAgcGVvcGxlU3RvcmUucHV0KHtcclxuICAgIG5hbWU6J1NhbSBNdW5veicsXHJcbiAgICBhZ2U6IDI1LFxyXG4gICAgZmF2b3JpdGVBbmltYWw6ICdkb2cnXHJcbiAgfSk7XHJcblxyXG4gIC8vIGhlcmUgYXJlIG1vcmUgdG8gcGVvcGxlIHRvIGFkZCB0byB0aGlzIERCIG9iamVjdFN0b3JlOlxyXG4gIHBlb3BsZVN0b3JlLnB1dCh7XHJcbiAgICBuYW1lOidIZXJtaW9uZSBHcmFuZ2VyJyxcclxuICAgIGFnZTogMTgsXHJcbiAgICBmYXZvcml0ZUFuaW1hbDogJ2NhdCdcclxuICB9KTsgIFxyXG5cclxuICBwZW9wbGVTdG9yZS5wdXQoe1xyXG4gICAgbmFtZTonSGFycnkgUG90dGVyJyxcclxuICAgIGFnZTogMTksXHJcbiAgICBmYXZvcml0ZUFuaW1hbDogJ293bCdcclxuICB9KTsgIFxyXG5cclxuICBwZW9wbGVTdG9yZS5wdXQoe1xyXG4gICAgbmFtZTonUm9uYWxkIFdlc2xleScsXHJcbiAgICBhZ2U6IDE5LFxyXG4gICAgZmF2b3JpdGVBbmltYWw6ICdyYXQnXHJcbiAgfSk7IFxyXG5cclxuICAvLyB0aGlzIHJldHVybnMgYSBwcm9taXNlLCB0aGF0IG9ubHkgcmV0dXJucyBpZiBhbmQgd2hlbiB0aGUgdHJhbnNhY3Rpb24gY29tcGxldGVzLCBhbmQgcmVqZWN0cyBpZiBpdCBmYWlsc1xyXG4gIHJldHVybiB0cmFuc2FjdGlvbi5jb21wbGV0ZTtcclxufSkudGhlbihmdW5jdGlvbigpe1xyXG4gIGNvbnNvbGUubG9nKCdQZW9wbGUgYWRkZWQnKTtcclxufSk7XHJcblxyXG4vLyB0aGUgZm9sbG93aW5nIHJlYWRzIHRoZSB2YWx1ZXMgb2YgdGhlIHBlb3BsZSBvYmplY3RTdG9yZVxyXG4vLyB0aGlzIGNhbGxzIG91ciBkYXRhYmFzZSwgYW5kIHJlYWRzIGZyb20gaXQsIGFmdGVyIHRoZSBwcm9taXNlIGhhcyBiZWVuIGZ1bGZpbGxlZCAoZGJQcm9taXNlKVxyXG5kYlByb21pc2UudGhlbihmdW5jdGlvbihkYil7XHJcblxyXG4gIC8vIHRoaXMgaXMgdGhlIGZ1bmN0aW9uIHRvIHJlYWQgZnJvbSB0aGUgZGF0YWJhc2Ugd2hpY2ggYWNjZXB0cyB0aGUgb2JqZWN0U3RvcmUgd2hpY2ggd2FzIGNyZWF0ZWQgYWJvdmUsIGluIHRoaXMgY2FzZSBrZXl2YWxcclxuICAvLyB0aGlzIGZ1bmN0aW9uIHNlbGVjdHMgdGhlICdrZXl2YWwnIG9iamVjdCBzdG9yZSwgcmVhZHkgdG8gdXNlLCB3aXRoIGFuIG9wdGlvbmFsICdkbyBzb21ldGhpbmcnIGFyZ3VtZW50XHJcbiAgdmFyIHRyYW5zYWN0aW9uID0gZGIudHJhbnNhY3Rpb24oJ3Blb3BsZScpO1xyXG5cclxuICAvLyB0aGlzIGNhbGxzIHRoZSBvYmplY3Qgc3RvcmUgKERCKSB3ZSB3YW50IHRvIGRpc3BsYXlcclxuICB2YXIgcGVvcGxlUmVhZCA9IHRyYW5zYWN0aW9uLm9iamVjdFN0b3JlKCdwZW9wbGUnKTtcclxuXHJcbiAgLy8gdGhpcyByZXR1cm5zIGFsbCBrZXlzIGFuZCB2YWx1ZXMgd2l0aGluIHRoZSBwZW9wbGUgb2JqZWN0U1RvcmVcclxuICByZXR1cm4gcGVvcGxlUmVhZC5nZXRBbGwoKTtcclxuXHJcbiAgLy8gb25jZSBmdWxmaWxsZWQsIHRoaXMgbG9ncyB0aGUgdmFsdWVzIG9mIHRoZSBwZW9wbGUgc3RvcmVcclxuICAvLyB0aGlzIGdyYWJzIEFMTCB0aGUgdmFsdWVzIG9mIHRoZSBEQiBhbmQgbG9ncyB0aGVtIGluIGFscGhhYmV0aWNhbCBvcmRlclxyXG4gIC8vIFZFUlkgSU1QT1JUQU5UIHRoaXMgaXMgZXhhY3RseSBob3cgdGhlIHZhbHVlcyB3aWxsIGJlIGdyYWJiZWQgZnJvbSB0aGUgdHJhbnNwb3J0YXRpb24gQVBJIGFuZCBwbGFjZWQgd2l0aGluIHRoZSB2aWV3IG9mIHRoZSBhcHBsaWNhdGlvblxyXG4gIC8vIFxyXG59KS50aGVuKGZ1bmN0aW9uKHZhbCl7XHJcbiAgY29uc29sZS5sb2coJ1Blb3BsZTonLCB2YWwpO1xyXG59KTsiXX0=