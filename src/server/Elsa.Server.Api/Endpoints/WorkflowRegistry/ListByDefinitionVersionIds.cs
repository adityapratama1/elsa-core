using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Asp.Versioning;
using Elsa.Server.Api.Mapping;
using Elsa.Server.Api.Helpers;
using Elsa.Server.Api.Models;
using Elsa.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Open.Linq.AsyncExtensions;
using Swashbuckle.AspNetCore.Annotations;

namespace Elsa.Server.Api.Endpoints.WorkflowRegistry
{
    [ApiController]
    [ApiVersion("1")]
    [Route("v{apiVersion:apiVersion}/workflow-registry/by-definition-version-ids")]
    [Produces("application/json")]
    public class ListByDefinitionVersionIds : Controller
    {
        private readonly IWorkflowRegistry _workflowRegistry;

        public ListByDefinitionVersionIds(IWorkflowRegistry workflowRegistry)
        {
            _workflowRegistry = workflowRegistry;
        }

        [HttpGet]
        [ProducesResponseType(StatusCodes.Status200OK, Type = typeof(PagedList<WorkflowBlueprintSummaryModel>))]
        [SwaggerOperation(
            Summary = "Returns a list of workflow blueprints for the provided set of definition version ids.",
            Description = "Returns a list of workflow blueprints for the provided set of definition version ids.",
            OperationId = "WorkflowBlueprints.ListByDefinitionVersionIds",
            Tags = new[] { "WorkflowBlueprints" })
        ]
        public async Task<ActionResult> Handle(string ids, CancellationToken cancellationToken = default)
        {
            var idList = ids.Split(",");
            var workflowBlueprints = await _workflowRegistry.FindManyByDefinitionVersionIds(idList, cancellationToken).ToList();
            var mappedItems = workflowBlueprints.Select(WorkflowApiModelMapper.ToSummary).ToList();

            return Ok(mappedItems).ConfigureForWorkflowDefinition();
        }
    }
}
