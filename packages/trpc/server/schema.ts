import { z } from "zod";

/** Empty input for no-arg procedures — must be a ZodObject for OpenAPI / Scalar. */
export const zodUndefinedModel = z.object({}).strict();

export { z };
