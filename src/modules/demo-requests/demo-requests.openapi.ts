import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { TAGS, errorContent } from '../../shared/openapi/core';
import { DEMO_REQUEST_RATE_LIMIT } from './demo-requests.routes';
import { demoRequestsValidators } from './demo-requests.validators';

const BASE = `${API_VERSION_PREFIX}/demo-requests`;

export function registerDemoRequestsOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: BASE,
    tags: [TAGS.DEMO_REQUESTS],
    operationId: 'demoRequests.create',
    description: `Public. Saves a "Book a Demo" request from the landing page. phoneNumber accepts 10 digits with or without +91. The same email + phone + product within 30 minutes is not saved twice. \`website\` is a honeypot: leave it empty. Rate limited to ${DEMO_REQUEST_RATE_LIMIT.limit} per IP per hour.`,
    request: {
      body: {
        content: { 'application/json': { schema: demoRequestsValidators.create.shape.body } },
      },
    },
    responses: {
      201: { description: '{ received: true }' },
      400: { description: 'Validation failed', ...errorContent },
      429: { description: 'Rate limit exceeded', ...errorContent },
    },
  });
}
