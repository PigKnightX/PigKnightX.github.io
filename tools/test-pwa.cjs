const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appSource = readFileSync(
  path.join(root, '_javascript/pwa/app.js'),
  'utf8'
).replace(/^import Toast from .*;\s*/m, '');
const workerSource = readFileSync(
  path.join(root, '_javascript/pwa/sw.js'),
  'utf8'
);

class EventHub {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }

  emit(type, details = {}) {
    for (const callback of this.listeners.get(type) || []) {
      callback({ type, target: this, ...details });
    }
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function installingWorker() {
  const worker = new EventHub();
  worker.state = 'installing';
  worker.messages = [];
  worker.postMessage = (message) => worker.messages.push(message);
  return worker;
}

function appFixture({
  controller = {},
  installing = null,
  waiting = null,
  register = 'true',
  updateError = null,
  registrationError = null
} = {}) {
  const state = {
    now: 100_000,
    registered: [],
    updates: 0,
    unregisters: 0,
    shows: 0,
    hides: 0,
    reloads: 0,
    errors: []
  };
  const registration = new EventHub();
  Object.assign(registration, {
    installing,
    waiting,
    update() {
      state.updates++;
      return updateError ? Promise.reject(updateError) : Promise.resolve(this);
    },
    unregister() {
      state.unregisters++;
      return Promise.resolve(true);
    }
  });
  const serviceWorker = new EventHub();
  Object.assign(serviceWorker, {
    controller,
    register(...args) {
      state.registered.push(args);
      return registrationError
        ? Promise.reject(registrationError)
        : Promise.resolve(registration);
    },
    getRegistrations: () => Promise.resolve([registration])
  });
  const button = new EventHub();
  const notification = { querySelector: () => button };
  const document = new EventHub();
  Object.assign(document, {
    currentScript: {
      src: `https://example.test/app.min.js?baseurl=&register=${register}`
    },
    visibilityState: 'visible',
    hidden: false,
    getElementById: () => notification
  });
  const window = new EventHub();
  window.location = { reload: () => state.reloads++ };
  const navigator = { serviceWorker, onLine: true };
  const context = vm.createContext({
    document,
    window,
    navigator,
    URL,
    Date: class extends Date {
      static now() {
        return state.now;
      }
    },
    setTimeout,
    clearTimeout,
    console: {
      error: (...args) => state.errors.push(args),
      warn: (...args) => state.errors.push(args),
      log() {}
    },
    Toast: {
      getOrCreateInstance: () => ({
        show: () => state.shows++,
        hide: () => state.hides++
      })
    }
  });
  vm.runInContext(appSource, context, { filename: 'app.js' });
  return { state, registration, serviceWorker, button, document, window, navigator };
}

test('registration bypasses the HTTP cache and immediately checks for updates', async () => {
  const { state } = appFixture();
  await settle();
  assert.equal(state.registered.length, 1);
  assert.equal(state.registered[0][0], '/sw.min.js');
  assert.equal(state.registered[0][1].updateViaCache, 'none');
  assert.equal(state.updates, 1);
});

test('register=false unregisters instead of treating the string as enabled', async () => {
  const { state } = appFixture({ register: 'false' });
  await settle();
  assert.equal(state.registered.length, 0);
  assert.equal(state.unregisters, 1);
});

test('an installation already in progress still produces the update notification', async () => {
  const worker = installingWorker();
  const { state, registration } = appFixture({ installing: worker });
  await settle();
  assert.equal(state.shows, 0);
  registration.installing = null;
  registration.waiting = worker;
  worker.state = 'installed';
  worker.emit('statechange');
  assert.equal(state.shows, 1);
});

test('a later updatefound is observed until the worker finishes installing', async () => {
  const { state, registration } = appFixture();
  await settle();
  const worker = installingWorker();
  registration.installing = worker;
  registration.emit('updatefound');
  assert.equal(state.shows, 0);
  registration.installing = null;
  registration.waiting = worker;
  worker.state = 'installed';
  worker.emit('statechange');
  assert.equal(state.shows, 1);
});

test('the first installation does not announce a content update', async () => {
  const worker = installingWorker();
  const { state, registration } = appFixture({ controller: null, installing: worker });
  await settle();
  registration.waiting = worker;
  worker.state = 'installed';
  worker.emit('statechange');
  assert.equal(state.shows, 0);
});

test('a waiting update can be accepted and controller changes reload only once', async () => {
  const worker = installingWorker();
  worker.state = 'installed';
  const { state, button, serviceWorker } = appFixture({ waiting: worker });
  await settle();
  assert.ok(state.shows > 0);
  button.emit('click');
  assert.deepEqual(worker.messages, ['SKIP_WAITING']);
  assert.equal(state.hides, 1);
  serviceWorker.emit('controllerchange');
  serviceWorker.emit('controllerchange');
  assert.equal(state.reloads, 1);
});

test('page restoration, foregrounding and reconnecting check for updates with throttling', async () => {
  const { state, window, document } = appFixture();
  await settle();
  assert.equal(state.updates, 1);

  window.emit('pageshow', { persisted: true });
  document.emit('visibilitychange');
  await settle();
  assert.equal(state.updates, 1, 'the same foreground transition must not issue duplicate requests');

  state.now += 61_000;
  window.emit('pageshow', { persisted: true });
  await settle();
  assert.equal(state.updates, 2);

  state.now += 61_000;
  document.visibilityState = 'hidden';
  document.hidden = true;
  document.emit('visibilitychange');
  await settle();
  assert.equal(state.updates, 2);
  document.visibilityState = 'visible';
  document.hidden = false;
  document.emit('visibilitychange');
  await settle();
  assert.equal(state.updates, 3);

  state.now += 61_000;
  window.emit('online');
  await settle();
  assert.equal(state.updates, 4);
});

test('a failed update is handled and can be retried after reconnecting', async () => {
  const { state, window } = appFixture({ updateError: new Error('offline') });
  await settle();
  assert.equal(state.updates, 1);
  window.emit('online');
  await settle();
  assert.equal(state.updates, 2);
});

test('an offline page skips update requests and checks after connectivity returns', async () => {
  const { state, window, navigator } = appFixture();
  await settle();
  navigator.onLine = false;
  state.now += 61_000;
  window.emit('pageshow', { persisted: true });
  await settle();
  assert.equal(state.updates, 1);
  navigator.onLine = true;
  window.emit('online');
  await settle();
  assert.equal(state.updates, 2);
});

test('a registration failure is reported without an unhandled rejection', async () => {
  const { state } = appFixture({ registrationError: new Error('registration failed') });
  await settle();
  assert.equal(state.updates, 0);
  assert.ok(state.errors.length > 0);
});

function workerFixture() {
  const self = new EventHub();
  const state = { imports: [], added: [], matches: [], fetched: [], skipped: 0 };
  self.skipWaiting = () => {
    state.skipped++;
    return Promise.resolve();
  };
  const response = { clone: () => response };
  const cache = {
    addAll: async (requests) => state.added.push(...requests),
    put: async () => {}
  };
  const context = vm.createContext({
    self,
    URL,
    Request,
    swconf: {
      purge: false,
      cacheName: 'chirpy-current',
      resources: ['https://example.test/', 'https://example.test/about/'],
      interceptor: { paths: [], urlPrefixes: [] }
    },
    importScripts: (...urls) => state.imports.push(...urls),
    caches: {
      open: async () => cache,
      match: async (request, options) => {
        state.matches.push({ request, options });
        return response;
      },
      keys: async () => [],
      delete: async () => true
    },
    fetch: async (request) => {
      state.fetched.push(request);
      return response;
    }
  });
  vm.runInContext(workerSource, context, { filename: 'sw.js' });
  return { self, state, response };
}

test('the imported configuration URL changes with the Jekyll build version', () => {
  const { state } = workerFixture();
  assert.equal(state.imports.length, 1);
  assert.match(state.imports[0], /swconf\.js\?.*\{\{\s*site\.time\b/);
});

test('installation fetches fresh precache resources instead of reusing HTTP cache', async () => {
  const { self, state } = workerFixture();
  let installation;
  self.emit('install', { waitUntil: (promise) => { installation = promise; } });
  assert.ok(installation);
  await installation;
  assert.equal(state.added.length, 2);
  for (const request of state.added) {
    assert.ok(request instanceof Request);
    assert.equal(request.cache, 'reload');
  }
});

test('an active worker reads only its own cache while a new version is waiting', async () => {
  const { self, state, response } = workerFixture();
  const request = new Request('https://example.test/');
  let result;
  self.emit('fetch', { request, respondWith: (promise) => { result = promise; } });
  assert.equal(await result, response);
  assert.equal(state.matches.length, 1);
  assert.equal(state.matches[0].options.cacheName, 'chirpy-current');
  assert.equal(state.fetched.length, 0);
});

test('the worker activates only after the page sends SKIP_WAITING', () => {
  const { self, state } = workerFixture();
  assert.equal(state.skipped, 0);
  self.emit('message', { data: 'SKIP_WAITING' });
  assert.equal(state.skipped, 1);
});
