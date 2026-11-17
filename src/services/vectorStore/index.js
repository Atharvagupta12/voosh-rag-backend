import { config } from "../../config.js";
import { createLocalStore } from "./localStore.js";
import { createQdrantStore } from "./qdrantStore.js";

export const vectorStore = config.qdrant.url
  ? createQdrantStore({
      url: config.qdrant.url,
      apiKey: config.qdrant.apiKey,
      collection: config.qdrant.collection,
      dimensions: config.jina.dimensions,
    })
  : createLocalStore({ filePath: config.localIndexPath, dimensions: config.jina.dimensions });
