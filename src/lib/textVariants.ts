export interface TextVariant {
  subject: string;
  bodyHtml: string;
}

// Чек-пойнт ротации текста (п.5 ТЗ): если оператор заранее заготовил несколько
// вариантов темы/текста — используем текущий активный, иначе базовую тему/текст кампании.
export function getCurrentVariant(campaign: {
  subject: string;
  bodyHtml: string;
  textVariants: unknown;
  activeVariantIndex: number;
}): TextVariant {
  const variants = Array.isArray(campaign.textVariants) ? (campaign.textVariants as TextVariant[]) : [];
  if (variants.length === 0) return { subject: campaign.subject, bodyHtml: campaign.bodyHtml };
  return variants[campaign.activeVariantIndex % variants.length] ?? { subject: campaign.subject, bodyHtml: campaign.bodyHtml };
}
