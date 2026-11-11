/** Contrato inicial; inventário não representa conversão nem validação funcional. */
export interface SiteInventory {
  source: string;
  files: string[];
  phpFiles: string[];
  htmlFiles: string[];
  styleFiles: string[];
  scriptFiles: string[];
}
export type PartStatus = 'pending' | 'converted-by-rule' | 'converted-by-gemini' | 'unfinished' | 'blocked';
