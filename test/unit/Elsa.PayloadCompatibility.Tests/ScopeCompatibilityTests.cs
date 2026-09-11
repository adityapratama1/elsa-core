using System;
using System.Collections.Generic;
using System.Linq;
using Elsa.Models;
using Elsa.Persistence;
using Elsa.Services;
using Elsa.Services.Models;
using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Newtonsoft.Json;
using NodaTime;
using Xunit;

public class ScopeCompatibilityTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void LookupKeepsScopeAndTransientPrecedence(bool transientNull)
    {
        using var services = new ServiceCollection()
            .AddSingleton(JsonSerializer.CreateDefault())
            .AddSingleton(Mock.Of<IMediator>())
            .AddSingleton(Mock.Of<IPublisher>())
            .AddSingleton(Mock.Of<IWorkflowExecutionLogStore>())
            .AddSingleton(Mock.Of<IIdGenerator>())
            .AddSingleton<IClock>(SystemClock.Instance)
            .BuildServiceProvider();
        var instance = new WorkflowInstance();
        var context = new WorkflowExecutionContext(services, Mock.Of<IWorkflowBlueprint>(), instance);
        instance.Variables.Set("name", "root");
        foreach (var name in new[] { "first", "second" })
        {
            var scope = new ActivityScope(name);
            scope.Variables.Set("name", name);
            instance.Scopes.Push(scope);
        }
        Assert.Equal(context.GetMergedVariables().Get("name"), context.GetVariable("name"));
        context.TransientState.Set("name", transientNull ? null : "transient");
        Assert.Equal(context.GetMergedVariables().Get("name"), context.GetVariable("name"));
        var data = new DeferredVariableDictionary(instance.Variables.Data);
        data.Defer("unused", () => throw new Exception("unrelated variable loaded"));
        instance.Variables = new Variables(data);
        Assert.True(context.HasVariable("unused"));
        Assert.Contains("unused", context.GetVariableNames());
        Assert.Equal(transientNull ? null : "transient", context.GetVariable<string>("name"));
        Assert.Equal(0, context.GetVariable<int>("missing"));
        Assert.Equal(2, instance.Scopes.Count);
    }
}
