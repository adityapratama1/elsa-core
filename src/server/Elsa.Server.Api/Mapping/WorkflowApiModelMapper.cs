using System.Collections.Generic;
using System.Linq;
using Elsa.Models;
using Elsa.Server.Api.Endpoints.WorkflowDefinitions;
using Elsa.Server.Api.Endpoints.WorkflowInstances;
using Elsa.Server.Api.Endpoints.WorkflowRegistry;
using Elsa.Services.Models;

namespace Elsa.Server.Api.Mapping;

/// <summary>
/// Explicit mappings for the Elsa API contract. Keeping these mappings close to
/// the endpoint models makes API changes compile-time visible and avoids a global
/// runtime mapping configuration.
/// </summary>
public static class WorkflowApiModelMapper
{
    public static WorkflowInstanceSummaryModel ToSummary(this WorkflowInstance source) => new()
    {
        Id = source.Id,
        DefinitionId = source.DefinitionId,
        DefinitionVersionId = source.DefinitionVersionId,
        TenantId = source.TenantId,
        Version = source.Version,
        WorkflowStatus = source.WorkflowStatus,
        CorrelationId = source.CorrelationId,
        ContextType = source.ContextType,
        ContextId = source.ContextId,
        Name = source.Name,
        CreatedAt = source.CreatedAt,
        LastExecutedAt = source.LastExecutedAt,
        FinishedAt = source.FinishedAt,
        CancelledAt = source.CancelledAt,
        FaultedAt = source.FaultedAt,
        Metadata = source.Metadata
    };

    public static WorkflowDefinitionSummaryModel ToSummary(this WorkflowDefinition source) => new(
        source.Id,
        source.DefinitionId,
        source.TenantId,
        source.Name,
        source.DisplayName,
        source.Description,
        source.Version,
        source.IsSingleton,
        source.PersistenceBehavior,
        source.IsPublished,
        source.IsLatest,
        source.CustomAttributes,
        source.CreatedAt);

    public static WorkflowDefinitionVersionModel ToVersionModel(this WorkflowDefinition source) => new(
        source.Id,
        source.DefinitionId,
        source.Version,
        source.IsLatest,
        source.IsPublished,
        source.CreatedAt);

    public static WorkflowBlueprintSummaryModel ToSummary(this IWorkflowBlueprint source) => new()
    {
        Id = source.Id,
        VersionId = source.VersionId,
        Name = source.Name,
        DisplayName = source.DisplayName,
        Description = source.Description,
        Version = source.Version,
        TenantId = source.TenantId,
        IsSingleton = source.IsSingleton,
        IsPublished = source.IsPublished,
        IsLatest = source.IsLatest,
        IsDisabled = source.IsDisabled
    };

    public static WorkflowBlueprintModel ToModel(
        this IWorkflowBlueprint source,
        IReadOnlyDictionary<string, Variables> inputProperties,
        IReadOnlyDictionary<string, Variables> outputProperties)
    {
        var model = new WorkflowBlueprintModel
        {
            Version = source.Version,
            TenantId = source.TenantId,
            IsSingleton = source.IsSingleton,
            IsPublished = source.IsPublished,
            IsLatest = source.IsLatest,
            IsDisabled = source.IsDisabled,
            Variables = source.Variables,
            ContextOptions = source.ContextOptions,
            PersistenceBehavior = source.PersistenceBehavior,
            DeleteCompletedInstances = source.DeleteCompletedInstances,
            CustomAttributes = source.CustomAttributes
        };

        CopyActivity(source, model, inputProperties, outputProperties);
        CopyComposite(source, model, inputProperties, outputProperties);
        return model;
    }

    private static ActivityBlueprintModel ToActivityModel(
        IActivityBlueprint source,
        IReadOnlyDictionary<string, Variables> inputProperties,
        IReadOnlyDictionary<string, Variables> outputProperties)
    {
        ActivityBlueprintModel model = source is ICompositeActivityBlueprint
            ? new CompositeActivityBlueprintModel()
            : new ActivityBlueprintModel();

        CopyActivity(source, model, inputProperties, outputProperties);

        if (source is ICompositeActivityBlueprint composite && model is CompositeActivityBlueprintModel compositeModel)
            CopyComposite(composite, compositeModel, inputProperties, outputProperties);

        return model;
    }

    private static void CopyActivity(
        IActivityBlueprint source,
        ActivityBlueprintModel destination,
        IReadOnlyDictionary<string, Variables> inputProperties,
        IReadOnlyDictionary<string, Variables> outputProperties)
    {
        destination.Id = source.Id;
        destination.Name = source.Name;
        destination.DisplayName = source.DisplayName;
        destination.Description = source.Description;
        destination.Type = source.Type;
        destination.ParentId = source.Parent?.Id;
        destination.PersistWorkflow = source.PersistWorkflow;
        destination.LoadWorkflowContext = source.LoadWorkflowContext;
        destination.SaveWorkflowContext = source.SaveWorkflowContext;
        destination.InputProperties = inputProperties.TryGetValue(source.Id, out var inputs) ? inputs : new Variables();
        destination.OutputProperties = outputProperties.TryGetValue(source.Id, out var outputs) ? outputs : new Variables();
        destination.X = source.X;
        destination.Y = source.Y;
    }

    private static void CopyComposite(
        ICompositeActivityBlueprint source,
        CompositeActivityBlueprintModel destination,
        IReadOnlyDictionary<string, Variables> inputProperties,
        IReadOnlyDictionary<string, Variables> outputProperties)
    {
        destination.Activities = source.Activities
            .Select(x => ToActivityModel(x, inputProperties, outputProperties))
            .ToList();
        destination.Connections = source.Connections.Select(ToConnectionModel).ToList();
    }

    private static ConnectionModel ToConnectionModel(IConnection source) => new()
    {
        SourceActivityId = source.Source.Activity.Id,
        TargetActivityId = source.Target.Activity.Id,
        Outcome = source.Source.Outcome
    };
}
