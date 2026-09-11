using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Xunit;

namespace Elsa.Models
{
    public class DeferredVariableDictionaryTests
    {
        [Fact]
        public void MetadataDoesNotLoadAndExistingGetLoadsOnce()
        {
            int calls = 0;
            var data = new DeferredVariableDictionary(new Dictionary<string, object?>());
            data.Defer("large", () => { calls++; return "value"; });
            var variables = new Variables(data);
            Assert.True(variables.Has("large"));
            Assert.Single(data.Keys);
            Assert.Equal(1, data.Count);
            Assert.Equal(0, calls);
            Assert.Equal("value", variables.Get<string>("large"));
            Assert.Equal("value", data["large"]);
            Assert.Equal(1, calls);
        }

        [Fact]
        public void SetAndRemoveDoNotReadPreviousPayload()
        {
            var data = new DeferredVariableDictionary(new Dictionary<string, object?>());
            data.Defer("set", () => throw new Exception("must not load"));
            data.Defer("remove", () => throw new Exception("must not load"));
            var variables = new Variables(data);
            variables.Set("set", 42);
            variables.Remove("remove");
            Assert.Equal(42, variables.Get<int>("set"));
            Assert.False(variables.Has("remove"));
        }

        [Fact]
        public void FailedReadsAreRetryableAndNotCachedAsNull()
        {
            int calls = 0;
            var data = new DeferredVariableDictionary(new Dictionary<string, object?>());
            data.Defer("a", () => ++calls == 1 ? throw new IOException() : "ok");
            Assert.Throws<IOException>(() => data["a"]);
            Assert.Equal("ok", data["a"]);
            Assert.Equal(2, calls);
        }

        [Fact]
        public async Task ConcurrentReadsResolveOnlyOnceAndPreserveObjectIdentity()
        {
            int calls = 0;
            var value = new List<int>();
            var data = new DeferredVariableDictionary(new Dictionary<string, object?>());
            data.Defer("a", () => { calls++; return value; });
            var results = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => Task.Run(() => data["a"])));
            Assert.All(results, x => Assert.Same(value, x));
            value.Add(42);
            Assert.Same(value, data.Materialize()["a"]);
            Assert.Equal(1, calls);
        }

        [Fact]
        public void ClearDropsResolversAndNullIsAValidCachedValue()
        {
            int calls = 0;
            var data = new DeferredVariableDictionary(new Dictionary<string, object?>());
            data.Defer("a", () => { calls++; return null; });
            Assert.True(data.TryGetValue("a", out var first));
            Assert.Null(first);
            Assert.Null(data["a"]);
            Assert.Equal(1, calls);
            data.Clear();
            Assert.False(data.TryGetValue("a", out _));
        }
    }
}
