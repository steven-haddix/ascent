// world-atlas ships TopoJSON data files without type declarations. We only ever pass
// the topology through topojson-client, so `unknown` (cast at the call site) is enough.
declare module "world-atlas/*.json" {
  const topology: unknown;
  export default topology;
}
