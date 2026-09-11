using System;
using Jint;

namespace Elsa.Scripting.JavaScript.Services
{
    /// <summary>Preserves synchronous global variable syntax without evaluating the value during binding.</summary>
    public static class DeferredVariableBinding
    {
        public static Action<string, Func<object?>> Create(Engine engine)
        {
            // The name is passed as an argument, never interpolated into JavaScript source.
            // Assigning a global remains local to this engine, just as with the old SetValue binding.
            var bind = engine.Evaluate(@"(function(defineProperty) { return function(name, read) {
                var loaded = false, value;
                defineProperty(this, name, {
                    configurable: true, enumerable: true,
                    get: function() {
                        if (!loaded) { value = read(); loaded = true; }
                        return value;
                    },
                    set: function(next) { value = next; loaded = true; }
                });
            }; })(Object.defineProperty)");
            return (name, read) => engine.Invoke(bind, name, read);
        }
    }
}
