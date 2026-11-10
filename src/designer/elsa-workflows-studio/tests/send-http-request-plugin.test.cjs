const {test} = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  ts = require('typescript'),
  vm = require('node:vm');

function loadPlugin(customDocument = {}) {
  const eventBusHandlers = {};
  const mockEventBus = {
    on(event, handler) {
      eventBusHandlers[event] = handler;
    },
    emit(event, ...args) {
      if (eventBusHandlers[event]) return eventBusHandlers[event](...args);
    }
  };

  const box = {
    exports: {},
    document: customDocument,
    setTimeout,
    clearTimeout,
    require: n => {
      if (n === '../services') return { eventBus: mockEventBus };
      if (n === '../models') return { EventTypes: { ActivityEditor: { Appearing: 'appearing', Disappearing: 'disappearing' } } };
      return {};
    }
  };

  const code = ts.transpileModule(
    fs.readFileSync('src/plugins/send-http-request-plugin.tsx', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2018,
        experimentalDecorators: true
      }
    }
  ).outputText;

  vm.runInNewContext(code, box);
  return {
    plugin: new box.exports.SendHttpRequestPlugin(),
    handlers: eventBusHandlers,
    box
  };
}

test('onActivityEditorAppearing handles missing DOM elements without throwing error', () => {
  const mockDoc = {
    querySelector: () => null
  };
  const { plugin, handlers } = loadPlugin(mockDoc);

  assert.doesNotThrow(() => {
    handlers['appearing']({ activityDescriptor: { type: 'SendHttpRequest' } });
  });

  assert.doesNotThrow(() => {
    handlers['disappearing']({ activityDescriptor: { type: 'SendHttpRequest' } });
  });
});

test('onActivityEditorAppearing ignores activities other than SendHttpRequest', () => {
  let queried = false;
  const mockDoc = {
    querySelector: () => {
      queried = true;
      return null;
    }
  };
  const { handlers } = loadPlugin(mockDoc);

  handlers['appearing']({ activityDescriptor: { type: 'WriteLine' } });
  assert.equal(queried, false);
});

test('updateUI correctly toggles hidden classes based on ReadContent and parser selection', () => {
  class MockClassList {
    constructor() { this.classes = new Set(); }
    toggle(cls, force) {
      if (force) this.classes.add(cls);
      else this.classes.delete(cls);
    }
    contains(cls) { return this.classes.has(cls); }
  }

  const elements = {
    '#ReadContent': { checked: false, addEventListener: () => {}, removeEventListener: () => {} },
    '#ResponseContentParserName': { value: 'JSON', addEventListener: () => {}, removeEventListener: () => {} },
    '#ResponseContentParserNameControl': { classList: new MockClassList() },
    '#ResponseContentTargetTypeControl': { classList: new MockClassList() }
  };

  const mockDoc = {
    querySelector: sel => elements[sel] || null
  };

  const { plugin } = loadPlugin(mockDoc);

  // 1. Unchecked ReadContent: parser and target type hidden
  elements['#ReadContent'].checked = false;
  plugin.updateUI();
  assert.equal(elements['#ResponseContentParserNameControl'].classList.contains('hidden'), true);
  assert.equal(elements['#ResponseContentTargetTypeControl'].classList.contains('hidden'), true);

  // 2. Checked ReadContent with JSON parser: parser visible, target type hidden
  elements['#ReadContent'].checked = true;
  elements['#ResponseContentParserName'].value = 'JSON';
  plugin.updateUI();
  assert.equal(elements['#ResponseContentParserNameControl'].classList.contains('hidden'), false);
  assert.equal(elements['#ResponseContentTargetTypeControl'].classList.contains('hidden'), true);

  // 3. Checked ReadContent with .NET Type parser: both visible
  elements['#ReadContent'].checked = true;
  elements['#ResponseContentParserName'].value = '.NET Type';
  plugin.updateUI();
  assert.equal(elements['#ResponseContentParserNameControl'].classList.contains('hidden'), false);
  assert.equal(elements['#ResponseContentTargetTypeControl'].classList.contains('hidden'), false);
});

test('onActivityEditorAppearing binds listeners when elements are present and cleans them up on disappearing', () => {
  let readContentListeners = 0;
  let parserListeners = 0;

  const elements = {
    '#ReadContent': {
      checked: true,
      addEventListener(evt, fn) { readContentListeners++; },
      removeEventListener(evt, fn) { readContentListeners--; }
    },
    '#ResponseContentParserName': {
      value: 'JSON',
      addEventListener(evt, fn) { parserListeners++; },
      removeEventListener(evt, fn) { parserListeners--; }
    }
  };

  const mockDoc = {
    querySelector: sel => elements[sel] || null
  };

  const { handlers } = loadPlugin(mockDoc);

  handlers['appearing']({ activityDescriptor: { type: 'SendHttpRequest' } });
  assert.equal(readContentListeners, 1);
  assert.equal(parserListeners, 1);

  handlers['disappearing']({ activityDescriptor: { type: 'SendHttpRequest' } });
  assert.equal(readContentListeners, 0);
  assert.equal(parserListeners, 0);
});
