/** In-process callbacks: their results are never persisted by the Workflow SDK. */
export type LocalSteps = { run<T>(name: string, callback: () => Promise<T> | T): Promise<T> };
export const localSteps: LocalSteps = { run: async (_name, callback) => callback() };
