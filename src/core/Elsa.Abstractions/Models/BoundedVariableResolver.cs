using System;
using System.Threading;
using System.Threading.Tasks;

namespace Elsa.Models
{
    /// <summary>
    /// Compatibility bridge for legacy synchronous readers. At most one asynchronous load is
    /// in flight. A timeout does not spawn duplicate loads if the provider ignores cancellation.
    /// </summary>
    public sealed class BoundedVariableResolver
    {
        private readonly Func<CancellationToken, Task<object?>> _load;
        private readonly TimeSpan _timeout;
        private readonly object _gate = new();
        private Task<object?>? _pending;

        public BoundedVariableResolver(Func<CancellationToken, Task<object?>> load, TimeSpan timeout)
        {
            _load = load ?? throw new ArgumentNullException(nameof(load));
            if (timeout <= TimeSpan.Zero || timeout > TimeSpan.FromMinutes(5))
                throw new ArgumentOutOfRangeException(nameof(timeout));
            _timeout = timeout;
        }

        public object? Resolve()
        {
            lock (_gate)
            {
                if (_pending == null || _pending.IsFaulted || _pending.IsCanceled)
                {
                    // Never run provider continuations on a caller's UI/request synchronization context.
                    _pending = Task.Run(async () =>
                    {
                        using var cancellation = new CancellationTokenSource(_timeout);
                        return await _load(cancellation.Token).ConfigureAwait(false);
                    });
                    // Observe failures even when a timed-out caller never reads this variable again.
                    _ = _pending.ContinueWith(task => { _ = task.Exception; }, CancellationToken.None,
                        TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
                        TaskScheduler.Default);
                }
                using var deadline = new CancellationTokenSource();
                var delay = Task.Delay(_timeout, deadline.Token);
                var completed = Task.WhenAny(_pending, delay).GetAwaiter().GetResult();
                deadline.Cancel();
                if (completed != _pending) throw new TimeoutException("Workflow variable payload load timed out.");
                return _pending.GetAwaiter().GetResult();
            }
        }
    }
}
