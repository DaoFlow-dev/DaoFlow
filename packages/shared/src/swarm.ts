import { z } from "zod";

export const swarmNodeRoleSchema = z.enum(["manager", "worker"]);
export const swarmNodeAvailabilitySchema = z.enum(["active", "pause", "drain", "unknown"]);
export const swarmNodeReachabilitySchema = z.enum(["reachable", "unreachable", "unknown"]);
export const swarmNodeManagerStatusSchema = z.enum([
  "leader",
  "reachable",
  "unreachable",
  "none",
  "unknown"
]);
export const swarmTopologySourceSchema = z.enum(["registration", "manual", "discovered"]);

export const swarmTopologyNodeSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  host: z.string().min(1).max(255).nullable().default(null),
  role: swarmNodeRoleSchema,
  availability: swarmNodeAvailabilitySchema.default("active"),
  reachability: swarmNodeReachabilitySchema.default("unknown"),
  managerStatus: swarmNodeManagerStatusSchema.default("none")
});

export const swarmTopologySchema = z
  .object({
    clusterId: z.string().min(1).max(120),
    clusterName: z.string().min(1).max(120),
    source: swarmTopologySourceSchema.default("registration"),
    defaultNamespace: z.string().min(1).max(120).nullable().default(null),
    nodes: z.array(swarmTopologyNodeSchema).min(1).max(50)
  })
  .superRefine((value, ctx) => {
    if (!value.nodes.some((node) => node.role === "manager")) {
      ctx.addIssue({
        code: "custom",
        message: "Swarm topology must include at least one manager node.",
        path: ["nodes"]
      });
    }
  });

export const swarmTopologySummarySchema = z.object({
  nodeCount: z.number().int().min(0),
  managerCount: z.number().int().min(0),
  workerCount: z.number().int().min(0),
  activeNodeCount: z.number().int().min(0),
  reachableNodeCount: z.number().int().min(0)
});

export const swarmTopologySnapshotSchema = swarmTopologySchema.extend({
  summary: swarmTopologySummarySchema
});

export type SwarmTopology = z.infer<typeof swarmTopologySchema>;
export type SwarmTopologyNode = z.infer<typeof swarmTopologyNodeSchema>;
export type SwarmTopologySnapshot = z.infer<typeof swarmTopologySnapshotSchema>;
