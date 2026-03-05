export type SponsorSettings = {
  showSponsors?: boolean | null;
};

export function shouldShowSponsors(settings?: SponsorSettings | null): boolean {
  return Boolean(settings?.showSponsors);
}
