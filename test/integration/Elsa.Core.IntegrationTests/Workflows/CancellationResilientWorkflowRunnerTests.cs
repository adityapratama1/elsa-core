using System;
using System.Threading;
using System.Threading.Tasks;
using Elsa.ActivityResults;
using Elsa.Builders;
using Elsa.Events;
using Elsa.Models;
using Elsa.Options;
using Elsa.Persistence;
using Elsa.Services;
using Elsa.Services.Models;
using Elsa.Testing.Shared.Unit;
using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using Xunit.Abstractions;

namespace Elsa.Core.IntegrationTests.Workflows
{
    public class CancellationResilientWorkflowRunnerTests : WorkflowsUnitTestBase
    {
        public CancellationResilientWorkflowRunnerTests(ITestOutputHelper testOutputHelper)
            : base(testOutputHelper, ConfigureServices, ConfigureElsa)
        {
        }

        [Fact(DisplayName = "Persists a faulted workflow when the execution token is cancelled by an activity.")]
        public async Task PersistsFaultedWorkflowAfterExecutionCancellation()
        {
            var cancellation = ServiceScope.ServiceProvider.GetRequiredService<ExecutionCancellation>();
            var notifications = ServiceScope.ServiceProvider.GetRequiredService<FaultNotificationObserver>();

            var result = await WorkflowBuilderAndStarter.BuildAndStartWorkflowAsync<CancellingWorkflow>(
                cancellationToken: cancellation.Token);

            var persistedInstance = await ServiceScope.ServiceProvider
                .GetRequiredService<IWorkflowInstanceStore>()
                .FindByIdAsync(result.WorkflowInstance!.Id, CancellationToken.None);

            Assert.True(cancellation.Token.IsCancellationRequested);
            Assert.Equal(WorkflowStatus.Faulted, result.WorkflowInstance.WorkflowStatus);
            Assert.NotNull(persistedInstance);
            Assert.Equal(WorkflowStatus.Faulted, persistedInstance!.WorkflowStatus);
            Assert.Equal(1, notifications.ActivityFaultedCount);
            Assert.Equal(1, notifications.WorkflowFaultedCount);
            Assert.False(notifications.ActivityFaultedTokenWasCancelled);
            Assert.False(notifications.WorkflowFaultedTokenWasCancelled);
        }

        private static void ConfigureElsa(ElsaOptionsBuilder options) => options.AddActivity<CancelRequestActivity>();

        private static void ConfigureServices(IServiceCollection services)
        {
            services.AddSingleton<ExecutionCancellation>();
            services.AddSingleton<FaultNotificationObserver>();
            services.AddSingleton<INotificationHandler<ActivityFaulted>>(sp => sp.GetRequiredService<FaultNotificationObserver>());
            services.AddSingleton<INotificationHandler<WorkflowFaulted>>(sp => sp.GetRequiredService<FaultNotificationObserver>());
        }
    }

    public class CancellingWorkflow : IWorkflow
    {
        public void Build(IWorkflowBuilder builder) => builder.Then<CancelRequestActivity>();
    }

    public class CancelRequestActivity : Activity
    {
        private readonly ExecutionCancellation _executionCancellation;

        public CancelRequestActivity(ExecutionCancellation executionCancellation)
        {
            _executionCancellation = executionCancellation;
        }

        protected override ValueTask<IActivityExecutionResult> OnExecuteAsync(ActivityExecutionContext context)
        {
            _executionCancellation.Cancel();
            throw new TaskCanceledException("Simulated request cancellation during activity execution.");
        }
    }

    public sealed class ExecutionCancellation : IDisposable
    {
        private readonly CancellationTokenSource _source = new();

        public CancellationToken Token => _source.Token;

        public void Cancel() => _source.Cancel();

        public void Dispose() => _source.Dispose();
    }

    public sealed class FaultNotificationObserver :
        INotificationHandler<ActivityFaulted>,
        INotificationHandler<WorkflowFaulted>
    {
        public int ActivityFaultedCount { get; private set; }
        public int WorkflowFaultedCount { get; private set; }
        public bool ActivityFaultedTokenWasCancelled { get; private set; }
        public bool WorkflowFaultedTokenWasCancelled { get; private set; }

        public Task Handle(ActivityFaulted notification, CancellationToken cancellationToken)
        {
            ActivityFaultedCount++;
            ActivityFaultedTokenWasCancelled = cancellationToken.IsCancellationRequested;
            return Task.CompletedTask;
        }

        public Task Handle(WorkflowFaulted notification, CancellationToken cancellationToken)
        {
            WorkflowFaultedCount++;
            WorkflowFaultedTokenWasCancelled = cancellationToken.IsCancellationRequested;
            return Task.CompletedTask;
        }
    }
}
