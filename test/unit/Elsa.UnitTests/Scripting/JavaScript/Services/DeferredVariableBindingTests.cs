using System;
using Jint;
using Xunit;

namespace Elsa.Scripting.JavaScript.Services
{
    public class DeferredVariableBindingTests
    {
        [Fact]
        public void LegacyGlobalSyntaxIsLazyAndCached()
        {
            var engine = new Engine();
            int calls = 0;
            DeferredVariableBinding.Create(engine)("all_accounts", () => { calls++; return 42; });
            Assert.Equal(0, calls);
            Assert.Equal(84d, engine.Evaluate("all_accounts + all_accounts").AsNumber());
            Assert.Equal(1, calls);
        }

        [Fact]
        public void GlobalAssignmentRetainsLegacyLocalValueSemantics()
        {
            var engine = new Engine();
            int reads = 0;
            int workflowValue = 7;
            DeferredVariableBinding.Create(engine)("value", () => { reads++; return workflowValue; });
            Assert.Equal(3d, engine.Evaluate("value = 3; value").AsNumber());
            Assert.Equal(7, workflowValue);
            // This pinned Jint version reads a binding while resolving a simple-assignment LHS.
            Assert.Equal(1, reads);
        }

        [Fact]
        public void ArbitraryNamesAreArgumentsAndDoNotExecuteCode()
        {
            var engine = new Engine();
            const string name = "x'); throw new Error('injected'); //";
            DeferredVariableBinding.Create(engine)(name, () => "safe");
            Assert.Equal("safe", engine.GetValue(name).AsString());
        }

        [Fact]
        public void BindingDoesNotDependOnUserObjectGlobal()
        {
            var engine = new Engine();
            var bind = DeferredVariableBinding.Create(engine);
            bind("Object", () => 1);
            bind("another", () => 2);
            Assert.Equal(3d, engine.Evaluate("Object + another").AsNumber());
        }
    }
}
