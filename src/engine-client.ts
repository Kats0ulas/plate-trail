import type { WorkerEnvelope, WorkerReply, WorkerRequest } from './engine/worker';
import EngineWorker from './engine/worker?worker';

/** Promise-based client for the engine worker. Later requests of the same type supersede earlier ones. */

const worker = new EngineWorker({ name: 'retention-window-engine' });
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const latestByType = new Map<string, number>();

worker.onmessage = (e: MessageEvent<WorkerReply>) => {
  const reply = e.data;
  const p = pending.get(reply.id);
  if (!p) return;
  pending.delete(reply.id);
  if (reply.ok) p.resolve(reply.data);
  else p.reject(new Error(reply.error));
};

export class Superseded extends Error {}

export function call<T>(req: WorkerRequest): Promise<T> {
  const id = nextId++;
  latestByType.set(req.type, id);
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (v) =>
        latestByType.get(req.type) === id ? resolve(v as T) : reject(new Superseded()),
      reject,
    });
    worker.postMessage({ id, req } satisfies WorkerEnvelope);
  });
}
