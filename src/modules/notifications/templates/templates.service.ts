import { TemplatesRepository } from './templates.repository';

// Resolves a template by templateId only — locale-based lookup was dropped along with i18n.
export class TemplatesService {
  constructor(private readonly templatesRepository: TemplatesRepository) {}

  // TODO: business logic
}
