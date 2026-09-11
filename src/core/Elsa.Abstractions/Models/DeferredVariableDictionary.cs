using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

namespace Elsa.Models
{
    /// <summary>
    /// Runtime-only variable dictionary. A key lookup resolves only that key; metadata operations
    /// do not resolve values. Persistence must materialize it into a normal dictionary before serialization.
    /// Resolvers must enforce their own I/O deadline and must not capture scoped/disposed database services.
    /// </summary>
    public sealed class DeferredVariableDictionary : IDictionary<string, object?>
    {
        private readonly object _gate = new();
        private readonly Dictionary<string, object?> _values;
        private readonly Dictionary<string, Func<object?>> _resolvers = new(StringComparer.Ordinal);
        private readonly Dictionary<string, object> _persistenceTokens = new(StringComparer.Ordinal);
        private Dictionary<string, object>? _snapshot;

        public DeferredVariableDictionary(IDictionary<string, object?> values)
        {
            _values = new Dictionary<string, object?>(values, StringComparer.Ordinal);
        }

        public void Defer(string name, Func<object?> resolve) => Defer(name, resolve, null);

        public void Defer(string name, Func<object?> resolve, object? persistenceToken)
        {
            if (resolve == null) throw new ArgumentNullException(nameof(resolve));
            lock (_gate)
            {
                _values[name] = null;
                _resolvers[name] = resolve;
                _persistenceTokens.Remove(name);
                if (persistenceToken != null) _persistenceTokens[name] = persistenceToken;
            }
        }

        public object? this[string key]
        {
            get
            {
                lock (_gate)
                {
                    if (_resolvers.TryGetValue(key, out var resolve))
                    {
                        // Failed loads are not cached as null and may be retried by the caller.
                        var value = resolve();
                        _values[key] = value;
                        _resolvers.Remove(key);
                        _persistenceTokens.Remove(key);
                    }
                    return _values[key];
                }
            }
            set { lock (_gate) { _values[key] = value; _resolvers.Remove(key); _persistenceTokens.Remove(key); } }
        }

        public ICollection<string> Keys { get { lock (_gate) return _values.Keys.ToArray(); } }
        public ICollection<object?> Values => Keys.Select(key => this[key]).ToArray();
        public int Count { get { lock (_gate) return _values.Count; } }
        public bool IsReadOnly => false;
        public bool ContainsKey(string key) { lock (_gate) return _values.ContainsKey(key); }
        public bool TryGetValue(string key, out object? value)
        {
            lock (_gate)
            {
                if (!_values.ContainsKey(key)) { value = null; return false; }
                value = this[key];
                return true;
            }
        }
        public void Add(string key, object? value) { lock (_gate) _values.Add(key, value); }
        public bool Remove(string key) { lock (_gate) { _resolvers.Remove(key); _persistenceTokens.Remove(key); return _values.Remove(key); } }
        public void Clear() { lock (_gate) { _resolvers.Clear(); _persistenceTokens.Clear(); _values.Clear(); } }
        public void Add(KeyValuePair<string, object?> item) => Add(item.Key, item.Value);
        public bool Contains(KeyValuePair<string, object?> item) =>
            TryGetValue(item.Key, out var value) && EqualityComparer<object?>.Default.Equals(value, item.Value);
        public bool Remove(KeyValuePair<string, object?> item)
        {
            lock (_gate) return Contains(item) && Remove(item.Key);
        }
        public void CopyTo(KeyValuePair<string, object?>[] array, int arrayIndex) =>
            ((ICollection<KeyValuePair<string, object?>>)Materialize()).CopyTo(array, arrayIndex);
        public IEnumerator<KeyValuePair<string, object?>> GetEnumerator()
        {
            foreach (var key in Keys)
            {
                object? value;
                lock (_gate)
                {
                    if (_snapshot != null && _persistenceTokens.TryGetValue(key, out var token))
                    {
                        _snapshot[key] = token;
                        value = null;
                    }
                    else value = this[key];
                }
                yield return new KeyValuePair<string, object?>(key, value);
            }
        }
        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

        public Dictionary<string, object?> Materialize() => this.ToDictionary(x => x.Key, x => x.Value, StringComparer.Ordinal);

        /// <summary>
        /// Synchronously serialize the original graph, collecting opaque references for unread values.
        /// The caller must persist these references with the null slots atomically in its snapshot.
        /// Normal reads never return placeholders. Untokened resolvers still materialize.
        /// </summary>
        public IReadOnlyDictionary<string, object> SerializeWithDeferredReferences(Action serialize)
        {
            lock (_gate)
            {
                if (_snapshot != null) throw new InvalidOperationException("Nested deferred persistence snapshot.");
                var snapshot = new Dictionary<string, object>(StringComparer.Ordinal);
                _snapshot = snapshot;
                try { serialize(); return snapshot; }
                finally { _snapshot = null; }
            }
        }
    }
}
