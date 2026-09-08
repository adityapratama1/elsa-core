using System.Collections.Generic;
using System.Linq;
using Elsa.Models;
using Elsa.Services;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Elsa.AutoMapper.UnitTests;

public class ContentSerializerClonerTests
{
    [Fact]
    public void AddElsaRegistersDeepDomainClonerWithoutAutoMapper()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddElsaCore();

        using var serviceProvider = services.BuildServiceProvider();
        var cloner = serviceProvider.GetRequiredService<ICloner>();
        var source = new WorkflowDefinition
        {
            Id = "version-1",
            DefinitionId = "workflow-1",
            Name = "Original",
            Activities = new List<ActivityDefinition>
            {
                new() { ActivityId = "activity-1", Type = "WriteLine" }
            }
        };

        var clone = cloner.Clone(source);

        Assert.NotSame(source, clone);
        Assert.NotSame(source.Activities, clone.Activities);
        Assert.Equal(source.Id, clone.Id);
        Assert.Equal(source.Activities.Single().ActivityId, clone.Activities.Single().ActivityId);

        clone.Activities.Single().ActivityId = "changed";
        Assert.Equal("activity-1", source.Activities.Single().ActivityId);
    }
}
