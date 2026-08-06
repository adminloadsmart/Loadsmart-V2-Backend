export interface TenancyGateway {
  assertTenantActive(tenantId: string): Promise<void>;
}
