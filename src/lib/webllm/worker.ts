import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

// All heavy work (WASM compilation, model loading, inference)
// runs in this worker thread, keeping the main thread free.
const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
