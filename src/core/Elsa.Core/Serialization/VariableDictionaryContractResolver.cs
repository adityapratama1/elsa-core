using System;
using System.Collections.Generic;
using Elsa.Models;
using Newtonsoft.Json.Serialization;

namespace Elsa.Serialization
{
    // Serialize the live object with the legacy dictionary contract, without cloning
    // Variables/Data or introducing a runtime-only $type into persisted state.
    internal sealed class VariableDictionaryContractResolver : DefaultContractResolver
    {
        public override JsonContract ResolveContract(Type type) => base.ResolveContract(
            type == typeof(DeferredVariableDictionary) ? typeof(Dictionary<string, object>) : type);
    }
}
