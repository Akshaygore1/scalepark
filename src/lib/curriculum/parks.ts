import {
  createNode,
  park,
  type Architecture,
  type NodeConfigs,
  type NodeType,
  type ParkNode,
} from "../model";

export type ParkSpec = { [T in Exclude<NodeType, "client">]?: Partial<NodeConfigs[T]> };

/** Build a park with the conventional routes between whatever buildings are present. */
export function standardPark(spec: ParkSpec): Architecture {
  const nodes: ParkNode[] = [createNode("client")];
  for (const type of Object.keys(spec) as Array<keyof ParkSpec>) {
    nodes.push(createNode(type, spec[type] as never) as ParkNode);
  }
  const has = (type: NodeType) => nodes.some((node) => node.type === type);
  const routes: Array<[NodeType, NodeType]> = [];
  if (has("api")) routes.push(has("load-balancer") ? ["client", "load-balancer"] : ["client", "api"]);
  if (has("load-balancer") && has("api")) routes.push(["load-balancer", "api"]);
  if (has("api") && has("database")) routes.push(["api", "database"]);
  if (has("api") && has("cache")) routes.push(["api", "cache"]);
  if (has("replica") && has("api") && has("database")) routes.push(["api", "replica"], ["database", "replica"]);
  if (has("queue") && has("worker") && has("api") && has("database")) {
    routes.push(["api", "queue"], ["queue", "worker"], ["worker", "database"]);
  }
  if (has("pubsub") && has("api")) routes.push(["api", "pubsub"]);
  if (has("archive") && has("database")) routes.push(["database", "archive"]);
  return park(nodes, routes);
}

export const clientsOnly = () => standardPark({});
