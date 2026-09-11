using System.Collections.Generic;
using Elsa.Models;
using Elsa.Serialization;
using Xunit;

namespace Elsa.PayloadCompatibility.Tests;

public class VariableSerializationTests
{
    [Fact]
    public void PersistenceSnapshotRetainsUnreadTokensAndRestoresNormalEnumerationAfterFailure()
    {
        var data = new DeferredVariableDictionary(new Dictionary<string, object?>());
        var token = new object();
        var reads = 0;
        data.Defer("large", () => { reads++; return "value"; }, token);
        var serializer = new DefaultContentSerializer(DefaultContentSerializer.CreateDefaultJsonSerializer);
        string json = "";
        var references = data.SerializeWithDeferredReferences(() => json = serializer.Serialize(new State { Variables = new Variables(data) }));
        Assert.Equal(0, reads);
        Assert.Same(token, references["large"]);
        Assert.Contains("\"large\": null", json);
        Assert.Throws<System.InvalidOperationException>(() => data.SerializeWithDeferredReferences(() => throw new System.InvalidOperationException()));
        Assert.Equal("value", data.Materialize()["large"]);
        Assert.Equal(1, reads);
    }

    [Fact]
    public void AssignmentAndRemovalDiscardPersistenceTokens()
    {
        var data = new DeferredVariableDictionary(new Dictionary<string, object?>());
        data.Defer("overwrite", () => throw new System.Exception("Must not fetch"), new object());
        data.Defer("remove", () => throw new System.Exception("Must not fetch"), new object());
        data["overwrite"] = "new";
        data.Remove("remove");
        var serializer = new DefaultContentSerializer(DefaultContentSerializer.CreateDefaultJsonSerializer);
        var references = data.SerializeWithDeferredReferences(() => serializer.Serialize(new State { Variables = new Variables(data) }));
        Assert.Empty(references);
    }

    [Fact]
    public void SaveMatchesLegacyGraphWithoutPersistingDeferredImplementation()
    {
        var data = new DeferredVariableDictionary(new Dictionary<string, object?>());
        var variables = new Variables(data);
        var reads = 0;
        data.Defer("large", () => { reads++; return new string('x', 100); });
        data["selfData"] = data;
        data["selfVariables"] = variables;
        var serializer = new DefaultContentSerializer(DefaultContentSerializer.CreateDefaultJsonSerializer);
        var legacy = new Variables();
        legacy.Set("large", new string('x', 100));
        legacy.Set("selfData", legacy.Data);
        legacy.Set("selfVariables", legacy);

        var json = serializer.Serialize(new State { Variables = variables });
        var legacyJson = serializer.Serialize(new State { Variables = legacy });
        var restored = serializer.Deserialize<State>(json).Variables;

        Assert.Equal(1, reads);
        Assert.DoesNotContain(nameof(DeferredVariableDictionary), json);
        Assert.Equal(legacyJson, json);
        Assert.IsType<Dictionary<string, object>>(restored.Data);
        Assert.Equal(new string('x', 100), restored.Get("large"));
    }

    public class State
    {
        public Variables Variables { get; set; } = new Variables();
    }
}
