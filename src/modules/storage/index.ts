import { DataSource } from 'typeorm';
import { S3Client } from '@aws-sdk/client-s3';
import { env } from '../../config/env';
import { S3Adapter } from '../../adapters/s3.adapter';
import { StorageRepository } from './storage.repository';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { createStorageRoutes } from './storage.routes';

// Repository, controller, validators, and the entity itself stay private to this module — only
// `router` and `service` cross the boundary, same as every other module's index.ts. `service` is
// exported (not just `router`) so a later consumer — e.g. organization/masters document flows —
// can constructor-inject it directly, without a gateway wrapper.
export function createStorageModule(dataSource: DataSource) {
  const s3Client = new S3Client({
    region: env.awsRegion,
    credentials: { accessKeyId: env.s3AccessKeyId, secretAccessKey: env.s3SecretAccessKey },
  });
  const s3Adapter = new S3Adapter(s3Client, env.s3Bucket);
  const repository = new StorageRepository(dataSource);
  const service = new StorageService(repository, s3Adapter);
  const controller = new StorageController(service);
  return { router: createStorageRoutes(controller), service };
}
