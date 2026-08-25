export interface TenancyGateway {
  // method/path are the current request's HTTP method and pathname (e.g. req.method/req.path) —
  // reads (GET/HEAD/OPTIONS) are allowed for any tenant-accessible org, mutating methods
  // additionally require the org to be fully approved, except for a small, explicit set of
  // routes (path-matched) that only need the org to be accessible. See TenancyGatewayLocal for
  // the actual status checks and the route exemption list.
  assertTenantActive(tenantId: string, method: string, path: string): Promise<void>;
}
