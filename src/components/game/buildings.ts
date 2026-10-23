import {
  Archive,
  Boxes,
  Container,
  Database,
  HardDrive,
  Network,
  Radio,
  Server,
  TimerReset,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { NodeType } from "@/lib/model";

export const buildingLook: Record<NodeType, { icon: LucideIcon; color: string }> = {
  client: { icon: Users, color: "mint" },
  "load-balancer": { icon: Network, color: "violet" },
  api: { icon: Server, color: "coral" },
  cache: { icon: Zap, color: "yellow" },
  database: { icon: Database, color: "blue" },
  replica: { icon: HardDrive, color: "indigo" },
  queue: { icon: Boxes, color: "orange" },
  worker: { icon: TimerReset, color: "green" },
  pubsub: { icon: Radio, color: "sky" },
  archive: { icon: Archive, color: "stone" },
  service: { icon: Container, color: "coral" },
};

export function formatMoney(value: number) {
  return `$${Math.round(value).toLocaleString()}`;
}

export function formatRate(value: number) {
  return `${Math.round(value).toLocaleString()}/s`;
}
