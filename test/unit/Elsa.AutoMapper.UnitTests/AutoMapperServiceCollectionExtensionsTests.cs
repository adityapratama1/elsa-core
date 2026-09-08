using AutoMapper;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Elsa.AutoMapper.UnitTests;

public class AutoMapperServiceCollectionExtensionsTests
{
    [Fact]
    public void AddElsaRegistersPatchedAutoMapperAndConfiguredProfiles()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddElsaCore(options => options.Services.AddAutoMapperProfile<TestProfile>());

        using var serviceProvider = services.BuildServiceProvider();
        var mapper = serviceProvider.GetRequiredService<IMapper>();
        var destination = mapper.Map<TestDestination>(new TestSource { Value = "mapped" });

        Assert.Equal("mapped", destination.Value);
    }

    private sealed class TestProfile : Profile
    {
        public TestProfile() => CreateMap<TestSource, TestDestination>();
    }

    private sealed class TestSource
    {
        public string Value { get; set; } = default!;
    }

    private sealed class TestDestination
    {
        public string Value { get; set; } = default!;
    }
}
