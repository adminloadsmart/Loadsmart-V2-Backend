import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_REGISTRY,
  TemplateKey,
  actionOfButtonTitle,
  msg91BodyOf,
  offerActionsOf,
  renderTemplateBody,
} from './template-registry';

const keys = Object.keys(TEMPLATE_REGISTRY) as TemplateKey[];

describe('load-flow WhatsApp templates (catalog LS_N_…)', () => {
  it.each(keys)(
    '%s: tokens in body = variables in order; Meta / MSG91 body and button rules',
    (key) => {
      const definition = TEMPLATE_REGISTRY[key];
      const tokens = [...definition.body.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
      expect(tokens).toEqual([...definition.variables]);
      // A body must not start or end with a variable (MSG91 template help / Meta).
      expect(definition.body.trim()).not.toMatch(/^\{\{/);
      expect(definition.body.trim()).not.toMatch(/\}\}[.\s]*$/);
      expect(definition.body.length).toBeLessThanOrEqual(1024);
      // MSG91: at most 3 buttons, each up to 20 characters.
      const buttons = 'buttons' in definition ? definition.buttons : [];
      expect(buttons.length).toBeLessThanOrEqual(3);
      for (const button of buttons) expect(button.title.length).toBeLessThanOrEqual(20);
    },
  );

  it('gives the body to create in MSG91 with {{var_N}} in variable order', () => {
    expect(msg91BodyOf('LS_N_0120')).toBe(
      'New indent from {{var_1}}: {{var_2}} to {{var_3}}, {{var_4}}, reporting {{var_5}}. Contract rate ₹{{var_6}}. Will you take it?',
    );
  });

  it('renders the sent text for the log, and maps a tapped button title to its action', () => {
    expect(
      renderTemplateBody('LS_N_0106', {
        route: 'Gurugram 122001 to Ludhiana',
        truck_type: '24 ft',
        weight: '18',
        reporting_time: '15 Nov, 10:00 am',
      }),
    ).toBe(
      'New load from Loadsmart: Gurugram 122001 to Ludhiana. Truck type: 24 ft, weight: 18 tons, reporting time: 15 Nov, 10:00 am. Send us your best rate. We have a new load opportunity available and look forward to receiving your quotation. Please share your best competitive price to proceed with the booking.',
    );
    // The approved ls_n_0106 has 4 variables (Meta rejected 5: "localizable_params (5) does not
    // match the expected number of params (4)").
    expect(msg91BodyOf('LS_N_0106')).toBe(
      'New load from Loadsmart: {{var1}}. Truck type: {{var2}}, weight: {{var3}} tons, reporting time: {{var4}}. Send us your best rate. We have a new load opportunity available and look forward to receiving your quotation. Please share your best competitive price to proceed with the booking.',
    );
    expect(offerActionsOf('LS_N_0105')).toEqual(['accept', 'negotiate', 'reject']);
    expect(actionOfButtonTitle('LS_N_0105', 'negotiate')).toBe('negotiate');
    expect(actionOfButtonTitle('LS_N_0069', 'Accept memo')).toBe('accept');
    expect(actionOfButtonTitle('LS_N_0069', 'View memo')).toBeNull();
    expect(actionOfButtonTitle('LS_N_0115', 'Sent by courier')).toBeNull();
  });
});
