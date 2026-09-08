using Elsa.Serialization;

namespace Elsa.Services
{
    /// <summary>
    /// Creates deep domain-model copies using Elsa's configured content serializer.
    /// </summary>
    public class ContentSerializerCloner : ICloner
    {
        private readonly IContentSerializer _contentSerializer;

        public ContentSerializerCloner(IContentSerializer contentSerializer) => _contentSerializer = contentSerializer;

        public T Clone<T>(T source)
        {
            if (source == null)
                return default!;

            return _contentSerializer.Deserialize<T>(_contentSerializer.Serialize(source));
        }
    }
}
