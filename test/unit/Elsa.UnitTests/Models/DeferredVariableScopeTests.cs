using System;
using System.Collections.Generic;
using System.Linq;
using Elsa.Services.Models;
using Elsa.Testing.Shared;
using Elsa.Testing.Shared.AutoFixture.Attributes;
using Xunit;

namespace Elsa.Models
{
    public class DeferredVariableScopeTests
    {
        [Theory, AutoMoqData]
        public void LookupMatchesMergedPrecedenceWithoutResolvingOtherVariables(
            [StubActivityExecutionContext] ActivityExecutionContext activityContext)
        {
            var context = activityContext.WorkflowExecutionContext;
            context.WorkflowInstance.Scopes.Clear();
            var root = new DeferredVariableDictionary(new Dictionary<string, object?> { ["name"] = "root" });
            root.Defer("unused", () => throw new Exception("must not hydrate"));
            context.WorkflowInstance.Variables = new Variables(root);
            var scope = new ActivityScope("scope");
            scope.Variables.Set("name", "scope");
            context.WorkflowInstance.Scopes.Push(scope);
            Assert.Equal("scope", context.GetVariable<string>("name"));
            Assert.True(context.HasVariable("unused"));
            Assert.Contains("unused", context.GetVariableNames());
            Assert.Equal(0, context.GetVariable<int>("missing"));
            Assert.Single(context.WorkflowInstance.Scopes);
        }

        [Theory, AutoMoqData]
        public void MultipleScopePrecedenceIsUnchanged(
            [StubActivityExecutionContext] ActivityExecutionContext activityContext)
        {
            var context = activityContext.WorkflowExecutionContext;
            context.WorkflowInstance.Scopes.Clear();
            context.WorkflowInstance.Variables = new Variables();
            context.SetVariable("name", "root");
            foreach (var name in new[] { "first", "second", "third" })
            {
                var scope = new ActivityScope(name);
                scope.Variables.Set("name", name);
                context.WorkflowInstance.Scopes.Push(scope);
            }
            var order = context.WorkflowInstance.Scopes.Select(x => x.ActivityId).ToArray();
            Assert.Equal(context.GetMergedVariables().Get("name"), context.GetVariable("name"));
            Assert.Equal(order, context.WorkflowInstance.Scopes.Select(x => x.ActivityId));
        }
    }
}
