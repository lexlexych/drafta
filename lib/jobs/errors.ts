/** A business rejection, caught before crossing a durable step boundary. */
export class NonRetriableError extends Error {
  override name = 'NonRetriableError';
}
