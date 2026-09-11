using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Elsa.Models
{
    public class BoundedVariableResolverTests
    {
        [Fact]
        public void SuccessfulReadIsCached()
        {
            int calls = 0;
            var value = new object();
            var resolver = new BoundedVariableResolver(_ =>
            {
                Interlocked.Increment(ref calls);
                return Task.FromResult<object?>(value);
            }, TimeSpan.FromSeconds(2));
            Assert.Same(value, resolver.Resolve());
            Assert.Same(value, resolver.Resolve());
            Assert.Equal(1, calls);
        }

        [Fact]
        public void FailureIsPropagatedAndCanBeRetried()
        {
            int calls = 0;
            var resolver = new BoundedVariableResolver(_ => ++calls == 1
                ? Task.FromException<object?>(new IOException("missing"))
                : Task.FromResult<object?>("ok"), TimeSpan.FromSeconds(2));
            Assert.Throws<IOException>(() => resolver.Resolve());
            Assert.Equal("ok", resolver.Resolve());
        }

        [Fact]
        public void TimedOutProviderDoesNotCreateDuplicateInFlightRequests()
        {
            int calls = 0;
            var pending = new TaskCompletionSource<object?>(TaskCreationOptions.RunContinuationsAsynchronously);
            var resolver = new BoundedVariableResolver(_ =>
            {
                Interlocked.Increment(ref calls);
                return pending.Task;
            }, TimeSpan.FromMilliseconds(100));
            try
            {
                Assert.Throws<TimeoutException>(() => resolver.Resolve());
                Assert.Throws<TimeoutException>(() => resolver.Resolve());
            }
            finally { pending.TrySetResult("eventually available"); }
            Assert.Equal("eventually available", resolver.Resolve());
            Assert.Equal(1, calls);
        }
    }
}
