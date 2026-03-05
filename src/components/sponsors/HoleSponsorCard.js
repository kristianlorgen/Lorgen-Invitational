import { SponsorBadgeCard } from './SponsorBadgeCard';

export function HoleSponsorCard({ holeNumber, sponsor, message = '' }) {
  if (!sponsor || !holeNumber) return '';
  return { holeNumber, card: SponsorBadgeCard({ sponsor, message }) };
}
