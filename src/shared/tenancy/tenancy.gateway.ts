export interface TenancyGateway {
  // method is the current request's HTTP method (e.g. req.method) — reads (GET/HEAD/OPTIONS) are
  // allowed for any tenant-accessible org, mutating methods additionally require the org to be
  // fully approved. See TenancyGatewayLocal for the actual status checks.
  assertTenantActive(tenantId: string, method: string): Promise<void>;
}
