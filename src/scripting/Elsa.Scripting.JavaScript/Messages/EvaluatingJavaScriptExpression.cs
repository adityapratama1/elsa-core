using Elsa.Services.Models;
using Jint;
using MediatR;

namespace Elsa.Scripting.JavaScript.Messages
{
    public class EvaluatingJavaScriptExpression : INotification
    {
        public EvaluatingJavaScriptExpression(Engine engine, ActivityExecutionContext activityExecutionContext)
            : this(engine, activityExecutionContext, null)
        {
        }

        public EvaluatingJavaScriptExpression(Engine engine, ActivityExecutionContext activityExecutionContext, string? expression)
        {
            Engine = engine;
            ActivityExecutionContext = activityExecutionContext;
            Expression = expression;
        }

        public Engine Engine { get; }
        public ActivityExecutionContext ActivityExecutionContext { get; }
        public string? Expression { get; }
    }
}
